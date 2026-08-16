import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import AccessControl, { AccessDeniedError } from '../src/index.ts'

async function harness(pool = new MemoryMediaPool()): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(AccessControl, {
    bootstrapUsername: 'admin',
    bootstrapPassword: 'correct horse battery staple',
    idleTimeoutMinutes: 60,
    absoluteTimeoutHours: 24,
  })
  return ctx
}

describe('persistent access control', () => {
  it('stores an Argon2id credential and resolves a durable server-side session', async () => {
    const ctx = await harness()
    const login = await ctx.accessControl.login('admin', 'correct horse battery staple', '127.0.0.1')
    expect(login.token).not.toContain('correct horse battery staple')
    expect(await ctx.accessControl.authenticate(login.token)).toMatchObject({ username: 'admin', roles: ['admin'] })
    expect((await ctx.accessControl.runAs(login.actor, () => ctx.accessControl.recentAudit(100))).map(entry => entry.action)).toContain('login')
    await ctx.fiber.dispose()
  })

  it('enforces permissions inside the operation and invalidates disabled-user sessions', async () => {
    const ctx = await harness()
    const admin = await ctx.accessControl.login('admin', 'correct horse battery staple')
    const viewer = await ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.createUser(
      'reader', 'another correct battery staple', ['viewer'],
    ))
    const viewerLogin = await ctx.accessControl.login('reader', 'another correct battery staple')
    await expect(ctx.accessControl.runAs(viewerLogin.actor, () => ctx.accessControl.authorize('operate')))
      .rejects.toBeInstanceOf(AccessDeniedError)
    await ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.setUserDisabled(viewer.id, true))
    expect(await ctx.accessControl.authenticate(viewerLogin.token)).toBeUndefined()
    expect((await ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.recentAudit(100))).some(entry => entry.outcome === 'denied')).toBe(true)
    await ctx.fiber.dispose()
  })

  it('authorizes identity reads, revokes sessions on role changes, and preserves one administrator', async () => {
    const ctx = await harness()
    const admin = await ctx.accessControl.login('admin', 'correct horse battery staple')
    const viewer = await ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.createUser(
      'reader', 'another correct battery staple', ['viewer'],
    ))
    const viewerLogin = await ctx.accessControl.login('reader', 'another correct battery staple')
    await expect(ctx.accessControl.runAs(viewerLogin.actor, () => ctx.accessControl.listUsers()))
      .rejects.toBeInstanceOf(AccessDeniedError)
    await expect(ctx.accessControl.runAs(viewerLogin.actor, () => ctx.accessControl.recentAudit(100)))
      .rejects.toBeInstanceOf(AccessDeniedError)
    await expect(ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.setUserRoles(admin.actor.userId, ['operator'])))
      .rejects.toThrow('last enabled administrator')
    await expect(ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.setUserDisabled(admin.actor.userId, true)))
      .rejects.toThrow('last enabled administrator')

    expect(await ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.setUserRoles(viewer.id, ['developer'])))
      .toMatchObject({ roles: ['developer'] })
    expect(await ctx.accessControl.authenticate(viewerLogin.token)).toBeUndefined()
    expect(await ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.listUsers()))
      .toEqual(expect.arrayContaining([expect.objectContaining({ username: 'reader', roles: ['developer'] })]))
    await expect(ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.recentAudit(0))).rejects.toThrow('1 to 1000')
    expect(await ctx.accessControl.runAs(admin.actor, () => ctx.accessControl.recentAudit(100)))
      .toEqual(expect.arrayContaining([expect.objectContaining({ action: 'user.roles', outcome: 'denied', detail: 'last enabled administrator' })]))
    await ctx.fiber.dispose()
  })

  it('reopens persisted users while bootstrap input is no longer authoritative', async () => {
    const pool = new MemoryMediaPool()
    const first = await harness(pool)
    await first.fiber.dispose()
    const second = new Context()
    await second.plugin(Storage)
    second.storage.backend.register('memory', new MemoryStorageBackend(pool))
    second.provide('storageDomain', new DomainFacility(second, { backend: 'memory' }))
    await second.plugin(AccessControl, {
      bootstrapUsername: 'ignored',
      bootstrapPassword: 'ignored password value',
      idleTimeoutMinutes: 60,
      absoluteTimeoutHours: 24,
    })
    await expect(second.accessControl.login('admin', 'correct horse battery staple')).resolves.toBeDefined()
    await expect(second.accessControl.login('ignored', 'ignored password value')).rejects.toBeInstanceOf(AccessDeniedError)
    await second.fiber.dispose()
  })
})
