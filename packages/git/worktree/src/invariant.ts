import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

/** Cordis companion plugin name. */
export const name = 'git-worktree-invariant'
/** Service required to register package ownership. */
export const inject = ['invariants']

// No runtime invariant: Git is the authoritative registry and operations read it directly.
const install: InvariantInstaller = () => {}

/** Register the package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@deepseek-ai/dsh-git-worktree', install))
