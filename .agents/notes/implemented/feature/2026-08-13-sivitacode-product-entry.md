# Agent Note: SivitaCode product entry

Status: implemented

English | [中文](2026-08-13-sivitacode-product-entry.zh.md)

## Problem

The repository needs an independently operated SivitaCode product without obscuring the origin of its DeepSeek Harness core. Reusing the `dsh` command and home would mix user data and make product behavior depend on compatibility conventions, while globally renaming internal packages would make upstream security review expensive and could imply authorship of unchanged code.

## Decision

**Two executable entries share one runtime.** The package publishes `sivitacode` through a dedicated thin entry and retains `dsh` as a compatibility executable. The dedicated entry selects product identity before importing the common dispatcher, so symlink resolution cannot select the wrong product.

**SivitaCode owns an isolated home.** `SIVITACODE_HOME`, or `~/.sivitacode` when unset, is mapped into the core's existing home resolver before boot. The compatibility executable continues to resolve `DSH_HOME` or `~/.dsh`. Project and home `.env` files cannot set either product's bootstrap variables.

**The product command favors Web and headless operation.** `sivitacode web` boots the Web profile and `sivitacode run <task>` boots the headless profile. The generic `--profile` and plugin-management interfaces remain available for composition and compatibility.

**Internal upstream package names remain traceable.** Unmodified and shared core packages retain their `@deepseek-ai/dsh-*` names and MIT attribution. The static browser artifact carries the SivitaCode title for the whole distribution. Command help, runtime prompt, and readiness text select SivitaCode identity only for the SivitaCode entry; the compatibility entry keeps its DSH text.

**Public identity is product-owned.** The Sivita Pulse mark combines an execution cell with a continuous S path, and the built-in violet/cyan palette distinguishes reasoning from execution signals. The Web application, documentation site, favicon, PWA metadata, and wordmark use the same geometry and color roles without reusing upstream artwork.

**Source and server artifacts are the primary public distribution.** The public Git repository preserves the complete MIT history and notices. Tagged releases attach verified, platform-specific Linux and macOS server archives plus the checksum-validating installer; users do not need access to the internal npm package graph. npm remains an optional launcher channel rather than the provenance or deployment authority.

## Alternatives considered

**Globally rename every upstream package.** Rejected because it creates a large permanent merge tax, weakens provenance, and adds no execution capability.

**Replace `dsh` with a single renamed executable.** Rejected because it breaks upstream comparisons and third-party plugin workflows while encouraging existing and new product data to share one home.

**Infer identity from an npm-generated symlink.** Rejected because launchers and package managers may expose either the link name or resolved JavaScript path. A dedicated marker entry is deterministic across direct, npm, pnpm, and container execution.

**Publish the complete internal package graph under a new npm scope.** Rejected because a mechanical rescope weakens upstream provenance and makes every upstream update a package-identity migration. Verified server archives carry the complete runtime without requiring registry publication of shared internals.

## Consequences

SivitaCode can ship its own command, data root, user-facing identity, and future configuration without misrepresenting the upstream core. Compatibility remains testable in the same artifact. Shared internals still use DSH-named environment and package interfaces, so a future rescope requires a deliberate migration rather than being implied by branding.

Release installation verification drives both packed executables with plain Node and requires each to report the packed package version. This prevents the compatibility entry from masking a missing or broken SivitaCode product entry.

The public release weighs more than a thin registry launcher, but one immutable archive includes the exact runtime that passed authentication, Web, ACP, native-sandbox, and offline-install checks. GitHub release publication waits for all supported platform jobs and can be repeated without changing asset names.
