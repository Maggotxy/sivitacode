import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

function context(fsWorld: object, subprocessWorld: object): Context {
  return {
    fs: { executionWorld: fsWorld },
    subprocess: { executionWorld: subprocessWorld },
  } as unknown as Context
}

describe('execution-world coherence', () => {
  it('accepts the same opaque provider identity', () => {
    const world = Object.freeze({ label: 'one-world' })
    expect(() => { apply(context(world, world)) }).not.toThrow()
  })

  it('rejects distinct identities even when labels match', () => {
    const fsWorld = Object.freeze({ label: 'remote' })
    const subprocessWorld = Object.freeze({ label: 'remote' })
    expect(() => { apply(context(fsWorld, subprocessWorld)) }).toThrow(
      /filesystem \(remote\) and subprocess \(remote\) providers do not share one environment/,
    )
  })
})
