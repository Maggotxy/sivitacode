# @deepseek-ai/dsh-host-webserver

English | [中文](README.zh.md)

Web HTTP and upgrade-route registration plugin (default-exported `WebServer`, config `{host, port}`): a `node:http` server that listens on activation and provides `ctx.webServer`. `guardRequests(guard)` and `guardUpgrades(guard)` register pre-routing policy in registration order; each guard returns true to continue or false after owning the rejection, and its disposer removes it. HTTP guards run before route matching and the fallback; upgrade guards run before route lookup. A thrown or rejected guard follows the same per-request containment as a handler and never permits dispatch. `register(route)` adds a named `exact`/`prefix` HTTP route; `registerUpgrade(route)` adds an upgrade route for an exact pathname. A duplicate path within either table throws because route patterns are a composition-level contract and a collision is a misconfiguration; both methods return a disposer that removes the registration. `registerFallback(handler)` registers the one handler for requests that match no named route. A second registration throws; the SPA dist server [`dsh-host-frontend-static`](../frontend-static/README.md) is the shipped owner, and the server returns 404 while none is registered. `tapIndex(transform)` adds an index.html transform, and `applyIndexTaps(html)` runs a body through the registered transforms in order; the fallback handler calls it on every index response. `port` reads the listening port (the OS-assigned value when `port` is 0), and `host` reads the configured bind host (composition-time facts other plugins adapt to, e.g. the directory-picker chooser). HTTP match order after guards is fixed: exact over the whole table, then longest prefix, then the fallback handler. Upgrades match exactly after guards and unmatched connections are closed; route registration order carries no request-facing semantics.

The package knows no harness concepts and serves no files: the `/api` HTTP bridge and downlink WebSockets are routes owned by the connection plugin, plugin bundles and the HMR event stream are routes owned by the modules/hmr plugins, and dist serving belongs to the fallback owner. The upgrade handler owns the protocol handshake and connection contents; the webserver only delivers the raw socket and request. `host` accepts only `127.0.0.1` (default posture) and `0.0.0.0` (deliberate network exposure). This server serves browsers only; Electron loads dist over `file://` and carries fetch over an IPC bridge. This package never prints; the URL line belongs to the shell.

A listen failure (EADDRINUSE…) throws out of activation and rejects Loader composition with the bind diagnostic; the failed candidate fiber is disposed. An HTTP request whose handling throws (a fallback owner's `decodeURIComponent` on a malformed %-escape, a client dropping mid-body) is answered 400 — or the socket destroyed when headers are already out — and logged as a warning; it never exits the process. An upgrade-handler exception or upgraded-socket transport error is logged as a warning and destroys its socket. Disposal starts `close()` and `closeAllConnections()`, destroys every tracked upgraded socket, and returns only after the HTTP server and those sockets have closed.

## Model Experience

None, as the package is a Web carrier between the browser and the HTTP/upgrade routes other plugins register; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **No built-in TLS or policy** — the server provides guard registration but does not choose authentication, origin, proxy, or TLS policy; a composition must mount those policies before binding a non-loopback address.
- **Socket options are fixed** — config selects the bind host and port, while backlog and other socket settings remain internal until a deployment needs them.
