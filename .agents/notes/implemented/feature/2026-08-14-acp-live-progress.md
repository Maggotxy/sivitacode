# Agent Note: ACP live progress projection

Status: implemented

English | [中文](2026-08-14-acp-live-progress.zh.md)

## Problem

ACP prompts previously emitted only committed assistant messages. Long model calls and tool workflows therefore appeared stalled to headless clients even though the durable session log already contained provider-neutral text deltas, reasoning, tool calls, results, and usage.

## Decision

The canonical `session/event` stream is the sole authority for ACP live updates. Non-empty text and reasoning deltas become `agent_message_chunk` and `agent_thought_chunk`; providers that publish only `block-end` receive a complete-block fallback, and blocks already streamed are not duplicated. Context usage is emitted only after the selected model advertises a context window, and reasoning tokens are not counted twice when they are an output-token subclass.

Durable `tool/call` and `tool/result` events become ACP `tool_call` and `tool_call_update` lifecycle records. The bridge captures the tool's result presenter at call time, maps generic and diff presentation intent to ACP-native content, and renders terminal intent as text because terminal ownership belongs to the ACP client. Presentation callbacks are an untrusted display seam: exceptions are contained and fall back to raw input/output.

ACP provides no rollback operation for a delivered partial message. A failed or retried attempt may therefore leave live partial text visible; the prompt rejection or eventual retry result is authoritative. Resume/load replay remains restricted to committed user and assistant messages and does not reconstruct attempts, reasoning, tools, or usage.

## Alternatives considered

**Continue sending committed messages only.** Rejected because remote and nested automation cannot distinguish a healthy long-running operation from a stalled process.

**Listen directly to provider and tool-runtime services.** Rejected because it would create a second ordering and ownership authority beside the durable session stream.

**Copy the Web UI projection.** Rejected because ACP has its own content vocabulary, terminal ownership, and replay guarantees; coupling the protocol bridge to browser state would blur those boundaries.

## Consequences

Headless ACP clients now see low-latency model and tool progress without provider-specific dependencies. Notification write failures and third-party presentation failures cannot fail an Agent turn. Clients must treat live partials as observations rather than durable transcript entries, and richer plans, titles, modes, configuration, and commands remain separate deferred surfaces.
