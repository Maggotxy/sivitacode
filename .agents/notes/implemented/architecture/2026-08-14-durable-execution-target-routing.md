# Agent Note: Durable execution-target routing

Status: implemented

English | [中文](2026-08-14-durable-execution-target-routing.zh.md)

## Problem

A session that selects a remote or container target must keep every filesystem and subprocess-backed capability in that target across resume, fork, and subagent creation. Routing only shell commands lets MCP, LSP, jobs, or file operations escape back to the control machine.

## Decision

A session header may name one deployment Inventory target. Agent construction resolves that target before publishing the Agent, isolates filesystem, subprocess, and transport service realms, and mounts one owner for the complete Agent lifetime. Forks and in-process subagents inherit the target. A missing, disabled, or unavailable target fails loud.

The route provider derives capability realms from AgentLoop's complete runtime Context, while the API, ACP, or subagent caller Context owns only the Agent lifecycle. This prevents a transport adapter's narrow injection scope from becoming the capability base and losing session, tool, or provider services.

ACP uses the standard extension metadata namespace `_meta['sivitacode.dev']`. A configured deployment allowlist advertises `executionTarget` support and permits `session/new` to persist one selected target; no allowlist means no advertised capability and every selection rejects. Because ACP stdio has no authenticated actor, an exact list or explicit `['*']` is process-level trust rather than user RBAC.

The shipped `sivitacode acp` profile composes the base runtime, ACP bridge, and deployment Inventory over the same `$SIVITACODE_HOME/sivitacode.db` SQLite WAL medium used by Web. Web remains the authenticated administrative control plane; each ACP process receives only its deployment allowlist. SQLite replaces the single-process whole-file JSON medium because Web and ACP are supported as concurrent processes. Existing JSON storage is not migrated under the pre-release compatibility stance.

Shared filesystem, search, and Bash tools plus workspace-instruction discovery select services from the routed Agent context for every call carrying a durable target; target-side Bash is mounted only after the filesystem and subprocess adapters are ready. Agent-scoped terminal, LSP, and MCP stdio plugins mounted during setup capture those routed services directly. Providers expose one opaque execution-world identity; the coherence invariant rejects mismatched filesystem and subprocess owners.

Filesystem skill discovery also follows the Agent filesystem. Host filesystem watchers observe only local execution-world roots; target-backed roots are complete but deliberately uncacheable and are rescanned on every lookup, so SSH or OCI changes made through Git, shell, or another process cannot leave a false host-watched catalog.

Inventory target revisions remain administrative desired state. A resumed session resolves its durable target id against the current enabled target record, so administrators can rotate host keys or images without rewriting session logs. Deployment plans instead pin a target revision because their approval applies to an exact executable destination.

## Alternatives considered

**Route each consumer independently.** This was rejected because new subprocess-backed consumers could silently bypass the target and independent providers could describe different machines.

**Persist a complete target snapshot in every session.** This was rejected because host-key and image rotation would require rewriting immutable session metadata. Deployment plans retain exact revisions where approval needs immutable destination state.

**Let any ACP client select any Inventory target.** This was rejected because the unauthenticated stdio client would gain access to target-held SSH credentials by knowing an id. The deployment must name exact targets or explicitly choose the wildcard.

## Consequences

Local, exact-host-key-pinned SSH, and rootless OCI targets use the same Agent composition. A transport-specific feature cannot bypass routing by spawning directly from the control process. MCP stdio follows that composition through `ctx.subprocess`. Streamable HTTP records `networkOwner: control-plane`; its URL is never silently reinterpreted as target-local `localhost`, and an `execution-target` owner is rejected until an authenticated, cancellable, audited tunnel lifecycle exists.

## Verification

Composition tests assert shared filesystem/subprocess identity, per-call filesystem/search/Bash provider selection, and real target-side file, process, shell, PTY, search, skill discovery, stdio MCP, Git worktree, health, deployment, and cleanup behavior. Session creation, persistence, fork, subagent inheritance, Host RPC, Client projections, ACP capability negotiation, allowlist rejection, pre-publication mount failure, and response metadata cover the durable target field.
