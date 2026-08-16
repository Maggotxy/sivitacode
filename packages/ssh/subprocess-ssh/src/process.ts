import { randomUUID } from 'node:crypto'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputMode,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { SshConnection } from '@deepseek-ai/dsh-ssh'
import { SshOutputReader } from './output.ts'
import { PROCESS_CONTROL, PROCESS_RUNNER } from './runner.ts'

interface ControlResult {
  alive: boolean
  groups: number[]
  outcome: SubprocessOutcome | null
}

function collected(mode: SubprocessOutputMode): mode is Exclude<SubprocessOutputMode, string> {
  return typeof mode === 'object'
}

/** One remotely owned POSIX process tree. */
export class SshSubprocessHandle implements SubprocessHandle {
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly collected: SubprocessHandle['collected']
  readonly done: Promise<SubprocessOutcome>

  private remotePid = -1
  private readonly state = `/tmp/.sivitacode-process-${randomUUID()}`
  private readonly token = randomUUID()
  private readonly input = new PassThrough()
  private readonly stdoutPipe = new PassThrough()
  private readonly stderrPipe = new PassThrough()
  private readonly stdoutReader: SshOutputReader | undefined
  private readonly stderrReader: SshOutputReader | undefined
  private readonly ready = Promise.withResolvers<void>()
  private terminated = false
  private quiescent = false
  private termination: Promise<void> | undefined

  constructor(
    private readonly ssh: SshConnection,
    private readonly spec: SubprocessSpawnSpec,
    private readonly pollMs: number,
    private readonly prepare: Promise<void> = Promise.resolve(),
  ) {
    const stdoutMode = spec.stdio.stdout
    const stderrMode = spec.stdio.stderr
    this.stdout = stdoutMode === 'pipe' ? this.stdoutPipe : undefined
    this.stderr = stderrMode === 'pipe' ? this.stderrPipe : undefined
    this.stdin = spec.stdio.stdin === 'pipe' ? this.input : undefined
    this.stdoutReader = collected(stdoutMode)
      ? new SshOutputReader(stdoutMode.maxBytes, stdoutMode.spill?.maxBytes, stdoutMode.spill === undefined ? undefined : `${this.state}/stdout`)
      : undefined
    this.stderrReader = collected(stderrMode)
      ? new SshOutputReader(stderrMode.maxBytes, stderrMode.spill?.maxBytes, stderrMode.spill === undefined ? undefined : `${this.state}/stderr`)
      : undefined
    this.collected = {
      ...(this.stdoutReader === undefined ? {} : { stdout: this.stdoutReader }),
      ...(this.stderrReader === undefined ? {} : { stderr: this.stderrReader }),
    }
    this.done = this.run()
    void this.ready.promise.catch(() => {})
    void this.done.catch(() => {})
    spec.signal?.addEventListener('abort', this.onAbort, { once: true })
    if (spec.signal?.aborted === true) this.terminate()
  }

  /** Remote process id after the runner publishes it. */
  get pid(): number { return this.remotePid }

  /** @inheritdoc */
  terminate(): void {
    if (this.quiescent || this.termination !== undefined) return
    this.terminated = true
    this.termination = this.terminateRemote().finally(() => { this.termination = undefined })
    void this.termination.catch(() => {})
  }

