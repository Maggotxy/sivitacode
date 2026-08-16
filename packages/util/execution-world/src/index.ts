/** Opaque identities and routing for capability providers addressing one execution environment. */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Runtime identity of one filesystem/process world. Consumers compare object
 * identity only; labels are diagnostics and never establish equivalence.
 */
export interface ExecutionWorldIdentity {
  /** Human-readable provider-owned description used in startup failures. */
  readonly label: string
}

/** Shared identity of providers operating directly on the SivitaCode host. */
export const LOCAL_EXECUTION_WORLD: ExecutionWorldIdentity = Object.freeze({ label: 'local-host' })

/** Durable inventory identity selecting one execution environment. */
export type ExecutionTargetId = Branded<'ExecutionTargetId'>

/**
 * Brand a validated durable execution-target identifier.
 * @param value - Non-empty target identifier validated by the caller boundary.
 * @returns The same string with its target brand.
 */
export function ExecutionTargetId(value: string): ExecutionTargetId {
  return value as ExecutionTargetId
}

/** Pre-publication route for one Agent and all of its capability consumers. */
export interface ExecutionWorldRoute {
  /** Context carrying isolated service realms before the Agent scope is minted. */
  readonly context: Context
  /** Mount the route's shared owners and providers before Agent publication. */
  setup(agentContext: Context): Promise<void>
}

/** Provider resolving a durable target into one coherent capability world. */
export interface ExecutionWorldRouteProvider {
  /** Resolve an exact target or reject when it is unavailable. */
  route(runtimeContext: Context, targetId: ExecutionTargetId, cwd: string | undefined): ExecutionWorldRoute
}

declare module '@deepseek-ai/cordis' {
  interface Context { executionWorldRouter: ExecutionWorldRouter }
}

/** Registry with exactly one provider for durable execution targets. */
export class ExecutionWorldRouter extends Service {
  private provider: ExecutionWorldRouteProvider | undefined

  constructor(ctx: Context) { super(ctx, 'executionWorldRouter') }

  /**
   * Register the deployment's target provider.
   * @param provider - Sole provider resolving durable targets.
   * @returns Disposer removing this exact provider.
   */
  register(provider: ExecutionWorldRouteProvider): () => void {
    if (this.provider !== undefined) throw new Error('execution-world router already has a provider')
    this.provider = provider
    return () => { if (this.provider === provider) this.provider = undefined }
  }

  /**
   * Resolve one durable target through the registered provider.
   * @param runtimeContext - AgentLoop runtime Context carrying the complete capability graph.
   * @param targetId - Exact durable target id.
   * @param cwd - Control-plane working directory recorded by the session.
   * @returns Pre-construction context and pre-publication setup.
   */
  route(runtimeContext: Context, targetId: ExecutionTargetId, cwd: string | undefined): ExecutionWorldRoute {
    if (this.provider === undefined) throw new Error(`execution target '${targetId}' cannot resolve: no route provider is registered`)
    return this.provider.route(runtimeContext, targetId, cwd)
  }
}

export default ExecutionWorldRouter
