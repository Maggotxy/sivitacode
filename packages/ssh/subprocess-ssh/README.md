# `@deepseek-ai/dsh-subprocess-ssh`

English | [中文](README.zh.md)

Subprocess provider for one Linux or macOS host reached through `ctx.ssh`. It shares the SSH owner's execution-world identity with `fs-ssh`, starts argv without caller-controlled shell syntax, and owns ordinary process trees and OpenSSH-allocated terminals through quiescence.

## Process ownership

Each ordinary spawn creates a mode-0700 remote state directory and a random process identity inherited by descendants. A fixed Python runner starts the target with `setsid()`, records its identity and outcome, transports stdio, and optionally retains a complete remote spill. Independent control channels use the host's POSIX `ps` process/environment view to find that identity before signalling its process groups on both Linux and macOS; this prevents a reused leader PID from redirecting termination. `terminate()` sends TERM, waits `graceMs`, and sends KILL when needed. `waitForExit()` reports tree quiescence once no identity-bearing process remains; the separate `done` promise still rejects when transport loss prevents a durable outcome, so callers never mistake missing exit facts for successful completion.

Collected output keeps a bounded host-side tail. When configured and still within its byte cap, `spillPath` names the complete file inside the same remote execution world; consumers read it through `ctx.fs`. State without a retained spill is removed as soon as quiescence is proven. A startup maintenance pass removes only owner-matched, exact SivitaCode UUID directories older than 24 hours whose token is absent from every live process, bounding retained spill and crash residue without touching broad temporary paths.

## Terminals

`spawnTerminal()` requests a real OpenSSH PTY. Its fixed bootstrap applies dimensions, scrubs ambient credential-shaped environment names, publishes readiness, and execs the configured argv. Control channels inspect the kernel TTY foreground group, deliver supported signals to that group, and terminate every identity-bearing process group before disposal settles.

## Configuration

`pollMs` is the remote liveness polling cadence and defaults to 50 milliseconds. Optional `cwd` and `localAnchor` apply the same logical-workspace mapping as `fs-ssh`. Every SSH command requires remote `python3` plus a POSIX `ps` able to expose the target account's own process environments.

## Model Experience

Indirectly, through existing shell, job, LSP, MCP, and terminal consumers whose execution location this provider changes.

#### KV Cache effect

None beyond those consumers; the provider adds no tool schema or prompt text.

## Known Limitations and Deferred Work

- The process/environment inspector supports Linux procps and macOS BSD `ps`; other POSIX dialects are not claimed until their exact invocation runs in CI.
- Complete remote spills intentionally survive handle completion so downstream tools can read them; the exact-prefix, owner/token-checked 24-hour maintenance pass is their lifecycle bound.
- `inherit` output is projected through the local SivitaCode host stream rather than inheriting a remote descriptor.
- PTY resize is absent from the subprocess service definition and therefore unavailable through this provider.
- The real pinned-host `sshd` integration runs on Linux hosts that provide OpenSSH server binaries; other platforms rely on the fixed-runner protocol tests and CI matrix.
