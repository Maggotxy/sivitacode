# Agent Note: ACP 实时进度投影

Status: implemented

[English](2026-08-14-acp-live-progress.md) | 中文

## Problem

ACP 提示词此前只发送已提交的 assistant 消息。因此，长时间模型调用与工具工作流在无头客户端看来像是卡死，尽管持久会话日志已经包含与提供方无关的文本 delta、推理、工具调用、结果和用量。

## Decision

规范 `session/event` 流是 ACP 实时 update 的唯一权威。非空文本与推理 delta 分别成为 `agent_message_chunk` 和 `agent_thought_chunk`；只发布 `block-end` 的提供方会获得完整 block fallback，已经流式发送的 block 不会重复。只有选定模型公布 context window 后才发送上下文用量；当 reasoning token 属于 output token 子类时不会重复计数。

持久 `tool/call` 与 `tool/result` 事件成为 ACP `tool_call` 和 `tool_call_update` 生命周期记录。桥接层在调用时捕获工具的结果 presenter，把 generic 与 diff 展示意图映射为 ACP 原生内容；由于终端所有权属于 ACP 客户端，terminal 意图渲染为文本。展示 callback 是不受信的显示 seam：异常会被隔离，并回退到原始输入／输出。

ACP 不提供已送达 partial 消息的回滚操作。因此，失败或重试的尝试可能留下可见的实时部分文本；提示词拒绝或最终重试结果才是权威结论。resume／load 回放仍限于已提交的 user 与 assistant 消息，不重建尝试、推理、工具或用量。

## Alternatives considered

**继续只发送已提交消息。** 不采用，因为远程及嵌套自动化无法区分健康的长时间操作与卡死进程。

**直接监听提供方与工具运行时服务。** 不采用，因为这会在持久会话流之外创建第二套顺序与所有权权威。

**复制 Web UI 投影。** 不采用，因为 ACP 有自己的内容词汇、终端所有权与回放保证；把协议桥接耦合到浏览器状态会模糊这些边界。

## Consequences

无头 ACP 客户端现在可以低延迟观察模型与工具进度，不依赖特定提供方。通知写入失败和第三方展示失败都不能导致 Agent 轮次失败。客户端必须把实时 partial 视为观测，而非持久 transcript 条目；更丰富的计划、标题、模式、配置与命令仍是独立的延期界面。
