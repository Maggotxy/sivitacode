# @deepseek-ai/dsh-access-control

English | [中文](README.zh.md)

Persistent authenticated accounts and server-side sessions over `ctx.storageDomain`. Password credentials use Argon2id; cookie secrets are random 256-bit values whose SHA-256 digests alone are stored. `ctx.accessControl` verifies credentials, attaches a trusted `AccessActor` to transport requests, propagates it with `AsyncLocalStorage`, expands built-in roles into operation permissions, and appends security audit records.

The first startup requires `bootstrapUsername` and `bootstrapPassword` when the user table is empty. The bootstrap password is hashed before persistence and is not consulted again after an account exists. Disabling a user increments its session version, invalidating every existing session without a table scan.

Roles are intentionally small: `viewer` reads, `developer` reads and operates agents, `operator` additionally changes deployment configuration, and `admin` additionally manages identities. Consumers enforce `read`, `operate`, `configure`, or `administer` at the operation entry; browser payloads never carry trusted roles. The generated `accessControl` Remote lets an administrator list and create users, replace roles, disable accounts, and read a bounded audit window. Role and disabled-state changes increment the subject's session version, and the service refuses to disable or demote the last enabled administrator. These decisions and successful identity mutations append durable audit entries.

## Model Experience

None, as access policy changes no model request, prompt, tool schema, or tool result.

#### KV Cache effect

None; authorization adds no model-visible tokens.

## Known Limitations and Deferred Work

- Built-in roles provide the global permission ceiling. Deployment Inventory narrows non-admin users with explicit per-target grants; external OIDC identity federation remains a separate future provider rather than fields added speculatively to the local account format.
