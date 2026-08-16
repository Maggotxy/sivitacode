/** SivitaCode Web login over persistent access-control sessions. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { BlockList, isIP } from 'node:net'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-access-control'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'web-auth'
export const inject = ['webServer', 'accessControl']

const SECURE_COOKIE_NAME = '__Host-sivitacode_session'
const INSECURE_COOKIE_NAME = 'sivitacode_session'
const LOGIN_PATH = '/auth/login'
const LOGOUT_PATH = '/auth/logout'
const PUBLIC_ASSET_PATHS = new Set(['/favicon.svg', '/manifest.webmanifest'])
const MAX_LOGIN_BODY_BYTES = 16 * 1024

/** Administrator-session policy for the SivitaCode Web deployment. */
export interface Config {
  /** Whether login and request guards are active. */
  enabled: boolean
  /** Set the Secure Cookie attribute and use the browser-enforced `__Host-` name. */
  secureCookie: boolean
  /** Canonical HTTPS origin exposed by the reverse proxy. */
  publicOrigin?: string
  /** Proxy source networks allowed to supply forwarded request facts. */
  trustedProxyCidrs: string[]
  /** Failed login attempts accepted per peer address and rolling minute. */
  maxFailuresPerMinute: number
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  secureCookie: z.boolean().default(true),
  publicOrigin: z.string(),
  trustedProxyCidrs: z.array(String).default([]),
  maxFailuresPerMinute: z.natural().min(1).default(10),
})

interface FailureWindow {
  count: number
  startedAt: number
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function loginPage(error = ''): string {
  const message = error === '' ? '' : `<p role="alert">${escapeHtml(error)}</p>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f8f7fb"><title>SivitaCode 登录</title><style>body{font-family:system-ui,sans-serif;background:radial-gradient(circle at 50% 0,#f1edff 0,#f8f7fb 32%,#f8f7fb 100%);color:#19171f;display:grid;place-items:center;min-height:100vh;margin:0}main{width:min(24rem,calc(100% - 2rem));background:#fff;border:1px solid #e7e4ec;border-radius:18px;padding:2rem;box-sizing:border-box;box-shadow:0 22px 60px #29203314}.brand{display:flex;align-items:center;gap:.75rem}.mark{width:2rem;height:2rem;color:#7c3aed}.mark path:last-child{stroke:#0891b2}h1{font-size:1.35rem;margin:0}.tagline{color:#77727f;font-size:.88rem;margin:.55rem 0 1.75rem}label,input,button{display:block;width:100%;box-sizing:border-box}label{color:#514d57;font-size:.9rem}label+label{margin-top:1rem}input,button{font:inherit;padding:.8rem;border-radius:9px;margin-top:.5rem}input{background:#fff;color:inherit;border:1px solid #d8d4dc;outline:none}input:focus{border-color:#8b5cf6;box-shadow:0 0 0 3px #8b5cf61f}button{margin-top:1.35rem;background:#242129;color:#fff;border:0;font-weight:650;cursor:pointer}button:hover{background:#17151b}p{color:#c2415b}</style></head><body><main><div class="brand"><svg class="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2.75 20.25 7.5v9L12 21.25 3.75 16.5v-9L12 2.75Z" stroke="currentColor" stroke-width="1.8"/><path d="M15.8 8.2H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><h1>SivitaCode</h1></div><div class="tagline">Web-first coding agent</div>${message}<form method="post" action="${LOGIN_PATH}"><label>用户名<input name="username" autocomplete="username" required autofocus></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">登录</button></form></main></body></html>`
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(html)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > MAX_LOGIN_BODY_BYTES) throw new Error('login request body exceeds 16 KiB')
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function cookieValue(req: IncomingMessage, cookieName: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === cookieName) return value.join('=')
  }
  return undefined
}

function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown'
}

interface PublicBoundary {
  readonly origin: URL
  readonly proxies: BlockList
}

function canonicalOrigin(value: string): URL {
  const origin = new URL(value)
  if (origin.protocol !== 'https:' || origin.username !== '' || origin.password !== ''
    || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
    throw new Error('web-auth: publicOrigin must be a canonical https:// authority with no path, query, fragment, or credentials')
  }
  if (origin.origin !== value) {
    throw new Error(`web-auth: publicOrigin must use canonical form ${JSON.stringify(origin.origin)}`)
  }
  return origin
}

function addProxyCidr(blockList: BlockList, cidr: string): void {
  const match = /^(.*)\/(\d+)$/.exec(cidr)
  if (match === null) throw new Error(`web-auth: invalid trusted proxy CIDR ${JSON.stringify(cidr)}`)
  const address = match[1] ?? ''
  const prefix = Number(match[2])
  const family = isIP(address)
  if ((family === 4 && prefix <= 32) || (family === 6 && prefix <= 128)) {
    blockList.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6')
    return
  }
  throw new Error(`web-auth: invalid trusted proxy CIDR ${JSON.stringify(cidr)}`)
}

function peerAddress(req: IncomingMessage): { address: string; family: 'ipv4' | 'ipv6' } | undefined {
  const raw = req.socket.remoteAddress
  if (raw === undefined) return undefined
  if (raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4) return { address: raw.slice(7), family: 'ipv4' }
  const family = isIP(raw)
  return family === 4 ? { address: raw, family: 'ipv4' }
    : family === 6 ? { address: raw, family: 'ipv6' }
      : undefined
}

function singleHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return typeof value === 'string' && value.length > 0 && !value.includes(',') ? value : undefined
}

function requestClientKey(req: IncomingMessage, boundary: PublicBoundary | undefined): string {
  if (boundary === undefined) return clientKey(req)
  return singleHeader(req, 'x-forwarded-for') ?? 'unknown'
}

