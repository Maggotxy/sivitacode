# Agent Note: Immutable server releases

Status: implemented

English | [中文](2026-08-14-immutable-server-releases.zh.md)

## Problem

The server guide assumed a built source checkout under `/opt/sivitacode/current` and invoked pnpm from systemd. A new server therefore needed the monorepo, package manager, compiler output, and an undocumented manual upgrade procedure. A failed in-place install could alter the live dependency tree, and no authenticated artifact identified the upstream revision or supported rollback.

## Decision

The server artifact is built from the complete local npm tarball set after the packed-install check. The builder installs those exact package bytes into an isolated production dependency tree, compiles and loads node-pty for the target platform, removes npm command links, rejects remaining symbolic links, records every regular file by size and SHA-256, embeds the license and third-party notices, and emits a reproducible platform-and-architecture archive with an outer SHA-256 file. The manifest identifies SivitaCode, the Node engine range, the entry file, and the pinned DeepSeek Harness commit.

The server installer validates the outer digest and all tar members before extraction. It accepts only regular files and directories with relative non-traversing names, then requires the extracted file set to equal the manifest and verifies every size and digest. Platform, architecture, Node runtime, entry authentication, version output, and the Web, run, and ACP command surfaces are checked before activation.

The dsh release workflow builds four native archives from credential-free npm pack outputs: Linux x64, Linux arm64, macOS arm64, and macOS x64. Each runs on a matching GitHub-hosted architecture so node-pty is compiled for the declared target. Linux legs compile the matching static musl Landlock launcher and require two real confinement proofs. macOS legs use reproducible GNU tar and require a real installed-package Seatbelt proof that permits a workspace write while denying read-only and adjacent-path writes. Before upload, every leg performs a fresh offline install, starts the installed entry with a temporary state home and production-style public-origin settings, observes the unauthenticated login redirect, signs in through the trusted reverse-proxy boundary, checks the Secure `__Host-` session cookie, and fetches the packed SivitaCode SPA. It then starts the installed ACP entry, negotiates the text and complete persistent-session lifecycle including deletion, and requires a clean exit after stdin EOF. Publication depends on all four server legs, so uploaded artifacts are downstream of native loading, sandbox enforcement, and both runtime compositions' readiness rather than only archive construction.

Releases live under `<root>/releases/<identity>`. `current` and `previous` are relative symbolic links switched with same-filesystem rename. Installation stages under the deployment root, so publication and link replacement are atomic on that filesystem. A failed check leaves `current` untouched. Rollback re-verifies and smokes `previous` before swapping the two links. The installer retains every release and never edits product state, which remains under `SIVITACODE_HOME`.

The rootless bootstrap pins both a release and the SHA-256 of the full installer it downloads. It detects the host, fetches the matching archive and checksum, and delegates to that installer instead of implementing a second activation path. The zero-dependency `sivitacode` npm package pins and verifies that bootstrap, reuses an already active matching core, and otherwise delegates installation before forwarding arguments to the stable command. The Docker image uses the same immutable archive through the same installer. Private Linux Compose uses host networking to preserve the loopback-only Web default. Public Compose binds the application only to a fixed private container subnet, requires persistent authentication, trusts forwarded request facts only from that subnet, and places Caddy in front for automatic HTTPS.

## Alternatives considered

**Run pnpm deploy directly from the workspace.** A real probe produced a portable-looking dependency tree but failed at startup because plugins loaded by Cordis configuration are not all reachable through JavaScript dependency edges. Selecting only the CLI closure cannot represent the runtime composition.

**Install from the public registry on each server.** This makes activation depend on credentials, registry availability, mutable dist-tags, and post-download resolution. It also separates the server bytes from the tarballs already checked by the release workflow.

**Publish the internal package graph as an npm one-command install.** This duplicates dependency resolution outside the verified release build and exposes implementation packages as a public compatibility contract. The selected thin npm launcher downloads a pinned Release bootstrap instead, so npm is not the source of product bytes.

**Expose an unauthenticated application port from a bridge network.** This weakens the loopback security default and lets deployments become public accidentally. The private composition retains loopback through host networking; the public composition requires authentication and an explicit TLS origin.

**Copy or archive the source workspace.** This retains workspace links and build tools, captures dirty or ignored files, and makes a server deployment depend on the builder's checkout layout.

**Update one live directory in place.** This has no atomic commit point: a process restart can observe a partially replaced dependency tree, and recovery requires reconstructing the former bytes.

## Consequences

Linux and macOS need one artifact per platform and architecture, because optional native dependencies are resolved while the bundle is built. Artifact creation requires the complete locally packed family and external npm dependencies in the builder's cache or network, while installation itself is offline. The release directory is larger than a minimal static import closure because configuration-selected plugins are included deliberately.

Atomic activation does not by itself restart systemd or provide connection draining; operators combine the installer with the deployment inventory's drain, verify, rollback, and restore lifecycle. Retaining all releases consumes disk until an operator removes an inactive release through a separately reviewed procedure.

The shell and npm bootstraps require Node.js 22.19 or newer. The npm command also requires `sh`, `curl`, and `tar` because it deliberately preserves the shared installer path. The current preview publishes Linux x64 only, so detected hosts without a matching asset fail before activation. Private Compose depends on Linux host networking. Public Compose requires a DNS name, reachable ports 80 and 443, and an operator-supplied administrator password.
