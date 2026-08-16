/** Package-owned runtime invariant for access control. @module @deepseek-ai/dsh-access-control/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'

const PACKAGE_NAME = '@deepseek-ai/dsh-access-control'
export const name = 'access-control-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign((ctx: Context, fail: (message: string) => never) => {
  ctx.on('domain/changed', (change: DomainChanged) => {
    if (change.domain !== 'access_control') return
    if (!['users', 'sessions', 'audit'].includes(change.table)) fail(`unexpected durable table '${change.table}'`)
  })
}, { inject: ['accessControl'] })

export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
