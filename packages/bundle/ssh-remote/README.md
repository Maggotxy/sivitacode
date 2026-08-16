# `@deepseek-ai/dsh-ssh-remote`

English | [中文](README.zh.md)

Explicit profile overlay that replaces the base filesystem and subprocess providers with the pinned SSH providers. Place it after `@deepseek-ai/dsh-base` and before a surface bundle such as `@deepseek-ai/dsh-web-app` or `@deepseek-ai/dsh-headless`.

## Configuration

The launching environment must set `SIVITACODE_SSH_HOST`, `SIVITACODE_SSH_USERNAME`, `SIVITACODE_SSH_HOST_KEY`, and the absolute remote project path `SIVITACODE_SSH_WORKSPACE`. `SIVITACODE_SSH_PORT` defaults to 22. `SIVITACODE_SSH_IDENTITY_FILE` is optional; omission uses the SSH agent. These bootstrap values are rejected in discovered `.env` files.

The control-plane current directory remains the logical workspace recorded in sessions and prompts. Both SSH providers map it to `SIVITACODE_SSH_WORKSPACE`, so an absolute path derived from the logical workspace reaches the same remote project for file and process operations.

Host-local sandbox runners cannot confine the remote kernel. This overlay therefore selects the direct bash provider and `danger-full-access`; it never advertises `workspace-write`. Use container isolation on the target before selecting a narrower policy.

## Model Experience

Indirectly, through existing coding tools that operate in the remote project and report the logical control-plane workspace.

#### KV Cache effect

None beyond those tools; the overlay contributes no prompt or schema text.

## Known Limitations and Deferred Work

- This is one deployment target per profile. Inventory-driven per-session node selection is a later orchestration layer.
- The target is not container-confined by this overlay.
- The overlay does not install keys or discover a host key; operators pin an independently verified exact key.
