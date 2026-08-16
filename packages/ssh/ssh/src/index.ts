/* oxlint-disable typescript/no-unsafe-argument, typescript/no-unnecessary-condition -- ssh2 dependency
 * callbacks erase Buffer generics and expose optional lifecycle states narrower than their declarations. */
/** Shared pinned-host OpenSSH connection owner for remote execution providers. */

import { constants } from 'node:fs'
import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ExecutionWorldIdentity } from '@deepseek-ai/dsh-execution-world'

declare module '@deepseek-ai/cordis' {
  interface Context { ssh: SshConnection }
}

/** OpenSSH connection configuration. */
export interface Config {
  /** DNS name or IP address of the pinned server. */
  host: string
  /** SSH port. */
  port?: number
  /** Remote account name. */
  username: string
  /** Exact OpenSSH public host key, for example `ssh-ed25519 AAAA…`. */
  pinnedHostKey: string
  /** Optional private-key path; omission uses the operator's SSH agent. */
  identityFile?: string
  /** Connection establishment deadline. */
  connectTimeoutMs?: number
  /** Server-alive interval for the shared master. */
  keepAliveSeconds?: number
}

const HOST_KEY_PATTERN = /^(?:ssh-ed25519|ecdsa-sha2-nistp(?:256|384|521)|rsa-sha2-(?:256|512)|ssh-rsa) [A-Za-z0-9+/]+={0,2}$/

export const Config: z<Config> = z.object({
  host: z.string().required(),
  port: z.natural().min(1).max(65535).default(22),
  username: z.string().required(),
  pinnedHostKey: z.string().required().pattern(HOST_KEY_PATTERN),
  identityFile: z.string(),
  connectTimeoutMs: z.natural().min(1).default(15_000),
  keepAliveSeconds: z.natural().min(1).default(15),
})

/** Stable plugin name. */
export const name = 'ssh'

/** A completed remote command. */
export interface SshCommandResult {
  readonly exitCode: number
  readonly stdout: Buffer
  readonly stderr: Buffer
}

/** Options for one remote command channel. */
export interface SshCommandOptions {
  readonly input?: Uint8Array
  readonly signal?: AbortSignal
}

/** Options for one live remote command channel. */
export interface SshChannelOptions {
  /** Allocate a remote pseudo-terminal and force it even without a local TTY. */
  readonly terminal?: boolean
  /** Abort only this transport channel; remote workload cleanup belongs to its provider. */
  readonly signal?: AbortSignal
}

/** One live channel multiplexed over the authenticated SSH master. */
export interface SshChannel {
  /** Bytes delivered to the remote command's standard input. */
  readonly stdin: Writable
  /** Remote standard output, or terminal output when a PTY was requested. */
  readonly stdout: Readable
  /** OpenSSH diagnostics and remote standard error outside terminal mode. */
  readonly stderr: Readable
  /** Local ssh-client process id. This is never the remote workload id. */
  readonly transportPid: number
  /** Resolves after the local transport closes. */
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: NodeJS.Signals | null }>
  /** Terminate only this local transport channel. */
  close(): void
}

