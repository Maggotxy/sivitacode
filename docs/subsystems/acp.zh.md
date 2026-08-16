# Agent Client Protocol

[English](acp.md) | 中文

[ACP bridge](../../packages/acp/acp) 通过逐行 JSON-RPC 向受信程序化客户端开放 SivitaCode Agent（智能体）。它拥有一条连接上创建的实时 handle，而持久 list、resume、load、fork 与 close 操作使用共享会话语料库。该桥接层把规范会话流投影为实时文本、推理、工具生命周期和上下文用量 update；浏览器展示与逐用户 Web 授权仍属于独立产品界面。

原始 `assistant/chunk`、`tool/call` 与 `tool/result` 事件是投影权威。只有 block-end 的提供方会获得完整 block fallback，已经流式发送的 block 不会重复。工具展示 callback 经过隔离，generic／diff 意图原生映射，terminal 则降级为文本。由于 ACP 没有 partial 消息回滚，失败或重试的尝试可能留下已经送达的实时文本；load／replay 仍有意只包含已提交的 user 与 assistant 消息。

连接输入关闭后，bridge 会先取消并收稳自己拥有的所有 Agent，再发出 `acp/closed`。[ACP 应用组合包](../../packages/bundle/acp-app)消费该事件并请求有界的整个 profile 关闭，因此进程不会抢在会话 teardown 之前退出。

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
