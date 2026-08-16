# `@deepseek-ai/dsh-execution-world`

English | [中文](README.zh.md)

Defines opaque runtime identities used to prove that filesystem and process providers address the same machine, container, VM, or remote sandbox. Equality is object identity; the label exists only for diagnostics. `LOCAL_EXECUTION_WORLD` is the shared identity of host-local providers. A remote owner exposes its own stable object to every adapter backed by that exact remote instance.

`ExecutionWorldRouter` resolves a durable session target before Agent construction. A route supplies the context carrying isolated capability realms plus a pre-publication setup that mounts their common owner and adapters. A stored target fails loud when no provider can resolve it.

## Known Limitations and Deferred Work

- **Identity is process-local** — distributed control planes compare registered environment ids before constructing adapters; these object identities do not cross a wire.
