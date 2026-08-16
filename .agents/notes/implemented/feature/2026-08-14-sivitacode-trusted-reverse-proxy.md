# Agent Note: SivitaCode trusted reverse proxy

Status: implemented

English | [中文](2026-08-14-sivitacode-trusted-reverse-proxy.zh.md)

## Problem

TLS normally terminates at Nginx, Caddy, Traefik, or a managed ingress while SivitaCode receives plain HTTP. Trusting forwarded fields from any peer lets a direct caller forge HTTPS, public authority, or source address. Ignoring them prevents correct Secure Cookie and client throttling behavior behind a proxy.

## Decision

Public SivitaCode Web serving has one canonical HTTPS Origin and an explicit set of trusted reverse-proxy CIDRs. The server accepts forwarded scheme, authority, and client-address facts only when the direct TCP peer belongs to that set. Requests must carry the canonical public Host, forwarded Host, HTTPS scheme, and one literal client address; browser Origin must match, and state-changing requests require it.

The same policy runs before HTTP route selection and WebSocket upgrade dispatch. Public responses receive HSTS, CSP, anti-framing, MIME-sniffing, referrer, and permissions headers. Login throttling keys on the validated client address rather than an untrusted forwarding field.

A canonical Origin plus proxy source CIDRs makes the transition explicit and keeps the backend port outside the public trust domain.

## Alternatives considered

**Trust forwarded headers unconditionally.** Rejected because a caller reaching the backend port could forge every security-relevant external request fact.

**Ignore forwarded headers.** Rejected because the application could not verify public HTTPS authority or throttle the actual client behind a proxy.

**Accept a list of public Origins.** Rejected for the single-admin deployment because one canonical Origin gives Cookie, Origin, and WebSocket policy one unambiguous authority.

## Consequences

Operators must configure the proxy to replace, not append, the four required headers and must update the CIDR list when the proxy network changes. The initial administrator identity remains process-local; persistent users, RBAC, shared revocation, and high availability are separate work.

The application currently needs inline scripts and styles for its generated boot manifest, boot theme, and rendered UI, so CSP permits inline script and style execution while rejecting other origins, objects, framing, and base changes. Removing those allowances requires nonce propagation through every index transform and client renderer.

Tests cover a trusted loopback proxy, missing forwarding facts, cross-origin login rejection, security headers, and the Secure `__Host-` Cookie. Startup coverage proves all-interface binding requires the password, public Origin, and proxy CIDRs together.
