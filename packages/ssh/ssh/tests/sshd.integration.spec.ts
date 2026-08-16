import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import SshConnection from '../src/index.ts'

const resources: Array<{ directory: string; server?: ChildProcess }> = []
afterEach(async () => {
  for (const resource of resources.splice(0).reverse()) {
    resource.server?.kill('SIGTERM')
    if (resource.server !== undefined) await new Promise(resolve => resource.server!.once('close', resolve))
    await rm(resource.directory, { recursive: true, force: true })
  }
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'sivitacode-sshd-'))
  const resource: { directory: string; server?: ChildProcess } = { directory }
  resources.push(resource)
  const hostKey = join(directory, 'host')
  const identity = join(directory, 'identity')
  generateKey(hostKey)
  generateKey(identity)
  const authorized = join(directory, 'authorized_keys')
  await writeFile(authorized, await readFile(`${identity}.pub`), { mode: 0o600 })
  const port = await freePort()
  const config = join(directory, 'sshd_config')
  await writeFile(config, [
    `Port ${String(port)}`, 'ListenAddress 127.0.0.1', `HostKey ${hostKey}`,
    `AuthorizedKeysFile ${authorized}`, `PidFile ${join(directory, 'pid')}`,
    'StrictModes no', 'PasswordAuthentication no', 'KbdInteractiveAuthentication no',
    'ChallengeResponseAuthentication no', 'UsePAM no', 'PermitRootLogin no', 'LogLevel ERROR',
  ].join('\n'))
  const server = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] })
  resource.server = server
  let diagnostic = ''
  server.stderr.on('data', (chunk) => { diagnostic += String(chunk) })
  await waitForListening(port, server, () => diagnostic)
  const publicHostKey = (await readFile(`${hostKey}.pub`, 'utf8')).trim().split(/\s+/u).slice(0, 2).join(' ')
  return { port, identity, publicHostKey }
}

describe('real pinned sshd integration', () => {
  it('authenticates, multiplexes channels, and rejects a different pinned key', async () => {
    const server = await fixture()
    const ctx = new Context()
    await ctx.plugin(SshConnection, {
      host: '127.0.0.1', port: server.port, username: userInfo().username,
      pinnedHostKey: server.publicHostKey, identityFile: server.identity,
    }).await()
    const [first, second] = await Promise.all([
      ctx.ssh.command(['printf', '%s', 'first']), ctx.ssh.command(['printf', '%s', 'second']),
    ])
    expect([first.stdout.toString(), second.stdout.toString()]).toEqual(['first', 'second'])
    await ctx.fiber.dispose()

    const wrong = new Context()
    const badKey = `ssh-ed25519 ${Buffer.alloc(32, 9).toString('base64')}`
    let rejected = false
    try {
      await wrong.plugin(SshConnection, {
        host: '127.0.0.1', port: server.port, username: userInfo().username,
        pinnedHostKey: badKey, identityFile: server.identity, connectTimeoutMs: 2_000,
      }).await()
      await wrong.ssh.ready()
    } catch (_expectedHostKeyRejection) {
      rejected = true
    }
    expect(rejected).toBe(true)
    await wrong.fiber.dispose()
  })
})

function generateKey(path: string): void {
  const result = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', path])
  if (result.status !== 0) throw new Error(`ssh-keygen failed: ${String(result.stderr)}`)
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('failed to allocate port')
  await new Promise<void>((resolve, reject) => server.close((error) => { if (error) reject(error); else resolve() }))
  return address.port
}

async function waitForListening(port: number, process: ChildProcess, diagnostic: () => string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (process.exitCode !== null) throw new Error(`sshd exited: ${diagnostic()}`)
    const connected = await new Promise<boolean>((resolve) => {
      const socket = createServer().listen(port, '127.0.0.1')
      socket.once('error', () =>{  resolve(true) })
      socket.once('listening', () => socket.close(() =>{  resolve(false) }))
    })
    if (connected) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`sshd did not listen: ${diagnostic()}`)
}
