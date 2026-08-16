# Agent Note: ACP persistent session lifecycle

Status: implemented

English | [中文](2026-08-14-acp-persistent-session-lifecycle.zh.md)

## Problem

An automation client could create and drive a session but could not continue it after releasing the live process handle. That made ACP unsuitable for long-running server work, cross-device continuation, or independent branches even though the harness already owned a validated durable session corpus.

## Decision

The ACP bridge uses `ctx.sessionQuery` and `ctx.agents.resume()` as the only durable lifecycle authorities. When that query service is present it advertises `session/list`, `session/resume`, `session/load`, and unstable `session/fork`; `session/close` is available for every live bridge-owned handle. Load replays committed user and assistant messages before responding, resume does not replay, and fork seeds a new agent from the validated complete log while preserving lineage and execution-world metadata.

Stored execution targets pass the same deployment allowlist as new sessions. A client cannot resume or fork a durable session into an Inventory target that its stdio deployment is not authorized to select. Close waits for agent quiescence and a session flush before releasing the handle, so a successful close is immediately resumable and listable.

Connection EOF owns the same quiescence operation as plugin disposal. After that operation settles, including after a logged teardown failure, the bridge emits `acp/closed`; the ACP application bundle consumes this notification to request bounded whole-profile shutdown. Process lifetime therefore follows protocol-stream closure rather than a second raw-stdin listener that can drift from the bridge's actual read lifecycle.

Protocol deletion remains unavailable because the append-only persistence service has no deletion operation. Listing is deliberately complete and unpaginated; a supplied cursor rejects instead of pretending to provide a stable snapshot cursor.

## Alternatives considered

**Keep ACP sessions process-lifetime only.** This retained a small bridge but failed the product requirement to continue server work across connections and duplicated a limitation the durable corpus already solves.

**Add ACP-owned session files.** A second store would diverge from Web, break execution-target and lineage invariants, and create recovery races. The shared session query, persistence, and agent factory remain authoritative.

**Delete persistence artifacts directly.** Backend-specific file or SQL deletion would bypass the persistence service and its lifecycle serialization. SivitaCode does not advertise `session/delete` until the owning service defines a safe operation.

## Consequences

ACP clients can close and later continue a session, replay its committed conversation, or fork an independent branch without keeping one stdio connection alive. The bridge now depends on the query service for persistent methods, while minimal compositions without it advertise only close plus baseline session operations. Full transcript presentation, pagination, and durable deletion remain explicit gaps.
