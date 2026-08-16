import { describe, expect, it } from 'vitest'
import { assertRegressionBudget, distribution, parseOptions, type BenchmarkReport } from './benchmark-sivitacode.ts'

function report(medianMs: number): BenchmarkReport {
  return {
    schemaVersion: 1, generatedAt: '2026-08-14T00:00:00.000Z',
    environment: { node: 'v24', platform: 'linux', release: 'test', arch: 'x64', hostname: 'test' },
    warmup: 0, samples: 1,
    scenarios: [{ id: 'one', command: ['one'], samplesMs: [medianMs], minMs: medianMs, medianMs, p95Ms: medianMs, maxMs: medianMs }],
    acceptance: { id: 'keyless-agent-tool-roundtrip', passed: true, durationMs: 1 },
  }
}

describe('SivitaCode benchmark', () => {
  it('computes nearest-rank statistics without mutating observations', () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5]
    expect(distribution(values)).toMatchObject({ minMs: 1, medianMs: 5, p95Ms: 10, maxMs: 10 })
    expect(values).toEqual([10, 1, 9, 2, 8, 3, 7, 4, 6, 5])
  })

  it('validates options and paired baseline controls', () => {
    expect(parseOptions(['--samples', '3', '--warmup', '0'])).toMatchObject({ samples: 3, warmup: 0 })
    expect(() => parseOptions(['--samples', '0'])).toThrow('positive integer')
    expect(() => parseOptions(['--baseline', 'old.json'])).toThrow('must be supplied together')
  })

  it('rejects only median regressions above the selected budget', () => {
    expect(() => { assertRegressionBudget(report(109), report(100), 10) }).not.toThrow()
    expect(() => { assertRegressionBudget(report(111), report(100), 10) }).toThrow('one: 11.0%')
  })
})
