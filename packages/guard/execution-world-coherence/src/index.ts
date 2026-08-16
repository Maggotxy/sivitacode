/** Startup enforcement for co-located filesystem and subprocess providers. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-subprocess'

/** Stable Cordis plugin name. */
export const name = 'execution-world-coherence'
/** Both providers must exist before their identities can be compared. */
export const inject = ['fs', 'subprocess']

/**
 * Refuse a composition whose files and commands inhabit different worlds.
 * @param ctx - context carrying both execution providers.
 */
export function apply(ctx: Context): void {
  if (ctx.fs.executionWorld !== ctx.subprocess.executionWorld) {
    throw new Error(
      `execution-world: filesystem (${ctx.fs.executionWorld.label}) and subprocess `
      + `(${ctx.subprocess.executionWorld.label}) providers do not share one environment`,
    )
  }
}
