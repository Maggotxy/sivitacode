/** Stable keyset pagination for ACP session/list. */

import type { SessionId } from '@deepseek-ai/dsh-session'

/** Default number of sessions returned by one ACP list request. */
export const ACP_SESSION_LIST_PAGE_SIZE = 50

/** Minimum session facts required by the list paginator. */
export interface ListableSession {
  header: {
    id: SessionId
    createdAt: number
  }
}

interface CursorPayload {
  version: 1
  cwd: string | null
  createdAt: number
  id: string
}

/**
 * Select a stable keyset page from newest-first session records.
 * @param records - Records sorted by descending createdAt then ascending id.
 * @param cursor - Opaque continuation from an earlier page.
 * @param cwd - Exact request filter bound into the cursor.
 * @param pageSize - Positive page capacity.
 * @returns Selected records and an opaque continuation when more remain.
 */
export function paginateSessions<T extends ListableSession>(
  records: readonly T[],
  cursor: string | null | undefined,
  cwd: string | null | undefined,
  pageSize = ACP_SESSION_LIST_PAGE_SIZE,
): { records: T[]; nextCursor?: string } {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new TypeError('session/list page size must be positive')
  const normalizedCwd = cwd ?? null
  const anchor = cursor === undefined || cursor === null ? undefined : decodeCursor(cursor, normalizedCwd)
  const eligible = anchor === undefined
    ? records
    : records.filter(record => record.header.createdAt < anchor.createdAt
      || (record.header.createdAt === anchor.createdAt && record.header.id.localeCompare(anchor.id) > 0))
  const selected = eligible.slice(0, pageSize)
  if (eligible.length <= pageSize) return { records: [...selected] }
  const last = selected.at(-1)
  if (last === undefined) throw new Error('session/list pagination selected no cursor anchor')
  return {
    records: [...selected],
    nextCursor: encodeCursor({
      version: 1,
      cwd: normalizedCwd,
      createdAt: last.header.createdAt,
      id: last.header.id,
    }),
  }
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeCursor(cursor: string, cwd: string | null): CursorPayload {
  let value: unknown
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
  } catch {
    throw new TypeError('invalid session/list cursor')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('invalid session/list cursor')
  }
  const payload = value as Partial<CursorPayload>
  if (payload.version !== 1 || payload.cwd !== cwd
    || !Number.isSafeInteger(payload.createdAt) || (payload.createdAt as number) < 0
    || typeof payload.id !== 'string' || payload.id.length === 0
    || Object.keys(value).some(key => !['version', 'cwd', 'createdAt', 'id'].includes(key))) {
    throw new TypeError('invalid session/list cursor')
  }
  return payload as CursorPayload
}
