// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { PluginInventorySettingsTab } from '../src/client/PluginInventorySettingsTab.tsx'
import type { PluginInventorySettingsTabInjected } from '../src/client/PluginInventorySettingsTab.tsx'
import { DeploymentTargetsTab } from '../src/client/DeploymentTargetsTab.tsx'
import type { DeploymentTargetsTabProps } from '../src/client/DeploymentTargetsTab.tsx'
import { AccessControlTab, type AccessControlTabProps } from '../src/client/AccessControlTab.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

const EMPTY = { entries: [] }
type ListResult =
  | { readonly ok: true; readonly value: typeof EMPTY }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  const list = vi.fn<() => Promise<ListResult>>()
    .mockResolvedValue({ ok: true, value: EMPTY })
  ctx.provide('remote.pluginInventory', { list })
  ctx.provide('remote.deploymentInventory', {
    list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    create: vi.fn(), delete: vi.fn(), get: vi.fn(), update: vi.fn(),
  })
  ctx.provide('remote.accessControl', {
    listUsers: vi.fn(), createUser: vi.fn(), setUserDisabled: vi.fn(), setUserRoles: vi.fn(), recentAudit: vi.fn(),
  })
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-plugin-inventory browser plugin', () => {
  it('declares only the services used by the Settings Remote contribution', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.deploymentInventory', 'remote.accessControl'])
  })

  it('registers a localized tab without reading the Remote eagerly', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entries = b.slots.entries('settings.plugins.tab')
    expect(entries).toHaveLength(3)
    const entry = entries.find(candidate => candidate.options.id === 'all')!
    expect(entry.component).toBe(PluginInventorySettingsTab)
    expect(entry.options).toMatchObject({ id: 'all', order: 10 })
    expect(entry.locale).toBe(NS)
    expect(resolveSlotLabel(entry.options.label)).toBe('插件列表')
    expect(b.list).not.toHaveBeenCalled()

    const injected = (entry.inject as unknown as () => PluginInventorySettingsTabInjected)()
    await expect(injected.list()).resolves.toEqual(EMPTY)
    expect(b.list).toHaveBeenCalledOnce()
    b.list.mockResolvedValueOnce({ ok: false, error: { code: 'REMOTE_ERROR', message: 'unavailable' } })
    await expect(injected.list()).rejects.toThrow('pluginInventory.list failed: REMOTE_ERROR: unavailable')
    await b.ctx.fiber.dispose()
  })

  it('follows locale and recovers across late declaration and declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(3) })
    b.locale.setLocale('en')
    const entries = b.slots.entries('settings.plugins.tab')
    expect(resolveSlotLabel(entries.find(entry => entry.component === PluginInventorySettingsTab)!.options.label)).toBe('Plugin list')
    expect(entries.some(entry => entry.component === DeploymentTargetsTab)).toBe(true)
    expect(entries.some(entry => entry.component === AccessControlTab)).toBe(true)

    stop()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.plugins.tab')[0]?.component).toBe(PluginInventorySettingsTab)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(() => b.locale.register(NS, 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })

  it('renders authorized users and audit, then creates an account through the injected service', async () => {
    const listUsers = vi.fn().mockResolvedValue([{ id: 'user-admin', username: 'admin', roles: ['admin'], disabled: false, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' }])
    const recentAudit = vi.fn().mockResolvedValue([{ id: 'audit-1', at: '2026-08-14T00:00:00.000Z', action: 'bootstrap', outcome: 'success' }])
    const createUser = vi.fn().mockResolvedValue({ id: 'user-reader', username: 'reader', roles: ['viewer'], disabled: false, createdAt: '2026-08-14T00:00:01.000Z', updatedAt: '2026-08-14T00:00:01.000Z' })
    const props = {
      listUsers, recentAudit, createUser,
      setUserDisabled: vi.fn(), setUserRoles: vi.fn(),
      t: (key: string) => key,
    } as unknown as AccessControlTabProps
    render(<AccessControlTab {...props} />)
    expect(await screen.findByText('admin')).toBeDefined()
    expect(screen.getByText('bootstrap')).toBeDefined()
    fireEvent.change(screen.getByLabelText('access.username'), { target: { value: 'reader' } })
    fireEvent.change(screen.getByLabelText('access.password'), { target: { value: 'another correct battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: 'access.create' }))
    await waitFor(() => { expect(createUser).toHaveBeenCalledWith('reader', 'another correct battery staple', ['viewer']) })
    expect(listUsers).toHaveBeenCalledTimes(2)
  })

  it('keeps granted deployment targets usable when user administration is denied', async () => {
    const props = {
      list: vi.fn().mockResolvedValue([{ id: 'target-1', name: 'project-a', environment: 'development', transport: 'local', workspace: '/srv/project-a', enabled: true, labels: {}, revision: 1, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' }]),
      listPlans: vi.fn().mockResolvedValue([]),
      listRollouts: vi.fn().mockResolvedValue([]),
      listUsers: vi.fn().mockRejectedValue(new Error('ACCESS_DENIED')),
      create: vi.fn(), delete: vi.fn(), checkHealth: vi.fn(), createPlan: vi.fn(), approvePlan: vi.fn(), executePlan: vi.fn(),
      createRollout: vi.fn(), approveRollout: vi.fn(), executeRollout: vi.fn(), recoverRollout: vi.fn(),
      listWorktrees: vi.fn(), createWorktree: vi.fn(), removeWorktree: vi.fn(), listGrants: vi.fn(), setGrant: vi.fn(),
      openSession: vi.fn(), openWorktreeSession: vi.fn(),
      t: (key: string) => key,
    } as unknown as DeploymentTargetsTabProps
    render(<DeploymentTargetsTab {...props} />)

    await waitFor(() => { expect(screen.getAllByText('project-a').length).toBeGreaterThan(0) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(props.listUsers).toHaveBeenCalledOnce()
  })

  it('creates a rolling deployment from multiple selected targets', async () => {
    const targets = [
      { id: 'target-1', name: 'node-a', environment: 'staging', transport: 'local', workspace: '/srv/a', enabled: true, labels: {}, revision: 1, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' },
      { id: 'target-2', name: 'node-b', environment: 'staging', transport: 'local', workspace: '/srv/b', enabled: true, labels: {}, revision: 1, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' },
    ]
    const createRollout = vi.fn().mockResolvedValue({})
    const props = {
      list: vi.fn().mockResolvedValue(targets), listPlans: vi.fn().mockResolvedValue([]), listRollouts: vi.fn().mockResolvedValue([]),
      listUsers: vi.fn().mockRejectedValue(new Error('ACCESS_DENIED')),
      create: vi.fn(), delete: vi.fn(), checkHealth: vi.fn(), createPlan: vi.fn(), approvePlan: vi.fn(), executePlan: vi.fn(),
      createRollout, approveRollout: vi.fn(), executeRollout: vi.fn(), recoverRollout: vi.fn(),
      listWorktrees: vi.fn(), createWorktree: vi.fn(), removeWorktree: vi.fn(), listGrants: vi.fn(), setGrant: vi.fn(),
      openSession: vi.fn(), openWorktreeSession: vi.fn(), t: (key: string) => key,
    } as unknown as DeploymentTargetsTabProps
    render(<DeploymentTargetsTab {...props} />)
    const selector = await screen.findByLabelText('rollouts.targets')
    fireEvent.change(selector, { target: { value: 'target-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'rollouts.add' }))
    fireEvent.change(selector, { target: { value: 'target-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'rollouts.add' }))
    fireEvent.click(screen.getByRole('button', { name: 'rollouts.up node-b' }))
    fireEvent.change(screen.getByLabelText('rollouts.command'), { target: { value: '["pnpm","deploy"]' } })
    fireEvent.change(screen.getByLabelText('rollouts.batch'), { target: { value: '2', valueAsNumber: 2 } })
    fireEvent.click(screen.getByRole('button', { name: 'rollouts.create' }))
    await waitFor(() => {
      expect(createRollout).toHaveBeenCalledWith({ targetIds: ['target-2', 'target-1'], argv: ['pnpm', 'deploy'], batchSize: 2 })
    })
  })
})
