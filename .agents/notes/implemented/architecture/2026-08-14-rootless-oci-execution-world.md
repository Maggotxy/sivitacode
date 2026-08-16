# Agent Note: Rootless OCI execution world

Status: implemented

English | [中文](2026-08-14-rootless-oci-execution-world.zh.md)

## Problem

Container sessions need one execution owner for files, processes, terminals, and subprocess protocols without silently running work on the host. A runtime name alone does not prove unprivileged operation or adequate confinement.

## Decision

The OCI provider owns one persistent Docker or Podman container and implements the same literal-argv channel protocol as the SSH owner. It requires structured proof of rootless operation, disables networking by default, drops all capabilities, enables no-new-privileges, uses a read-only root filesystem with bounded tmpfs mounts, and applies PID, CPU, and memory limits. Only the selected project directory is bind-mounted read-write.

Runtime inspection, creation, and deletion have bounded diagnostics and lifecycle deadlines. A failed creation attempts an idempotent forced removal. Disposal terminates active channels, waits for quiescence, and removes the container. Runtime absence or failed rootless proof never falls back to host execution.

## Alternatives considered

**Fall back to host execution when a runtime is absent.** This was rejected because a containment request would become an unconfined host operation.

**Treat any runtime output containing “rootless” as proof.** This was rejected because unrelated diagnostic text could satisfy it; Docker and Podman use structured fields.

**Claim VM-grade isolation.** This was rejected because a read-write host bind mount and the shared kernel do not provide that security boundary.

## Consequences

The provider offers project-process isolation, not a VM security boundary. Images contain Python 3 and the project toolchain. Deployments requiring hostile-code isolation use a stronger provider such as gVisor or a microVM while retaining the execution-world interfaces.

## Verification

Hermetic lifecycle tests pin structured Docker and Podman proof, hardening arguments, failure rollback, and cleanup without requiring a local runtime. The independent rootless OCI workflow fails unless Podman proves rootless operation, resolves the test image to an immutable digest, completes direct provider operations, and creates an Agent from a persistent Inventory target whose filesystem, managed processes, PTY, health check, deployment plan, and cleanup all traverse real containers.
