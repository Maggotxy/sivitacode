#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const CORE_VERSION = '0.1.0-rc.5'
const BOOTSTRAP_URL = 'https://github.com/Maggotxy/sivitacode/releases/download/dsh-v0.1.0-rc.5-sivitacode.1/install.sh'
const BOOTSTRAP_SHA256 = '3618eeb95d6ed65a0e7fd60b38b720af2e707faf483a6b06e651ef31858880d2'
const MAX_BOOTSTRAP_BYTES = 1024 * 1024

function fail(message) {
  throw new Error(`SivitaCode launcher: ${message}`)
}

function relay(result, label) {
  if (result.error !== undefined) fail(`${label}: ${result.error.message}`)
  if (result.signal !== null) {
    process.kill(process.pid, result.signal)
    return 1
  }
  return result.status ?? 1
}

function installedCommand(env) {
  const home = env.HOME
  if (home === undefined || home === '') fail('HOME is required')
  return join(env.SIVITACODE_BIN_DIR ?? join(home, '.local', 'bin'), 'sivitacode')
}

function hasPinnedCore(command, expectedVersion, env) {
  try {
    if (!lstatSync(command).isSymbolicLink()) return false
    const probe = spawnSync(command, ['--version'], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    })
    return probe.status === 0 && probe.stdout.trim() === expectedVersion
  } catch {
    return false
  }
}

async function fetchBootstrap(env) {
  const url = env.SIVITACODE_BOOTSTRAP_URL ?? BOOTSTRAP_URL
  const expectedDigest = env.SIVITACODE_BOOTSTRAP_SHA256 ?? BOOTSTRAP_SHA256
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) fail('bootstrap SHA-256 must be 64 lowercase hexadecimal characters')

  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
    headers: { 'user-agent': 'sivitacode-npm-launcher' },
  })
  if (!response.ok) fail(`bootstrap download returned HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BOOTSTRAP_BYTES) fail('bootstrap download is too large')

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_BOOTSTRAP_BYTES) fail('bootstrap download is too large')
  const actualDigest = createHash('sha256').update(bytes).digest('hex')
  if (actualDigest !== expectedDigest) fail('bootstrap checksum mismatch')
  return bytes
}

async function install(env) {
  const bytes = await fetchBootstrap(env)
  const staging = mkdtempSync(join(tmpdir(), 'sivitacode-npm-'))
  const script = join(staging, 'install.sh')
  try {
    // npm remains a small discovery layer; the authenticated Release installer
    // continues to own platform selection, validation, activation, and rollback.
    writeFileSync(script, bytes, { mode: 0o700 })
    return relay(spawnSync('sh', [script], { env, stdio: 'inherit' }), 'bootstrap installer')
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function main() {
  const env = process.env
  const command = installedCommand(env)
  const expectedVersion = env.SIVITACODE_ARTIFACT_VERSION ?? CORE_VERSION
  if (!hasPinnedCore(command, expectedVersion, env)) {
    const installStatus = await install(env)
    if (installStatus !== 0) return installStatus
  }

  const requested = process.argv.slice(2)
  const args = requested.length === 0 ? ['web'] : requested
  return relay(spawnSync(command, args, { env, stdio: 'inherit' }), 'installed command')
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
