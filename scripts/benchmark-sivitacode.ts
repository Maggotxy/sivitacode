/** Reproducible built-product latency and keyless agent-acceptance benchmark. */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { hostname, platform, release, arch } from 'node:os'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

export interface Distribution {
  readonly samplesMs: readonly number[]
  readonly minMs: number
  readonly medianMs: number
  readonly p95Ms: number
  readonly maxMs: number
}

export interface BenchmarkScenarioResult extends Distribution {
  readonly id: string
  readonly command: readonly string[]
}

export interface BenchmarkReport {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly environment: {
    readonly node: string
    readonly platform: string
    readonly release: string
    readonly arch: string
    readonly hostname: string
  }
  readonly warmup: number
  readonly samples: number
  readonly scenarios: readonly BenchmarkScenarioResult[]
  readonly acceptance: { readonly id: 'keyless-agent-tool-roundtrip'; readonly passed: true; readonly durationMs: number }
}

export interface BenchmarkOptions {
  readonly samples: number
  readonly warmup: number
  readonly output?: string
  readonly baseline?: string
  readonly maxRegressionPercent?: number
}

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const builtBin = resolve(repoRoot, 'apps/cli/lib/sivitacode.js')
const scenarios: ReadonlyArray<{ id: string; argv: readonly string[] }> = [
  { id: 'product-version', argv: [process.execPath, builtBin, '--version'] },
  { id: 'headless-help', argv: [process.execPath, builtBin, '--profile', 'headless', '--help'] },
  { id: 'web-default-config', argv: [process.execPath, builtBin, '--profile', 'web', '--dump-default-config'] },
]

/**
 * Compute interpolation-free nearest-rank latency statistics.
 * @param samplesMs - Non-empty finite millisecond observations.
 * @returns Sorted samples and min, median, p95, and max values.
 */
export function distribution(samplesMs: readonly number[]): Distribution {
  if (samplesMs.length === 0 || samplesMs.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('benchmark samples must be non-empty finite non-negative numbers')
  }
  const sorted = [...samplesMs].sort((left, right) => left - right)
  const rank = (quantile: number): number => required(sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)])
  return { samplesMs: sorted, minMs: required(sorted[0]), medianMs: rank(0.5), p95Ms: rank(0.95), maxMs: required(sorted.at(-1)) }
}

/**
 * Reject scenario regressions against a prior report.
 * @param report - Current benchmark report.
 * @param baseline - Prior report with matching scenario identifiers.
 * @param maxRegressionPercent - Maximum permitted median increase.
 */
export function assertRegressionBudget(report: BenchmarkReport, baseline: BenchmarkReport, maxRegressionPercent: number): void {
  if (!Number.isFinite(maxRegressionPercent) || maxRegressionPercent < 0) throw new Error('max regression percent must be non-negative')
  const previous = new Map(baseline.scenarios.map(scenario => [scenario.id, scenario]))
  const failures: string[] = []
  for (const current of report.scenarios) {
    const reference = previous.get(current.id)
    if (reference === undefined) throw new Error(`baseline is missing scenario ${current.id}`)
    const increase = reference.medianMs === 0
      ? current.medianMs === 0 ? 0 : Number.POSITIVE_INFINITY
      : (current.medianMs - reference.medianMs) / reference.medianMs * 100
    if (increase > maxRegressionPercent) failures.push(`${current.id}: ${increase.toFixed(1)}%`)
  }
  if (failures.length > 0) throw new Error(`benchmark median regression exceeds ${String(maxRegressionPercent)}%: ${failures.join(', ')}`)
}

async function runCommand(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const started = performance.now()
  const command = required(argv[0])
  const child = spawn(command, argv.slice(1), { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let diagnostic = ''
  child.stderr.on('data', (chunk) => { diagnostic = (diagnostic + String(chunk)).slice(-8_192) })
  const code = await new Promise<number | null>((resolveCode, reject) => {
    child.once('error', reject)
    child.once('close', resolveCode)
  })
  if (code !== 0) throw new Error(`${argv.join(' ')} exited ${String(code)}: ${diagnostic.trim()}`)
  return performance.now() - started
}

async function benchmark(options: BenchmarkOptions): Promise<BenchmarkReport> {
  const results: BenchmarkScenarioResult[] = []
  for (const scenario of scenarios) {
    for (let index = 0; index < options.warmup; index++) await runCommand(scenario.argv)
    const samplesMs: number[] = []
    for (let index = 0; index < options.samples; index++) samplesMs.push(await runCommand(scenario.argv))
    results.push({ id: scenario.id, command: scenario.argv, ...distribution(samplesMs) })
  }
  const acceptanceArgv = [
    resolve(repoRoot, 'node_modules/.bin/vitest'), 'run', '--config', 'vitest.e2e.config.ts',
    'examples/headless-agent/tests/keyless-smoke.e2e.ts',
  ]
  const acceptanceMs = await runCommand(acceptanceArgv, { ...process.env, DSH_EXAMPLE_MODE: 'lib', DSH_TELEMETRY_DISABLED: '1' })
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: platform(), release: release(), arch: arch(), hostname: hostname() },
    warmup: options.warmup, samples: options.samples, scenarios: results,
    acceptance: { id: 'keyless-agent-tool-roundtrip', passed: true, durationMs: acceptanceMs },
  }
}

/**
 * Parse benchmark command options.
 * @param argv - Arguments after the script name.
 * @returns Validated benchmark options.
 */
export function parseOptions(argv: readonly string[]): BenchmarkOptions {
  let samples = 7; let warmup = 2
  let output: string | undefined; let baseline: string | undefined; let maxRegressionPercent: number | undefined
  for (let index = 0; index < argv.length; index++) {
    const option = required(argv[index])
    const value = argv[++index]
    if (value === undefined) throw new Error(`${option} requires a value`)
    if (option === '--samples') samples = positiveInteger(value, option)
    else if (option === '--warmup') warmup = nonNegativeInteger(value, option)
    else if (option === '--output') output = resolve(value)
    else if (option === '--baseline') baseline = resolve(value)
    else if (option === '--max-regression-percent') maxRegressionPercent = nonNegativeNumber(value, option)
    else throw new Error(`unknown benchmark option ${option}`)
  }
  if ((baseline === undefined) !== (maxRegressionPercent === undefined)) {
    throw new Error('--baseline and --max-regression-percent must be supplied together')
  }
  return {
    samples, warmup,
    ...output === undefined ? {} : { output },
    ...baseline === undefined ? {} : { baseline },
    ...maxRegressionPercent === undefined ? {} : { maxRegressionPercent },
  }
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('benchmark internal value is missing')
  return value
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer`)
  return parsed
}

function nonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative integer`)
  return parsed
}

function nonNegativeNumber(value: string, option: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${option} must be a non-negative number`)
  return parsed
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const report = await benchmark(options)
  if (options.baseline !== undefined && options.maxRegressionPercent !== undefined) {
    assertRegressionBudget(report, JSON.parse(await readFile(options.baseline, 'utf8')) as BenchmarkReport, options.maxRegressionPercent)
  }
  const serialized = `${JSON.stringify(report, undefined, 2)}\n`
  if (options.output === undefined) process.stdout.write(serialized)
  else { await mkdir(dirname(options.output), { recursive: true }); await writeFile(options.output, serialized) }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 })
}
