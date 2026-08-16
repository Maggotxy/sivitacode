import { createHash } from 'node:crypto'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function executable(path: string, source: string): void {
  writeFileSync(path, source)
  chmodSync(path, 0o755)
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function fixture(options: { installer?: string; system?: string; architecture?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sivitacode-bootstrap-'))
  const commands = join(root, 'commands')
  const assets = join(root, 'assets')
  const home = join(root, 'home')
  const log = join(root, 'requests.log')
  mkdirSync(commands)
  mkdirSync(assets)
  mkdirSync(home)

  executable(join(commands, 'uname'), `#!/bin/sh
if [ "$1" = "-s" ]; then printf '%s\\n' "\${SIVITA_TEST_UNAME_S}"; else printf '%s\\n' "\${SIVITA_TEST_UNAME_M}"; fi
`)
  executable(join(commands, 'curl'), `#!/bin/sh
set -eu
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --retry|--proto) shift 2 ;;
    --*) shift ;;
    *) url=$1; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$SIVITA_TEST_LOG"
cp "$SIVITA_TEST_ASSETS/\${url##*/}" "$output"
`)
  executable(join(commands, 'node'), `#!/bin/sh
set -eu
if [ "$1" = "-e" ]; then exit 0; fi
shift
[ "$1" = "install" ]
shift
install_root=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) install_root=$2; shift 2 ;;
    *) shift ;;
  esac
done
entry="$install_root/current/node_modules/@deepseek-ai/dsh/lib/sivitacode.js"
mkdir -p "\${entry%/*}"
printf '#!/bin/sh\\n' > "$entry"
chmod 755 "$entry"
printf 'install\\n' >> "$SIVITA_TEST_LOG"
`)

  const installer = join(assets, 'install-sivitacode.mjs')
  if (options.installer === undefined) cpSync('deploy/install-sivitacode.mjs', installer)
  else writeFileSync(installer, options.installer)
  const archiveName = 'sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz'
  const archive = join(assets, archiveName)
  writeFileSync(archive, 'authenticated fixture archive')
  writeFileSync(`${archive}.sha256`, `${digest(archive)}  ${archiveName}\n`)

  return {
    root,
    home,
    log,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${commands}:/usr/bin:/bin`,
      SIVITA_TEST_ASSETS: assets,
      SIVITA_TEST_LOG: log,
      SIVITA_TEST_UNAME_S: options.system ?? 'Linux',
      SIVITA_TEST_UNAME_M: options.architecture ?? 'x86_64',
      SIVITACODE_RELEASE_BASE_URL: 'https://releases.example.invalid/version',
    },
  }
}

describe('SivitaCode bootstrap installer', () => {
  it('selects the host artifact and publishes a stable command link', () => {
    const subject = fixture()
    const output = execFileSync('sh', ['deploy/install.sh'], { env: subject.env, encoding: 'utf8' })
    const installRoot = join(subject.home, '.local/share/sivitacode')
    const command = join(subject.home, '.local/bin/sivitacode')
    expect(readlinkSync(command)).toBe(join(
      installRoot, 'current/node_modules/@deepseek-ai/dsh/lib/sivitacode.js',
    ))
    expect(readFileSync(subject.log, 'utf8')).toContain('sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz')
    expect(output).toContain(`${command} web`)
  })

  it('rejects a bootstrap installer that does not match the pinned digest', () => {
    const subject = fixture({ installer: 'untrusted installer' })
    expect(() => execFileSync('sh', ['deploy/install.sh'], { env: subject.env, encoding: 'utf8' }))
      .toThrow(/installer checksum mismatch/)
    expect(readFileSync(subject.log, 'utf8')).not.toContain('install\n')
  })

  it('rejects an unsupported host before downloading release assets', () => {
    const subject = fixture({ system: 'FreeBSD' })
    expect(() => execFileSync('sh', ['deploy/install.sh'], { env: subject.env, encoding: 'utf8' }))
      .toThrow(/unsupported operating system/)
    expect(() => readFileSync(subject.log, 'utf8')).toThrow()
  })
})
