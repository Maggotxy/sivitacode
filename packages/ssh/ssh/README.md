# `@deepseek-ai/dsh-ssh`

English | [中文](README.zh.md)

Shared OpenSSH ControlMaster owner for one pinned remote host. Filesystem and subprocess providers inject this service and reuse its authenticated connection plus opaque execution-world identity.

## Configuration

`host`, `username`, and an exact `pinnedHostKey` are required. The host key is an OpenSSH public-key record such as `ssh-ed25519 AAAA…`; SivitaCode writes it to a private, connection-local `known_hosts` file and always uses `StrictHostKeyChecking=yes`. `identityFile` selects a readable private key; omission uses the launching operator's SSH agent. Password and keyboard-interactive authentication are disabled.

`port` defaults to 22, `connectTimeoutMs` to 15000, and `keepAliveSeconds` to 15. The provider requires the host's `ssh` executable and targets POSIX OpenSSH servers.

## Lifecycle

Activation starts one foreground ControlMaster in a mode-0700 temporary directory and resolves only after `ssh -O check` succeeds. Each channel reuses its socket. Disposal sends `ssh -O exit`, terminates a surviving master, and removes its socket and pinned-host file.

## Model Experience

None, as this host transport registers no tools or prompt text.

#### KV Cache effect

None; this package contributes no model request content.

## Known Limitations and Deferred Work

- This transport accepts SSH-agent or identity-file authentication. Deployment Inventory resolves credential-reference private keys into owner-only temporary identity files for health and deployment operations; direct profile composition still accepts a path.
- ProxyJump, SSH certificates, bastions, Windows clients, and per-host algorithm policy are not configured yet.
- This owner alone moves no workload; paired filesystem and subprocess providers establish the execution world.
