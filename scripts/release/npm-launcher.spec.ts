import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const launcher = 'deploy/npm/bin/sivitacode.js'

function executable(path: string, source: string): void {
  writeFileSync(path, source)
  chmodSync(path, 0o755)
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sivitacode-npm-launcher-'))
  const commands = join(root, 'commands')
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  const log = join(root, 'launch.log')
  mkdirSync(commands)
  mkdirSync(home)
  mkdirSync(bin)

  const bootstrap = `#!/bin/sh
set -eu
target="$SIVITACODE_BIN_DIR/installed-sivitacode"
cat > "$target" <<'SCRIPT'
#!/bin/sh
if [ "\${1:-}" = "--version" ]; then printf '%s\\n' '0.1.0-rc.5'; exit 0; fi
printf '%s\\n' "$@" >> "$SIVITA_TEST_LOG"
SCRIPT
chmod 755 "$target"
ln -s "$target" "$SIVITACODE_BIN_DIR/sivitacode"
printf 'bootstrap\\n' >> "$SIVITA_TEST_LOG"
`
  const digest = createHash('sha256').update(bootstrap).digest('hex')
  const bootstrapFile = join(root, 'bootstrap.sh')
  writeFileSync(bootstrapFile, bootstrap)
  executable(join(commands, 'curl'), `#!/bin/sh
set -eu
output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output) output=$2; shift 2 ;;
    --retry|--proto) shift 2 ;;
    --*) shift ;;
    *) shift ;;
  esac
done
cp "$SIVITA_TEST_BOOTSTRAP" "$output"
`)
  return {
    root,
    bin,
    log,
    bootstrap,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${commands}:/usr/bin:/bin`,
      SIVITACODE_BIN_DIR: bin,
      SIVITACODE_BOOTSTRAP_URL: 'https://releases.example.invalid/install.sh',
      SIVITACODE_BOOTSTRAP_SHA256: digest,
      SIVITA_TEST_BOOTSTRAP: bootstrapFile,
      SIVITA_TEST_LOG: log,
    },
  }
}

describe('SivitaCode npm launcher', () => {
  it('installs the pinned core and starts the Web surface by default', () => {
    const subject = fixture()
    execFileSync('node', [launcher], { env: subject.env })
    expect(readFileSync(subject.log, 'utf8')).toBe('bootstrap\nweb\n')
  })

  it('reuses a matching installed core and forwards arguments unchanged', () => {
    const subject = fixture()
    const installed = join(subject.bin, 'installed-sivitacode')
    executable(installed, `#!/bin/sh
if [ "\${1:-}" = "--version" ]; then printf '%s\\n' '0.1.0-rc.5'; exit 0; fi
printf '%s\\n' "$@" >> "$SIVITA_TEST_LOG"
`)
    symlinkSync(installed, join(subject.bin, 'sivitacode'))

    execFileSync('node', [launcher, 'run', 'inspect safely'], { env: subject.env })
    expect(readFileSync(subject.log, 'utf8')).toBe('run\ninspect safely\n')
  })

  it('rejects a bootstrap whose bytes do not match the pinned digest', () => {
    const subject = fixture()
    const env = { ...subject.env, SIVITACODE_BOOTSTRAP_SHA256: '0'.repeat(64) }
    expect(() => execFileSync('node', [launcher], { env, encoding: 'utf8' }))
      .toThrow(/bootstrap checksum mismatch/)
    expect(() => readFileSync(subject.log, 'utf8')).toThrow()
  })
})
