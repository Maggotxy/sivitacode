# @deepseek-ai/dsh-acp

[English](README.md) | 中文

通过 JSON-RPC stdio 提供的仅面向自动化的 [ACP（Agent Client Protocol）](https://agentclientprotocol.com) 服务器。程序化客户端可以创建、列出、关闭、恢复、加载和 fork 持久化 harness agent（智能体），发送文本提示词，实时观察文本、推理、工具生命周期和上下文用量，按策略响应一次性权限请求并取消工作。仓库中的主要客户端是 [`dsh-subagent-acp`](../../subagent/subagent-acp/README.md)。

此包是传输适配器，而非 UI 集成或能力 seam。它不公开编辑器导航、完整 transcript（文本记录）回放、命令、模式、配置选择器、信息征集、计划或标题。它会把提供方无关的推理和工具展示意图投影成 ACP update；交互式渲染与向用户提问仍由客户端或 Web 宿主负责。

## 插件

`apply(ctx, config)` 在 stdin/stdout 上打开 `AgentSideConnection` 并驱动 `ctx.agents`。Stdout 专用于协议帧。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `provider` | 无 | 每个已创建 agent 的初始提供方路由。 |
| `model` | 无 | 每个已创建 agent 的初始模型。 |
| `executionTargets` | 无 | ACP 客户端可选择的精确持久目标 id；`['*']` 表示显式信任 stdio 客户端选择任意已注册目标。 |

两个字段都是可选的，以便由另一个 agent/request 监听器提供目标。可运行的 ACP 组合同时要求两者。

## 协议约定

| 方法 | 行为 |
|---|---|
| `initialize` | 协商受支持的版本，并仅公布基线提示词。配置 `executionTargets` 时，通过 `agentCapabilities._meta['sivitacode.dev'].executionTarget` 公布目标选择；不公布编辑器、终端、文件系统或 MCP 客户端能力。 |
| `authenticate` | 空操作，因为服务器不公布身份验证方法。 |
| `session/new` | 以绝对路径作为主 `cwd` 创建新 agent；接受空的 `additionalDirectories` 和 `mcpServers`，拒绝非空值。可选的 `_meta['sivitacode.dev'].executionTarget` 必须指向 allowlist 中的目标；服务器在发布前完成挂载，将其持久化到会话 header，并在响应 `_meta` 中回显选择。 |
| `session/list` | 列出带绝对 `cwd` 的持久及实时会话，支持精确 `cwd` 筛选和标题元数据，并只返回本 ACP 部署允许的执行目标。返回稳定的 50 条 keyset 分页；cursor 与其 cwd 筛选绑定，并从 `(createdAt,id)` 之后继续，因此插入更新会话或删除锚点都不会导致重复记录。 |
| `session/delete` | 先取消、结算、flush、drain 后代并释放连接拥有的实时 handle，再永久删除其持久日志。由其他界面拥有的实时会话及未知 id 会拒绝。只有挂载的持久化后端支持删除时才公布该能力。 |
| `session/resume` | 恢复不活跃的持久会话但不回放历史；请求 `cwd` 必须与持久 header 一致，目标也必须仍在 allowlist 中。 |
| `session/load` | 以相同检查恢复会话，并在返回前按日志顺序回放已提交的 user 和 assistant 消息。 |
| `session/fork` | 从经过验证且轮次闭合的完整日志创建独立会话，并记录持久的父会话、seed、workspace、preset 和执行目标元数据。 |
| `session/close` | 取消并结算待处理工作，等待空闲，执行持久化 flush，drain 可继续后代，并且只释放指定的实时会话。 |
| `session/prompt` | 拼接文本块，将基线资源链接渲染为带方括号的文本引用，拒绝空输入或超出基线的输入，每个会话只允许一个正在处理的请求，并等待整个 agent 进入空闲状态。正常完全停稳时报告 `end_turn`；显式 ACP 取消、资源释放，或准入被丢弃的提示词（无轮次槽位）时报告 `cancelled`。 |
| `session/cancel` | 仅取消指定的 agent，并将其待处理提示词结算为 `cancelled`；未知 id 为空操作。 |
| `session/update` | 将持久的 `assistant/chunk`、`tool/call` 与 `tool/result` 事件投影为实时文本、thought 和工具生命周期 update。只有 `block-end` 的提供方仍会产生一次完整文本／thought update；已经通过 delta 发送的 block 不会重复。只有模型公布了 context window 才发送用量。 |
| `session/request_permission` | 为携带工具调用 id、由桥接层拥有的批准请求提供一次性允许／拒绝选项。客户端可以自动回答。 |

一个连接可以拥有多个会话。桥接层以带品牌的会话 id 作为记录键，并在路由事件或权限请求前检查 agent 是否为同一对象。每个会话都有独立的提示词槽位、工作区、取消路径和资源释放器。

ACP stdio 是无认证的可信自动化通道。因此，部署未提供 `executionTargets` 时目标选择保持关闭，防止任意本地 ACP 客户端仅通过猜测目标 id 使用 Inventory 保存的 SSH 凭据。精确列表只授权列出的 id，而 `['*']` 显式授权所有当前及未来 Inventory 目标。目标不存在、被禁用或无法挂载时，`session/new` 会拒绝且不会发布会话。

规范会话事件流是实时 update 的权威来源。文本与推理 delta 到达即转发；工具调用成为 `tool_call`，结果成为 completed 或 failed 的 `tool_call_update`。工具拥有的 generic 与 diff 展示意图会映射为原生 ACP 内容。由于终端界面由 ACP 客户端拥有，terminal 意图会降级为文本。第三方 presenter 抛错会被隔离，并回退到原始工具名、输入与结果。

ACP 没有回滚 partial update 的消息。如果提供方在发送文本后失败或进入重试，已经送达的部分文本／thought 会继续可见，而提示词拒绝或最终重试结果才是权威结论。`session/load` 有意只回放已提交的 user 和 assistant 消息，不回放实时尝试、推理、用量或工具 trace。

## 生命周期

客户端断开与 Cordis 释放共用同一个记忆化清理流程。桥接层先拒绝新会话和提示词，结算待处理提示词，然后只 drain 此连接确切拥有的 Agent 之下的可继续后代，再并行释放这些 handle，并等待全部结果结算后才报告失败。其他共享该上下文的前端会保留其可继续森林和准入。因此，仅 ACP 的插件重载不会遗留 agent。

ACP 要求每个提示词响应都携带 `stopReason`，但桥接层不声称它表示提示词专属的轮次结果。实时 update 会在整个自有活动期间流式输出，agent 进入空闲状态前发生的 steering（中途引导）或注入工作也可能参与其中。因此，因 token 上限而结束的轮次不会成为提示词级 ACP 停止原因（它们以 `end_turn` 结算）；关联轮次上的模型错误会立即拒绝该提示词。

## 运行

`pnpm --dir /path/to/deepseek-harness run demo:acp` 启动仓库的自动化服务器组合。父 harness 可以通过 [`@deepseek-ai/dsh-subagent-acp`](../../subagent/subagent-acp/README.md) spawn 它；其他 ACP 客户端只需上述核心方法。

## 模型体验

### 提示词文本

#### 模型看到的内容

`session/prompt` 文本块会原样拼接为一条用户消息；基线资源链接会在该消息中表示为带方括号的 `[resource_link name=… uri=…]` 引用，模型可以使用自身工具打开它。协议元数据、客户端能力、权限选择和会话 id 绝不进入模型请求。

#### Token 影响

提示词 token 取决于数据，并保留在该会话的历史中直到上下文压缩（context compaction）。并发 ACP 会话保留独立上下文。

#### KV Cache 影响

仅追加；新用户消息位于可复用请求前缀之后，不会使先前缓存条目失效。

### 权限决策

#### 模型看到的内容

不会直接看到任何内容。所属工具通过常规工具结果路径记录其结果：允许、拒绝、取消或不可用。

#### Token 影响

只有所属工具的结果会贡献 token。

#### KV Cache 影响

仅通过所属工具的结果追加。

## 已知限制与暂缓事项

- **仅基线提示词和一个 workspace**：图像、音频、嵌入资源、非空附加目录和 MCP 服务器都会被拒绝；资源链接只会展平为文本引用，不会获取其内容。
- **部分实时历史不属于持久回放**：load 只回放已提交的 user／assistant 消息；失败尝试的 partial、推理、工具与用量是实时观测，不会重建为历史。
- **没有计划、标题、模式、配置或命令**：这些更丰富的 ACP 界面仍属延期工作。
- **由连接拥有实时 handle**：`session/close` 释放一个 handle，连接清理则释放该连接仍拥有的所有 handle。
- **部署 allowlist，而非用户 RBAC**：ACP 没有经过认证的 actor，因此目标授权来自进程配置，不是逐用户或逐项目 grant。
