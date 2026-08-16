# `@deepseek-ai/dsh-web-app`

English | [中文](README.zh.md)

The dsh browser-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the coding persona, inserts the Web host rows (webserver, API gateway, workspace, projection cache, storage) and the browser plugin roster, the always-on client-plugin reload chain ([`dsh-client-hmr`](../../client/hmr/README.md), idle until a rebuild watcher rewrites client bundles), and mounts this package's `web-runtime` glue plugin (config `{printUrl, surfaceContext, trustedHosts, publicOrigin}`). That plugin resolves the built frontend dist through `@deepseek-ai/dsh-web-frontend`'s exports, samples bind-dependent LAN trust once, provides it as `webRuntime` to the browser-trust fence and client roster, mounts the [`frontend-static`](../../host/frontend-static/README.md) fallback owner, registers the harness-source and web-surface prompt sections plus the bash-visible `DSH_WEB_URL` runtime variable when `surfaceContext` is true, and prints the selected product's URL line when `printUrl` is true, after its Loader tree settles so a sibling failure cannot announce a dead app. A configured public origin replaces the private bind URL in the prompt, environment, and readiness line. This bundle also owns the app command line: the ordinary `web-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)), parses `--host`, `--port`, repeatable `--trusted-host`, and the app's `--help`, then provides `webStartup`. All-interfaces binding requires the SivitaCode product entry plus configured Web authentication. Flag-configured rows inject the service and read it directly from lazy config, so nothing binds a port before argument resolution and `dsh --profile web --help` starts no server. [`dsh-headless`](../headless/README.md) is a sibling surface over the same base and does not mount this bundle.

SivitaCode enables persistent access control and `web-auth` when `SIVITACODE_WEB_PASSWORD` is present and at least 12 characters. `SIVITACODE_WEB_ADMIN_USERNAME` selects the first administrator name and defaults to `admin`; these bootstrap values create the first Argon2id credential only when the account store is empty. Login sets a random HttpOnly, SameSite=Strict, Secure `__Host-sivitacode_session` Cookie whose server-side record survives restart; sessions expire after 60 idle minutes or 24 hours. The Host API enforces authenticated request-local actors and server-defined `viewer`, `developer`, `operator`, and `admin` permissions at dispatch, and records login, logout, identity changes, and denials in the durable audit table. The Web Settings page exposes administrator-only user, role, revocation, and audit operations; the service preserves at least one enabled administrator. Public serving additionally requires a canonical `SIVITACODE_WEB_PUBLIC_ORIGIN` and comma-separated `SIVITACODE_WEB_TRUSTED_PROXY_CIDRS`. Only a direct peer in those CIDRs may supply one exact forwarded client address, HTTPS scheme, and public authority; every HTTP and WebSocket request must match that origin. The guard also emits CSP, anti-framing, MIME-sniffing, referrer, permissions, and HSTS headers. Failed login attempts are limited by the validated forwarded client address. `SIVITACODE_WEB_INSECURE_COOKIE=1` exists only for local HTTP testing.

## Model Experience

### Harness-source and Web-surface context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory, and the `app:web-surface` global section (order −98) orients the model to the GUI: the configured public origin or canonical local URL, the "this page" referent, the update contract (the reload receiver is always on; no-refresh reloads additionally need the `pnpm run dev:web` watcher), and the instruction not to start replacement servers. `DSH_WEB_URL` additionally appears in the managed bash environment with its description and the same browser-facing URL. When it is false, neither section nor the variable is registered.

#### Token effect

One source line and one prompt paragraph per session plus two managed-environment variable lines; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process (the port is a boot fact), so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **The frontend dist must be built** — `require.resolve` of the dist fails loud at activation with a build hint; there is no source-serving fallback.
- **`lanAddresses` is a boot-time snapshot** — interface changes after boot are not re-advertised; the printed LAN URL always matches the configured trust fence.
- **Target grants name individual users** — global roles cap authority and Inventory grants narrow each non-admin user to selected targets; external group mapping requires a future identity provider.
