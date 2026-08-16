# Agent Note: Health-gated rolling deployments

Status: implemented

English | [中文](2026-08-14-health-gated-rollouts.zh.md)

## Problem

Calling several independent deployment plans from the browser cannot provide one durable multi-node decision. A control-plane restart, concurrent execute request, target edit, or early node failure could otherwise leave later nodes running without an authoritative rollout record.

## Decision

Inventory owns a rollout record separate from one-target plans. Creation fixes an ordered set of 2–64 unique targets, each observed revision and environment, one literal argv, timeout, and a batch size from one to sixteen. The actor needs `operate` on every target. Any production member makes the complete rollout pending approval by a different administrator with `administer` on every member.

Execution uses the same serialized mutation owner as plan approval and reservation. It atomically moves one observed ready revision to running, rejects any changed or disabled member, then processes bounded batches in stored order. Every target receives a point-in-time health check immediately before execution. Batch members may run concurrently; the next batch starts only if every member succeeded. A health or command failure settles that member as failed and every unstarted member as skipped. Per-target output uses the existing valid-UTF-8 64 KiB bound.

Each rollout may persist drain, post-deploy verification, rollback, and traffic-restoration argv in addition to deploy argv. Drain requires restore. Inventory executes the lifecycle in order, attempts rollback after deployment or verification failure, and attempts restore whenever drain succeeded. Every phase has an independently bounded durable result. Failed restore or restart after drain produces `recovery-required`; recovery retries only restore and never guesses by rerunning deploy.

The Web client builds this order as an explicit queue with add, move, and remove controls. It sends the visible queue directly to Inventory, so browser option sorting cannot change rollout order.

A service restart settles running members as failed and pending members as skipped. An unsettled rollout prevents deletion of any member. List visibility requires read access to the complete member set, so a partial grant cannot reveal the remaining topology.

## Alternatives considered

**Create several ordinary plans in the Web client.** Rejected because browser state is not an execution transaction and cannot own restart recovery or exactly-once reservation.

**Continue after a failed batch.** Rejected as the initial policy because later nodes would receive a release whose earlier health signal is already negative. A future strategy may add an explicit failure budget rather than weakening this default.

**Run every target concurrently.** Rejected because it removes the operational value of a rollout and can take down every replica at once.

## Consequences

SivitaCode can perform explicit, approval-aware, bounded rolling deployment across local, pinned-SSH, and rootless-container targets. The mechanism is fail-stop rather than self-rolling-back: deployment argv owns application-specific rollback, while the durable record identifies the exact succeeded, failed, and skipped members. Scheduled triggering and load-balancer drain hooks remain separate consumers.
