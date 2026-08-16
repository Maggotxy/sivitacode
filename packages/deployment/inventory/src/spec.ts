import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DeploymentPlanId, DeploymentRolloutId, DeploymentTargetId } from './types.ts'

/** Durable non-secret deployment target record. */
export const deploymentTargetRecord = z.object({
  name: z.string().min(1).max(128),
  environment: z.enum(['development', 'staging', 'production']),
  transport: z.enum(['local', 'ssh', 'container']),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).optional(),
  hostKey: z.string().min(1).optional(),
  identityCredential: z.string().min(1).optional(),
  containerRuntime: z.enum(['docker', 'podman']).optional(),
  containerImage: z.string().min(1).optional(),
  containerNetwork: z.enum(['none', 'host']).optional(),
  workspace: z.string().min(1),
  enabled: z.boolean(),
  labels: z.record(z.string(), z.string()),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Stored target record. */
export type DeploymentTargetRecord = z.infer<typeof deploymentTargetRecord>

/** Durable deployment plan record. */
export const deploymentPlanRecord = z.object({
  targetId: z.string().min(1), targetRevision: z.number().int().positive(),
  environment: z.enum(['development', 'staging', 'production']), argv: z.array(z.string()),
  timeoutMs: z.number().int().positive(),
  status: z.enum(['pending-approval', 'ready', 'running', 'succeeded', 'failed']),
  createdBy: z.string().min(1), approvedBy: z.string().optional(), createdAt: z.string(), approvedAt: z.string().optional(),
  startedAt: z.string().optional(), finishedAt: z.string().optional(), exitCode: z.number().int().optional(),
  output: z.string().optional(), failure: z.string().optional(), revision: z.number().int().positive(),
})
/** Stored deployment plan record. */
export type DeploymentPlanRecord = z.infer<typeof deploymentPlanRecord>

/** Durable per-target rollout record. */
export const deploymentRolloutTargetRecord = z.object({
  targetId: z.string().min(1), targetRevision: z.number().int().positive(),
  environment: z.enum(['development', 'staging', 'production']),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'recovery-required']),
  startedAt: z.string().optional(), finishedAt: z.string().optional(), exitCode: z.number().int().optional(),
  output: z.string().optional(), failure: z.string().optional(),
  steps: z.array(z.object({
    phase: z.enum(['drain', 'deploy', 'verify', 'rollback', 'restore']), status: z.enum(['succeeded', 'failed']),
    startedAt: z.string(), finishedAt: z.string(), exitCode: z.number().int().optional(),
    output: z.string().optional(), failure: z.string().optional(),
  })),
})

/** Durable multi-target rollout record. */
export const deploymentRolloutRecord = z.object({
  targets: z.array(deploymentRolloutTargetRecord).min(2).max(64), argv: z.array(z.string()),
  drainArgv: z.array(z.string()).optional(), verifyArgv: z.array(z.string()).optional(),
  rollbackArgv: z.array(z.string()).optional(), restoreArgv: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive(), batchSize: z.number().int().min(1).max(16),
  status: z.enum(['pending-approval', 'ready', 'running', 'succeeded', 'failed', 'recovery-required']),
  createdBy: z.string().min(1), approvedBy: z.string().optional(), createdAt: z.string(), approvedAt: z.string().optional(),
  startedAt: z.string().optional(), finishedAt: z.string().optional(), revision: z.number().int().positive(),
})
/** Stored rollout record. */
export type DeploymentRolloutRecord = z.infer<typeof deploymentRolloutRecord>

/** Durable per-target user grant. */
export const deploymentTargetGrantRecord = z.object({
  targetId: z.string().min(1),
  userId: z.string().min(1),
  permission: z.enum(['read', 'operate', 'configure', 'administer']),
  revision: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
/** Stored target grant record. */
export type DeploymentTargetGrantRecord = z.infer<typeof deploymentTargetGrantRecord>

/** Versioned deployment inventory domain. */
export const deploymentInventoryDomain = defineDomain({
  name: 'deployment_inventory',
  version: 6,
  tables: {
    targets: domainTable<DeploymentTargetId, DeploymentTargetRecord>(deploymentTargetRecord),
    plans: domainTable<DeploymentPlanId, DeploymentPlanRecord>(deploymentPlanRecord),
    rollouts: domainTable<DeploymentRolloutId, DeploymentRolloutRecord>(deploymentRolloutRecord),
    grants: domainTable<string, DeploymentTargetGrantRecord>(deploymentTargetGrantRecord),
  },
})
