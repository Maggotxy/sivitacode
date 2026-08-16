# ssh/ — OpenSSH remote execution family

English | [中文](README.zh.md)

The SSH family places provider-neutral filesystem and process consumers on one pinned POSIX OpenSSH server. `@deepseek-ai/dsh-ssh` owns authentication, host-key verification, connection reuse, and the shared execution-world identity; filesystem and subprocess adapters consume that owner.

| Package | Context key | Role |
|---|---|---|
| [`ssh`](ssh/README.md) | `ctx.ssh` | Shared pinned-host OpenSSH ControlMaster lifecycle and command channels |
| [`fs-ssh`](fs-ssh/README.md) | `ctx.fs` | Remote canonical paths, bounded reads, and atomic version-guarded mutation |
| [`subprocess-ssh`](subprocess-ssh/README.md) | `ctx.subprocess` | Remote process-tree ownership, bounded output, and true PTY sessions |

Mount the owner and both providers together. The execution-world coherence guard rejects an SSH filesystem paired with a local subprocess provider or the inverse.

## Known Limitations and Deferred Work

Remote container isolation and multi-node selection remain deployment layers above these single-host providers.
