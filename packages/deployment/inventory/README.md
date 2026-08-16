# `@deepseek-ai/dsh-deployment-inventory`

English | [中文](README.zh.md)

Persistent non-secret registry for local, pinned-SSH, and rootless-container deployment targets. It stores target identity, environment, transport configuration, logical credential reference, project workspace, labels, enabled state, and optimistic revision; it never stores a private key or password.

## Authorization and mutation

All methods require the current trusted `ctx.accessControl` actor. Global roles are a permission ceiling; non-admin users additionally need an explicit per-target grant at the requested `read`, `operate`, `configure`, or `administer` level. Administrators retain recovery access to every target. Listing filters unauthorized targets and plans, while each read, health, worktree, routing, configuration, approval, execution, and deletion operation rechecks the exact target inside the service. Grant replacements and removals use optimistic revisions and append product-domain events to the shared security audit. Updates and deletes also require the observed revision, so two administrators cannot silently overwrite each other.

SSH targets require a host, username, exact OpenSSH public host key, and absolute POSIX workspace. `identityCredential` is a validated `CredentialRef`, such as `SIVITACODE_SSH_PROD_KEY`; the credential value is a private key, resolved only for an operation and never exposed as target state. Local targets reject SSH fields.

`checkHealth()` requires `operate`. A local check verifies the workspace is reachable. An SSH check resolves its optional identity credential, writes it to a mode-0600 temporary file, establishes a fresh exact-host-key-pinned OpenSSH connection, and asks remote Python whether the workspace is a directory. Cleanup removes the temporary key and connection state. The result and audit contain status, duration, and a redacted diagnostic only.

Deployment plans persist the target revision and literal argv before execution. Development and staging plans become ready immediately. Production plans require an `admin` other than the creator to approve them. Approval and execution reservation serialize at the service, so one observed revision can settle only once; targets with unsettled plans cannot be deleted. Execution rejects changed or disabled targets, transitions durably through `running`, scrubs credential-shaped environment entries for local commands, invokes SSH argv without business shell interpolation, retains only the final valid-UTF-8 64 KiB of combined output, and settles once as `succeeded` or `failed`.

Rolling deployments persist an ordered set of 2–64 targets, each observed target revision, literal argv, timeout, and a batch size up to 16. Optional literal argv phases implement `drain → deploy → verify → rollback on failure → restore`; configuring drain requires restore. A rollout containing any production target uses the same different-administrator approval rule. Execution is atomically reserved once, rechecks every target revision, then health-checks and runs one bounded batch at a time. Each phase retains its own bounded result. Failure stops later batches. Failed traffic restoration or a restart after successful drain produces `recovery-required`; an authorized operator can retry only the persisted restore argv, without rerunning deployment.

When the execution-world router is mounted, an enabled target can own a session. The session stores the target id durably; Agent construction creates independent `fs`, `subprocess`, and `ssh` service realms before publication, plus a target-side `shell` realm for SSH and OCI. It then mounts local providers or one pinned SSH/OCI owner with its filesystem, process, and Bash adapters. The shared filesystem, search, and Bash tools select these Agent-scoped providers at execution; agent-scoped terminal, LSP, and MCP stdio plugins inherit them when mounted after routing. Browser users start this path with **Open session** on a target.

The Web Inventory page lists and creates Git worktrees in a selected target and opens a session directly in a worktree. These operations mount the same local, pinned-SSH, or rootless-container execution world as the session. Linked checkouts stay below `<workspace>/.sivitacode/worktrees`; removal is limited to that directory and never forces a dirty or locked worktree.

## Model Experience

None, as Inventory is an administrative control-plane service and is not mounted as a model tool.

#### KV Cache effect

None; target records do not enter model requests.

## Known Limitations and Deferred Work

- Local targets execute as the SivitaCode service account and provide no OS boundary between projects. They are for a trusted single-user control host. Multi-user or mutually untrusted projects require a rootless-container target or an SSH target whose remote account is isolated; SivitaCode never presents path checks or Cordis service realms as a substitute for an OS security boundary.
- Scheduled rollout triggering remains a separate consumer; operators start durable rollouts explicitly.
- Host-key rotation is an ordinary revision-guarded update; a dedicated two-key transition workflow is deferred.
- Grants apply to users rather than external groups; OIDC or directory-group mapping requires a separate identity provider.
