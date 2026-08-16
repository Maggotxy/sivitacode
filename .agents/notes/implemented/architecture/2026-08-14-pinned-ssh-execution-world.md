# Agent Note: Pinned SSH execution world

Status: implemented

English | [中文](2026-08-14-pinned-ssh-execution-world.zh.md)

## Problem

SivitaCode needs to operate a project on another server without installing its complete Web control plane on every target. Treating remote files as SSH operations while launching commands locally splits one agent turn across different machines. Wrapping commands in `ssh host "..."` also loses argv integrity, process-tree ownership, terminal foreground signalling, and proof that teardown reached quiescence.

## Decision

One `@deepseek-ai/dsh-ssh` service owns a foreground OpenSSH ControlMaster, exact pinned host key, private `known_hosts`, and opaque execution-world identity. `fs-ssh` and `subprocess-ssh` inject that same owner and expose its identity through the provider-neutral filesystem and subprocess services. The existing coherence guard rejects mixed worlds.

The deployment Inventory stores only a validated credential reference. A target health operation resolves the private key per operation, writes a mode-0600 temporary identity, uses a fresh pinned connection to inspect the remote workspace, redacts failure detail, and removes the identity and connection files before returning.

The owner uses the platform OpenSSH implementation rather than embedding another SSH cryptographic stack. Authentication is non-interactive, password and keyboard-interactive methods are disabled, `StrictHostKeyChecking=yes` is mandatory, and every business argv is POSIX-quoted as a sequence of arguments. Live channels multiplex through the authenticated master and are joined during disposal.

File mutation runs one fixed remote Python control program. It obtains a per-path lock and performs version comparison, temporary write, file fsync, atomic replace, and parent-directory fsync on the target host. This keeps observation and mutation inside one remote transaction.

Ordinary processes run under a fixed Python owner that creates a new POSIX session and gives the complete tree an unguessable inherited identity. Independent control channels find that identity through the target's POSIX `ps` process/environment view, signal every associated process group, and report tree quiescence only after the identity set is empty. This protocol is exercised with Linux procps and macOS BSD `ps`. Exit completion separately requires the durable outcome, so transport loss cannot become a successful process result. A leader PID alone is never sufficient because it can exit and be reused.

Terminals use OpenSSH PTY allocation. A fixed bootstrap publishes readiness before exec. Separate control channels read the TTY foreground group from portable `ps` facts, signal that group, and terminate all identity-bearing groups during cleanup.

State directories without a retained output spill are removed after quiescence. Complete spills intentionally remain readable after handle completion. Each provider startup runs a bounded collector that accepts only exact SivitaCode UUID names below `/tmp`, requires the directory owner to match the SSH account, skips tokens present in any live process, and removes residue only after 24 hours.

## Alternatives considered

**Install one complete SivitaCode instance on every server.** This remains a valid deployment mode for administrative separation, but it does not replace central operation of several targets and duplicates control-plane state.

**Prefix existing local commands with `ssh`.** This was rejected because shell interpolation becomes the wire format, killing the local ssh process does not prove remote descendants stopped, and local filesystem paths no longer describe the command's execution world.

**Use a JavaScript SSH library.** This was rejected for the initial provider because system OpenSSH already supplies host-key policy, agent and hardware integration, multiplexing, and mature algorithm maintenance. A library may be reconsidered only when a required transport capability cannot be expressed safely through OpenSSH.

**Identify trees only by PID, process group, or session id.** This was rejected because identifiers are reused and daemonizing descendants can leave the original group or session. The inherited random identity establishes ownership independently of numeric reuse.

**Base the product runtime on the Mux desktop architecture.** This was rejected for the server-first product because Electron is not a stronger execution substrate for headless Linux hosts. Mux remains UX and capability prior art; its AGPL source is not copied into the MIT line.

## Consequences

One Web/CLI control plane can operate a pinned Linux or macOS target while all filesystem, subprocess, shell, job, LSP, MCP-through-subprocess, and terminal consumers share one machine. A macOS or Linux computer can host the control plane because the SSH transport is OpenSSH-based.

Remote process ownership requires Python 3 and a POSIX `ps` that exposes the SSH account's own process environments. Linux procps and macOS BSD `ps` are supported; other dialects remain unclaimed. Complete spill files remain for downstream reads but are bounded by caller byte caps and the owner/token-checked 24-hour collector. Container confinement and multi-node inventory are separate layers; SSH transport alone does not claim either property.

The tests execute the fixed filesystem, process, and terminal programs against real local POSIX processes and a real PTY, including version races, binary replacement metadata, bounded output, batch stdin, TERM-to-KILL escalation, descendant cleanup, terminal input, foreground signalling, and session termination. A real ephemeral `sshd` fixture generates independent host and user keys, verifies concurrent ControlMaster channels, and proves a different pinned host key is rejected.

The Inventory composition test drives an ephemeral `sshd` through target creation, pinned health, routed filesystem reads, managed subprocess execution, and settled deployment plans. It also kills a live deployment transport, proves the reserved plan settles as failed and cannot execute again, then deploys a new plan through a fresh pinned connection. Temporary health connections dispose only their isolated SSH plugin fiber, so they cannot tear down access control or other parent control-plane services.
