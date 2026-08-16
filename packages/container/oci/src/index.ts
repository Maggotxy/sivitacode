/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unsafe-assignment, typescript/no-unnecessary-condition, @stylistic/max-len -- ssh2 stream buffers use dependency-erased Buffer generics and runtime inspection JSON is validated immediately below. */
/** Rootless OCI container owner implementing the shared remote-command protocol. */

import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ExecutionWorldIdentity } from '@deepseek-ai/dsh-execution-world'
import type { SshChannel, SshChannelOptions, SshCommandOptions, SshCommandResult } from '@deepseek-ai/dsh-ssh'
import type {} from '@deepseek-ai/dsh-ssh'

/** OCI owner configuration. */
export interface Config {
  /** Exact runtime executable; only Docker and Podman CLI protocols are supported. */
  runtime: 'docker' | 'podman'
  /** Immutable image reference; deployments should use a digest. */
  image: string
  /** Existing host project directory bind-mounted at the identical container path. */
  workspace: string
  /** Disable container networking unless explicitly enabled. */
  network?: 'none' | 'host'
  /** Require the runtime to prove rootless operation. */
  requireRootless?: boolean
  /** Upper bound for runtime inspection and container lifecycle commands. */
  lifecycleTimeoutMs?: number
  /** Memory limit accepted by Docker and Podman. */
  memory?: string
  /** CPU quota accepted by Docker and Podman. */
  cpus?: number
}

/** OCI owner configuration schema. */
export const Config: z<Config> = z.object({
  runtime: z.union(['docker', 'podman'] as const).default('podman'),
  image: z.string().required(), workspace: z.string().required(),
  network: z.union(['none', 'host'] as const).default('none'), requireRootless: z.boolean().default(true),
  lifecycleTimeoutMs: z.number().min(1_000).max(120_000).default(20_000),
  memory: z.string().default('2g'), cpus: z.number().min(0.1).max(128).default(2),
})

/** Injectable CLI boundary and parsers for hermetic lifecycle tests. */
export const internals = { spawn, provesRootless }

