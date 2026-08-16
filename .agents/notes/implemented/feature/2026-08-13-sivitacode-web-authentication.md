# Agent Note: SivitaCode Web authentication

Status: implemented

English | [中文](2026-08-13-sivitacode-web-authentication.zh.md)

## Problem

The coding agent can execute commands and read project files as its process account. Host and Origin checks prevent DNS rebinding and cross-site browser requests but do not identify an operator, so trusting a public hostname alone must not enable network exposure.

## Decision

SivitaCode permits `0.0.0.0` only when a launch-time administrator password of at least 12 characters is configured. The password is compared through fixed-length SHA-256 digests with timing-safe equality and is never sent back to the browser or stored in browser storage.

Successful login creates a 256-bit random in-memory session. The browser receives only an HttpOnly, SameSite=Strict Cookie. HTTPS deployments use the Secure `__Host-` form; an explicit insecure local-test mode uses an unprefixed Cookie. Sessions have idle and absolute expiry, disappear on restart, and logout revokes the server record. Failed login attempts are limited per peer address.

Webserver pre-routing guards protect static content, API routes, event transports, downloads, and upgrades. Unauthenticated page requests redirect to login, API requests return 401, and upgrades receive an HTTP 401 before route dispatch.

## Alternatives considered

**HTTP Basic authentication.** Rejected because browsers retain credentials opaquely, logout is unreliable, and session expiry and future identity metadata do not compose cleanly.

**Bearer token in localStorage.** Rejected because script-readable persistent credentials increase the impact of a client-side injection and require custom WebSocket propagation.

**Trust only the reverse proxy or hostname.** Rejected because a configuration mistake would expose remote code execution without an application-level identity check.

## Consequences

One operator can safely authenticate through an HTTPS reverse proxy without exposing the password after login. Sessions are intentionally lost on restart and do not yet provide users, roles, durable revocation, or audit identity; those belong to the identity/RBAC control plane. The application still requires strict Host/Origin configuration and TLS.
