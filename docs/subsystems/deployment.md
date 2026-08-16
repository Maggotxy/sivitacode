# Deployment

English | [中文](deployment.zh.md)

[`dsh-deployment-inventory`](../../packages/deployment/inventory/README.md) owns the persistent non-secret target registry. It relies on [`access-control`](access-control.md) for request actors, global role ceilings, per-target permission grants, and the shared security audit. Administrators retain recovery access to every target; other users see and operate only explicitly granted targets within their global role ceiling. Private keys and passwords remain in credential providers; an Inventory record contains only an optional credential reference.

The service applies optimistic revisions to targets and grants. Every target operation reauthorizes its exact identifier, including execution-world routing, deployment plans, and rollouts. An SSH target carries an independently verified exact host key and absolute POSIX workspace. A health operation resolves optional private-key credentials only for its exact-host-key-pinned connection and returns a redacted result. Rootless Docker or Podman targets mount the same filesystem and subprocess capability world with networking disabled by default. Durable plans capture target revision and literal argv; production requires two-person approval before one-shot local, pinned-SSH, or rootless-container execution. Durable rollouts fix an ordered multi-target revision set, health-check each member, execute bounded batches, and stop before the next batch after any failure. Scheduled triggering remains a separate consumer.

## Rolling deployment records

A rollout records target order and observed revisions at creation. Each optional lifecycle command is an argv array: drain, deploy, verify, rollback, and restore. A deployment or verification failure attempts rollback, always attempts traffic restoration after a successful drain, marks every unstarted target skipped, and prevents re-execution. Failed restoration or a control-plane restart after drain leaves the rollout `recovery-required`; an operator can retry only the stored restore command.

```ts type-equiv
/** Durable multi-target rollout id. */
type DeploymentRolloutId = Branded<'DeploymentRolloutId'>
```

```ts type-equiv
/** Durable rollout lifecycle. */
type DeploymentRolloutStatus = DeploymentPlanStatus | 'recovery-required'
```

```ts type-equiv
/** Per-target rollout lifecycle. */
type DeploymentRolloutTargetStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'recovery-required'
```

```ts type-equiv
/** One persisted rollout lifecycle command phase. */
type DeploymentRolloutPhase = 'drain' | 'deploy' | 'verify' | 'rollback' | 'restore'
```

```ts type-equiv
/** Bounded result from one rollout lifecycle command. */
interface DeploymentRolloutStep {
  readonly phase: DeploymentRolloutPhase
  readonly status: 'succeeded' | 'failed'
  readonly startedAt: string
  readonly finishedAt: string
  readonly exitCode?: number
  readonly output?: string
  readonly failure?: string
}
```

```ts type-equiv
/** Request for one immutable health-gated rolling deployment. */
interface DeploymentRolloutCreate {
  readonly targetIds: readonly DeploymentTargetId[]
  readonly argv: readonly string[]
  readonly drainArgv?: readonly string[]
  readonly verifyArgv?: readonly string[]
  readonly rollbackArgv?: readonly string[]
  readonly restoreArgv?: readonly string[]
  readonly timeoutMs?: number
  readonly batchSize?: number
}
```

```ts type-equiv
/** Public per-target rollout result. */
interface DeploymentRolloutTarget {
  readonly targetId: DeploymentTargetId
  readonly targetRevision: number
  readonly environment: DeploymentEnvironment
  readonly status: DeploymentRolloutTargetStatus
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly exitCode?: number
  readonly output?: string
  readonly failure?: string
  readonly steps: readonly DeploymentRolloutStep[]
}
```

```ts type-equiv
/** Public durable rolling deployment and bounded per-target results. */
interface DeploymentRollout {
  readonly id: DeploymentRolloutId
  readonly targets: readonly DeploymentRolloutTarget[]
  readonly argv: readonly string[]
  readonly drainArgv?: readonly string[]
  readonly verifyArgv?: readonly string[]
  readonly rollbackArgv?: readonly string[]
  readonly restoreArgv?: readonly string[]
  readonly timeoutMs: number
  readonly batchSize: number
  readonly status: DeploymentRolloutStatus
  readonly createdBy: string
  readonly approvedBy?: string
  readonly createdAt: string
  readonly approvedAt?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly revision: number
}
```


