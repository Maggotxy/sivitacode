# deployment/ — 目标控制平面

[English](README.md) | 中文

持久非秘密部署状态、连通性、审批与执行编排。

| 包 | 上下文键 | 角色 |
|---|---|---|
| [`inventory`](inventory/README.md) | `ctx.deploymentInventory` | 带 revision、审计与连通性检查的已授权本地／SSH 目标注册表 |

## 已知限制与延期工作

容器隔离和多节点调度属于该系列的独立包。
