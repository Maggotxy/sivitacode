/* oxlint-disable typescript/no-non-null-assertion -- argv and bounded collected streams are constructed
 * as non-empty required values in this module. */
/** Safe Git worktree operations executed through the active subprocess provider. */

import { posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

/** One machine-readable `git worktree list` record. */
export interface GitWorktree {
  readonly path: string
  readonly head: string
  readonly branch?: string
  readonly bare: boolean
  readonly detached: boolean
  readonly locked?: string
  readonly prunable?: string
}

/** Request to create a linked worktree under the repository-owned directory. */
export interface CreateGitWorktree {
  readonly repository: string
  readonly branch: string
  readonly startPoint?: string
  readonly createBranch?: boolean
}

interface MutableGitWorktree {
  path?: string
  head?: string
  branch?: string
  bare?: boolean
  detached?: boolean
  locked?: string
  prunable?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context { gitWorktrees: GitWorktreeService }
}

/** Target-aware Git worktree manager that never invokes a shell or force removal. */
export class GitWorktreeService extends Service {
  static inject = ['subprocess']

  constructor(ctx: Context) { super(ctx, 'gitWorktrees') }

  /**
   * List linked worktrees using Git's stable NUL-delimited porcelain format.
   * @param repository - Absolute POSIX path to the repository.
   * @returns Parsed worktrees in Git's order.
   */
  async list(repository: string): Promise<GitWorktree[]> {
    assertAbsolute(repository)
    const output = await this.git(repository, ['worktree', 'list', '--porcelain', '-z'])
    return parseWorktreeList(output)
  }

  /**
   * Create a linked worktree at a deterministic contained path.
   * @param request - Repository, branch, and optional starting revision.
   * @returns The created worktree after reading authoritative Git state.
   */
  async create(request: CreateGitWorktree): Promise<GitWorktree> {
    assertAbsolute(request.repository)
    await this.git(request.repository, ['check-ref-format', '--branch', request.branch])
    const leaf = encodeBranch(request.branch)
    const root = posix.join(request.repository, '.sivitacode', 'worktrees')
    const path = posix.join(root, leaf)
    await this.run(['mkdir', '-p', root], request.repository)
    await this.git(request.repository, request.createBranch === true
      ? ['worktree', 'add', '-b', request.branch, '--', path, ...(request.startPoint === undefined ? [] : [request.startPoint])]
      : ['worktree', 'add', '--', path, request.startPoint ?? request.branch])
    const created = (await this.list(request.repository)).find(worktree => worktree.path === path)
    if (created === undefined) throw new Error(`git worktree creation did not publish '${path}'`)
    return created
  }

  /**
   * Remove a linked worktree without force; Git rejects main, locked, or dirty worktrees.
   * @param repository - Absolute POSIX path to the repository.
   * @param path - Exact path returned by {@link list}.
   * @returns Resolution after Git removes its directory and metadata.
   */
  async remove(repository: string, path: string): Promise<void> {
    assertAbsolute(repository); assertAbsolute(path)
    const worktrees = await this.list(repository)
    const main = worktrees[0]
    const selected = worktrees.find(worktree => worktree.path === path)
    if (selected === undefined) throw new Error(`git worktree '${path}' was not found`)
    if (selected.path === main?.path || selected.bare) throw new Error('git worktree: the main worktree cannot be removed')
    const root = posix.join(repository, '.sivitacode', 'worktrees')
    if (path !== root && !path.startsWith(`${root}/`)) throw new Error('git worktree: removal path is outside the managed worktree directory')
    await this.git(repository, ['worktree', 'remove', '--', path])
  }

  private async git(repository: string, args: readonly string[]): Promise<string> {
    const git = await this.ctx.subprocess.resolveExecutable('git')
    return await this.run([git, '-C', repository, ...args], repository)
  }

  private async run(argv: readonly string[], cwd: string): Promise<string> {
    const executable = await this.ctx.subprocess.resolveExecutable(argv[0]!)
    const handle: SubprocessHandle = this.ctx.subprocess.spawn({
      argv: [executable, ...argv.slice(1)], cwd, env: {}, graceMs: 5_000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_048_576 }, stderr: { maxBytes: 65_536 } },
    })
    const outcome = await handle.done
    const stdout = handle.collected.stdout!.readFrom(0)
    const stderr = handle.collected.stderr!.readFrom(0)
    if (stdout.lossy || stderr.lossy) throw new Error('git worktree: command output exceeded its safety bound')
    if (outcome.exitCode !== 0) throw new Error(`git worktree: command failed (${String(outcome.exitCode)}): ${stderr.text.trim() || 'no diagnostic'}`)
    return stdout.text
  }
}

function assertAbsolute(path: string): void {
  if (!posix.isAbsolute(path) || path.includes('\0')) throw new Error('git worktree: repository and worktree paths must be absolute POSIX paths')
}

function encodeBranch(branch: string): string {
  return Buffer.from(branch).toString('base64url')
}

/**
 * Parse `git worktree list --porcelain -z` without relying on human formatting.
 * @param output - Complete NUL-delimited Git output.
 * @returns Parsed records.
 */
export function parseWorktreeList(output: string): GitWorktree[] {
  const records: GitWorktree[] = []
  let current: MutableGitWorktree | undefined
  for (const field of output.split('\0')) {
    if (field.length === 0) continue
    const space = field.indexOf(' ')
    const key = space === -1 ? field : field.slice(0, space)
    const value = space === -1 ? '' : field.slice(space + 1)
    if (key === 'worktree') {
      if (current !== undefined) records.push(finish(current))
      current = { path: value, bare: false, detached: false }
    } else if (current !== undefined) {
      if (key === 'HEAD') current.head = value
      else if (key === 'branch') current.branch = value.startsWith('refs/heads/') ? value.slice(11) : value
      else if (key === 'bare') current.bare = true
      else if (key === 'detached') current.detached = true
      else if (key === 'locked') current.locked = value
      else if (key === 'prunable') current.prunable = value
    }
  }
  if (current !== undefined) records.push(finish(current))
  return records
}

function finish(record: MutableGitWorktree): GitWorktree {
  if (record.path === undefined || record.head === undefined) throw new Error('git worktree: malformed porcelain record')
  return {
    path: record.path, head: record.head, bare: record.bare ?? false, detached: record.detached ?? false,
    ...(record.branch === undefined ? {} : { branch: record.branch }),
    ...(record.locked === undefined ? {} : { locked: record.locked }),
    ...(record.prunable === undefined ? {} : { prunable: record.prunable }),
  }
}

export default GitWorktreeService
