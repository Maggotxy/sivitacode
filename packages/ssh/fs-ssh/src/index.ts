/* oxlint-disable @stylistic/max-len, typescript/require-await -- interface parity keeps immediate remote-path resolution asynchronous. */
/** Filesystem provider over the shared pinned-host SSH execution world. */

import { Buffer } from 'node:buffer'
import { posix } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { FileSystem, FsError, FsTargetKey, FsVersion } from '@deepseek-ai/dsh-fs'
import type { FsDirEntry, FsEditOutcome, FsEditRequest, FsInfo, FsPathInfo, FsTarget, FsWriteIntent, FsWriteOutcome } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-ssh'
import { FS_SSH_HELPER } from './helper.ts'

interface Failure { ok: false; code: ConstructorParameters<typeof FsError>[1]; message: string }
type Reply<T> = { ok: true } & T | Failure

/** SSH filesystem workspace mapping configuration. */
export interface Config {
  /** Remote project root corresponding to the control-plane workspace. */
  cwd?: string
  /** Control-plane path represented by `cwd`; defaults to process.cwd(). */
  localAnchor?: string
}

/** SSH filesystem workspace mapping schema. */
export const Config: z<Config> = z.object({ cwd: z.string(), localAnchor: z.string() })

/** Provider class registered as `ctx.fs`. */
export class SshFileSystem extends FileSystem {
  static inject = ['ssh']
  static Config = Config
  private readonly remoteCwd: string
  private readonly localAnchor: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.remoteCwd = config.cwd ?? '/'
    this.localAnchor = posix.resolve(config.localAnchor ?? process.cwd())
    if (!posix.isAbsolute(this.remoteCwd)) throw new Error('fs-ssh: cwd must be an absolute POSIX path')
  }

  override get executionWorld() { return this.ctx.ssh.executionWorld }

  override async resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget> {
    const reply = await this.call<{ path: string }>({
      op: 'resolve',
      value: this.mapped(path),
      cwd: this.mapped(opts?.cwd ?? this.localAnchor),
    }, opts?.signal)
    return target(reply.path)
  }

  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override processPath(value: FsTarget): string { return ownedPath(value) }
  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override fileUrl(value: FsTarget): string { return pathToFileURL(ownedPath(value)).href }
  override contains(parent: FsTarget, child: FsTarget): boolean {
    const relative = posix.relative(ownedPath(parent), ownedPath(child))
    return relative === '' || relative !== '..' && !relative.startsWith('../')
  }

  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override async stat(value: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined> {
    const reply = await this.call<{ info: FsInfo | undefined }>({ op: 'stat', path: ownedPath(value) }, signal)
    return reply.info === undefined ? undefined : withVersion(reply.info)
  }

  override async lstat(path: string, opts?: { cwd?: string }, signal?: AbortSignal): Promise<FsPathInfo | undefined> {
    const mapped = this.mapped(path)
    const resolved = posix.isAbsolute(mapped) ? mapped : posix.resolve(this.mapped(opts?.cwd ?? this.localAnchor), mapped)
    const reply = await this.call<{ info: FsPathInfo | undefined }>({ op: 'lstat', path: resolved }, signal)
    return reply.info === undefined ? undefined : withVersion(reply.info)
  }

  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override async readText(value: FsTarget, signal?: AbortSignal): Promise<string> {
    const reply = await this.call<{ data: string }>({ op: 'read', path: ownedPath(value), text: true }, signal)
    return decode(reply.data).toString('utf8')
  }

  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override async streamText(value: FsTarget, signal?: AbortSignal): Promise<AsyncIterable<string>> {
    const content = await this.readText(value, signal)
    return (async function* () { yield content })()
  }

  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override async readBytes(value: FsTarget, signal: AbortSignal | undefined, maxBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('maxBytes must be a non-negative safe integer')
    const reply = await this.call<{ data: string }>({ op: 'read', path: ownedPath(value), maxBytes }, signal)
    return decode(reply.data)
  }

  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override async listDir(value: FsTarget, signal?: AbortSignal): Promise<FsDirEntry[]> {
    const reply = await this.call<{ entries: Array<{ name: string; path: string; type: FsInfo['type']; version: string; size?: number }> }>({ op: 'list', path: ownedPath(value) }, signal)
    return reply.entries.map(entry => ({
      name: entry.name, type: entry.type, target: target(entry.path), version: FsVersion(entry.version),
      ...entry.size === undefined ? {} : { size: entry.size },
    }))
  }

  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override async writeText(value: FsTarget, content: string, expected?: FsWriteIntent, signal?: AbortSignal): Promise<FsWriteOutcome> {
    const reply = await this.call<{ operation: 'create' | 'update'; version: string; before: string | null; after: string }>({
      op: 'write', path: ownedPath(value), content, ...expected === undefined ? {} : { expected },
    }, signal)
    return { ...reply, version: FsVersion(reply.version) }
  }

  /**
   * @inheritdoc
   * @param value - SSH-owned target.
   */
  override async editText(value: FsTarget, edit: FsEditRequest, expected?: { version: ReturnType<typeof FsVersion> }, signal?: AbortSignal): Promise<FsEditOutcome> {
    const reply = await this.call<{ version: string; before: string; after: string }>({
      op: 'edit', path: ownedPath(value), old: edit.oldString, new: edit.newString, all: edit.replaceAll,
      ...expected === undefined ? {} : { expected: { kind: 'replaceIfVersion', version: expected.version } },
    }, signal)
    return { ...reply, version: FsVersion(reply.version) }
  }

  private async call<T>(request: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const result = await this.ctx.ssh.command(['python3', '-c', FS_SSH_HELPER], {
      input: Buffer.from(JSON.stringify(request)), ...signal === undefined ? {} : { signal },
    })
    if (signal?.aborted === true) throw new FsError('SSH filesystem operation aborted', 'FS_ABORTED')
    if (result.exitCode !== 0) throw new FsError(`SSH filesystem transport failed: ${result.stderr.toString('utf8').trim()}`, 'FS_IO_ERROR')
    let reply: Reply<T>
    try { reply = JSON.parse(result.stdout.toString('utf8')) as Reply<T> } catch (error) {
      throw new FsError('SSH filesystem helper returned invalid JSON', 'FS_IO_ERROR', { cause: error })
    }
    if (!reply.ok) throw new FsError(`SSH filesystem operation failed: ${reply.message}`, reply.code)
    return reply
  }

  private mapped(path: string): string {
    if (!posix.isAbsolute(path)) return path
    const normalized = posix.resolve(path)
    const relative = posix.relative(this.localAnchor, normalized)
    if (relative === '') return this.remoteCwd
    if (relative !== '..' && !relative.startsWith('../')) return posix.resolve(this.remoteCwd, relative)
    return normalized
  }
}

function target(path: string): FsTarget { return { targetKey: FsTargetKey(`ssh:${path}`), displayPath: path } }
function ownedPath(value: FsTarget): string {
  const key = String(value.targetKey)
  if (!key.startsWith('ssh:/')) throw new TypeError('filesystem target does not belong to the SSH provider')
  return key.slice(4)
}
function withVersion<T extends { version: string }>(value: T): Omit<T, 'version'> & { version: ReturnType<typeof FsVersion> } {
  return { ...value, version: FsVersion(value.version) }
}
function decode(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) throw new FsError('SSH filesystem helper returned invalid base64', 'FS_IO_ERROR')
  return bytes
}

export default SshFileSystem
