/** Package-owned invariant companion for execution-world coherence. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-execution-world-coherence'

/** Cordis companion plugin name. */
export const name = 'execution-world-coherence-invariant'
/** Services required to register and evaluate the provider relation. */
export const inject = ['invariants']

const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    if (ctx.fs.executionWorld !== ctx.subprocess.executionWorld) {
      fail('filesystem and subprocess providers identify different execution worlds')
    }
  },
  { inject: ['fs', 'subprocess'] },
)

/** Register the coherence invariant. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
