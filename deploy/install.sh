#!/bin/sh

set -eu

REPOSITORY=${SIVITACODE_REPOSITORY:-Maggotxy/sivitacode}
RELEASE=${SIVITACODE_VERSION:-dsh-v0.1.0-rc.5-sivitacode.1}
ARTIFACT_VERSION=${SIVITACODE_ARTIFACT_VERSION:-0.1.0-rc.5}
INSTALLER_SHA256=b86db19b6a7f13359c8c7f8a0b37cfb0eb56dedd0df12d8cd7e880482edb5a14

# Pinning both the release and installer digest keeps a convenient pipe install on
# the same authenticated, atomic path as a manually downloaded release.

fail() {
  printf 'SivitaCode install: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail 'Node.js 22.19 or newer is required'
command -v curl >/dev/null 2>&1 || fail 'curl is required'
command -v tar >/dev/null 2>&1 || fail 'tar is required'
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit((major === 22 && minor >= 19) || major >= 24 ? 0 : 1)" \
  || fail "Node.js $(node --version) is unsupported; install Node.js 22.19 or newer"

case "$(uname -s)" in
  Linux) platform=linux ;;
  Darwin) platform=darwin ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) architecture=x64 ;;
  arm64 | aarch64) architecture=arm64 ;;
  *) fail "unsupported CPU architecture: $(uname -m)" ;;
esac

home=${HOME:?HOME is required}
install_root=${SIVITACODE_INSTALL_ROOT:-${XDG_DATA_HOME:-$home/.local/share}/sivitacode}
bin_dir=${SIVITACODE_BIN_DIR:-$home/.local/bin}
base_url=${SIVITACODE_RELEASE_BASE_URL:-https://github.com/$REPOSITORY/releases/download/$RELEASE}
archive_name=sivitacode-server-$ARTIFACT_VERSION-$platform-$architecture.tar.gz

mkdir -p "$bin_dir"
if { [ -e "$bin_dir/sivitacode" ] || [ -L "$bin_dir/sivitacode" ]; } && [ ! -L "$bin_dir/sivitacode" ]; then
  fail "$bin_dir/sivitacode exists and is not a symbolic link"
fi

temporary=$(mktemp -d "${TMPDIR:-/tmp}/sivitacode-install.XXXXXX")
link_temporary=$bin_dir/.sivitacode.$$
cleanup() {
  rm -rf "$temporary"
  rm -f "$link_temporary"
}
trap cleanup EXIT HUP INT TERM

download() {
  curl --fail --location --silent --show-error --retry 3 --proto '=https' --tlsv1.2 \
    --output "$2" "$1"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    node -e "const { createHash } = require('node:crypto'); const { readFileSync } = require('node:fs'); process.stdout.write(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'))" "$1"
  fi
}

installer=$temporary/install-sivitacode.mjs
archive=$temporary/$archive_name
checksum=$archive.sha256

download "$base_url/install-sivitacode.mjs" "$installer"
[ "$(sha256 "$installer")" = "$INSTALLER_SHA256" ] || fail 'installer checksum mismatch'
download "$base_url/$archive_name" "$archive" \
  || fail "release $RELEASE does not provide $platform-$architecture"
download "$base_url/$archive_name.sha256" "$checksum"

node "$installer" install --root "$install_root" --archive "$archive" --checksum "$checksum"

installed_installer=$install_root/install-sivitacode.mjs
cp "$installer" "$install_root/.install-sivitacode.mjs.$$"
chmod 755 "$install_root/.install-sivitacode.mjs.$$"
mv -f "$install_root/.install-sivitacode.mjs.$$" "$installed_installer"

command_path=$install_root/current/node_modules/@deepseek-ai/dsh/lib/sivitacode.js
[ -x "$command_path" ] || fail "installed command is not executable: $command_path"
ln -s "$command_path" "$link_temporary"
mv -f "$link_temporary" "$bin_dir/sivitacode"

printf '\nSivitaCode %s is installed.\n' "$ARTIFACT_VERSION"
printf 'Run: %s web\n' "$bin_dir/sivitacode"
printf 'Rollback: node %s rollback --root %s\n' "$installed_installer" "$install_root"
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf 'Add %s to PATH to run sivitacode directly.\n' "$bin_dir" ;;
esac
