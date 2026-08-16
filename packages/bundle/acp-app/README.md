# `@deepseek-ai/dsh-acp-app`

English | [中文](README.zh.md)

SivitaCode's headless Agent Client Protocol profile bundle. `sivitacode acp` serves newline-delimited ACP JSON-RPC on stdin/stdout and creates ordinary base-runtime agents. When the client closes stdin, the ACP bridge cancels and settles its owned Agents, emits `acp/closed`, and this bundle requests bounded whole-profile shutdown. It mounts no HTTP server, browser UI, Electron runtime, or stdout logger.

The bundle opens the same `$SIVITACODE_HOME/sivitacode.db` SQLite WAL database as `sivitacode web`. Operators create and update local, SSH, and rootless-container targets through the authenticated Web control plane; ACP reads those durable Inventory records rather than maintaining a second target format. Web and ACP may run as separate processes. Because this pre-release repository provides no storage migration compatibility, an older `$SIVITACODE_HOME/storages/*.json` inventory is not imported automatically.

During a prompt, the profile forwards live assistant text, reasoning, tool calls/results, and context usage through ACP `session/update`. Tool presentation is provider-neutral and contained: generic/diff views become ACP cards, terminal views use text fallback, and a faulty presenter cannot fail the turn. Loading a session replays only committed user/assistant messages, not prior live attempts or tool traces.

Session listing uses stable 50-record keyset pages. `session/delete` is available with the bundled first-party persistence backend and permanently removes an exact log only after any connection-owned live Agent has settled and released its resources; `session/close` remains the non-destructive release operation.

ACP stdio authenticates neither a person nor a Web session. Execution-target selection is therefore disabled unless `SIVITACODE_ACP_EXECUTION_TARGETS` contains an exact comma-separated allowlist of target ids. `*` is an explicit full-trust deployment opt-in. A client selects an allowed target through `_meta['sivitacode.dev'].executionTarget`; the target is mounted before the session is published and persisted in the session header. This allowlist authorizes the whole ACP process and is not per-user RBAC—run separate ACP processes with different allowlists when automation principals need different access.

An existing Web-initialized home needs no password. On an empty home, set `SIVITACODE_WEB_PASSWORD` (and optionally `SIVITACODE_WEB_ADMIN_USERNAME`) once so the shared access-control domain can bootstrap; omitting it fails startup rather than creating an unprotected administrator.

```sh
SIVITACODE_HOME=/srv/sivitacode \
SIVITACODE_ACP_EXECUTION_TARGETS='target-id-a,target-id-b' \
sivitacode acp
```

## Model Experience

Indirectly, through the composed base runtime whose prompts, tools, model selection, and answer formatting remain unchanged.

#### KV Cache effect

None beyond the composed base runtime; the profile contributes no prompt or schema text.

## Known Limitations and Deferred Work

- ACP's process allowlist is not per-user RBAC because standard stdio ACP carries no authenticated SivitaCode actor.
- HTTP MCP servers remain explicit network endpoints; only stdio/process-backed capabilities move with an execution target.
- An older JSON Inventory requires a manual one-time export or recreation before using the shared SQLite control-plane database.
