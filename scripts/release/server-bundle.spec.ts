import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { payloadFiles, removeBinDirectories } from './server-bundle.ts'

describe('server bundle manifest', () => {
  it('sorts and hashes every regular payload file', () => {
    const root = mkdtempSync(join(tmpdir(), 'sivitacode-bundle-files-'))
    mkdirSync(join(root, 'z'))
    writeFileSync(join(root, 'z', 'b'), 'second')
    writeFileSync(join(root, 'a'), 'first')
    writeFileSync(join(root, 'manifest.json'), 'excluded')
    expect(payloadFiles(root).map(file => [file.path, file.size])).toEqual([['a', 5], ['z/b', 6]])
    expect(payloadFiles(root).every(file => /^[0-9a-f]{64}$/.test(file.sha256))).toBe(true)
  })

  it('rejects links rather than authenticating their target from another tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'sivitacode-bundle-link-'))
    writeFileSync(join(root, 'file'), 'content')
    symlinkSync('file', join(root, 'link'))
    expect(() => payloadFiles(root)).toThrow(/symbolic link/)
  })

  it('removes generated command links at every dependency depth', () => {
    const root = mkdtempSync(join(tmpdir(), 'sivitacode-bundle-bin-'))
    mkdirSync(join(root, 'dependency', 'node_modules', '.bin'), { recursive: true })
    writeFileSync(join(root, 'dependency', 'kept'), 'content')
    symlinkSync('../../kept', join(root, 'dependency', 'node_modules', '.bin', 'command'))
    removeBinDirectories(root)
    expect(payloadFiles(root).map(file => file.path)).toEqual(['dependency/kept'])
  })
})
