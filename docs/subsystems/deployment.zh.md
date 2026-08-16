# 部署

[English](deployment.md) | 中文

[`dsh-deployment-inventory`](../../packages/deployment/inventory/README.md) 负责持久非秘密目标注册表。它依赖 [`access-control`](access-control.md) 提供请求 actor、全局角色权限上限、逐目标权限授权和共享安全审计。管理员保留对所有目标的恢复访问权；其他用户只能在其全局角色权限上限内查看和操作被明确授权的目标。私钥和密码留在凭据提供方中；Inventory 记录只包含可选凭据引用。

该服务对目标和授权应用乐观 revision。每项目标操作都会按精确标识符重新鉴权，包括执行世界路由、部署 plan 和 rollout。SSH 目标携带经独立验证的精确主机密钥和绝对 POSIX workspace。健康操作只为精确主机密钥固定连接解析可选私钥凭据，并返回脱敏结果。无根 Docker 或 Podman 目标挂载同一个文件系统与子进程能力世界，并默认禁用网络。持久 plan 会捕获目标 revision 与字面 argv；生产环境要求双人审批后才允许一次性本地、固定 SSH 或无根容器执行。持久 rollout 会固定有序多目标 revision 集合、逐成员健康检查、执行有界批次，并在任一失败后阻止下一批启动。定时触发仍由独立消费方负责。

## 滚动发布记录

滚动发布在创建时记录目标顺序及其已观察 revision。每个可选生命周期命令都是 argv 数组：摘流、部署、验证、回滚和恢复流量。部署或验证失败会尝试回滚；成功摘流后始终尝试恢复流量；所有尚未启动的目标被标记为 skipped，且 rollout 不可再次执行。恢复流量失败，或控制平面在摘流后重启，会让 rollout 进入 `recovery-required`；操作员只能重试已存储的恢复命令。

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
