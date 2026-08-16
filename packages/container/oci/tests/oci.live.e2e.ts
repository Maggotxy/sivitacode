import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import SshFileSystem from '@deepseek-ai/dsh-fs-ssh'
import SshSubprocessRuntime from '@deepseek-ai/dsh-subprocess-ssh'
import { afterEach, describe, expect, it } from 'vitest'
import OciContainer from '../src/index.ts'

const execute = promisify(execFile)
const runtime = process.env.SIVITACODE_OCI_E2E_RUNTIME
const image = process.env.SIVITACODE_OCI_E2E_IMAGE
const immutableImage = image !== undefined && (image.includes('@sha256:') || image.startsWith('sha256:'))
const enabled = runtime === 'podman' && immutableImage
const live = enabled ? describe : describe.skip
let workspace: string | undefined

afterEach(async () => {
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  workspace = undefined
})

live('rootless OCI live execution world', () => {
  it('routes files, managed processes, PTY, and cleanup through one real container', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'sivitacode-oci-live-'))
    await writeFile(join(workspace, 'input.txt'), 'from-host\n')
    const ctx = new Context()
    const owner = await ctx.plugin(OciContainer, {
      runtime: 'podman', image: image!, workspace, network: 'none', requireRootless: true,
      lifecycleTimeoutMs: 120_000, memory: '512m', cpus: 1,
    })
    await ctx.ssh.ready()
    const world = ctx.ssh.executionWorld
    const containerName = world.label.split(':').at(-1)!

    await ctx.plugin(SshFileSystem, { cwd: workspace, localAnchor: workspace }).await()
    await ctx.plugin(SshSubprocessRuntime, { cwd: workspace, localAnchor: workspace, pollMs: 20 }).await()
    expect(ctx.fs.executionWorld).toBe(world)
    expect(ctx.subprocess.executionWorld).toBe(world)

    const input = await ctx.fs.resolve('input.txt', { cwd: workspace })
    expect(await ctx.fs.readText(input)).toBe('from-host\n')
    const output = await ctx.fs.resolve('output.txt', { cwd: workspace })
    await ctx.fs.writeText(output, 'from-container\n', { kind: 'createIfAbsent' })

    const process = ctx.subprocess.spawn({
      argv: ['python3', '-c', 'import pathlib,sys;sys.stdout.write(pathlib.Path("output.txt").read_text())'],
      cwd: workspace, graceMs: 1_000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_024 }, stderr: { maxBytes: 1_024 } },
    })
    await expect(process.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(process.collected.stdout?.readFrom(0).text).toBe('from-container\n')

    const terminal = await ctx.subprocess.spawnTerminal({
      argv: ['python3', '-c', 'print("pty-through-container", flush=True)'],
      cwd: workspace, rows: 24, cols: 80, graceMs: 1_000,
    })
    let terminalOutput = ''
    terminal.output.setEncoding('utf8')
    terminal.output.on('data', (chunk) => { terminalOutput += String(chunk) })
    await expect(terminal.done).resolves.toMatchObject({ exitCode: 0 })
    expect(terminalOutput).toContain('pty-through-container')

    await owner.dispose()
    await expect(execute('podman', ['container', 'exists', containerName])).rejects.toMatchObject({ code: 1 })
  }, 180_000)
})
