# Agent Note: Execution-world coherence

Status: implemented

English | [中文](2026-08-13-execution-world-coherence.zh.md)

## Problem

Filesystem tools operate through `ctx.fs`, while search, Shell, LSP, jobs, MCP stdio, Git subprocesses, and PTY allocation ultimately use `ctx.subprocess`. Provider swaps relied on a composition convention to keep these roots together. A mixed local/remote or remote/remote composition could therefore read and edit one project while executing commands somewhere else.

## Decision

Every filesystem and subprocess provider exposes an opaque process-local execution-world identity. The shipped composition mounts a startup guard that accepts the providers only when those identities are the same object. Labels are diagnostic and cannot establish equivalence.

Host-local providers share one exported identity. Adapters backed by a remote owner expose that owner's per-instance identity, so two independent sandboxes of the same provider type remain different worlds.

The identity check makes co-location a startup invariant without coupling consumers to local, SSH, container, E2B, or future Kubernetes implementations. It also gives remote inventory entries a concrete rule: construct all capability adapters from one resolved environment owner.

## Alternatives considered

**Compare provider labels or types.** Rejected because two containers or remote hosts created by the same provider remain different environments.

**Rely on bundle composition.** Rejected because user overlays and future Inventory resolution can replace one provider independently.

**Merge every capability into one large service.** Rejected because filesystem and process providers evolve independently and existing consumers already target their narrow seams.

## Consequences

Opaque identity proves only providers that participate in the contract. A provider-specific capability that bypasses both roots needs its own identity check. Process-local objects also do not replace durable environment ids in a distributed control plane; the control plane resolves a durable id first, then creates adapters that share one runtime object.

Unit coverage proves same-object acceptance and rejects equal labels on different objects. The assembled base profile mounts the guard over its local filesystem and subprocess providers; build and Loader validation cover that product path.
