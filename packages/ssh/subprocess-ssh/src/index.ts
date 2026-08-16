/* oxlint-disable typescript/no-unsafe-return -- ssh2 callback arrays are normalized at the public adapter. */
import { posix } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { SshSubprocessHandle } from './process.ts'
import { REMOTE_STATE_GC, RESOLVE_EXECUTABLE } from './runner.ts'
import { SshTerminalHandle } from './terminal.ts'

const MAX_TIMER_DELAY_MS = 2_147_483_647
const REMOTE_STATE_RETENTION_SECONDS = 24 * 60 * 60

/** SSH subprocess provider configuration. */
export interface Config {
  /** Remote process-liveness polling cadence. */
  pollMs?: number
  /** Remote project root corresponding to the control-plane workspace. */
  cwd?: string
  /** Control-plane path represented by `cwd`; defaults to process.cwd(). */
  localAnchor?: string
}

/** SSH subprocess provider configuration schema. */
export const Config: z<Config> = z.object({
  pollMs: z.natural().min(1).default(50),
  cwd: z.string(),
  localAnchor: z.string(),
})

function requireGrace(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`subprocess graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

/** Managed subprocess provider inside the shared pinned SSH execution world. */
export class SshSubprocessRuntime extends SubprocessRuntime {
  static inject = ['ssh']
  static Config = Config

  override get executionWorld() { return this.ctx.ssh.executionWorld }

  private readonly live = new Set<SshSubprocessHandle>()
  private readonly terminals = new Set<SshTerminalHandle>()
  private readonly pollMs: number
  private readonly remoteCwd: string | undefined
  private readonly localAnchor: string
  private readonly maintenance: Promise<void>
  private disposing = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.pollMs = config.pollMs ?? 50
    this.remoteCwd = config.cwd
    this.localAnchor = posix.resolve(config.localAnchor ?? process.cwd())
    this.maintenance = this.collectStaleState()
    void this.maintenance.catch(() => {})
    if (!Number.isSafeInteger(this.pollMs) || this.pollMs <= 0) {
      throw new Error('subprocess-ssh: pollMs must be a positive safe integer')
    }
    if (this.remoteCwd !== undefined && !posix.isAbsolute(this.remoteCwd)) {
      throw new Error('subprocess-ssh: cwd must be an absolute POSIX path')
    }
    ctx.effect(() => async () => {
      this.disposing = true
      await this.maintenance
      const handles = [...this.live]
      const terminals = [...this.terminals]
      for (const handle of handles) handle.terminate()
      const outcomes = await Promise.allSettled([...handles.map(async (handle) => {
        await handle.waitForExit()
        await handle.done.catch(() => undefined)
        this.live.delete(handle)
      }), ...terminals.map(async (terminal) => {
        await terminal.terminate()
        this.terminals.delete(terminal)
      })])
      const failures = outcomes.flatMap<unknown>(outcome => outcome.status === 'rejected' ? [outcome.reason] : [])
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'subprocess-ssh: teardown failed')
    }, 'ssh subprocess teardown')
  }

  /** @inheritdoc */
  async resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    if (command.length === 0) throw new Error('subprocess-ssh: executable must be non-empty')
    if (!posix.isAbsolute(command) && command.includes('/')) {
      throw new Error(`subprocess-ssh: command ${JSON.stringify(command)} is a relative path; use an absolute path or a bare PATH name`)
    }
    signal?.throwIfAborted()
    await this.maintenance
    signal?.throwIfAborted()
    const options = {
      input: Buffer.from(JSON.stringify({ command, path: env?.PATH })),
      ...(signal === undefined ? {} : { signal }),
    }
    const result = await this.ctx.ssh.command(['python3', '-c', RESOLVE_EXECUTABLE], options)
    if (result.exitCode !== 0) throw new Error(`subprocess-ssh: executable lookup failed: ${result.stderr.toString().trim()}`)
    const response = JSON.parse(result.stdout.toString()) as { ok: boolean; path: string | null }
    if (!response.ok || response.path === null) {
      throw new Error(`subprocess-ssh: command ${JSON.stringify(command)} was not found as an executable`)
    }
    return response.path
  }

  /** @inheritdoc */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (this.disposing) throw new Error('subprocess-ssh: service is disposing')
    const program = spec.argv[0]
    if (program === undefined || program.length === 0) throw new Error('subprocess-ssh: argv must contain a program')
    requireGrace(spec.graceMs)
    spec.signal?.throwIfAborted()
    const handle = new SshSubprocessHandle(
      this.ctx.ssh,
      { ...spec, cwd: this.mappedCwd(spec.cwd) },
      this.pollMs,
      this.maintenance,
    )
    this.live.add(handle)
    const release = async (): Promise<void> => {
      await handle.waitForExit()
      this.live.delete(handle)
    }
    void handle.done.then(release, release).catch(() => {})
    return handle
  }

  /** @inheritdoc */
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    if (this.disposing) throw new Error('subprocess-ssh: service is disposing')
    const program = spec.argv[0]
    if (program === undefined || program.length === 0) throw new Error('subprocess-ssh: terminal argv must contain a program')
    requireGrace(spec.graceMs)
    spec.signal?.throwIfAborted()
    await this.maintenance
    spec.signal?.throwIfAborted()
    const terminal = new SshTerminalHandle(this.ctx.ssh, { ...spec, cwd: this.mappedCwd(spec.cwd) }, this.pollMs)
    this.terminals.add(terminal)
    const release = async (): Promise<void> => {
      await terminal.terminate()
      this.terminals.delete(terminal)
    }
    void terminal.done.then(release, release).catch(() => {})
    return terminal
  }

  private mappedCwd(cwd: string): string {
    if (this.remoteCwd === undefined) return cwd
    const normalized = posix.resolve(cwd)
    const relative = posix.relative(this.localAnchor, normalized)
    if (relative === '') return this.remoteCwd
    if (relative !== '..' && !relative.startsWith('../')) return posix.resolve(this.remoteCwd, relative)
    return cwd
  }

  private async collectStaleState(): Promise<void> {
    const result = await this.ctx.ssh.command(['python3', '-c', REMOTE_STATE_GC], {
      input: Buffer.from(JSON.stringify({ minimumAgeSeconds: REMOTE_STATE_RETENTION_SECONDS })),
    })
    if (result.exitCode !== 0) {
      throw new Error(`subprocess-ssh: remote state maintenance failed: ${result.stderr.toString().trim()}`)
    }
  }
}

export default SshSubprocessRuntime
