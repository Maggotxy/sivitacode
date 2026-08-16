#!/usr/bin/env node
/** Install a server artifact offline and prove its authenticated Web and ACP assemblies. */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk'
import { install } from '../../deploy/install-sivitacode.mjs'

const PUBLIC_HOST = 'code.example.test'
const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`
const USERNAME = 'release-probe'
const PASSWORD = 'release-probe-correct-horse-battery-staple'
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 10_000
const MAX_LOG_BYTES = 64 * 1024
const ACP_PROTOCOL_VERSION = 1

function fail(message) { throw new Error(message) }

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') fail('probe could not reserve a TCP port')
  await new Promise((resolveClose, reject) => server.close(error => error === undefined ? resolveClose() : reject(error)))
  return address.port
}

function appendBounded(current, chunk) {
  const combined = current + String(chunk)
  return combined.length <= MAX_LOG_BYTES ? combined : combined.slice(-MAX_LOG_BYTES)
}

function publicHeaders(extra = {}) {
  return {
    host: PUBLIC_HOST,
    'x-forwarded-host': PUBLIC_HOST,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '203.0.113.8',
    ...extra,
  }
}

function http(port, path, options = {}) {
  return new Promise((resolveResponse, reject) => {
    const req = request({
      host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: publicHeaders(options.headers),
    }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size <= 1024 * 1024) chunks.push(chunk)
      })
      res.on('end', () => resolveResponse({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.once('error', reject)
    req.end(options.body)
  })
}

async function waitForLogin(port, child, logs) {
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail(`installed Web exited with ${String(child.exitCode)} before readiness:\n${logs()}`)
    try {
      const response = await http(port, '/')
      if (response.status === 303 && response.headers.location === '/auth/login') return
    } catch (error) {
      if (!(error instanceof Error) || !['ECONNREFUSED', 'ECONNRESET'].includes(error.code ?? '')) throw error
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  fail(`installed Web did not become ready in ${String(START_TIMEOUT_MS)} ms:\n${logs()}`)
}

async function stop(child) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const settled = new Promise(resolveExit => child.once('exit', resolveExit))
  let timer
  const timeout = new Promise(resolveTimeout => { timer = setTimeout(resolveTimeout, STOP_TIMEOUT_MS, 'timeout') })
  const result = await Promise.race([settled, timeout])
  if (timer !== undefined) clearTimeout(timer)
  if (result === 'timeout') {
    child.kill('SIGKILL')
    await settled
  }
}

async function waitForCleanExit(child, logs) {
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) fail(`installed ACP exited with ${String(child.exitCode)}:\n${logs()}`)
    return
  }
  let timer
  const exit = new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })))
  const timeout = new Promise(resolveTimeout => { timer = setTimeout(resolveTimeout, STOP_TIMEOUT_MS, 'timeout') })
  const result = await Promise.race([exit, timeout])
  if (timer !== undefined) clearTimeout(timer)
  if (result === 'timeout') fail(`installed ACP did not exit after stdin EOF:\n${logs()}`)
  if (result.code !== 0 || result.signal !== null) {
    fail(`installed ACP exited with code ${String(result.code)} and signal ${String(result.signal)}:\n${logs()}`)
  }
}

async function verifyAcp(entry, release, environment, version) {
  const fixture = mkdtempSync(join(tmpdir(), 'sivitacode-installed-acp-'))
  const llmEntry = pathToFileURL(join(release, 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')).href
  const adapter = join(fixture, 'release-probe-llm.mjs')
  const patch = join(fixture, 'release-probe.patch.yml')
  writeFileSync(adapter, `
import { LlmAdapter } from ${JSON.stringify(llmEntry)}
class ReleaseProbeAdapter extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: 'Release probe' } }
  listModels(provider) { return Promise.resolve([{ provider, id: 'release-probe', name: 'Release probe' }]) }
  resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 4096 } }) }
  async * stream() {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' }
    yield { type: 'reasoning-delta', index: 0, text: 'installed reasoning' }
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'installed reasoning' } }
    yield { type: 'block-start', index: 1, blockType: 'text' }
    yield { type: 'text-delta', index: 1, text: 'installed ' }
    yield { type: 'text-delta', index: 1, text: 'ACP live' }
    yield { type: 'block-end', index: 1, block: { type: 'text', text: 'installed ACP live' } }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 4, reasoningTokens: 2 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
export const name = 'release-probe-llm'
export const inject = ['llm']
export function apply(ctx) { ctx.llm.registerAdapter(['release-probe'], new ReleaseProbeAdapter()) }
`)
  writeFileSync(patch, `
- id: agent-default-model
  config:
    provider: release-probe
    model: release-probe
- id: acp
  config:
    provider: release-probe
    model: release-probe
    executionTargets: []
- insert:
    - id: release-probe-llm
      name: ${JSON.stringify(adapter)}