<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdeploymentinventory--deploymentinventoryservice"></a>

### `ctx.deploymentInventory` — `DeploymentInventoryService`

Persistent deployment target inventory.

```ts cordis-catalog
/**
 * Resolve an enabled inventory target into isolated Agent capability realms.
 * @param runtimeContext - AgentLoop runtime Context carrying the complete capability graph.
 * @param targetId - Durable Inventory target id.
 * @param cwd - Control-plane path mapped to the target workspace.
 * @returns Route mounted before Agent publication.
 */
route(runtimeContext: Context, targetId: ExecutionTargetId, cwd: string | undefined): ExecutionWorldRoute

/**
 * List targets visible to the authenticated actor.
 * @returns Authorized target projections in name order.
 */
@Remote('list') async list(): Promise<DeploymentTarget[]>

/**
 * Read one target.
 * @param id - Target identifier.
 * @returns Authorized target projection, or undefined when absent.
 */
@Remote('get') async get(id: DeploymentTargetId): Promise<DeploymentTarget | undefined>

/**
 * Create one target after configuration authorization.
 * @param input - Valid non-secret target configuration.
 * @returns Created target at revision one.
 */
@Remote('create') async create(input: DeploymentTargetCreate): Promise<DeploymentTarget>

/**
 * List one target's explicit user grants.
 * @param targetId - Target whose grants are requested.
 * @returns Grants ordered by user id.
 */
@Remote('listGrants') async listGrants(targetId: DeploymentTargetId): Promise<DeploymentTargetGrant[]>

/**
 * Create, replace, or delete one explicit target grant.
 * @param input - Target, user, permission, and observed revision.
 * @returns New grant, or undefined after deletion.
 */
@Remote('setGrant') async setGrant(input: DeploymentTargetGrantSet): Promise<DeploymentTargetGrant | undefined>

/**
 * Replace one target when its observed revision is current.
 * @param id - Target identifier.
 * @param input - Replacement and observed revision.
 * @returns Updated target with an incremented revision.
 */
@Remote('update') async update(id: DeploymentTargetId, input: DeploymentTargetUpdate): Promise<DeploymentTarget>

/**
 * Delete a target after administrative authorization.
 * @param id - Target identifier.
 * @param expectedRevision - Revision observed by the administrator.
 * @returns Resolution after delete and audit.
 */
@Remote('delete') async delete(id: DeploymentTargetId, expectedRevision: number): Promise<void>

/**
 * Verify target reachability and its configured workspace without changing it.
 * @param id - Target identifier.
 * @returns Point-in-time health result with no secret material.
 */
@Remote('checkHealth') async checkHealth(id: DeploymentTargetId): Promise<DeploymentTargetHealth>

/**
 * List Git worktrees inside one authorized execution target.
 * @param targetId - Inventory target owning the repository and process realm.
 * @returns Git-authoritative worktree records.
 */
@Remote('listWorktrees') async listWorktrees(targetId: DeploymentTargetId): Promise<DeploymentWorktree[]>

/**
 * Create a managed linked worktree inside one execution target.
 * @param input - Target, branch, and optional starting revision.
 * @returns The created Git-authoritative record.
 */
@Remote('createWorktree') async createWorktree(input: DeploymentWorktreeCreate): Promise<DeploymentWorktree>

/**
 * Remove a clean managed linked worktree inside one execution target.
 * @param targetId - Inventory target owning the repository.
 * @param path - Exact managed path returned by {@link listWorktrees}.
 */
@Remote('removeWorktree') async removeWorktree(targetId: DeploymentTargetId, path: string): Promise<void>

/**
 * List deployment plans after read authorization.
 * @returns Plans newest first.
 */
@Remote('listPlans') async listPlans(): Promise<DeploymentPlan[]>

/**
 * Create an immutable deployment plan.
 * @param input - Target and literal argv.
 * @returns Durable plan.
 */
@Remote('createPlan') async createPlan(input: DeploymentPlanCreate): Promise<DeploymentPlan>

/**
 * Approve a production deployment as an administrator.
 * @param id - Plan id.
 * @param expectedRevision - Observed revision.
 * @returns Approved plan.
 */
@Remote('approvePlan') async approvePlan(id: DeploymentPlanId, expectedRevision: number): Promise<DeploymentPlan>

/**
 * Execute one ready plan exactly once.
 * @param id - Plan id.
 * @param expectedRevision - Observed revision.
 * @returns Settled plan.
 */
@Remote('executePlan') async executePlan(id: DeploymentPlanId, expectedRevision: number): Promise<DeploymentPlan>

/**
 * List rolling deployments whose complete target set is readable by the actor.
 * @returns Authorized rollouts newest first.
 */
@Remote('listRollouts') async listRollouts(): Promise<DeploymentRollout[]>

/**
 * Create one immutable health-gated multi-target rollout.
 * @param input - Ordered targets, literal argv, timeout, and batch size.
 * @returns Durable rollout awaiting approval when any target is production.
 */
@Remote('createRollout') async createRollout(input: DeploymentRolloutCreate): Promise<DeploymentRollout>

/**
 * Approve a production rollout as a different administrator authorized for every target.
 * @param id - Rollout id.
 * @param expectedRevision - Observed revision.
 * @returns Approved rollout.
 */
@Remote('approveRollout') async approveRollout(id: DeploymentRolloutId, expectedRevision: number): Promise<DeploymentRollout>

/**
 * Execute one ready rollout exactly once in health-gated bounded batches.
 * @param id - Rollout id.
 * @param expectedRevision - Observed revision.
 * @returns Settled rollout with every target result.
 */
@Remote('executeRollout') async executeRollout(id: DeploymentRolloutId, expectedRevision: number): Promise<DeploymentRollout>

/**
 * Retry traffic restoration for targets left drained after an interrupted or failed rollout.
 * @param id - Rollout requiring operator recovery.
 * @param expectedRevision - Observed rollout revision.
 * @returns Failed rollout after restoration, or recovery-required when any restore still fails.
 */
@Remote('recoverRollout') async recoverRollout(id: DeploymentRolloutId, expectedRevision: number): Promise<DeploymentRollout>
```

