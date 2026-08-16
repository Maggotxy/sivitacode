/* oxlint-disable typescript/no-unsafe-argument -- ssh2 fixture stream buffers lose their generic parameter in dependency types. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { quoteRemoteArg } from '@deepseek-ai/dsh-ssh'
import type { SshChannel, SshCommandOptions } from '@deepseek-ai/dsh-ssh'
import { afterEach, describe, expect, it } from 'vitest'
import { SshTerminalHandle } from '../src/terminal.ts'

const terminals = new Set<SshTerminalHandle>()

afterEach(async () => {
  await Promise.all([...terminals].map(terminal => terminal.terminate()))
  terminals.clear()
})

function localSsh() {
  return {
    async command(argv: readonly string[], options: SshCommandOptions = {}) {
      const child = spawn(argv[0]!, argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => stderr.push(Buffer.from(chunk)))
      child.stdin.end(options.input)
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) =>{  resolve(code ?? 255) })
      })
      return { exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }
    },
    async spawnChannel(argv: readonly string[]): Promise<SshChannel> {
      const command = argv.map(quoteRemoteArg).join(' ')
      const child = spawn('script', ['-qfec', command, '/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] })
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

function create(argv: readonly string[]): SshTerminalHandle {
  const terminal = new SshTerminalHandle(localSsh() as never, {
    argv,
    cwd: process.cwd(),
    rows: 24,
    cols: 80,
    graceMs: 100,
  }, 10)
  terminals.add(terminal)
  return terminal
}

async function outputUntil(terminal: SshTerminalHandle, expected: string): Promise<string> {
  let output = ''
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() =>{  reject(new Error(`terminal output timeout: ${JSON.stringify(output)}`)) }, 2_000)
    terminal.output.on('data', (value) => {
      output += String(value)
      if (output.includes(expected)) {
        clearTimeout(deadline)
        resolve()
      }
    })
  })
  return output
}

describe('SSH subprocess terminal owner', () => {
  it('allocates a true PTY and transports interactive input', async () => {
    const terminal = create(['/usr/bin/env', 'python3', '-c', [
      'import os,sys',
      'print("TTY="+str(os.isatty(0)), flush=True)',
      'print("INPUT="+sys.stdin.readline().strip(), flush=True)',
    ].join(';')])
    const state = (terminal as unknown as { state: string }).state
    await outputUntil(terminal, 'TTY=True')
    await terminal.write('hello\n')
    const output = await outputUntil(terminal, 'INPUT=hello')
    expect(output).toContain('INPUT=hello')
    await expect(terminal.done).resolves.toMatchObject({ exitCode: 0 })
    await terminal.terminate()
    expect(existsSync(state)).toBe(false)
  })

  it('inspects, signals, and terminates the complete terminal session', async () => {
    const terminal = create(['/bin/sh', '-c', 'sleep 60'])
    let foreground
    for (let attempt = 0; attempt < 100 && foreground === undefined; attempt++) {
      try {
        foreground = await terminal.inspectForeground()
      } catch (error: unknown) {
        if (attempt === 99) throw error
      }
      if (foreground === undefined) await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(foreground?.processGroupId).toBeGreaterThan(1)
    await expect(terminal.signalForeground('SIGTSTP')).resolves.toBe(foreground?.processGroupId)
    await expect(terminal.terminate()).resolves.toBeUndefined()
  })
})
