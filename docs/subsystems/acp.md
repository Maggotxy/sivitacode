# Agent Client Protocol

English | [中文](acp.zh.md)

The [ACP bridge](../../packages/acp/acp) exposes SivitaCode agents to trusted programmatic clients over newline-delimited JSON-RPC. It owns live handles created on one connection while persistent list, resume, load, fork, and close operations use the shared session corpus. The bridge projects the canonical session stream into live text, reasoning, tool lifecycle, and context-usage updates; browser presentation and per-user Web authorization remain separate product surfaces.

Raw `assistant/chunk`, `tool/call`, and `tool/result` events are the projection authority. Block-end-only providers receive a complete-block fallback, while streamed blocks are not duplicated. Tool presentation callbacks are contained and map generic/diff intent natively, with textual terminal fallback. Because ACP has no partial-message rollback, failed or retried attempts may leave already delivered live text visible; load/replay remains intentionally limited to committed user and assistant messages.

Connection input closure cancels and settles every Agent owned by that bridge before emitting `acp/closed`. The [ACP application bundle](../../packages/bundle/acp-app) consumes this event to request bounded whole-profile shutdown, so the process does not exit ahead of session teardown.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="acp-events"></a>

### `acp/*` events

<a id="acpclosed--emit"></a>

#### `acp/closed` — emit

The ACP input stream closed and every Agent owned by that connection reached its teardown settlement point. A teardown failure is logged before this notification so a process host can still terminate.

```ts cordis-catalog
/**
 * The ACP input stream closed and every Agent owned by that connection
 * reached its teardown settlement point. A teardown failure is logged
 * before this notification so a process host can still terminate.
 * @mode emit
 */
'acp/closed'(): void
```

Source: [`packages/acp/acp/src/index.ts:77`](../../packages/acp/acp/src/index.ts)
<!-- END GENERATED cordis-surface -->
