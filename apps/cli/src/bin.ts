#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { DSH_CLI_IDENTITY, parseDshArgs, type CliIdentity } from './args.ts'

const SIVITACODE_HOME_ENV = 'SIVITACODE_HOME'
const SIVITACODE_PRODUCT_ENV = 'SIVITACODE_PRODUCT'
const SIVITACODE_IDENTITY: CliIdentity = {
  command: 'sivitacode',
  product: 'SivitaCode',
  homeEnvironment: SIVITACODE_HOME_ENV,
  runAlias: true,
  acpAlias: true,
}

/** Select product behavior from the dedicated entry's source-launch marker. */
function resolveIdentity(): CliIdentity {
  const sivita = process.env[SIVITACODE_PRODUCT_ENV] === '1'
  if (!sivita) return DSH_CLI_IDENTITY
  const configured = process.env[SIVITACODE_HOME_ENV]?.trim()
  process.env.DSH_HOME = configured === undefined || configured === ''
    ? join(homedir(), '.sivitacode')
    : configured
  process.env[SIVITACODE_PRODUCT_ENV] = '1'
  return SIVITACODE_IDENTITY
}

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const identity = resolveIdentity()
const invocation = parseDshArgs(process.argv.slice(2), readVersion(), identity)

switch (invocation.mode) {
  case 'profile': {
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv(identity.command),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
    })
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`${identity.command}: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
