import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { paginateSessions } from '../src/list-pagination.ts'

function record(id: string, createdAt: number) {
  return { header: { id: SessionId(id), createdAt } }
}

describe('ACP session/list keyset pagination', () => {
  it('continues without duplicates when newer records appear between pages', () => {
    const firstCorpus = [record('new', 30), record('same-a', 20), record('same-b', 20), record('old', 10)]
    const first = paginateSessions(firstCorpus, undefined, '/work', 2)
    expect(first.records.map(item => item.header.id)).toEqual(['new', 'same-a'])
    expect(first.nextCursor).toBeTypeOf('string')

    const changedCorpus = [record('newer', 40), ...firstCorpus]
    const second = paginateSessions(changedCorpus, first.nextCursor, '/work', 2)
    expect(second.records.map(item => item.header.id)).toEqual(['same-b', 'old'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('continues after a deleted anchor and binds cursors to the cwd filter', () => {
    const first = paginateSessions([record('a', 3), record('b', 2), record('c', 1)], undefined, null, 2)
    const withoutAnchor = [record('a', 3), record('c', 1)]
    expect(paginateSessions(withoutAnchor, first.nextCursor, null, 2).records.map(item => item.header.id))
      .toEqual(['c'])
    expect(() => paginateSessions(withoutAnchor, first.nextCursor, '/different', 2))
      .toThrow(/invalid session\/list cursor/)
  })

  it('rejects malformed cursors and invalid page sizes', () => {
    expect(() => paginateSessions([], 'not-json', null)).toThrow(/invalid session\/list cursor/)
    expect(() => paginateSessions([], Buffer.from('null').toString('base64url'), null))
      .toThrow(/invalid session\/list cursor/)
    expect(() => paginateSessions([], undefined, null, 0)).toThrow(/page size must be positive/)
  })
})