/** One persistent rootless OCI container shared by filesystem, process, and PTY adapters. */
export class OciContainer extends Service {
  /** Uses the existing remote-command adapter service key. */
  static Config = Config
  /** Opaque identity shared by every adapter mounted on this container. */
  readonly executionWorld: ExecutionWorldIdentity
  private readonly containerName = `sivitacode-${randomUUID()}`
  private readonly opening: Promise<void>
  private readonly channels = new Set<ChildProcessWithoutNullStreams>()
  private closing = false

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'ssh')
    if (!config.workspace.startsWith('/')) throw new Error('oci: workspace must be absolute')
    if (config.image.trim().length === 0) throw new Error('oci: image must be non-empty')
    this.executionWorld = Object.freeze({ label: `oci:${config.runtime}:${this.containerName}` })
    this.opening = this.open()
    ctx.effect(() => () => this.closeOwner(), 'oci container teardown')
  }

  /** Await rootless verification and persistent container creation. */
  async ready(): Promise<void> {
    if (this.closing) throw new Error('oci: container is closing')
    await this.opening
  }

  /**
   * Run literal argv through one `exec` channel.
   * @param argv - Program and arguments passed without a shell.
   * @param options - Input and cancellation controls.
   * @returns Captured command result after the runtime channel closes.
   */
  async command(argv: readonly string[], options: SshCommandOptions = {}): Promise<SshCommandResult> {
    const channel = await this.spawnChannel(argv, options.signal === undefined ? {} : { signal: options.signal })
    const stdout: Buffer[] = []; const stderr: Buffer[] = []
    channel.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    channel.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    channel.stdin.end(options.input)
    const result = await channel.done
    options.signal?.throwIfAborted()
    return { exitCode: result.exitCode ?? 255, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
  }

  /**
   * Start one live literal-argv exec channel, optionally with an OCI PTY.
   * @param argv - Program and arguments passed without a shell.
   * @param options - Terminal and cancellation controls.
   * @returns Live channel backed by the runtime CLI.
   */
  async spawnChannel(argv: readonly string[], options: SshChannelOptions = {}): Promise<SshChannel> {
    if (argv.length === 0) throw new Error('oci: argv must contain a program')
    await this.ready(); options.signal?.throwIfAborted()
    const child = internals.spawn(this.config.runtime, [
      'exec', '-i', ...(options.terminal === true ? ['-t'] : []), this.containerName, ...argv,
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.channels.add(child)
    const done = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    let failure: Error | undefined
    child.once('error', (error) => { failure = error })
    child.once('close', (exitCode, signal) => {
      this.channels.delete(child)
      if (failure === undefined) done.resolve({ exitCode, signal })
      else done.reject(failure)
    })
    const abort = (): void => { child.kill('SIGTERM') }
    options.signal?.addEventListener('abort', abort, { once: true })
    void done.promise.finally(() => { options.signal?.removeEventListener('abort', abort) }).catch(() => {})
    return { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, transportPid: child.pid ?? -1, done: done.promise, close: abort }
  }

  private async open(): Promise<void> {
    if (this.config.requireRootless ?? true) await this.verifyRootless()
    const result = await capture(this.config.runtime, [
      'run', '--detach', '--rm', '--name', this.containerName,
      '--network', this.config.network ?? 'none', '--security-opt', 'no-new-privileges',
      '--cap-drop', 'ALL', '--pids-limit', '512', '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m', '--tmpfs', '/run:rw,noexec,nosuid,size=64m',
      '--memory', this.config.memory ?? '2g', '--cpus', String(this.config.cpus ?? 2),
      '--mount', `type=bind,src=${this.config.workspace},dst=${this.config.workspace}`,
      '--workdir', this.config.workspace, this.config.image,
      'python3', '-c', 'import signal,time; signal.signal(signal.SIGTERM,lambda *_:exit(0)); time.sleep(10**9)',
    ], this.config.lifecycleTimeoutMs ?? 20_000)
    if (result.code !== 0) {
      await capture(this.config.runtime, ['rm', '--force', this.containerName], this.config.lifecycleTimeoutMs ?? 20_000).catch(() => undefined)
      throw new Error(`oci: container creation failed: ${diagnostic(result.stderr)}`)
    }
  }

  private async verifyRootless(): Promise<void> {
    const args = this.config.runtime === 'docker'
      ? ['info', '--format', '{{json .SecurityOptions}}']
      : ['info', '--format', 'json']
    const result = await capture(this.config.runtime, args, this.config.lifecycleTimeoutMs ?? 20_000)
    if (result.code !== 0) throw new Error(`oci: ${this.config.runtime} runtime unavailable: ${diagnostic(result.stderr)}`)
    if (!provesRootless(this.config.runtime, result.stdout)) throw new Error(`oci: ${this.config.runtime} did not prove rootless operation`)
  }

  private async closeOwner(): Promise<void> {
    if (this.closing) return
    this.closing = true
    await this.opening.catch(() => undefined)
    const channels = [...this.channels]
    for (const channel of channels) channel.kill('SIGTERM')
    await Promise.all(channels.map(waitChild))
    await capture(this.config.runtime, ['rm', '--force', this.containerName], this.config.lifecycleTimeoutMs ?? 20_000).catch(() => undefined)
  }
}

const CAPTURE_LIMIT_BYTES = 65_536

async function capture(command: string, args: readonly string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = internals.spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout: Buffer = Buffer.alloc(0); let stderr: Buffer = Buffer.alloc(0)
  child.stdout?.on('data', (chunk) => { stdout = appendTail(stdout, Buffer.from(chunk)) })
  child.stderr?.on('data', (chunk) => { stderr = appendTail(stderr, Buffer.from(chunk)) })
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`oci: runtime command timed out after ${String(timeoutMs)}ms`)) }, timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 255, stdout: stdout.toString(), stderr: stderr.toString() }) })
  })
}

function appendTail(current: Buffer, chunk: Buffer): Buffer {
  const combined = Buffer.concat([current, chunk])
  return combined.length <= CAPTURE_LIMIT_BYTES ? combined : combined.subarray(combined.length - CAPTURE_LIMIT_BYTES)
}

function provesRootless(runtime: Config['runtime'], output: string): boolean {
  try {
    const value: unknown = JSON.parse(output)
    if (runtime === 'docker') return Array.isArray(value) && value.some(option => typeof option === 'string' && option.toLowerCase().includes('rootless'))
    if (typeof value !== 'object' || value === null) return false
    const host = Reflect.get(value, 'host')
    const security = typeof host === 'object' && host !== null ? Reflect.get(host, 'security') : undefined
    return typeof security === 'object' && security !== null && Reflect.get(security, 'rootless') === true
  } catch (_invalidRuntimeJson) {
    return false
  }
}

function diagnostic(stderr: string): string {
  const trimmed = stderr.trim()
  return trimmed.length === 0 ? 'runtime returned no diagnostic' : trimmed
}

async function waitChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => { child.once('error', () =>{  resolve() }); child.once('close', () =>{  resolve() }) })
}

export default OciContainer
