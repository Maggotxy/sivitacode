import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { afterEach, describe, expect, it } from 'vitest'
import GitWorktrees, { parseWorktreeList } from '../src/index.ts'

const exec = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0).reverse()) await rm(directory, { recursive: true, force: true })
})

describe('Git worktrees', () => {
  it('parses NUL-delimited porcelain fields including locks', () => {
    expect(parseWorktreeList('worktree /repo\0HEAD abc\0branch refs/heads/main\0\0worktree /repo/w\0HEAD def\0detached\0locked busy\0')).toEqual([
      { path: '/repo', head: 'abc', branch: 'main', bare: false, detached: false },
      { path: '/repo/w', head: 'def', bare: false, detached: true, locked: 'busy' },
    ])
  })

  it('creates a contained worktree and refuses dirty or main-worktree removal', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'sivitacode-worktree-'))
    directories.push(repository)
    await exec('git', ['init', '-q', '-b', 'main', repository])
    await exec('git', ['-C', repository, 'config', 'user.name', 'SivitaCode Test'])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@sivitacode.invalid'])
    await writeFile(join(repository, 'README.md'), 'fixture\n')
    await exec('git', ['-C', repository, 'add', 'README.md'])
    await exec('git', ['-C', repository, 'commit', '-q', '-m', 'fixture'])

    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime).await()
    await ctx.plugin(GitWorktrees).await()
    const created = await ctx.gitWorktrees.create({ repository, branch: 'feature/test', createBranch: true })
    expect(created.path.startsWith(`${repository}/.sivitacode/worktrees/`)).toBe(true)
    expect(created.branch).toBe('feature/test')
    await writeFile(join(created.path, 'dirty.txt'), 'retain me')
    await expect(ctx.gitWorktrees.remove(repository, created.path)).rejects.toThrow('command failed')
    await expect(ctx.gitWorktrees.remove(repository, repository)).rejects.toThrow('main worktree')
    await ctx.fiber.dispose()
  })

  it('rejects invalid branch names before creating directories', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'sivitacode-worktree-invalid-'))
    directories.push(repository)
    await exec('git', ['init', '-q', '-b', 'main', repository])
    const ctx = new Context()
    await ctx.plugin(LocalSubprocessRuntime).await()
    await ctx.plugin(GitWorktrees).await()
    await expect(ctx.gitWorktrees.create({ repository, branch: '../escape', createBranch: true })).rejects.toThrow('command failed')
    await ctx.fiber.dispose()
  })
})
