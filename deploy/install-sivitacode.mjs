#!/usr/bin/env node
/** Verify and atomically install, upgrade, or roll back a SivitaCode server artifact. */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, readdirSync, renameSync,
  rmSync, statSync, symlinkSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const FORMAT = 1
const DIGEST = /^[0-9a-f]{64}$/

function fail(message) { throw new Error(message) }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { maxBuffer: 64 * 1024 * 1024, ...options, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${String(result.status)}:\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }

function safeRelative(name) {
  if (name === '' || name.includes('\0') || name.includes('\\') || isAbsolute(name) || name.split('/').some(part => part === '..')) {
    fail(`archive entry escapes its root: ${JSON.stringify(name)}`)
  }
}

/** Reject links, devices and traversal before tar writes any archive entry. */
export function inspectArchive(archive) {
  const names = run('tar', ['-tzf', archive]).split('\n').filter(Boolean)
  const verbose = run('tar', ['-tvzf', archive]).split('\n').filter(Boolean)
  if (names.length === 0 || names.length !== verbose.length) fail('archive listing is empty or inconsistent')
  const seen = new Set()
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]
    safeRelative(name)
    const normalized = name.replace(/\/$/, '')
    if (seen.has(normalized)) fail(`archive contains duplicate entry: ${name}`)
    seen.add(normalized)
    const type = verbose[index]?.[0]
    if (type !== '-' && type !== 'd') fail(`archive contains unsupported ${type ?? 'unknown'} entry: ${name}`)
  }
  return names
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is not an object`)
  return value
}

/** Validate a release tree and every byte declared by its manifest. */
export function verifyRelease(root) {
  const manifest = object(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')), 'manifest')
  if (manifest.format !== FORMAT || manifest.product !== 'SivitaCode') fail('unsupported server artifact manifest')
  for (const key of ['version', 'platform', 'arch', 'node', 'entry']) {
    if (typeof manifest[key] !== 'string' || manifest[key] === '') fail(`manifest ${key} is invalid`)
  }
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    fail(`artifact targets ${manifest.platform}-${manifest.arch}, host is ${process.platform}-${process.arch}`)
  }
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (!((major === 22 && minor >= 19) || major >= 24)) fail(`Node ${process.versions.node} does not satisfy ${manifest.node}`)
  const upstream = object(manifest.upstream, 'manifest upstream')
  if (typeof upstream.commit !== 'string' || !/^[0-9a-f]{40}$/.test(upstream.commit)) fail('manifest upstream commit is invalid')
  if (!Array.isArray(manifest.files)) fail('manifest files is not an array')
  const expected = new Set(['manifest.json'])
  for (const raw of manifest.files) {
    const file = object(raw, 'manifest file')
    if (typeof file.path !== 'string') fail('manifest file path is invalid')
    safeRelative(file.path)
    if (expected.has(file.path)) fail(`manifest repeats file: ${file.path}`)
    if (!Number.isSafeInteger(file.size) || file.size < 0 || typeof file.sha256 !== 'string' || !DIGEST.test(file.sha256)) {
      fail(`manifest metadata is invalid for ${file.path}`)
    }
    const path = join(root, ...file.path.split('/'))
    if (!existsSync(path) || !lstatSync(path).isFile()) fail(`release file is missing or not regular: ${file.path}`)
    if (statSync(path).size !== file.size || hash(path) !== file.sha256) fail(`release file failed integrity verification: ${file.path}`)
    expected.add(file.path)
  }
  const actual = new Set()
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) actual.add(relative(root, path).split(sep).join('/'))
      else fail(`release contains unsupported file: ${relative(root, path)}`)
    }
  }
  walk(root)
  for (const path of actual) if (!expected.has(path)) fail(`release contains undeclared file: ${path}`)
  for (const path of expected) if (!actual.has(path)) fail(`release declares absent file: ${path}`)
  if (!expected.has(manifest.entry)) fail('manifest entry is not an authenticated file')
  return manifest
}

function targetOf(root, link) {
  const path = join(root, link)
  if (!existsSync(path)) return undefined
  if (!lstatSync(path).isSymbolicLink()) fail(`${path} is not a symbolic link`)
  const target = realpathSync(path)
  const releases = `${realpathSync(join(root, 'releases'))}${sep}`
  if (!target.startsWith(releases)) fail(`${path} points outside ${join(root, 'releases')}`)
  return target
}

function switchLink(root, name, target) {
  const temporary = join(root, `.${name}-${process.pid}-${Date.now()}`)
  symlinkSync(relative(root, target), temporary)
  renameSync(temporary, join(root, name))
}

function smoke(release, manifest) {
  const smokeHome = mkdtempSync(join(tmpdir(), 'sivitacode-install-smoke-'))
  try {
    const environment = { ...process.env, SIVITACODE_HOME: smokeHome, DSH_TELEMETRY_DISABLED: '1' }
    delete environment.NODE_OPTIONS
    delete environment.NODE_PATH
    const entry = join(release, ...manifest.entry.split('/'))
    const version = run(process.execPath, [entry, '--version'], { cwd: release, env: environment })
    if (version !== manifest.version) fail(`SivitaCode reports ${version}, expected ${manifest.version}`)
    run(process.execPath, [entry, 'web', '--help'], { cwd: release, env: environment })
    run(process.execPath, [entry, 'run', '--help'], { cwd: release, env: environment })
    run(process.execPath, [entry, 'acp', '--help'], { cwd: release, env: environment })
  } finally {
    rmSync(smokeHome, { recursive: true, force: true })
  }
}

/** Install one authenticated artifact without changing current until smoke checks pass. */
export function install({ archive, checksum, root }) {
  const deploymentRoot = resolve(root)
  const archivePath = resolve(archive)
  if (checksum !== undefined) {
    const expected = readFileSync(resolve(checksum), 'utf8').trim().split(/\s+/)[0]
    if (!DIGEST.test(expected) || hash(archivePath) !== expected) fail('server archive checksum mismatch')
  }
  inspectArchive(archivePath)
  mkdirSync(join(deploymentRoot, 'releases'), { recursive: true })
  const staging = mkdtempSync(join(deploymentRoot, '.staging-'))
  try {
    run('tar', ['--no-same-owner', '--no-same-permissions', '-xzf', archivePath, '-C', staging])
    const children = readdirSync(staging)
    if (children.length !== 1) fail('server archive must contain one top-level directory')
    const extracted = join(staging, children[0])
    const manifest = verifyRelease(extracted)
    smoke(extracted, manifest)
    // A deployment may build reviewed local changes before they are committed.
    // Include authenticated manifest content so two artifacts from the same
    // source commit remain distinct, while reinstalling identical bytes stays
    // idempotent instead of failing with a release-id collision.
    const content = createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 12)
    const id = `${manifest.version}-${manifest.platform}-${manifest.arch}-${manifest.upstream.commit.slice(0, 12)}-${content}`
    const release = join(deploymentRoot, 'releases', id)
    if (existsSync(release)) {
      const installed = verifyRelease(release)
      if (JSON.stringify(installed) !== JSON.stringify(manifest)) fail(`release id collision with different content: ${id}`)
      rmSync(extracted, { recursive: true, force: true })
    } else renameSync(extracted, release)
    const current = targetOf(deploymentRoot, 'current')
    if (current === release) return { id, changed: false }
    if (current !== undefined) switchLink(deploymentRoot, 'previous', current)
    switchLink(deploymentRoot, 'current', release)
    return { id, changed: true }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Atomically return current to the previously activated verified release. */
export function rollback(root) {
  const deploymentRoot = resolve(root)
  const previous = targetOf(deploymentRoot, 'previous')
  if (previous === undefined) fail('no previous SivitaCode release is recorded')
  const current = targetOf(deploymentRoot, 'current')
  const manifest = verifyRelease(previous)
  smoke(previous, manifest)
  if (current !== undefined) switchLink(deploymentRoot, 'previous', current)
  switchLink(deploymentRoot, 'current', previous)
  return basename(previous)
}

function main() {
  const command = process.argv[2]
  const { values } = parseArgs({ args: process.argv.slice(3), options: {
    root: { type: 'string' }, archive: { type: 'string' }, checksum: { type: 'string' },
  } })
  if (values.root === undefined || !['install', 'rollback'].includes(command)) {
    fail('usage: install-sivitacode.mjs install --root <dir> --archive <tar.gz> [--checksum <sha256>] | rollback --root <dir>')
  }
  const result = command === 'rollback'
    ? { rolledBackTo: rollback(values.root) }
    : install({ root: values.root, archive: values.archive ?? fail('--archive is required'), checksum: values.checksum })
  console.log(JSON.stringify(result))
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main()
