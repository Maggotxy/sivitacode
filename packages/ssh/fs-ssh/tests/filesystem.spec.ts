/* oxlint-disable typescript/no-unsafe-argument -- ssh2 fixture stream buffers lose their generic parameter in dependency types. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SshFileSystem from '../src/index.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Execute the provider's fixed remote helper locally, preserving the SSH owner contract. */
function fakeSsh() {
  const executionWorld = Object.freeze({ label: 'ssh-test' })
  return {
    executionWorld,
    async command(argv: readonly string[], options: { input?: Uint8Array; signal?: AbortSignal } = {}) {
      const child = spawn(argv[0]!, [...argv.slice(1)], { stdio: ['pipe', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
      const abort = () => child.kill('SIGTERM')
      options.signal?.addEventListener('abort', abort, { once: true })
      child.stdin.end(options.input)
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) =>{  resolve(code ?? 255) })
      })
      options.signal?.removeEventListener('abort', abort)
      options.signal?.throwIfAborted()
      return { exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
    },
  }
}

async function fixture(): Promise<{ ctx: Context; fs: SshFileSystem; root: string }> {
  root = await mkdtemp(join(tmpdir(), 'sivitacode-fs-ssh-'))
  const ctx = new Context()
  ctx.provide('ssh', fakeSsh() as never)
  const fs = new SshFileSystem(ctx, {})
  return { ctx, fs, root }
}

describe('SSH filesystem provider', () => {
  it('shares its owner identity and canonicalizes remote paths', async () => {
    const value = await fixture()
    const target = await value.fs.resolve('.', { cwd: value.root })
    expect(value.fs.executionWorld).toBe(value.ctx.ssh.executionWorld)
    expect(value.fs.processPath(target)).toBe(value.root)
    expect(value.fs.fileUrl(target)).toBe(`file://${value.root}`)
    expect(value.fs.contains(target, await value.fs.resolve('child', { cwd: value.root }))).toBe(true)
  })

  it('maps the control-plane workspace into one remote project root', async () => {
    root = await mkdtemp(join(tmpdir(), 'sivitacode-fs-ssh-map-'))
    const remote = join(root, 'remote')
    await mkdir(remote)
    const ctx = new Context()
    ctx.provide('ssh', fakeSsh() as never)
    const mapped = new SshFileSystem(ctx, { cwd: remote, localAnchor: '/control/project' })
    expect((await mapped.resolve('/control/project/src/file.ts')).displayPath).toBe(join(remote, 'src/file.ts'))
    expect((await mapped.resolve('relative.ts', { cwd: '/control/project' })).displayPath).toBe(join(remote, 'relative.ts'))
  })

  it('reads strict text and bytes and lists stable resolved children', async () => {
    const { fs, root } = await fixture()
    await writeFile(join(root, 'z.txt'), '世界\n')
    await writeFile(join(root, 'a.txt'), 'alpha')
    const target = await fs.resolve('z.txt', { cwd: root })
    expect(await fs.readText(target)).toBe('世界\n')
    expect(Buffer.from(await fs.readBytes(target, undefined, 7)).toString()).toBe('世界\n')
    await expect(fs.readBytes(target, undefined, 6)).rejects.toMatchObject({ code: 'FS_TOO_LARGE' })
    const entries = await fs.listDir(await fs.resolve(root))
    expect(entries.map(entry => entry.name)).toEqual(['a.txt', 'z.txt'])
    expect(entries[1]?.version).toMatch(/^ssh:/)
  })

  it('atomically enforces create and replace versions across operations', async () => {
    const { fs, root } = await fixture()
    const target = await fs.resolve('state.txt', { cwd: root })
    const created = await fs.writeText(target, 'one\n', { kind: 'createIfAbsent' })
    expect(created).toMatchObject({ operation: 'create', before: null, after: 'one\n' })
    await expect(fs.writeText(target, 'collision', { kind: 'createIfAbsent' }))
      .rejects.toMatchObject({ code: 'FS_NOT_OBSERVED' })
    await writeFile(join(root, 'state.txt'), 'external\n')
    await expect(fs.writeText(target, 'stale', { kind: 'replaceIfVersion', version: created.version }))
      .rejects.toMatchObject({ code: 'FS_STALE_VERSION' })
    const observed = await fs.stat(target)
    const updated = await fs.writeText(target, 'two\n', { kind: 'replaceIfVersion', version: observed!.version })
    expect(updated.before).toBe('external\n')
    expect(await readFile(join(root, 'state.txt'), 'utf8')).toBe('two\n')
  })

  it('replaces an observed binary file without decoding its prior bytes', async () => {
    const { fs, root } = await fixture()
    const target = await fs.resolve('binary', { cwd: root })
    await writeFile(join(root, 'binary'), Buffer.from([0, 255, 1]))
    const observed = await fs.stat(target)
    const updated = await fs.writeText(target, 'now text\n', {
      kind: 'replaceIfVersion',
      version: observed!.version,
    })
    expect(updated).toMatchObject({ operation: 'update', before: null, after: 'now text\n' })
    expect(await readFile(join(root, 'binary'), 'utf8')).toBe('now text\n')
  })

  it('edits only the observed version and reports ambiguous literals', async () => {
    const { fs, root } = await fixture()
    const target = await fs.resolve('edit.txt', { cwd: root })
    await writeFile(join(root, 'edit.txt'), 'same same\n')
    const observed = await fs.stat(target)
    await expect(fs.editText(target, { oldString: 'same', newString: 'x', replaceAll: false }, { version: observed!.version }))
      .rejects.toMatchObject({ code: 'FS_AMBIGUOUS_EDIT' })
    const outcome = await fs.editText(target, { oldString: 'same', newString: 'x', replaceAll: true }, { version: observed!.version })
    expect(outcome.after).toBe('x x\n')
  })

  it('rejects binary text and maps cancellation to the filesystem taxonomy', async () => {
    const { fs, root } = await fixture()
    await writeFile(join(root, 'binary'), Buffer.from([0, 1, 2]))
    await expect(fs.readText(await fs.resolve('binary', { cwd: root })))
      .rejects.toMatchObject({ code: 'FS_NOT_TEXT' })
    const controller = new AbortController()
    controller.abort(new Error('stop'))
    await expect(fs.stat(await fs.resolve(root), controller.signal)).rejects.toThrow('stop')
  })
})