Source: [`packages/deployment/inventory/src/index.ts:37`](../../packages/deployment/inventory/src/index.ts)

<a id="ctxexecutionworldrouter--executionworldrouter"></a>

### `ctx.executionWorldRouter` — `ExecutionWorldRouter`

Registry with exactly one provider for durable execution targets.

```ts cordis-catalog
/**
 * Register the deployment's target provider.
 * @param provider - Sole provider resolving durable targets.
 * @returns Disposer removing this exact provider.
 */
register(provider: ExecutionWorldRouteProvider): () => void

/**
 * Resolve one durable target through the registered provider.
 * @param runtimeContext - AgentLoop runtime Context carrying the complete capability graph.
 * @param targetId - Exact durable target id.
 * @param cwd - Control-plane working directory recorded by the session.
 * @returns Pre-construction context and pre-publication setup.
 */
route(runtimeContext: Context, targetId: ExecutionTargetId, cwd: string | undefined): ExecutionWorldRoute
```

Source: [`packages/util/execution-world/src/index.ts:49`](../../packages/util/execution-world/src/index.ts)

<a id="ctxgitworktrees--gitworktreeservice"></a>

### `ctx.gitWorktrees` — `GitWorktreeService`

Target-aware Git worktree manager that never invokes a shell or force removal.

```ts cordis-catalog
/**
 * List linked worktrees using Git's stable NUL-delimited porcelain format.
 * @param repository - Absolute POSIX path to the repository.
 * @returns Parsed worktrees in Git's order.
 */
async list(repository: string): Promise<GitWorktree[]>

/**
 * Create a linked worktree at a deterministic contained path.
 * @param request - Repository, branch, and optional starting revision.
 * @returns The created worktree after reading authoritative Git state.
 */
async create(request: CreateGitWorktree): Promise<GitWorktree>

/**
 * Remove a linked worktree without force; Git rejects main, locked, or dirty worktrees.
 * @param repository - Absolute POSIX path to the repository.
 * @param path - Exact path returned by {@link list}.
 * @returns Resolution after Git removes its directory and metadata.
 */
async remove(repository: string, path: string): Promise<void>
```

Source: [`packages/git/worktree/src/index.ts:43`](../../packages/git/worktree/src/index.ts)
<!-- END GENERATED cordis-surface -->
