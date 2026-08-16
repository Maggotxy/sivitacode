# Agent Note: Web identity administration

Status: implemented

English | [中文](2026-08-14-web-identity-administration.zh.md)

## Problem

SivitaCode's access-control domain already owns durable users, roles, session revocation, and security audit. Keeping its read operations as unguarded in-process methods would make authorization depend on every future transport wrapper and would leave no product control surface for a second administrator.

## Decision

Access control is a generated Typert Remote service. Each identity and audit operation authorizes `administer` inside the service method before reading or changing durable state. Web Settings mounts that namespace and provides user creation, one-role assignment, account enable or disable, and a bounded recent-audit view.

Role and disabled-state mutations increment the subject's session version, invalidating existing sessions. The service counts enabled administrators at the mutation commit point and rejects disabling or demoting the last one. That rejection and successful mutations append durable audit entries. Password hashes, session tokens, and credential material never enter Remote results.

## Alternatives considered

**Authorize only in the Web component or API gateway.** Rejected because an ACP, plugin, or future transport could invoke the service without that wrapper.

**Allow deleting the final administrator and rely on environment bootstrap.** Rejected because bootstrap values are intentionally ignored after the user table becomes non-empty; this would create an unrecoverable deployment through an ordinary UI action.

**Expose arbitrary role arrays in the first Web form.** The service supports non-empty role sets, while the initial UI chooses one built-in role per user to keep privilege changes reviewable. Additional role-composition UI does not require a storage change.

## Consequences

The browser can administer a multi-user deployment without editing SQLite or restarting the service. Only administrators can discover users or audit records. Built-in roles remain global permission ceilings; Deployment Inventory owns the separate per-target grant policy.

## Verification

Service tests cover read denial, role-change revocation, last-administrator rejection, bounded audit reads, and durable denial records. Client tests cover generated Remote injection and Settings registration. Type generation, the Web composition tests, documentation pairing, lint, and repository hygiene cover the assembled path.