  /** @inheritdoc */
  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    while (!this.quiescent) {
      if (signal?.aborted === true) return false
      const result = await this.control()
      if (!result.alive) {
        this.quiescent = true
        return true
      }
      await delay(this.pollMs, undefined, signal === undefined ? undefined : { signal }).catch(() => {})
    }
    return true
  }

  private readonly onAbort = (): void => { this.terminate() }

  private async run(): Promise<SubprocessOutcome> {
    try {
      await this.prepare
      this.spec.signal?.throwIfAborted()
      const stdoutMode = this.spec.stdio.stdout
      const stderrMode = this.spec.stdio.stderr
      const request = {
        state: this.state,
        token: this.token,
        argv: this.spec.argv,
        cwd: this.spec.cwd,
        env: this.spec.env ?? {},
        ...(collected(stdoutMode) && stdoutMode.spill !== undefined ? { stdoutSpill: { path: `${this.state}/stdout`, maxBytes: stdoutMode.spill.maxBytes } } : {}),
        ...(collected(stderrMode) && stderrMode.spill !== undefined ? { stderrSpill: { path: `${this.state}/stderr`, maxBytes: stderrMode.spill.maxBytes } } : {}),
      }
      const channel = await this.ssh.spawnChannel(['python3', '-c', PROCESS_RUNNER])
      this.routeOutput(channel.stdout, stdoutMode, this.stdoutPipe, this.stdoutReader, process.stdout)
      this.routeOutput(channel.stderr, stderrMode, this.stderrPipe, this.stderrReader, process.stderr, true)
      channel.stdin.write(`${JSON.stringify(request)}\n`)
      if (this.spec.stdio.stdin === 'ignore') channel.stdin.end()
      else if (typeof this.spec.stdio.stdin === 'object') channel.stdin.end(this.spec.stdio.stdin.data)
      else this.input.pipe(channel.stdin)
      const transport = await channel.done
      this.stdoutPipe.end()
      this.stderrPipe.end()
      if (transport.signal !== null && !this.terminated) {
        throw new Error(`subprocess-ssh: transport terminated by ${transport.signal}`)
      }
      const result = await this.control()
      if (result.alive) throw new Error('subprocess-ssh: transport closed while the remote process tree is still alive')
      if (result.outcome === null) throw new Error('subprocess-ssh: remote process exited without a durable outcome')
      this.quiescent = true
      this.remotePid = -1
      if (this.stdoutReader?.readFrom(0).spillPath === undefined && this.stderrReader?.readFrom(0).spillPath === undefined) {
        await this.control(undefined, true)
      }
      return result.outcome
    } catch (error: unknown) {
      this.ready.reject(error)
      throw error
    } finally {
      this.spec.signal?.removeEventListener('abort', this.onAbort)
    }
  }

  private routeOutput(
    source: Readable,
    mode: SubprocessOutputMode,
    pipe: PassThrough,
    reader: SshOutputReader | undefined,
    inherited: NodeJS.WriteStream,
    filterReady = false,
  ): void {
    let pending = Buffer.alloc(0)
    source.on('data', (value: Buffer) => {
      let bytes = Buffer.from(value)
      if (filterReady && this.remotePid < 0) {
        pending = Buffer.concat([pending, bytes])
        const marker = Buffer.from('\0SIVITACODE_PROCESS_READY ')
        const start = pending.indexOf(marker)
        const end = start < 0 ? -1 : pending.indexOf(10, start)
        if (end < 0) {
          if (pending.length > 65_536) throw new Error('subprocess-ssh: missing remote process readiness marker')
          return
        }
        const facts = JSON.parse(pending.subarray(start + marker.length, end).toString()) as { pid: number }
        this.remotePid = facts.pid
        this.ready.resolve()
        bytes = Buffer.concat([pending.subarray(0, start), pending.subarray(end + 1)])
        pending = Buffer.alloc(0)
      }
      if (bytes.length === 0) return
      if (mode === 'pipe') pipe.write(bytes)
      else if (mode === 'inherit') inherited.write(bytes)
      else reader?.push(bytes)
    })
  }

  private async control(action?: 'TERM' | 'KILL', cleanup = false): Promise<ControlResult> {
    const result = await this.ssh.command(['python3', '-c', PROCESS_CONTROL], {
      input: Buffer.from(JSON.stringify({ state: this.state, action, cleanup })),
    })
    if (result.exitCode !== 0) throw new Error(`subprocess-ssh: process control failed: ${result.stderr.toString().trim()}`)
    return JSON.parse(result.stdout.toString()) as ControlResult
  }

  private async terminateRemote(): Promise<void> {
    try {
      await this.ready.promise
    } catch {
      return
    }
    let state = await this.control('TERM')
    const deadline = Date.now() + this.spec.graceMs
    while (state.alive && Date.now() < deadline) {
      await delay(Math.min(this.pollMs, Math.max(1, deadline - Date.now())))
      state = await this.control()
    }
    if (state.alive) {
      await this.control('KILL')
      do {
        await delay(this.pollMs)
        state = await this.control()
      } while (state.alive)
    }
    this.quiescent = true
    if (this.stdoutReader?.readFrom(0).spillPath === undefined && this.stderrReader?.readFrom(0).spillPath === undefined) {
      await this.control(undefined, true)
    }
  }
}
