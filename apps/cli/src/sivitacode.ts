#!/usr/bin/env node
/**
 * SivitaCode executable. The marker is set before loading the shared launcher,
 * so product identity and home resolution do not depend on symlink behavior.
 * @module @deepseek-ai/dsh/sivitacode
 */

process.env.SIVITACODE_PRODUCT = '1'
await import('./bin.ts')

export {}
