# SivitaCode

English | [中文](README.zh.md)

SivitaCode is a Web-first, headless coding agent for Linux and macOS. It is independently developed from the MIT-licensed [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), retains the upstream `dsh` compatibility command, and adds a product-owned `sivitacode` command and isolated home.

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Status

SivitaCode is in developer preview. Pin deployments to a release because its upstream core and SivitaCode extensions may make compatibility-breaking changes before the first stable release.

## Run

### Install a published server release

The supported public distribution is a verified GitHub Release archive for `linux-x64`, `linux-arm64`, `darwin-x64`, or `darwin-arm64`. It requires Node.js 22.19 or newer on the destination, but no source checkout, pnpm, compiler, or npm registry access. Download the archive, its adjacent `.sha256`, and `install-sivitacode.mjs` from the same [release](https://github.com/Maggotxy/sivitacode/releases), then install them:

```sh
sudo node install-sivitacode.mjs install \
  --root /opt/sivitacode \
  --archive ./sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz \
  --checksum ./sivitacode-server-0.1.0-rc.5-linux-x64.tar.gz.sha256
node /opt/sivitacode/current/node_modules/@deepseek-ai/dsh/lib/sivitacode.js web
```

The installer validates the outer digest, every archived path, the per-file manifest, and installed CLI smokes before atomically changing `current`. The [deployment reference](deploy/README.md) covers systemd, HTTPS reverse proxies, upgrades, rollback, SSH targets, and rootless container targets.

### Run from source

Install Node.js 22.19 or later and pnpm 11.7, then run:

```sh
corepack pnpm install
corepack pnpm run build
corepack pnpm sivitacode web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default. The loopback default is deliberate: use an SSH tunnel for private remote access, or deploy the authenticated reverse-proxy configuration below for public access.

For an HTTPS reverse proxy on the same server, keep SivitaCode behind the proxy and configure the public authority explicitly:

```sh
SIVITACODE_WEB_PASSWORD='use a long unique password' \
SIVITACODE_WEB_ADMIN_USERNAME='admin' \
SIVITACODE_WEB_PUBLIC_ORIGIN='https://code.example.com' \
SIVITACODE_WEB_TRUSTED_PROXY_CIDRS='127.0.0.1/32' \
  corepack pnpm sivitacode web --host 0.0.0.0 --trusted-host code.example.com
```

Terminate TLS at the reverse proxy and forward HTTP plus WebSocket upgrades to port 3080. The proxy must replace `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`; SivitaCode trusts those fields only when the direct peer belongs to `SIVITACODE_WEB_TRUSTED_PROXY_CIDRS`. Use the proxy's actual source CIDR rather than a client network. Do not expose port 3080 publicly or set `SIVITACODE_WEB_INSECURE_COOKIE` in a public deployment.

### Run one headless task

```sh
corepack pnpm sivitacode run "inspect this repository and run its tests"
```

SivitaCode stores profiles, settings, credentials, and sessions under `~/.sivitacode`. Set `SIVITACODE_HOME` in the launching environment to move that root. The compatibility `dsh` command continues to use `DSH_HOME` or `~/.dsh`; the two products never share data implicitly.

## Architecture

Web and headless modes use one plugin-composed agent core. Filesystem, shell, terminal, jobs, LSP, MCP stdio, sessions, tools, LLMs, and subagents share a selected execution world. The Web inventory can open sessions on the local host, an exact-host-key-pinned SSH server, or a rootless Docker/Podman container without routing subprocess-backed tools back to the control machine. Deployment plans retain target revisions, enforce separate production approval, bound output, and execute once through the same managed subprocess provider. Safe Git worktrees are created inside each selected target workspace.

GitHub Releases are the deployment authority. npm publication remains optional because distributing the complete internal `@deepseek-ai/dsh-*` graph under another scope would weaken provenance and create a permanent upstream merge cost; a future `sivitacode` npm package may provide a checksum-verifying launcher without replacing release archives.

The current repository intentionally keeps upstream internal `@deepseek-ai/dsh-*` package names. This preserves traceable provenance, avoids pretending upstream work is original SivitaCode code, and keeps selective upstream security updates reviewable. SivitaCode-owned features use their own product identity and are documented as such.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## Attribution and license

SivitaCode is based on DeepSeek Harness and distributed under the [MIT license](LICENSE). The original DeepSeek copyright and permission notice are retained. SivitaCode modifications must be identified in release notes and source history; do not describe the upstream core as original SivitaCode work.

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
