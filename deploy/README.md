# SivitaCode server deployment

English | [中文](README.zh.md)

SivitaCode server artifacts are self-contained production dependency trees built from the same npm tarballs that pass the packed-install release check. They require a supported Node runtime but no source checkout, Corepack, pnpm, compiler, or registry access on the server. Each archive carries the MIT license, third-party notices, target platform and architecture, pinned upstream commit, and a per-file SHA-256 manifest.

Each `dsh-v*` tag publishes all four verified archives, their checksum files, and this repository's installer on [GitHub Releases](https://github.com/Maggotxy/sivitacode/releases). Release assets, rather than the internal npm package graph, are the supported public installation input.

Build and verify the npm inputs on the same platform and CPU architecture as the destination, then produce the platform-specific archive. Building the Linux launcher requires a native musl toolchain (`musl-tools` on Ubuntu); macOS reproducible archives require GNU tar (`brew install gnu-tar`). Production servers need neither tool. `--from` accepts the dsh, vendored-framework, and Landlock pack directories; every supplied tarball is installed from local bytes into an isolated staging tree. The command sequence below is the Linux path; macOS packs the portable Landlock entry instead of a launcher and uses Seatbelt at runtime.

```sh
pnpm run build
pnpm run release:pack --family dsh --out dist/npm/dsh
pnpm run release:pack --family vendor --out dist/npm/vendor
pnpm --dir native/landlock-run run build:native
node native/landlock-run/scripts/pack-release.mjs "$PWD/dist/npm-landlock" --current-platform-only
NALR_REQUIRE_LANDLOCK=1 node native/landlock-run/scripts/verify-packed-install.mjs "$PWD/dist/npm-landlock" --current-platform-only
pnpm run release:verify-packed-install --family dsh --from dist/npm/dsh --from dist/npm/vendor --from dist/npm-landlock
pnpm run release:server-bundle --from dist/npm/dsh --from dist/npm/vendor --from dist/npm-landlock --out dist/server
```

Copy the `.tar.gz`, matching `.sha256`, and `deploy/install-sivitacode.mjs` to a Linux or macOS server of the matching CPU architecture. The installer validates the outer checksum and archive entries before extraction, validates every manifest file, runs the installed `--version` and command-help smokes, then switches `current` atomically. A failed validation or smoke leaves the active release unchanged. Old releases are retained.

The dsh release workflow builds and verifies four native artifacts:

| Artifact | Native runner | Required confinement proof |
|---|---|---|
| `linux-x64` | `ubuntu-24.04` | installed Landlock |
| `linux-arm64` | `ubuntu-24.04-arm` | installed Landlock |
| `darwin-arm64` | `macos-latest` | installed Seatbelt |
| `darwin-x64` | `macos-15-intel` | installed Seatbelt |

Every leg performs a fresh offline installation, boots the authenticated Web composition, accepts a secure login through the trusted-proxy boundary, serves the packed SPA, then drives an installed ACP session through a deterministic real prompt and verifies live reasoning/text updates plus the complete persistent lifecycle. Publication waits for all four native legs.

```sh
sudo node install-sivitacode.mjs install \
  --root /opt/sivitacode \
  --archive ./sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz \
  --checksum ./sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz.sha256
readlink -f /opt/sivitacode/current
```

An upgrade uses the same command with the new artifact. Roll back to the release recorded before the latest activation without rebuilding or downloading anything:

```sh
sudo node install-sivitacode.mjs rollback --root /opt/sivitacode
```

Keep mutable state outside release directories and run the Web profile as an unprivileged dedicated account. Copy `sivitacode.env.example` to `/etc/sivitacode/sivitacode.env`, restrict it to the service account, replace every example value, and install `sivitacode.service` as `/etc/systemd/system/sivitacode.service`. The unit invokes the installed Node entry directly.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now sivitacode
sudo systemctl status sivitacode
```

The unit binds only to loopback. Use exactly one TLS reverse-proxy example, replace `code.example.com`, and keep port 3080 blocked from public networks. The proxy replaces forwarded headers and supports WebSocket upgrades; the application trusts only the configured loopback proxy CIDR.

Container execution targets are separate from packaging SivitaCode itself. Install rootless Docker or Podman for the service account before registering such a target; SivitaCode refuses a runtime that cannot prove rootless operation and never falls back to host execution.

Treat local execution targets as projects trusted to the dedicated service account: they share that account's host permissions. A public multi-user deployment must place mutually untrusted projects in rootless-container targets or isolated remote SSH accounts. Filesystem roots and per-Agent service realms route capabilities coherently but do not replace an OS isolation boundary.
