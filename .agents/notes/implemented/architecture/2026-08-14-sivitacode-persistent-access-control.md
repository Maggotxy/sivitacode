# Agent Note: SivitaCode persistent access control

Status: implemented

English | [中文](2026-08-14-sivitacode-persistent-access-control.zh.md)

## Problem

SivitaCode's public Web control plane uses a dedicated access-control service rather than treating a launch-time password as the identity database. The service owns durable users, Argon2id password credentials, random server-side sessions, user session versions, disabled state, built-in roles, request-local actors, and append-only audit records over the domain storage form.

## Decision

The Web authentication plugin owns HTTP concerns only: trusted reverse-proxy validation, login and logout routes, cookies, rate limits, and attaching an actor verified by the access-control service to the transport request. The browser never supplies roles. The connection carrier recovers that actor, enters an `AsyncLocalStorage` scope, and checks a server-selected operation permission before dispatching API or WebSocket work. Authorization therefore follows concurrent asynchronous work without putting mutable identity on the process-wide API service.

The PWA manifest and product favicon are public after the same request-authority validation but before session authentication. They contain install metadata only; making these exact paths public lets browsers install and brand the login-protected application without exposing the frontend bundles, APIs, or project data.

The initial environment username and password are bootstrap inputs. They create the first administrator only when the durable user table is empty; the password is immediately transformed with Argon2id and the environment value has no authority over an existing store. Disabling a user increments its session version, so every previously issued session fails authentication without scanning or deleting each record first.

The initial roles express current Host operation groups: viewer reads, developer reads and operates agent work, operator additionally changes configuration, and admin additionally manages identity. The durable format does not speculate about project grants or external identity providers. Those capabilities can provide a later policy implementation without weakening the current default-deny operation checks.

## Alternatives considered

**Keep the environment password and process-local sessions.** Rejected because restart-wide revocation, multi-user identity, password-hardening upgrades, and audit cannot be built on an ephemeral map.

**Put roles in browser RPC payloads.** Rejected because untrusted clients could claim authority and every consumer would need to repeat identity validation.

**Store a mutable actor on the process-wide API service.** Rejected because concurrent HTTP and WebSocket work would race and could execute under another request's identity.

## Consequences

Verification covers Argon2id-backed login, durable reopening, request-session resolution, permission denial at the service operation, disabled-user revocation, audit creation, Web login/logout, login rate limiting, public install metadata, trusted reverse-proxy validation, and repository type, lint, documentation, and composition gates.
