# Agent Note: ACP 持久会话生命周期

Status: implemented

[English](2026-08-14-acp-persistent-session-lifecycle.md) | 中文

## Problem

自动化客户端可以创建并驱动会话，却无法在释放实时进程 handle 后继续会话。即使 harness 已拥有经过验证的持久会话语料库，ACP 仍不适合长期服务器工作、跨设备续接或独立分支。

## Decision

ACP 桥接层只使用 `ctx.sessionQuery` 和 `ctx.agents.resume()` 作为持久生命周期权威。存在 query 服务时，它公布 `session/list`、`session/resume`、`session/load` 和不稳定的 `session/fork`；每个由桥接层拥有的实时 handle 都可使用 `session/close`。Load 在响应前回放已提交的 user 和 assistant 消息，resume 不回放，fork 则从经过验证的完整日志为新 agent 提供 seed，并保留血缘与执行世界元数据。

已存储的执行目标必须通过与新会话相同的部署 allowlist。客户端不能把持久会话恢复或 fork 到其 stdio 部署无权选择的 Inventory 目标。Close 在释放 handle 前等待 agent 完全停稳和会话 flush，因此成功关闭后可以立即恢复和列出。

连接 EOF 与插件 disposal 共用同一个 quiescence 操作。该操作完成后，即使 teardown 失败已被记录，桥接层也会发出 `acp/closed`；ACP 应用组合包消费此通知并请求有界的整个 profile 关闭。因此，进程生命周期跟随协议流关闭，而不是依赖可能与桥接层实际读取生命周期产生偏差的第二个原始 stdin listener。

协议删除保持不可用，因为只追加持久化服务没有删除操作。列表有意返回完整结果且不分页；提供 cursor 时明确拒绝，而不是伪装成稳定的快照 cursor。

## Alternatives considered

**让 ACP 会话继续只存活于进程生命周期。** 这能保持桥接层较小，却无法满足跨连接继续服务器工作的产品要求，而且重复了持久语料库已经解决的限制。

**增加 ACP 自有会话文件。** 第二套存储会与 Web 分歧，破坏执行目标和血缘不变量，并产生恢复竞态。共享会话查询、持久化和 agent factory 保持权威。

**直接删除持久化制品。** 按后端删除文件或 SQL 行会绕过持久化服务及其生命周期串行化。在所属服务定义安全操作前，SivitaCode 不公布 `session/delete`。

## Consequences

ACP 客户端无需保持一条 stdio 连接，就能关闭并稍后继续会话、回放已提交的对话，或 fork 独立分支。桥接层的持久方法依赖 query 服务；缺少该服务的最小组合只公布 close 和基线会话操作。完整 transcript 展示、分页和持久删除仍是明确缺口。
