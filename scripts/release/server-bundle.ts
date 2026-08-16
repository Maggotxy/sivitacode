/** Build a self-contained SivitaCode server archive from verified npm tarballs. */

import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { releaseFamily } from './families.ts'
import { capture, isEntry, run } from './process.ts'
import { packedIdentity } from './tarball.ts'

/** Schema version of the server artifact manifest. */
export const SERVER_BUNDLE_FORMAT = 1

/** One immutable file carried by a server artifact. */
export interface ServerBundleFile {
  /** POSIX path below the artifact root. */
  readonly path: string
  /** File size in bytes. */
  readonly size: number
  /** Lowercase SHA-256 digest. */
  readonly sha256: string
}

/** Metadata authenticated by the outer archive digest and checked by the installer. */
export interface ServerBundleManifest {
  readonly format: typeof SERVER_BUNDLE_FORMAT
  readonly product: 'SivitaCode'
  readonly version: string
  readonly platform: NodeJS.Platform
  readonly arch: string
  readonly node: string
  readonly upstream: { readonly repository: string; readonly commit: string }
  readonly entry: string
  readonly files: readonly ServerBundleFile[]
}

/** Return a file's SHA-256 digest. */
export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Enumerate regular files without allowing links to escape the immutable release. */
export function payloadFiles(root: string): ServerBundleFile[] {
  const files: ServerBundleFile[] = []
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`server bundle payload contains a symbolic link: ${relative(root, path)}`)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        const name = relative(root, path).replaceAll('\\', '/')
        if (name !== 'manifest.json') files.push({ path: name, size: statSync(path).size, sha256: sha256(path) })
      } else throw new Error(`server bundle payload contains an unsupported file: ${relative(root, path)}`)
    }
  }
  visit(root)
  return files
}

/** Remove npm's generated command-link directories; SivitaCode invokes its Node entry directly. */
export function removeBinDirectories(root: string): void {
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      if (entry.name === '.bin') rmSync(path, { recursive: true, force: true })
      else visit(path)
    }
  }
  visit(root)
}

function packedDependencies(directories: readonly string[]): Map<string, { readonly path: string; readonly url: string }> {
  const dependencies = new Map<string, { readonly path: string; readonly url: string }>()
  for (const directory of directories) {
    for (const filename of readdirSync(directory).filter(name => name.endsWith('.tgz')).sort()) {
      const tarball = join(directory, filename)
      dependencies.set(packedIdentity(tarball).name, { path: tarball, url: pathToFileURL(tarball).href })
    }
  }
  return dependencies
}

/** Build the archive named by the command-line options. */
function main(): void {
  const { values } = parseArgs({ options: {
    from: { type: 'string', multiple: true }, out: { type: 'string' }, commit: { type: 'string' },
  } })
  if (values.from === undefined || values.from.length === 0) {
    throw new Error('usage: server-bundle.ts --from <packed directory> [--from ...] [--out dist/server] [--commit <sha>]')
  }
  const repository = process.cwd()
  const packed = packedDependencies(values.from.map(path => resolve(repository, path)))
  const cli = packed.get('@deepseek-ai/dsh')
  if (cli === undefined) throw new Error('packed inputs do not contain @deepseek-ai/dsh')
  const expectedVersion = packedIdentity(cli.path).version
  releaseFamily('dsh').verifyVersions(releaseFamily('dsh').members(repository))
  const commit = values.commit ?? capture('git', ['rev-parse', 'HEAD'], { cwd: repository })
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`commit must be a full lowercase Git SHA: ${commit}`)

  const temporary = mkdtempSync(join(tmpdir(), 'sivitacode-server-bundle-'))
  const artifactRoot = join(temporary, 'sivitacode-server')
  const output = resolve(repository, values.out ?? 'dist/server')
  try {
    mkdirSync(artifactRoot, { recursive: true })
    writeFileSync(join(artifactRoot, 'package.json'), `${JSON.stringify({
      name: 'sivitacode-server-runtime', private: true, version: expectedVersion,
      allowScripts: { 'node-pty@1.1.0': true },
      dependencies: Object.fromEntries([...packed].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, value.url])),
    }, null, 2)}\n`)
    const environment = { ...process.env }
    delete environment.NODE_OPTIONS
    delete environment.NODE_PATH
    capture('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: artifactRoot, env: environment })
    // npm does not consistently run node-pty's install script when its parent
    // arrives through local file tarballs. The server artifact must carry the
    // native module built for its declared platform instead of deferring a
    // compiler requirement to the target server.
    capture(process.execPath, ['-e', "require('node-pty')"], { cwd: artifactRoot, env: environment })
    removeBinDirectories(join(artifactRoot, 'node_modules'))
    cpSync(join(repository, 'LICENSE'), join(artifactRoot, 'LICENSE'))
    cpSync(join(repository, 'THIRD_PARTY_NOTICES.md'), join(artifactRoot, 'THIRD_PARTY_NOTICES.md'))
    const entry = 'node_modules/@deepseek-ai/dsh/lib/sivitacode.js'
    const version = capture(process.execPath, [join(artifactRoot, entry), '--version'], { cwd: artifactRoot, env: environment })
    if (version !== expectedVersion) throw new Error(`installed SivitaCode reports ${version}, expected ${expectedVersion}`)
    capture(process.execPath, [join(artifactRoot, entry), 'web', '--help'], { cwd: artifactRoot, env: environment })
    rmSync(join(artifactRoot, 'package.json'))
    const manifest: ServerBundleManifest = {
      format: SERVER_BUNDLE_FORMAT, product: 'SivitaCode', version: expectedVersion,
      platform: process.platform, arch: process.arch, node: '^22.19.0 || >=24.0.0',
      upstream: { repository: 'https://github.com/deepseek-ai/deepseek-harness', commit }, entry,
      files: payloadFiles(artifactRoot),
    }
    writeFileSync(join(artifactRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    mkdirSync(output, { recursive: true })
    const filename = `sivitacode-server-${expectedVersion}-${process.platform}-${process.arch}.tar.gz`
    const archive = join(output, filename)
    // GNU tar is `tar` on Linux and `gtar` from Homebrew on macOS. The
    // explicit choice preserves byte-reproducible ordering/metadata instead
    // of silently accepting BSD tar's different option and gzip dialect.
    const tar = process.platform === 'darwin' ? 'gtar' : 'tar'
    run(tar, ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', archive, '-C', temporary, basename(artifactRoot)])
    writeFileSync(`${archive}.sha256`, `${sha256(archive)}  ${filename}\n`)
    console.log(`server bundle: ${archive}`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (isEntry(import.meta.url)) main()
