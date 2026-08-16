import { randomUUID } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import type {
  SubprocessOutcome,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { SshConnection, SshChannel } from '@deepseek-ai/dsh-ssh'
import { TERMINAL_CONTROL, TERMINAL_RUNNER } from './runner.ts'

interface TerminalControlResult {
  groups: number[]
  foreground: number | null
  inputWaiting: boolean
}

const SIGNAL_ACTION: Record<SubprocessTerminalSignal, 'INT' | 'TERM' | 'KILL' | 'TSTP' | 'HUP'> = {
  SIGINT: 'INT',
  SIGTERM: 'TERM',
  SIGKILL: 'KILL',
  SIGTSTP: 'TSTP',
  SIGHUP: 'HUP',
}

/** One OpenSSH-allocated PTY and all token-owned remote process groups. */
export class SshTerminalHandle implements SubprocessTerminalHandle {
  readonly output = new PassThrough()
  readonly done: Promise<SubprocessOutcome>
  private remotePid = -1
  private readonly state = `/tmp/.sivitacode-terminal-${randomUUID()}`
  private readonly token = randomUUID()
  private readonly ready = Promise.withResolvers<void>()
  private closing: Promise<void> | undefined
  private operations = new Set<Promise<unknown>>()
  private transport: SshChannel | undefined

  constructor(
    private readonly ssh: SshConnection,
    private readonly spec: SubprocessTerminalSpawnSpec,
    private readonly pollMs: number,
    private readonly prepare: Promise<void> = Promise.resolve(),
  ) {
    void this.ready.promise.catch(() => {})
    this.done = this.run()
    void this.done.catch(() => {})
  }

  /** Remote terminal leader pid after allocation. */
  get pid(): number { return this.remotePid }

  /** @inheritdoc */
  async write(data: string): Promise<void> {
    await this.ready.promise
    if (this.closing !== undefined) throw new Error('subprocess-ssh: terminal is terminating')
    const channel = this.transport
    if (channel === undefined || channel.stdin.destroyed) throw new Error('subprocess-ssh: terminal input is closed')
    await new Promise<void>((resolve, reject) => channel.stdin.write(data, (error) => {
      if (error === null || error === undefined) resolve()
      else reject(error)
    }))
  }

  /** @inheritdoc */
  async inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    await this.ready.promise
    const result = await this.track(this.control())
    if (result.foreground === null) return undefined
    return { processGroupId: result.foreground, inputWaiting: result.inputWaiting }
  }

  /** @inheritdoc */
  async signalForeground(signal: SubprocessTerminalSignal): Promise<number> {
    await this.ready.promise
    const observed = await this.track(this.control())
    if (observed.foreground === null) throw new Error('subprocess-ssh: terminal has no foreground process group')
    await this.track(this.control(SIGNAL_ACTION[signal], observed.foreground))
    return observed.foreground
  }

  /** @inheritdoc */
  terminate(): Promise<void> {
    this.closing ??= this.terminateSession()
    return this.closing
  }

  private async run(): Promise<SubprocessOutcome> {
    try {
      await this.prepare
      this.spec.signal?.throwIfAborted()
      const channel = await this.ssh.spawnChannel(['python3', '-c', TERMINAL_RUNNER], { terminal: true })
      this.transport = channel
      let pending = Buffer.alloc(0)
      const marker = Buffer.from('\0SIVITACODE_TERMINAL_READY ')
      channel.stdout.on('data', (value: Buffer) => {
        let bytes = Buffer.from(value)
        if (this.remotePid < 0) {
          pending = Buffer.concat([pending, bytes])
          const start = pending.indexOf(marker)
          const end = start < 0 ? -1 : pending.indexOf(10, start)
          if (end < 0) return
          const facts = JSON.parse(pending.subarray(start + marker.length, end).toString()) as { pid: number }
          this.remotePid = facts.pid
          bytes = pending.subarray(end + 1)
          pending = Buffer.alloc(0)
          this.ready.resolve()
        }
        if (bytes.length > 0) this.output.write(bytes)
      })
      channel.stderr.on('data', value => this.output.write(value))
      channel.stdin.write(`${JSON.stringify({
        state: this.state,
        token: this.token,
        argv: this.spec.argv,
        cwd: this.spec.cwd,
        env: this.spec.env ?? {},
        rows: this.spec.rows,
        cols: this.spec.cols,
      })}\n`)
      const result = await channel.done
      this.output.end()
      if (this.remotePid < 0) throw new Error('subprocess-ssh: terminal exited before readiness')
      return { exitCode: result.exitCode, signal: result.signal }
    } catch (error: unknown) {
      this.ready.reject(error)
      this.output.destroy(error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  private async control(
    action?: 'INT' | 'TERM' | 'KILL' | 'TSTP' | 'HUP',
    group?: number,
    cleanup = false,
  ): Promise<TerminalControlResult> {
    const result = await this.ssh.command(['python3', '-c', TERMINAL_CONTROL], {
      input: Buffer.from(JSON.stringify({ state: this.state, action, group, cleanup })),
    })
    if (result.exitCode !== 0) throw new Error(`subprocess-ssh: terminal control failed: ${result.stderr.toString().trim()}`)
    return JSON.parse(result.stdout.toString()) as TerminalControlResult
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation.finally(() => { this.operations.delete(operation) }).catch(() => {})
    return operation
  }

  private async terminateSession(): Promise<void> {
    try {
      await this.ready.promise
    } catch {
      this.transport?.close()
      await this.done.catch(() => undefined)
      return
    }
    let state = await this.control('TERM')
    const deadline = Date.now() + this.spec.graceMs
    while (state.groups.length > 0 && Date.now() < deadline) {
      await delay(Math.min(this.pollMs, Math.max(1, deadline - Date.now())))
      state = await this.control()
    }
    while (state.groups.length > 0) {
      state = await this.control('KILL')
      if (state.groups.length > 0) await delay(this.pollMs)
    }
    this.transport?.close()
    await Promise.allSettled([...this.operations])
    await this.done.catch(() => undefined)
    await this.control(undefined, undefined, true)
  }
}
