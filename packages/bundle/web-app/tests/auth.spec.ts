import { once } from 'node:events'
import { request } from 'node:http'
import { connect } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import AccessControl from '@deepseek-ai/dsh-access-control'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { apply, Config } from '../src/auth.ts'

let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
})

async function start(config: Partial<Config> = {}): Promise<WebServer> {
  ctx = new Context()
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(AccessControl, {
    bootstrapUsername: 'admin',
    bootstrapPassword: 'correct horse battery staple',
    idleTimeoutMinutes: 60,
    absoluteTimeoutHours: 24,
  })
  apply(ctx, new Config({
    enabled: true,
    secureCookie: false,
    trustedProxyCidrs: [],
    maxFailuresPerMinute: 2,
    ...config,
  }))
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/probe',
    handler: (_req, res) => { res.writeHead(200); res.end('API') },
  })
  ctx.webServer.registerFallback((_req, res) => { res.writeHead(200); res.end('APP') })
  ctx.webServer.registerUpgrade({
    path: '/api/events',
    handler: (_req, socket) => {
      socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: test\r\n\r\n')
    },
  })
  return ctx.webServer
}

async function rawRequest(
  port: number,
  path: string,
  options: { method?: string; headers: Record<string, string>; body?: string },
): Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    req.on('error', reject)
    if (options.body !== undefined) req.end(options.body)
    else req.end()
  })
}

describe('SivitaCode Web authentication', () => {
  it('protects pages, APIs, and upgrades with one server-side session', async () => {
    const server = await start()
    const origin = `http://127.0.0.1:${String(server.port)}`
    const page = await fetch(`${origin}/`, { redirect: 'manual' })
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toBe('/auth/login')
    expect(await (await fetch(`${origin}/manifest.webmanifest`)).text()).toBe('APP')
    expect(await (await fetch(`${origin}/favicon.svg`)).text()).toBe('APP')
    expect((await fetch(`${origin}/api/probe`)).status).toBe(401)

    const bad = await fetch(`${origin}/auth/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'admin', password: 'wrong password' }),
      redirect: 'manual',
    })
    expect(bad.status).toBe(401)
    expect(await bad.text()).toContain('用户名或密码错误')

    const login = await fetch(`${origin}/auth/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'admin', password: 'correct horse battery staple' }),
      redirect: 'manual',
    })
    expect(login.status).toBe(303)
    const cookie = login.headers.get('set-cookie')
    expect(cookie).toContain('sivitacode_session=')
    expect(cookie).not.toContain('__Host-')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).not.toContain('Secure')
    if (cookie === null) throw new Error('session cookie missing')
    const requestCookie = cookie.split(';', 1)[0]
    if (requestCookie === undefined) throw new Error('session cookie value missing')
    expect(await (await fetch(`${origin}/`, { headers: { cookie: requestCookie } })).text()).toBe('APP')
    expect(await (await fetch(`${origin}/api/probe`, { headers: { cookie: requestCookie } })).text()).toBe('API')

    const socket = connect(server.port, '127.0.0.1')
    await once(socket, 'connect')
    const data = once(socket, 'data')
    socket.write([
      'GET /api/events HTTP/1.1',
      `Host: 127.0.0.1:${String(server.port)}`,
      `Cookie: ${requestCookie}`,
      'Connection: Upgrade',
      'Upgrade: test',
      '',
      '',
    ].join('\r\n'))
    expect(String((await data)[0])).toContain('101 Switching Protocols')
    socket.destroy()

    const logout = await fetch(`${origin}/auth/logout`, {
      method: 'POST', headers: { cookie: requestCookie }, redirect: 'manual',
    })
    expect(logout.status).toBe(303)
    expect((await fetch(`${origin}/api/probe`, { headers: { cookie: requestCookie } })).status).toBe(401)
  })

  it('rate-limits credential failures', async () => {
    const server = await start()
    const origin = `http://127.0.0.1:${String(server.port)}`
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await fetch(`${origin}/auth/login`, {
        method: 'POST', body: new URLSearchParams({ username: 'admin', password: 'wrong' }),
      })).status).toBe(401)
    }
    const limited = await fetch(`${origin}/auth/login`, {
      method: 'POST', body: new URLSearchParams({ username: 'admin', password: 'correct horse battery staple' }),
    })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
  })

  it('accepts forwarded authority only from an explicit proxy network', async () => {
    const server = await start({
      secureCookie: true,
      publicOrigin: 'https://code.example.com',
      trustedProxyCidrs: ['127.0.0.1/32'],
    })
    const headers = {
      host: 'code.example.com',
      'x-forwarded-host': 'code.example.com',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '203.0.113.8',
    }
    const page = await rawRequest(server.port, '/auth/login', { headers })
    expect(page.status).toBe(200)
    expect(page.headers['strict-transport-security']).toBe('max-age=31536000')
    expect(page.headers['x-frame-options']).toBe('DENY')

    const missingForwarded = await rawRequest(server.port, '/auth/login', {
      headers: { host: 'code.example.com' },
    })
    expect(missingForwarded.status).toBe(403)

    const crossSiteLogin = await rawRequest(server.port, '/auth/login', {
      method: 'POST',
      headers: { ...headers, origin: 'https://evil.example' },
      body: new URLSearchParams({ username: 'admin', password: 'correct horse battery staple' }).toString(),
    })
    expect(crossSiteLogin.status).toBe(403)

    const login = await rawRequest(server.port, '/auth/login', {
      method: 'POST',
      headers: { ...headers, origin: 'https://code.example.com' },
      body: new URLSearchParams({ username: 'admin', password: 'correct horse battery staple' }).toString(),
    })
    expect(login.status).toBe(303)
    expect(login.headers['set-cookie']?.[0]).toContain('__Host-sivitacode_session=')
    expect(login.headers['set-cookie']?.[0]).toContain('Secure')
  })
})
