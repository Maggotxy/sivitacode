import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import * as installer from '../../deploy/install-sivitacode.mjs'

interface InstallResult { readonly changed: boolean }
interface Installer {
  inspectArchive(archive: string): string[]
  install(options: { root: string; archive: string; checksum?: string }): InstallResult
  rollback(root: string): string
}

const subject = installer as Installer

const COMMIT = '47f943859bef60e4160492346772ded9b24f765a'

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function artifact(
  parent: string,
  version: string,
  options: { corrupt?: boolean; marker?: string } = {},
): { archive: string; checksum: string } {
  const source = join(parent, `source-${version}`)
  const root = join(source, 'sivitacode-server')
  const entry = 'bin/sivitacode.mjs'
  mkdirSync(join(root, 'bin'), { recursive: true })
  const executable = join(root, entry)
  writeFileSync(executable, `// ${options.marker ?? 'baseline'}\nconst args = process.argv.slice(2)\nif (args[0] === '--version') console.log('${version}')\nelse if (args[1] === '--help' && ['web', 'run', 'acp'].includes(args[0])) process.exit(0)\nelse process.exit(2)\n`)
  const file = { path: entry, size: readFileSync(executable).byteLength, sha256: digest(executable) }
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify({
    format: 1, product: 'SivitaCode', version, platform: process.platform, arch: process.arch,
    node: '^22.19.0 || >=24.0.0', upstream: { repository: 'https://github.com/deepseek-ai/deepseek-harness', commit: COMMIT },
    entry, files: [file],
  }, null, 2)}\n`)
  if (options.corrupt === true) writeFileSync(executable, 'corrupted after manifest')
  const archive = join(parent, `sivitacode-${version}.tar.gz`)
  execFileSync('tar', ['-czf', archive, '-C', source, 'sivitacode-server'])
  const checksum = `${archive}.sha256`
  writeFileSync(checksum, `${digest(archive)}  ${archive.split('/').at(-1)}\n`)
  return { archive, checksum }
}

function link(root: string, name: string): string {
  return resolve(root, readlinkSync(join(root, name)))
}

describe('SivitaCode server installer', () => {
  it('activates verified upgrades, preserves current on failure, and rolls back', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sivitacode-installer-'))
    const deployment = join(fixture, 'deployment')
    const first = subject.install({ root: deployment, ...artifact(fixture, '1.0.0') })
    const release1 = link(deployment, 'current')
    expect(first.changed).toBe(true)

    subject.install({ root: deployment, ...artifact(fixture, '1.1.0') })
    const release2 = link(deployment, 'current')
    expect(release2).not.toBe(release1)
    expect(link(deployment, 'previous')).toBe(release1)

    expect(() => subject.install({ root: deployment, ...artifact(fixture, '1.2.0', { corrupt: true }) })).toThrow(/integrity/)
    expect(link(deployment, 'current')).toBe(release2)
    expect(subject.rollback(deployment)).toContain('1.0.0')
    expect(link(deployment, 'current')).toBe(release1)
    expect(link(deployment, 'previous')).toBe(release2)
  })

  it('rejects an archive whose outer digest changed', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sivitacode-checksum-'))
    const built = artifact(fixture, '2.0.0')
    writeFileSync(built.checksum, `${'0'.repeat(64)}  wrong.tar.gz\n`)
    expect(() => subject.install({ root: join(fixture, 'deployment'), ...built })).toThrow(/checksum mismatch/)
  })

  it('keeps distinct local builds from the same version and commit', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sivitacode-local-builds-'))
    const deployment = join(fixture, 'deployment')
    subject.install({ root: deployment, ...artifact(fixture, '2.1.0', { marker: 'first' }) })
    const first = link(deployment, 'current')
    subject.install({ root: deployment, ...artifact(fixture, '2.1.0', { marker: 'second' }) })
    expect(link(deployment, 'current')).not.toBe(first)
    expect(link(deployment, 'previous')).toBe(first)
  })

  it('rejects traversal and link entries before extraction', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'sivitacode-hostile-archive-'))
    const source = join(fixture, 'source')
    mkdirSync(source)
    writeFileSync(join(source, 'file'), 'content')
    const traversal = join(fixture, 'traversal.tar.gz')
    execFileSync('tar', ['-czf', traversal, '--transform=s|file|../outside|', '-C', source, 'file'])
    expect(() => subject.inspectArchive(traversal)).toThrow(/escapes/)
    const link = join(fixture, 'link.tar.gz')
    execFileSync('ln', ['-s', 'file', join(source, 'link')])
    execFileSync('tar', ['-czf', link, '-C', source, 'link'])
    expect(() => subject.inspectArchive(link)).toThrow(/unsupported l entry/)
  })
})
