import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AccessPermission, UserId } from '@deepseek-ai/dsh-access-control'

/** Durable deployment target id. */
export type DeploymentTargetId = Branded<'DeploymentTargetId'>
/**
 * Brand a deployment target id at an input boundary.
 * @param value - Raw durable identifier.
 * @returns Branded deployment target identifier.
 */
export const DeploymentTargetId = (value: string): DeploymentTargetId => value as DeploymentTargetId
/** Target transport. */
export type DeploymentTransport = 'local' | 'ssh' | 'container'
/** Allowed deployment environment labels. */
export type DeploymentEnvironment = 'development' | 'staging' | 'production'

/** Public non-secret target record. */
export interface DeploymentTarget {
  readonly id: DeploymentTargetId
  readonly name: string
  readonly environment: DeploymentEnvironment
  readonly transport: DeploymentTransport
  readonly host?: string
  readonly port?: number
  readonly username?: string
  readonly hostKey?: string
  readonly identityCredential?: string
  readonly containerRuntime?: 'docker' | 'podman'
  readonly containerImage?: string
  readonly containerNetwork?: 'none' | 'host'
  readonly workspace: string
  readonly enabled: boolean
  readonly labels: Readonly<Record<string, string>>
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Create request; credentials are references, never secret bytes. */
export type DeploymentTargetCreate = Omit<DeploymentTarget, 'id' | 'revision' | 'createdAt' | 'updatedAt'>
/** Update request guarded by the observed revision. */
export interface DeploymentTargetUpdate {
  readonly expectedRevision: number
  readonly value: DeploymentTargetCreate
}

/** Per-target permission ceiling assigned to one durable user. */
export interface DeploymentTargetGrant {
  readonly targetId: DeploymentTargetId
  readonly userId: UserId
  readonly permission: AccessPermission
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Revision-guarded grant replacement; omission deletes an existing grant. */
export interface DeploymentTargetGrantSet {
  readonly targetId: DeploymentTargetId
  readonly userId: UserId
  readonly permission?: AccessPermission
  readonly expectedRevision?: number
}

/** One point-in-time target connectivity result. */
export interface DeploymentTargetHealth {
  readonly targetId: DeploymentTargetId
  readonly status: 'healthy' | 'unhealthy' | 'disabled'
  readonly checkedAt: string
  readonly latencyMs: number
  readonly detail: string
}

/** One Git worktree projected from the selected execution target. */
export interface DeploymentWorktree {
  readonly path: string
  readonly head: string
  readonly branch?: string
  readonly bare: boolean
  readonly detached: boolean
  readonly locked?: string
  readonly prunable?: string
}

/** Request to create a target-owned linked Git worktree. */
export interface DeploymentWorktreeCreate {
  readonly targetId: DeploymentTargetId
  readonly branch: string
  readonly startPoint?: string
  readonly createBranch?: boolean
}

/** Durable deployment plan id. */
export type DeploymentPlanId = Branded<'DeploymentPlanId'>
/**
 * Brand a durable deployment plan id.
 * @param value - Raw durable identifier.
 * @returns Branded deployment plan identifier.
 */
export const DeploymentPlanId = (value: string): DeploymentPlanId => value as DeploymentPlanId
/** Durable deployment lifecycle. */
export type DeploymentPlanStatus = 'pending-approval' | 'ready' | 'running' | 'succeeded' | 'failed'

/** Request to create an immutable argv deployment plan. */
export interface DeploymentPlanCreate {
  readonly targetId: DeploymentTargetId
  readonly argv: readonly string[]
  readonly timeoutMs?: number
}

/** Public deployment plan and bounded execution result. */
export interface DeploymentPlan {
  readonly id: DeploymentPlanId
  readonly targetId: DeploymentTargetId
  readonly targetRevision: number
  readonly environment: DeploymentEnvironment
  readonly argv: readonly string[]
  readonly timeoutMs: number
  readonly status: DeploymentPlanStatus
  readonly createdBy: string
  readonly approvedBy?: string
  readonly createdAt: string
  readonly approvedAt?: string
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly exitCode?: number
  readonly output?: string
  readonly failure?: string
  readonly revision: number
}

/** Durable multi-target rollout id. */
export type DeploymentRolloutId = Branded<'DeploymentRolloutId'>
/**
 * Brand a durable rollout id.
 * @param value - Raw durable identifier.
 * @returns Branded deployment rollout identifier.
 */
export const DeploymentRolloutId = (value: string): DeploymentRolloutId => value as DeploymentRolloutId
/** Durable rollout lifecycle. */
export type DeploymentRolloutStatus = DeploymentPlanStatus | 'recovery-required'
/** Per-target rollout lifecycle. */
export type DeploymentRolloutTargetStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'recovery-required'
/** One persisted rollout lifecycle command phase. */
export type DeploymentRolloutPhase = 'drain' | 'deploy' | 'verify' | 'rollback' | 'restore'

/** Bounded result from one rollout lifecycle command. */
export interface DeploymentRolloutStep {
  readonly phase: DeploymentRolloutPhase
  readonly status: 'succeeded' | 'failed'
  readonly startedAt: string
  readonly finishedAt: string
  readonly exitCode?: number
  readonly output?: string
  readonly failure?: string
}

/** Request for one immutable health-gated rolling deployment. */
export interface DeploymentRolloutCreate {
  readonly targetIds: readonly DeploymentTargetId[]
  readonly argv: readonly string[]
  readonly drainArgv?: readonly string[]
  readonly verifyArgv?: readonly string[]
  readonly rollbackArgv?: readonly string[]
  readonly restoreArgv?: readonly string[]
  readonly timeoutMs?: number
  readonly batchSize?: number
}

/** Public per-target rollout result. */
export interface DeploymentRolloutTarget {
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

/** Public durable rolling deployment and bounded per-target results. */
export interface DeploymentRollout {
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
