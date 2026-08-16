/** Package-owned invariant companion for the SSH connection owner. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-ssh'
/** Cordis companion name. */
export const name = 'ssh-invariant'
/** Required registry service. */
export const inject = ['invariants']

/** No runtime invariant: connection readiness and teardown share one master-process lifecycle. */
const install: InvariantInstaller = () => {}

/** Register package ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
