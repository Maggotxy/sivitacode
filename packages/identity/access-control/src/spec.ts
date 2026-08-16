/** Durable access-control domain declaration. @module @deepseek-ai/dsh-access-control/src/spec */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { AccessRole, AccessSessionId, UserId } from './types.ts'

const roleSchema = z.enum(['admin', 'operator', 'developer', 'viewer'])

/** Durable user record schema. */
export const accessUserRecordSchema = z.object({
  username: z.string().min(1),
  passwordHash: z.string().min(1),
  roles: z.array(roleSchema).min(1),
  disabled: z.boolean(),
  sessionVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** Durable user record. */
export type AccessUserRecord = z.infer<typeof accessUserRecordSchema> & { roles: AccessRole[] }

/** Durable server-side session schema. */
export const accessSessionRecordSchema = z.object({
  userId: z.string(),
  tokenHash: z.string().length(64),
  sessionVersion: z.number().int().nonnegative(),
  createdAt: z.string(),
  touchedAt: z.string(),
  expiresAt: z.string(),
})

/** Durable server-side session. */
export type AccessSessionRecord = z.infer<typeof accessSessionRecordSchema>

/** Durable audit entry schema. */
export const accessAuditRecordSchema = z.object({
  id: z.string(),
  at: z.string(),
  action: z.string(),
  outcome: z.enum(['success', 'failure', 'denied']),
  actorUserId: z.string().optional(),
  subjectUserId: z.string().optional(),
  clientAddress: z.string().optional(),
  detail: z.string().optional(),
})

/** Versioned access-control domain. */
export const accessControlDomainSpec = defineDomain({
  name: 'access_control',
  version: 1,
  tables: {
    users: domainTable<UserId, AccessUserRecord>(accessUserRecordSchema),
    sessions: domainTable<AccessSessionId, AccessSessionRecord>(accessSessionRecordSchema),
    audit: domainTable<string, z.infer<typeof accessAuditRecordSchema>>(accessAuditRecordSchema),
  },
})
