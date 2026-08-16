/** Package-owned invariant companion for `@deepseek-ai/dsh-acp-app`. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-acp-app'
/** Cordis companion plugin name. */
export const name = 'acp-app-invariant'
/** Service required before registration. */
export const inject = ['invariants']
/** No runtime invariant: this package contributes only a static bundle patch. */
const install: InvariantInstaller = () => {}
/** Register the package marker. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
