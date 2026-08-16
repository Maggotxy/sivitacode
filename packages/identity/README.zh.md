# identity/ — 共享身份

[English](README.md) | 中文

跨产品领域共享的身份值与认证访问策略。

| 包 | 职责 | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.md) | 为遥测、反馈和 DeepSeek 请求持久化一个限定于 Harness home 的匿名关联 id | — |
| [`access-control/`](access-control/README.md) | 持久账户、会话、请求 actor、RBAC 与审计 | `ctx.accessControl` |
