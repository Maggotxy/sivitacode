# Agent Note: Per-target RBAC

Status: implemented

English | [中文](2026-08-14-per-target-rbac.zh.md)

## Problem

A multi-node control plane cannot treat a global `developer` or `operator` role as authority over every registered server. Hiding unauthorized rows in Web is insufficient because direct Remote calls, session creation, worktree operations, and deployment execution can still name a target id.

## Decision

Global roles remain the maximum permission a user can exercise. Every non-admin user additionally needs a durable grant for the exact target, with a ceiling of `read`, `operate`, `configure`, or `administer`. Administrators retain access to every target for recovery and grant management.

Inventory filters target and plan lists by the current actor, then rechecks grants inside every target-specific service operation. Reads, health checks, worktrees, execution-world routing, target changes, plan creation, approval, execution, and deletion cannot rely on list filtering. Grant changes use observed revisions, validate that the target and user exist, and append security audit records. Creating a target gives its creator an explicit administrator grant even though global administrators do not depend on it.

The Web deployment page mounts the generated grant Remote operations. An administrator selects a target, user, and permission ceiling, then can revise or revoke the grant without database access.

## Alternatives considered

**Encode access in target labels.** Rejected because labels are user-controlled metadata without revisioned subject identity or an authorization operation.

**Use global roles alone.** Rejected because an operator for one project would gain credentials and execution access to every SSH or container target.

**Authorize only when listing targets.** Rejected because opaque ids can be retained or guessed, and every operation must enforce the decision it makes.

## Consequences

One SivitaCode Web process can administer several projects and servers without giving every authenticated developer access to all of them. Grants bind local users; external directory groups and OIDC claims require a separate identity provider. ACP stdio continues to use its process allowlist because it carries no authenticated SivitaCode actor.

## Verification

Inventory tests cover filtered lists, direct-read denial, operation denial, route denial, permission upgrades, grant listing, and revocation. Generated Remote types and Web client tests cover the assembled control surface. Full type, build, documentation, lint, hygiene, and built-product tests cover publication and composition.
