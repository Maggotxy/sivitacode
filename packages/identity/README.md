# identity/ — shared identity

English | [中文](README.zh.md)

Identity values and authenticated access policy shared across product domains.

| Package | Role | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.md) | Persists one anonymous Harness-home correlation id for telemetry, feedback, and DeepSeek requests | — |
| [`access-control/`](access-control/README.md) | Persistent accounts, sessions, request actors, RBAC, and audit | `ctx.accessControl` |
