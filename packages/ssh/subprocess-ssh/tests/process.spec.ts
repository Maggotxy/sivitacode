/* oxlint-disable typescript/no-unsafe-argument -- ssh2 fixture stream buffers lose their generic parameter in dependency types. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type { SshChannel, SshCommandOptions } from '@deepseek-ai/dsh-ssh'
import { SshSubprocessHandle } from '../src/process.ts'

const handles = new Set<SshSubprocessHandle>()

afterEach(async () => {
  for (const handle of handles) handle.terminate()
  await Promise.all([...handles].map(handle => handle.waitForExit()))
  handles.clear()
})

function localSsh() {
  return {
    async command(argv: readonly string[], options: SshCommandOptions = {}) {
      const child = spawn(argv[0]!, argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
      const abort = (): void => { child.kill('SIGTERM') }
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
    async spawnChannel(argv: readonly string[]): Promise<SshChannel> {
      const child = spawn(argv[0]!, argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (exitCode, signal) =>{  resolve({ exitCode, signal }) })
      })
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        transportPid: child.pid ?? -1,
        done,
        close: () => { child.kill('SIGTERM') },
      }
    },
  }
}

function create(
  argv: readonly string[],
  overrides: Partial<ConstructorParameters<typeof SshSubprocessHandle>[1]> = {},
): SshSubprocessHandle {
  const handle = new SshSubprocessHandle(localSsh() as never, {
    argv,
    cwd: process.cwd(),
    graceMs: 100,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 5, spill: { maxBytes: 1000 } },
      stderr: { maxBytes: 100 },
    },
    ...overrides,
  }, 10)
  handles.add(handle)
  return handle
}

describe('SSH subprocess process owner', () => {
  it('reports quiescence when no identity-bearing process survives without inventing an outcome', async () => {
    const pending = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const handle = new SshSubprocessHandle({
      async command() {
        return { exitCode: 0, stdout: Buffer.from('{"alive":false,"groups":[],"outcome":null}'), stderr: Buffer.alloc(0) }
      },
      async spawnChannel() {
        return {
          stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
          transportPid: 123, done: pending.promise, close: () => { pending.resolve({ exitCode: null, signal: 'SIGTERM' }) },
        }
      },
    } as never, {
      argv: ['unreachable'], cwd: process.cwd(), graceMs: 100,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 10 }, stderr: { maxBytes: 10 } },
    }, 10)
    handles.add(handle)
    await expect(handle.waitForExit()).resolves.toBe(true)
    pending.resolve({ exitCode: 255, signal: null })
    await expect(handle.done).rejects.toThrow('without a durable outcome')
  })

  it('runs argv without shell interpretation and retains a bounded tail with remote spill', async () => {
    const handle = create(['/bin/printf', '%s', 'hello world'])
    await expect(handle.done).resolves.toEqual({ exitCode: 0, signal: null })
    expect(handle.collected.stdout?.readFrom(0)).toMatchObject({ text: 'world', lossy: true })
    expect(handle.collected.stdout?.readFrom(0).spillPath).toMatch(/^\/tmp\/\.sivitacode-process-/)
  })

  it('streams batch stdin and keeps explicit environment overrides', async () => {
    const handle = create(['/usr/bin/env', 'python3', '-c', 'import os,sys;sys.stdout.write(os.environ["VISIBLE"]+":"+sys.stdin.read())'], {
      env: { VISIBLE: 'yes' },
      stdio: {
        stdin: { data: 'payload' },
        stdout: { maxBytes: 100 },
        stderr: { maxBytes: 100 },
      },
    })
    await handle.done
    expect(handle.collected.stdout?.readFrom(0).text).toBe('yes:payload')
  })

  it('removes process state after bounded output no longer needs a remote spill', async () => {
    const handle = create(['/bin/printf', 'small'], {
      stdio: { stdin: 'ignore', stdout: { maxBytes: 100 }, stderr: { maxBytes: 100 } },
    })
    const state = (handle as unknown as { state: string }).state
    await handle.done
    expect(existsSync(state)).toBe(false)
  })

  it('escalates termination and proves token-owned descendants are gone', async () => {
    const handle = create(['/usr/bin/env', 'python3', '-c', [
      'import os,signal,subprocess,time',
      'signal.signal(signal.SIGTERM, signal.SIG_IGN)',
      'subprocess.Popen(["sleep","60"])',
      'time.sleep(60)',
    ].join(';')])
    await new Promise<void>((resolve) => {
      const check = (): void => { if (handle.pid > 1) resolve(); else setTimeout(check, 5) }
      check()
    })
    handle.terminate()
    await expect(handle.waitForExit()).resolves.toBe(true)
    await expect(handle.done).resolves.toMatchObject({ signal: 'SIGKILL' })
  })
})
