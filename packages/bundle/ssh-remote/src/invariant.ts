import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ssh-remote'
/** Cordis companion name. */
export const name = 'ssh-remote-bundle-invariant'
/** Required service. */
export const inject = ['invariants']
/** No runtime invariant: the bundle only replaces provider rows; their companions enforce identity. */
const install: InvariantInstaller = () => {}
/** Register package ownership. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
