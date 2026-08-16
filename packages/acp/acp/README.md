# @deepseek-ai/dsh-acp

English | [中文](README.zh.md)

Automation-only [Agent Client Protocol](https://agentclientprotocol.com) server over JSON-RPC stdio. Programmatic clients create, list, close, resume, load, and fork persistent harness agents, send text prompts, observe live text, reasoning, tool lifecycle, and context usage, resolve one-shot permission requests by policy, and cancel work. The primary in-repository client is [`dsh-subagent-acp`](../../subagent/subagent-acp/README.md).

This package is a transport adapter, not a UI integration or a capability seam. It does not expose editor navigation, complete transcript replay, commands, modes, configuration pickers, elicitation, plans, or titles. It does project provider-neutral reasoning and tool presentation intents onto ACP updates; interactive rendering and human questions remain the responsibility of the client or Web host.

## Plugin

`apply(ctx, config)` opens an `AgentSideConnection` on stdin/stdout and drives `ctx.agents`. Stdout is reserved for protocol frames.

| Config | Default | Meaning |
|---|---|---|
| `provider` | — | Initial provider route for every created agent. |
| `model` | — | Initial model for every created agent. |
| `executionTargets` | — | Exact durable target ids an ACP client may select; `['*']` explicitly trusts the stdio client to select any registered target. |

Both fields are optional so another agent/request listener may supply the target. The runnable ACP composition requires both.

## Protocol contract

| Method | Behavior |
|---|---|
| `initialize` | Negotiates the supported version and advertises baseline-only prompts. When `executionTargets` is configured, `agentCapabilities._meta['sivitacode.dev'].executionTarget` advertises target selection. No editor, terminal, filesystem, or MCP client capability is advertised. |
| `authenticate` | No-op because the server advertises no authentication methods. |
| `session/new` | Creates a fresh agent with an absolute primary `cwd`; empty `additionalDirectories` and `mcpServers` are accepted, non-empty values reject. Optional `_meta['sivitacode.dev'].executionTarget` must name an allowlisted target; the server mounts it before publication, persists it in the session header, and echoes the selection in response `_meta`. |
| `session/list` | Lists durable and live sessions with an absolute `cwd`, optional exact-`cwd` filtering, title metadata, and only execution targets permitted by this ACP deployment. Returns stable 50-record keyset pages; a cursor is bound to its cwd filter and continues after `(createdAt,id)`, so newer inserts and deletion of the anchor do not duplicate records. |
| `session/delete` | Cancels, settles, flushes, drains descendants, and releases a connection-owned live handle before permanently deleting its durable log. A live session owned elsewhere and an unknown id reject. Advertised only when the mounted persistence backend supports deletion. |
| `session/resume` | Reconstructs an inactive persisted session without replaying history; its `cwd` must match the durable header and its target must remain allowlisted. |
| `session/load` | Resumes with the same checks, then replays committed user and assistant messages in log order before returning. |
| `session/fork` | Creates an independent session from a validated, balanced complete log and records durable parent, seed, workspace, preset, and execution-target metadata. |
| `session/close` | Cancels and settles pending work, waits for idle, flushes durability, drains continuable descendants, and releases only the addressed live session. |
| `session/prompt` | Concatenates text blocks, renders baseline resource links as bracketed textual references, rejects empty or beyond-baseline input, permits one in-flight request per session, and waits for the whole agent to become idle. Normal quiescence reports `end_turn`; explicit ACP cancellation, disposal, or a prompt whose admission was discarded (a turnless slot) reports `cancelled`. |
| `session/cancel` | Cancels only the addressed agent and settles its pending prompt as `cancelled`; unknown ids are no-ops. |
| `session/update` | Projects durable `assistant/chunk`, `tool/call`, and `tool/result` events as live text, thought, and tool lifecycle updates. A provider that emits only `block-end` still produces one complete text/thought update; a block already sent as deltas is not repeated. Usage is sent only when the model advertised a context window. |
| `session/request_permission` | Offers one-shot allow/reject choices for bridge-owned approval requests carrying a tool call id. Clients may answer automatically. |

One connection may own several sessions. The bridge keys records by branded session id and checks exact agent identity before routing events or permission requests. Each session has an independent prompt slot, workspace, cancellation path, and disposer.

ACP stdio is an unauthenticated trusted automation channel. Target selection is therefore disabled unless the deployment supplies `executionTargets`; this prevents an arbitrary local ACP client from reaching Inventory-held SSH credentials merely by guessing a target id. An exact list grants only those ids, while `['*']` explicitly grants every current and future Inventory target. Missing, disabled, or unmountable targets reject `session/new` without publishing a session.

The canonical session event stream is the live-update authority. Text and reasoning deltas are forwarded as they arrive; tool calls become `tool_call`, and results become completed or failed `tool_call_update` records. Tool-owned generic and diff presentation intents map to native ACP content. Terminal intents fall back to text because the ACP client owns any terminal surface. A throwing third-party presenter is contained and falls back to the raw tool name, input, and result.

ACP has no rollback message for a partial update. If a provider fails after sending text or a retry begins, already delivered partial text/thought remains visible while the prompt rejection or eventual retry result is authoritative. `session/load` deliberately replays only committed user and assistant messages; it does not replay live attempts, reasoning, usage, or tool traces.

## Lifecycle

Client disconnect and Cordis disposal share one memoized teardown. The bridge first rejects new sessions and prompts, settles pending prompts, then drains continuable descendants only below this connection's exact owned Agents before disposing those handles in parallel and awaiting every result before reporting any failure. Other frontends sharing the Context retain their continuable forests and admission. An ACP-only plugin reload therefore leaves no orphan agent.

ACP requires each prompt response to carry a `stopReason`, but the bridge does not claim a prompt-specific turn outcome. Live updates stream across the owned activity, and steering or injected work may contribute before idle. Token-limit turn endings therefore do not become prompt-level ACP stop reasons (they settle as `end_turn`); a model error on the correlated turn rejects the prompt immediately.

## Running

`pnpm --dir /path/to/deepseek-harness run demo:acp` boots the repository's automation server composition. A parent harness can spawn it through [`@deepseek-ai/dsh-subagent-acp`](../../subagent/subagent-acp/README.md); other ACP clients need only the core methods above.

## Model Experience

### Prompt text

#### What the model sees

`session/prompt` text blocks are concatenated verbatim into one user message; a baseline resource link appears in that message as a bracketed `[resource_link name=… uri=…]` reference the model may open with its own tools. Protocol metadata, client capabilities, permission choices, and session ids never enter the model request.

#### Token effect

Prompt tokens are data-dependent and remain in that session's history until compaction. Concurrent ACP sessions retain independent contexts.

#### KV Cache effect

Append-only; the new user message follows the reusable request prefix and does not invalidate prior cache entries.

### Permission decisions

#### What the model sees

Nothing directly. The owning tool records its allowed, rejected, cancelled, or unavailable outcome through the normal tool-result path.

#### Token effect

Only the owning tool result contributes tokens.

#### KV Cache effect

Append-only through the owning tool result.

## Known Limitations and Deferred Work

- **Baseline prompts and one workspace only** — images, audio, embedded resources, non-empty additional directories, and MCP servers reject; resource links flatten to textual references rather than fetched content.
- **Partial live history is not durable replay** — load replays committed user/assistant messages only; failed-attempt partials, reasoning, tools, and usage are live observations rather than reconstructed history.
- **No plans, titles, modes, configuration, or commands** — these richer ACP surfaces remain deferred.
- **Connection-owned live handles** — `session/close` releases one handle, while connection teardown releases every handle still owned by that connection.
- **Deployment allowlist, not user RBAC** — ACP has no authenticated actor, so target authorization is process configuration rather than per-user or per-project grants.
