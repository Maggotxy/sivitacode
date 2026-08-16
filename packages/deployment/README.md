# deployment/ — target control plane

English | [中文](README.zh.md)

Persistent non-secret deployment state, connectivity, approval, and execution orchestration.

| Package | Context key | Role |
|---|---|---|
| [`inventory`](inventory/README.md) | `ctx.deploymentInventory` | Authorized local/SSH target registry with revisions, audit, and connectivity checks |

## Known Limitations and Deferred Work

Container isolation and multi-node scheduling are separate packages in this family.
