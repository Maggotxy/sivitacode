# guard/ — runtime guard family

English | [中文](README.zh.md)

Guard plugins reject invalid runtime composition, watch the agent loop for unproductive patterns, and enforce per-call budgets. A guard is a self-contained consumer of services and extension points, not a swappable capability.

| Package | Role | ctx key |
|---|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Advisory reminders for repeated tool calls | listens on tool and agent events |
| [`timeout-policy/`](timeout-policy/README.md) | Arms per-call tool deadlines as deployment policy | registers a `tools/execute` listener |
| [`execution-world-coherence/`](execution-world-coherence/README.md) | Rejects filesystem and subprocess providers from different execution worlds | injects `ctx.fs` and `ctx.subprocess` |

Reminders travel as `additionalContexts` on the `tools/post-execute` decision and are appended as logged plugin-sourced `user/message` events ([tools](../../docs/subsystems/tools.md)); the timeout split across `dsh-timeout`, capability termination, and this policy layer is recorded in the [timeout-library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md).
