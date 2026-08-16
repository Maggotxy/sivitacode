/** Read-only Host plugin inventory registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginInventorySettingsTab, type PluginInventorySettingsTabInjected } from './PluginInventorySettingsTab.tsx'
import { DeploymentTargetsTab, type DeploymentTargetsInjected } from './DeploymentTargetsTab.tsx'
import { AccessControlTab, type AccessControlInjected } from './AccessControlTab.tsx'
import { en, zh, type PluginInventoryLocaleKey } from './locales.ts'

export type { PluginInventorySettingsTabInjected, PluginInventorySettingsTabProps } from './PluginInventorySettingsTab.tsx'
export type { PluginInventoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Read-only Host plugin inventory copy. */
    'settings.pluginInventory': PluginInventoryLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.pluginInventory'

/** Services required by the Settings registration and generated Remote face. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginInventory', 'remote.deploymentInventory', 'remote.accessControl']

/** Contribute the lazy inventory tab to the Plugins settings section. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-plugin-inventory: dictionaries')

  const t = ctx.locale.bind(NS)
  const list: PluginInventorySettingsTabInjected['list'] = async () => {
    const result = await ctx.remote.pluginInventory.list()
    if (!result.ok) {
      throw new Error(`pluginInventory.list failed: ${result.error.code}: ${result.error.message}`)
    }
    return result.value
  }
  const injected = (): PluginInventorySettingsTabInjected => ({ list })

  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'all',
    order: 10,
    label: () => t('tab'),
    locale: NS,
    inject: injected,
  }, PluginInventorySettingsTab))

  const deploymentInjected = (): DeploymentTargetsInjected => ({
    list: async () => unwrap(await ctx.remote.deploymentInventory.list()),
    create: async input => unwrap(await ctx.remote.deploymentInventory.create(input)),
    delete: async (id, revision) => { unwrap(await ctx.remote.deploymentInventory.delete(id, revision)) },
    checkHealth: async id => unwrap(await ctx.remote.deploymentInventory.checkHealth(id)),
    listPlans: async () => unwrap(await ctx.remote.deploymentInventory.listPlans()),
    createPlan: async (targetId, argv) => unwrap(await ctx.remote.deploymentInventory.createPlan({ targetId, argv })),
    approvePlan: async (id, revision) => unwrap(await ctx.remote.deploymentInventory.approvePlan(id, revision)),
    executePlan: async (id, revision) => unwrap(await ctx.remote.deploymentInventory.executePlan(id, revision)),
    listRollouts: async () => unwrap(await ctx.remote.deploymentInventory.listRollouts()),
    createRollout: async input => unwrap(await ctx.remote.deploymentInventory.createRollout(input)),
    approveRollout: async (id, revision) => unwrap(await ctx.remote.deploymentInventory.approveRollout(id, revision)),
    executeRollout: async (id, revision) => unwrap(await ctx.remote.deploymentInventory.executeRollout(id, revision)),
    recoverRollout: async (id, revision) => unwrap(await ctx.remote.deploymentInventory.recoverRollout(id, revision)),
    listWorktrees: async targetId => unwrap(await ctx.remote.deploymentInventory.listWorktrees(targetId)),
    createWorktree: async input => unwrap(await ctx.remote.deploymentInventory.createWorktree(input)),
    removeWorktree: async (targetId, path) => { unwrap(await ctx.remote.deploymentInventory.removeWorktree(targetId, path)) },
    listUsers: async () => unwrap(await ctx.remote.accessControl.listUsers()),
    listGrants: async targetId => unwrap(await ctx.remote.deploymentInventory.listGrants(targetId)),
    setGrant: async (targetId, userId, permission, revision) => unwrap(await ctx.remote.deploymentInventory.setGrant({
      targetId, userId, ...(permission === undefined ? {} : { permission }),
      ...(revision === undefined ? {} : { expectedRevision: revision }),
    })),
    openSession: async (target) => {
      const id = await ctx.sessions.create({ cwd: target.workspace, executionTarget: target.id as never })
      ctx.sessions.open(id)
    },
    openWorktreeSession: async (target, path) => {
      const id = await ctx.sessions.create({ cwd: path, executionTarget: target.id as never })
      ctx.sessions.open(id)
    },
  })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'deployment-targets', order: 20,
    label: () => t('targets.tab'), locale: NS, inject: deploymentInjected,
  }, DeploymentTargetsTab))

  const accessInjected = (): AccessControlInjected => ({
    listUsers: async () => unwrap(await ctx.remote.accessControl.listUsers()),
    createUser: async (username, password, roles) => unwrap(await ctx.remote.accessControl.createUser(username, password, roles)),
    setUserDisabled: async (id, disabled) => { unwrap(await ctx.remote.accessControl.setUserDisabled(id, disabled)) },
    setUserRoles: async (id, roles) => unwrap(await ctx.remote.accessControl.setUserRoles(id, roles)),
    recentAudit: async limit => unwrap(await ctx.remote.accessControl.recentAudit(limit)),
  })
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab', id: 'access-control', order: 30,
    label: () => t('access.tab'), locale: NS, inject: accessInjected,
  }, AccessControlTab))
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}
