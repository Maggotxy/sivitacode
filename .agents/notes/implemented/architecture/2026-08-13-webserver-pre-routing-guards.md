# Agent Note: Webserver pre-routing guards

Status: implemented

English | [中文](2026-08-13-webserver-pre-routing-guards.zh.md)

## Problem

Production authentication and request policy must cover the browser shell, RPC, downloads, event streams, and protocol upgrades consistently. Wrapping individual routes leaves unmatched and later-added routes outside policy, while embedding product authentication into the generic Web server would couple the carrier to one deployment model.

## Decision

The `webServer` service exposes separate HTTP and upgrade guard registries. Guards run in registration order before any route lookup. A guard returns true to continue or false only after completing the rejection response or closing the socket. Its disposer removes the registration. A thrown or rejected guard enters the server's existing request-error containment and never continues dispatch.

HTTP guards precede exact, prefix, and fallback handling. Upgrade guards precede upgrade-route lookup and handler ownership. Route matching and fallback semantics remain unchanged after the guards permit a request.

## Alternatives considered

**Wrap only `/api`.** Rejected because it leaves the browser shell and future non-API endpoints accessible and requires separate WebSocket policy.

**Put authentication configuration in `WebServer`.** Rejected because the carrier should not own users, sessions, credentials, reverse-proxy trust, or product login behavior.

**Expose one guard for HTTP and upgrades.** Rejected because `ServerResponse` and raw upgraded sockets have different rejection ownership and async lifecycle requirements.

## Consequences

Authentication and deployment-policy plugins can protect every current and future Web path without modifying route owners. A misbehaving guard can still produce a 400 or closed socket through generic containment, so security plugins must answer precise status codes before returning false. Real Loader tests pin rejection-before-dispatch, ordering, disposal, and upgrade coverage.
