# `@deepseek-ai/dsh-fs-ssh`

English | [中文](README.zh.md)

Filesystem Service Provider for the shared `ctx.ssh` execution world. Every operation invokes a fixed Python 3 control program through the pinned ControlMaster; paths and file bytes remain remote.

## Semantics

`resolve` canonicalizes with remote `realpath`; target keys are opaque SSH paths. Optional `cwd` and `localAnchor` map the logical control-plane workspace into one remote project root. Metadata, bounded bytes, strict UTF-8 text, binary rejection, stable listings, and POSIX file URLs match the filesystem Service Definition. Write and literal edit operations acquire a remote per-path `flock`, recheck version intent inside that lock, write a same-directory temporary file, `fsync`, atomically replace, and sync the parent directory.

The remote server must provide Python 3 and POSIX `flock` support. Cancellation terminates the SSH channel; mutations only observe it before atomic publication, so a client disconnect cannot imply rollback after rename.

## Model Experience

Indirectly, through existing filesystem tools that consume this provider unchanged.

#### KV Cache effect

None beyond those tools; provider selection does not change their schemas or prompt text.

## Known Limitations and Deferred Work

- Streaming currently performs one bounded channel read and yields one decoded chunk; it does not yet provide incremental remote backpressure.
- POSIX servers only. ACLs, extended attributes, sparse files, hard-link identity policy, and cross-host copy are outside the contract.
- This provider does not itself confine paths. Project/container isolation must mount an isolated SSH account or a policy-enforcing provider above it.
