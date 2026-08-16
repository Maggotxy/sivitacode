import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-deployment-inventory'
/** Cordis companion name. */
export const name = 'deployment-inventory-invariant'
/** Required service. */
export const inject = ['invariants']
/** No runtime invariant: the storage domain validates every durable target and RBAC owns operation authorization. */
const install: InvariantInstaller = () => {}
/** Register package ownership. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
