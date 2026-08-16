# Agent Note: Durable session deletion and ACP keyset pagination

Status: implemented

English | [中文](2026-08-14-session-deletion-and-acp-pagination.zh.md)

## Problem

Closing an ACP session released its live Agent but retained the durable log forever, and `session/list` returned the entire corpus. Operators could neither remove a selected history through the product protocol nor bound list responses as a server accumulated sessions.

## Decision

`SessionPersistence` now advertises `supportsDeletion` and exposes `delete(id, signal?)`. First-party JSONL and SQLite backends delegate through `PersistenceCoordinator`, which serializes deletion with every operation for that id, waits for retirement, rejects live or unpublished-reserved identities, invalidates cold cached preparations, and starts destructive backend work only after the final cancellation check. Once deletion starts, its storage result is authoritative rather than being masked by a late abort.

JSONL resolves the unique id across project scopes, validates the stored header against the exact path, removes only the session-owned directory, and fsyncs the parent directory on POSIX. SQLite deletes one session row atomically and relies on its foreign-key cascade for that session's event rows. Unknown identities return `false`; unsupported third-party backends retain an explicit rejecting default.

`SessionQueryEngine.deleteSession` is the trusted live-preferred boundary: live ids, missing ids, and backend failures receive distinct existing error codes. ACP advertises `sessionCapabilities.delete` only for a deletion-capable mounted backend. For a connection-owned live session it first cancels work, settles the prompt, waits for idle, flushes persistence, drains continuable descendants, and disposes the handle before deleting the log. A session live under another owner rejects.

ACP list responses use a fixed 50-record keyset page ordered by descending `createdAt` and ascending id. The opaque cursor stores the last key and exact cwd filter. Continuation compares against the key rather than an offset, so newer inserts and deletion of the anchor do not duplicate records across pages.

## Alternatives considered

**Delete files or rows directly from the ACP bridge.** Rejected because it would bypass write-behind, live ownership, prepared-session reservations, backend identity validation, and future persistence providers.

**Offset pagination.** Rejected because inserting or deleting records ahead of an offset duplicates or skips sessions during traversal.

**Automatically close sessions owned by another frontend.** Rejected because stdio ACP has no authority to destroy a Web operator's live work; only handles owned by the current connection are settled automatically.

## Consequences

Operators can now distinguish non-destructive close from exact permanent deletion and can traverse a large corpus with bounded stable responses. Deletion is intentionally irreversible and has no automatic retention scheduler, archival tier, legal hold, or cross-process lease. The coordinator protects in-process ownership and ordering; deployments that permit multiple independent writers still need an external single-writer or lease policy.