/** Injectable process boundary used by lifecycle tests. */
export const internals: {
  spawn: typeof spawn
  delay(ms: number): Promise<void>
} = {
  spawn,
  delay: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

/**
 * Quote one argument for the POSIX login shell mandated by the SSH protocol.
 * @param value - Literal argument value.
 * @returns POSIX shell word preserving the exact value.
 */
export function quoteRemoteArg(value: string): string {
  if (value.includes('\0')) throw new TypeError('SSH command arguments cannot contain NUL')
  return `'${value.replaceAll("'", "'\\''")}'`
}

/** One connection owner shared by filesystem and subprocess providers. */
export class SshConnection extends Service {
  static Config = Config
  /** Opaque identity shared by every provider using this owner. */
  readonly executionWorld: ExecutionWorldIdentity

  private readonly port: number
  private readonly connectTimeoutMs: number
  private readonly keepAliveSeconds: number
  private directory: string | undefined
  private socket: string | undefined
  private knownHosts: string | undefined
  private master: ChildProcessWithoutNullStreams | undefined
  private readonly channels = new Set<ChildProcessWithoutNullStreams>()
  private opening: Promise<void>
  private closing = false

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'ssh')
    validateConfig(config)
    this.port = config.port ?? 22
    this.connectTimeoutMs = config.connectTimeoutMs ?? 15_000
    this.keepAliveSeconds = config.keepAliveSeconds ?? 15
    this.executionWorld = Object.freeze({ label: `ssh:${config.username}@${config.host}:${String(this.port)}` })
    this.opening = this.open()
    ctx.effect(() => () => this.close(), 'ssh connection teardown')
  }

  /** Await the authenticated ControlMaster connection. */
  async ready(): Promise<void> {
    if (this.closing) throw new Error('ssh: connection is closing')
    await this.opening
    if (this.closing) throw new Error('ssh: connection closed during setup')
  }

  /**
   * Run one remote argv through the authenticated shared connection.
   * @param argv - Program and literal arguments.
   * @param options - Optional input and cancellation.
   * @returns Captured exit status and output.
   */
  async command(argv: readonly string[], options: SshCommandOptions = {}): Promise<SshCommandResult> {
    if (argv.length === 0) throw new Error('ssh: remote argv must contain a program')
    const channel = await this.spawnChannel(argv, options.signal === undefined ? {} : { signal: options.signal })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    channel.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
    channel.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
    channel.stdin.end(options.input)
    const outcome = await channel.done
    options.signal?.throwIfAborted()
    return { exitCode: outcome.exitCode ?? 255, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
  }

  /**
   * Start one live remote argv through the authenticated shared connection.
   * @param argv - Program and literal arguments.
   * @param options - PTY and transport cancellation options.
   * @returns Live multiplexed channel.
   */
  async spawnChannel(argv: readonly string[], options: SshChannelOptions = {}): Promise<SshChannel> {
    if (argv.length === 0) throw new Error('ssh: remote argv must contain a program')
    await this.ready()
    options.signal?.throwIfAborted()
    const command = argv.map(quoteRemoteArg).join(' ')
    const child = internals.spawn('ssh', [
      ...this.channelArgs(),
      ...(options.terminal === true ? ['-tt'] : []),
      this.target(), '--', command,
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.channels.add(child)
    const settled = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    let transportError: Error | undefined
    child.once('error', (error) => { transportError = error })
    child.once('close', (exitCode, signal) => {
      this.channels.delete(child)
      if (transportError !== undefined) settled.reject(transportError)
      else settled.resolve({ exitCode, signal })
    })
    const abort = (): void => { child.kill('SIGTERM') }
    options.signal?.addEventListener('abort', abort, { once: true })
    void settled.promise.finally(() => {
      options.signal?.removeEventListener('abort', abort)
    }).catch(() => {})
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      transportPid: child.pid ?? -1,
      done: settled.promise,
      close: () => { child.kill('SIGTERM') },
    }
  }

  private async open(): Promise<void> {
    if (this.config.identityFile !== undefined) {
      await access(this.config.identityFile, constants.R_OK)
    }
    const directory = await mkdtemp(join(tmpdir(), 'sivitacode-ssh-'))
    await chmod(directory, 0o700)
    this.directory = directory
    this.socket = join(directory, 'control')
    this.knownHosts = join(directory, 'known_hosts')
    await writeFile(this.knownHosts, `${knownHostToken(this.config.host, this.port)} ${this.config.pinnedHostKey}\n`, { mode: 0o600 })
    const master = internals.spawn('ssh', [
      ...this.baseArgs(), '-M', '-N', '-S', this.socket, '-o', 'ControlPersist=no', this.target(),
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.master = master
    let diagnostic = ''
    master.stderr.on('data', (chunk) => { diagnostic = (diagnostic + String(chunk)).slice(-8192) })
    const failure = Promise.withResolvers<never>()
    void failure.promise.catch(() => {})
    master.once('error', failure.reject)
    master.once('close', (code) =>{  failure.reject(new Error(`ssh: master exited during setup (${String(code)}): ${diagnostic.trim()}`)) })
    const deadline = Date.now() + this.connectTimeoutMs
    while (Date.now() < deadline) {
      if (this.closing) throw new Error('ssh: connection closed during setup')
      const checked = await Promise.race([this.checkMaster(), failure.promise])
      if (checked) return
      await internals.delay(50)
    }
    master.kill('SIGTERM')
    throw new Error(`ssh: connection to ${this.target()} timed out`)
  }

  private async checkMaster(): Promise<boolean> {
    if (this.socket === undefined) return false
    const child = internals.spawn('ssh', [...this.baseArgs(), '-S', this.socket, '-O', 'check', this.target()], {
      stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
    })
    return new Promise((resolve) => {
      child.once('error', () =>{  resolve(false) })
      child.once('close', (code) =>{  resolve(code === 0) })
    })
  }

  private baseArgs(): string[] {
    if (this.knownHosts === undefined) throw new Error('ssh: connection paths are not initialized')
    const seconds = Math.max(1, Math.ceil(this.connectTimeoutMs / 1000))
    return [
      '-p', String(this.port),
      '-o', 'BatchMode=yes',
      '-o', 'PasswordAuthentication=no',
      '-o', 'KbdInteractiveAuthentication=no',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${this.knownHosts}`,
      '-o', `ConnectTimeout=${String(seconds)}`,
      '-o', `ServerAliveInterval=${String(this.keepAliveSeconds)}`,
      '-o', 'ServerAliveCountMax=3',
      ...this.config.identityFile === undefined ? [] : ['-o', 'IdentitiesOnly=yes', '-i', this.config.identityFile],
    ]
  }

  private channelArgs(): string[] {
    if (this.socket === undefined) throw new Error('ssh: connection is not ready')
    return [...this.baseArgs(), '-S', this.socket]
  }

  private target(): string { return `${this.config.username}@${this.config.host}` }

  private async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    try {
      await this.opening.catch(() => {})
      const channels = [...this.channels]
      for (const channel of channels) channel.kill('SIGTERM')
      await Promise.all(channels.map(channel => new Promise<void>((resolve) => {
        if (channel.exitCode !== null || channel.signalCode !== null) resolve()
        else {
          channel.once('error', () =>{  resolve() })
          channel.once('close', () =>{  resolve() })
        }
      })))
      if (this.socket !== undefined && this.master?.exitCode === null) {
        const exit = internals.spawn('ssh', [...this.baseArgs(), '-S', this.socket, '-O', 'exit', this.target()], {
          stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
        })
        await new Promise<void>((resolve) => {
          exit.once('error', () =>{  resolve() })
          exit.once('close', () =>{  resolve() })
        })
        if (this.master.exitCode === null) this.master.kill('SIGTERM')
      }
    } finally {
      if (this.directory !== undefined) await rm(this.directory, { recursive: true, force: true })
    }
  }
}

function validateConfig(config: Config): void {
  if (config.host.length === 0 || /[\s\0]/u.test(config.host)) throw new TypeError('ssh: host must be non-empty and contain no whitespace')
  if (config.username.length === 0 || /[\s@\0]/u.test(config.username)) throw new TypeError('ssh: username must be non-empty and contain no whitespace or @')
  if (!HOST_KEY_PATTERN.test(config.pinnedHostKey)) throw new TypeError('ssh: pinnedHostKey must be one exact OpenSSH public host key')
  const port = config.port ?? 22
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('ssh: port must be an integer from 1 to 65535')
}

function knownHostToken(host: string, port: number): string {
  const unbracketed = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  return port === 22 ? unbracketed : `[${unbracketed}]:${String(port)}`
}

export default SshConnection