function isPublicRequest(req: IncomingMessage, boundary: PublicBoundary): boolean {
  const peer = peerAddress(req)
  if (peer === undefined || !boundary.proxies.check(peer.address, peer.family)) return false
  const forwardedFor = singleHeader(req, 'x-forwarded-for')
  if (forwardedFor === undefined || isIP(forwardedFor) === 0) return false
  if (singleHeader(req, 'x-forwarded-proto') !== 'https') return false
  if (singleHeader(req, 'x-forwarded-host') !== boundary.origin.host) return false
  if (singleHeader(req, 'host') !== boundary.origin.host) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const requestOrigin = singleHeader(req, 'origin')
  if (requestOrigin !== undefined && requestOrigin !== boundary.origin.origin) return false
  if (req.method !== 'GET' && req.method !== 'HEAD' && requestOrigin !== boundary.origin.origin) return false
  return true
}

function setSecurityHeaders(res: ServerResponse, publicHttps: boolean): void {
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-frame-options', 'DENY')
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
  if (publicHttps) res.setHeader('strict-transport-security', 'max-age=31536000')
}

export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  if (config.secureCookie && config.publicOrigin === undefined) {
    throw new Error('web-auth: Secure Cookie mode requires publicOrigin')
  }
  if (config.publicOrigin !== undefined && config.trustedProxyCidrs.length === 0) {
    throw new Error('web-auth: publicOrigin requires at least one trustedProxyCidrs entry')
  }
  if (config.publicOrigin === undefined && config.trustedProxyCidrs.length > 0) {
    throw new Error('web-auth: trustedProxyCidrs requires publicOrigin')
  }
  const boundary = config.publicOrigin === undefined ? undefined : {
    origin: canonicalOrigin(config.publicOrigin),
    proxies: new BlockList(),
  }
  if (boundary !== undefined) {
    for (const cidr of config.trustedProxyCidrs) addProxyCidr(boundary.proxies, cidr)
  }
  const cookieName = config.secureCookie ? SECURE_COOKIE_NAME : INSECURE_COOKIE_NAME
  const failures = new Map<string, FailureWindow>()

  const authenticate = async (req: IncomingMessage): Promise<boolean> => {
    const token = cookieValue(req, cookieName)
    if (token === undefined) return false
    const actor = await ctx.accessControl.authenticate(token)
    if (actor === undefined) return false
    ctx.accessControl.bindRequest(req, actor)
    return true
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LOGIN_PATH,
    handler: async (req, res) => {
      if (req.method === 'GET') {
        sendHtml(res, 200, loginPage())
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'GET, POST' })
        res.end()
        return
      }
      const key = requestClientKey(req, boundary)
      const now = Date.now()
      const current = failures.get(key)
      const window = current === undefined || now - current.startedAt >= 60_000
        ? { count: 0, startedAt: now }
        : current
      if (window.count >= config.maxFailuresPerMinute) {
        res.writeHead(429, { 'retry-after': '60', 'cache-control': 'no-store' })
        res.end('too many login attempts')
        return
      }
      const body = new URLSearchParams(await readBody(req))
      let login
      try {
        login = await ctx.accessControl.login(
          body.get('username') ?? '', body.get('password') ?? '', requestClientKey(req, boundary),
        )
      } catch {
        window.count++
        failures.set(key, window)
        sendHtml(res, 401, loginPage('用户名或密码错误'))
        return
      }
      failures.delete(key)
      const secure = config.secureCookie ? '; Secure' : ''
      res.writeHead(303, {
        location: '/',
        'cache-control': 'no-store',
        'set-cookie': `${cookieName}=${login.token}; Path=/; HttpOnly; SameSite=Strict${secure}`,
      })
      res.end()
    },
  }), 'web-auth: login route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LOGOUT_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      const token = cookieValue(req, cookieName)
      if (token !== undefined) await ctx.accessControl.logout(token, requestClientKey(req, boundary))
      const secure = config.secureCookie ? '; Secure' : ''
      res.writeHead(303, {
        location: LOGIN_PATH,
        'cache-control': 'no-store',
        'set-cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
      })
      res.end()
    },
  }), 'web-auth: logout route')

  const bypass = (req: IncomingMessage): boolean => {
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    // Install metadata and the product mark are intentionally public so the
    // browser can install and brand the authenticated shell without exposing application data.
    return pathname === LOGIN_PATH || pathname === LOGOUT_PATH || PUBLIC_ASSET_PATHS.has(pathname)
  }
  ctx.effect(() => ctx.webServer.guardRequests(async (req, res) => {
    setSecurityHeaders(res, boundary !== undefined)
    if (boundary !== undefined && !isPublicRequest(req, boundary)) {
      res.writeHead(403, { 'cache-control': 'no-store' })
      res.end('forbidden request authority')
      return false
    }
    if (bypass(req) || await authenticate(req)) return true
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      res.writeHead(401, { 'cache-control': 'no-store' })
      res.end('authentication required')
    } else {
      res.writeHead(303, { location: LOGIN_PATH, 'cache-control': 'no-store' })
      res.end()
    }
    return false
  }), 'web-auth: HTTP guard')
  ctx.effect(() => ctx.webServer.guardUpgrades(async (req, socket: Duplex) => {
    if (boundary !== undefined && !isPublicRequest(req, boundary)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n')
      return false
    }
    if (await authenticate(req)) return true
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n')
    return false
  }), 'web-auth: upgrade guard')
  ctx.effect(() => () => {
    failures.clear()
  }, 'web-auth: clear failure windows')
}