`)
  let output = ''
  const child = spawn(process.execPath, [entry, 'acp', '--patch', patch], {
    cwd: release, env: environment, stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', chunk => { output = appendBounded(output, chunk) })
  const updates = []
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout),
  )
  const client = new ClientSideConnection(() => ({
    sessionUpdate(params) { updates.push(params.update); return Promise.resolve() },
    requestPermission() { return Promise.resolve({ outcome: { outcome: 'cancelled' } }) },
  }), stream)
  try {
    const result = await client.initialize({ protocolVersion: ACP_PROTOCOL_VERSION, clientCapabilities: {} })
    if (result?.protocolVersion !== ACP_PROTOCOL_VERSION
      || result?.agentInfo?.name !== 'sivitacode-acp' || result?.agentInfo?.version !== version
      || result?.agentCapabilities?.loadSession !== true
      || result?.agentCapabilities?.promptCapabilities?.image !== false
      || result?.agentCapabilities?.promptCapabilities?.audio !== false
      || result?.agentCapabilities?.promptCapabilities?.embeddedContext !== false
      || result?.agentCapabilities?.sessionCapabilities?.close === undefined
      || result?.agentCapabilities?.sessionCapabilities?.fork === undefined
      || result?.agentCapabilities?.sessionCapabilities?.list === undefined
      || result?.agentCapabilities?.sessionCapabilities?.resume === undefined
      || result?.agentCapabilities?.sessionCapabilities?.delete === undefined) {
      fail(`installed ACP advertised an unexpected initialize response: ${JSON.stringify(result)}`)
    }
    const { sessionId } = await client.newSession({ cwd: release, mcpServers: [] })
    const prompt = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'prove installed live updates' }] })
    const thought = updates.flatMap(update => update.sessionUpdate === 'agent_thought_chunk'
      && update.content.type === 'text' ? [update.content.text] : []).join('')
    const message = updates.flatMap(update => update.sessionUpdate === 'agent_message_chunk'
      && update.content.type === 'text' ? [update.content.text] : []).join('')
    if (prompt.stopReason !== 'end_turn' || thought !== 'installed reasoning' || message !== 'installed ACP live') {
      fail(`installed ACP live prompt failed: ${JSON.stringify({ prompt, thought, message, updates })}`)
    }
    child.stdin.end()
    await waitForCleanExit(child, () => output)
    console.log(`server install verify: ${version} ACP live progress and persistent lifecycle ready over stdio`)
  } finally {
    await stop(child)
    rmSync(fixture, { recursive: true, force: true })
  }
}

async function verifySeatbelt(release) {
  if (process.platform !== 'darwin') return
  const cordisEntry = join(release, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js')
  const sandboxEntry = join(release, 'node_modules', '@deepseek-ai', 'dsh-sandbox-local', 'lib', 'index.js')
  const [{ Context }, { LocalSandboxProvider }] = await Promise.all([
    import(pathToFileURL(cordisEntry).href),
    import(pathToFileURL(sandboxEntry).href),
  ])
  const workspace = mkdtempSync(join(homedir(), '.sivitacode-seatbelt-workspace-'))
  const outside = mkdtempSync(join(homedir(), '.sivitacode-seatbelt-outside-'))
  const ctx = new Context()
  try {
    await ctx.plugin(LocalSandboxProvider, {})
    const sandbox = ctx.sandbox
    const allowed = join(workspace, 'allowed.txt')
    const denied = join(outside, 'denied.txt')
    const readonly = sandbox.confine(['/bin/sh', '-c', `printf denied > ${JSON.stringify(allowed)}`], {
      mode: 'read-only', workspaceRoot: workspace,
    })
    const readonlyResult = spawnSync(readonly.argv[0], readonly.argv.slice(1), { encoding: 'utf8' })
    if (readonly.enforcement !== 'full' || readonlyResult.status === 0 || existsSync(allowed)) {
      fail('installed Seatbelt read-only profile allowed a workspace write')
    }
    const writable = sandbox.confine(['/bin/sh', '-c', [
      `printf allowed > ${JSON.stringify(allowed)}`,
      `printf denied > ${JSON.stringify(denied)}`,
    ].join(' && ')], { mode: 'workspace-write', workspaceRoot: workspace })
    const writableResult = spawnSync(writable.argv[0], writable.argv.slice(1), { encoding: 'utf8' })
    if (writableResult.status === 0 || readFileSync(allowed, 'utf8') !== 'allowed' || existsSync(denied)) {
      fail(`installed Seatbelt workspace boundary failed: ${writableResult.stderr}`)
    }
    console.log('server install verify: installed Seatbelt confinement proof passed')
  } finally {
    await ctx.fiber.dispose()
    rmSync(workspace, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
}

async function verifyLandlock(release, required) {
  const entry = join(release, 'node_modules', '@deepseek-ai', 'node-addon-landlock-run', 'lib', 'index.js')
  if (!existsSync(entry)) {
    if (required) fail('installed server is missing the Landlock entry package')
    console.log('server install verify: Landlock entry absent; confinement proof skipped')
    return
  }
  const landlock = await import(pathToFileURL(entry).href)
  const launcher = landlock.launcherPath()
  const enforcement = landlock.probe(launcher)
  if (enforcement === 'unusable') {
    if (required) fail(`installed Landlock launcher is unusable: ${launcher}`)
    console.log('server install verify: Landlock unavailable on this artifact or kernel; confinement proof skipped')
    return
  }
  const proof = mkdtempSync(join(tmpdir(), 'sivitacode-landlock-proof-'))
  try {
    const workspace = join(proof, 'workspace')
    const outside = join(proof, 'outside.txt')
    const allowed = join(workspace, 'allowed.txt')
    mkdirSync(workspace)
    const denied = spawnSync(launcher, [
      ...landlock.grantArgs({ readOnly: ['/'], readWrite: [workspace] }),
      '--', '/bin/sh', '-c', `printf denied > ${JSON.stringify(outside)}`,
    ], { encoding: 'utf8' })
    if (denied.status === 0 || existsSync(outside)) fail('installed Landlock launcher allowed a write outside the workspace')
    const granted = spawnSync(launcher, [
      ...landlock.grantArgs({ readOnly: ['/'], readWrite: [workspace] }),
      '--', '/bin/sh', '-c', `printf allowed > ${JSON.stringify(allowed)}`,
    ], { encoding: 'utf8' })
    if (granted.status !== 0 || readFileSync(allowed, 'utf8') !== 'allowed') {
      fail(`installed Landlock launcher denied a workspace write: ${granted.stderr}`)
    }
    console.log(`server install verify: installed Landlock ${enforcement} confinement proof passed`)
  } finally {
    rmSync(proof, { recursive: true, force: true })
  }
}

/** Verify one archive through its installed runtime and public authentication boundary. */
export async function verifyServerInstall({ archive, checksum, requireLandlock = false }) {
  const deployment = mkdtempSync(join(tmpdir(), 'sivitacode-server-verify-'))
  const state = mkdtempSync(join(tmpdir(), 'sivitacode-server-state-'))
  let child
  let output = ''
  try {
    install({ root: deployment, archive, checksum })
    const release = realpathSync(join(deployment, 'current'))
    const manifest = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8'))
    const entry = join(release, ...manifest.entry.split('/'))
    await verifyLandlock(release, requireLandlock)
    await verifySeatbelt(release)
    const port = await freePort()
    const environment = {
      ...process.env,
      SIVITACODE_HOME: state,
      SIVITACODE_WEB_ADMIN_USERNAME: USERNAME,
      SIVITACODE_WEB_PASSWORD: PASSWORD,
      SIVITACODE_WEB_PUBLIC_ORIGIN: PUBLIC_ORIGIN,
      SIVITACODE_WEB_TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
      DSH_TELEMETRY_DISABLED: '1',
    }
    delete environment.NODE_OPTIONS
    delete environment.NODE_PATH
    child = spawn(process.execPath, [entry, 'web', '--host', '127.0.0.1', '--port', String(port), '--trusted-host', PUBLIC_HOST], {
      cwd: release, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', chunk => { output = appendBounded(output, chunk) })
    child.stderr.on('data', chunk => { output = appendBounded(output, chunk) })
    await waitForLogin(port, child, () => output)

    const loginPage = await http(port, '/auth/login')
    if (loginPage.status !== 200 || !loginPage.body.includes('<title>SivitaCode 登录</title>')) {
      fail(`installed Web login page failed: HTTP ${String(loginPage.status)}`)
    }
    const body = new URLSearchParams({ username: USERNAME, password: PASSWORD }).toString()
    const login = await http(port, '/auth/login', {
      method: 'POST', body,
      headers: { origin: PUBLIC_ORIGIN, 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(body)) },
    })
    const cookie = login.headers['set-cookie']?.[0]
    if (login.status !== 303 || login.headers.location !== '/' || cookie === undefined
      || !cookie.includes('__Host-sivitacode_session=') || !cookie.includes('Secure') || !cookie.includes('HttpOnly')) {
      fail(`installed Web secure login failed: HTTP ${String(login.status)}`)
    }
    const sessionCookie = cookie.split(';', 1)[0]
    const app = await http(port, '/', { headers: { cookie: sessionCookie } })
    if (app.status !== 200 || !String(app.headers['content-type']).startsWith('text/html')
      || !app.body.includes('<title>SivitaCode</title>')) {
      fail(`installed Web frontend failed: HTTP ${String(app.status)}`)
    }
    console.log(`server install verify: ${manifest.version} authenticated Web ready on ${manifest.platform}-${manifest.arch}`)
    await stop(child)
    child = undefined
    await verifyAcp(entry, release, environment, manifest.version)
  } finally {
    if (child !== undefined) await stop(child)
    rmSync(deployment, { recursive: true, force: true })
    rmSync(state, { recursive: true, force: true })
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    archive: { type: 'string' }, checksum: { type: 'string' }, 'require-landlock': { type: 'boolean' },
  } })
  if (values.archive === undefined || values.checksum === undefined) {
    fail('usage: verify-server-install.mjs --archive <tar.gz> --checksum <sha256>')
  }
  await verifyServerInstall({
    archive: resolve(values.archive), checksum: resolve(values.checksum), requireLandlock: values['require-landlock'] ?? false,
  })
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) await main()
