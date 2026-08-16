# `@deepseek-ai/dsh-oci`

English | [中文](README.zh.md)

Owns one persistent rootless Docker or Podman container. It verifies rootless runtime status before creation, drops every Linux capability, enables no-new-privileges, bounds pids, disables networking by default, bind-mounts only the configured project, and removes the container at quiescent disposal. Missing runtimes and failed rootless proof fail loud; execution never falls back to the host.

The owner implements the remote-command protocol consumed by the existing Python filesystem and managed subprocess adapters, so FS, commands, PTY, LSP, jobs, and MCP stdio share its exact execution-world identity.

## Model Experience

None, as provider adapters and consumers own every model-visible effect.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- The image must contain Python 3 and the project toolchain.
- Bind mounts intentionally expose the selected host project read-write; VM-grade isolation requires a Firecracker or gVisor provider.
