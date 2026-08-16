import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { CallId } from '@deepseek-ai/dsh-llm'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-access-control'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-deployment-inventory'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'

const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH = join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
const runtime = process.env.SIVITACODE_OCI_E2E_RUNTIME
const image = process.env.SIVITACODE_OCI_E2E_IMAGE
const immutableImage = image !== undefined && (image.includes('@sha256:') || image.startsWith('sha256:'))
const live = runtime === 'podman' && immutableImage ? describe : describe.skip

async function bootWeb(home: string): Promise<Context> {
  const settingsFile = join(home, 'settings.yaml')
  await writeFile(settingsFile, '{}\n')
  const patches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', WEB_PATCH),
    { id: 'settings', config: { path: settingsFile, watch: false } },
    { id: 'storage-sqlite', config: { path: join(home, 'sivitacode.db'), journalMode: 'wal' } },
    {
      id: 'access-control', disabled: false,
      config: {
        bootstrapUsername: 'admin', bootstrapPassword: 'correct horse battery staple',
        idleTimeoutMinutes: 60, absoluteTimeoutHours: 24,
      },
    },
    { id: 'deployment-inventory', disabled: false },
    { id: 'webserver', disabled: true },
    { id: 'web-runtime', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    { id: 'modules', disabled: true },
    { id: 'connection', disabled: true },
    { id: 'client-hmr', disabled: true },
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    {
      id: 'agent-presets',
      config: {
        default: 'standard', roots: [{ path: join(CONFIG_DIR, 'agent-presets'), trust: 'system' }],
        includeUserRoot: false,
      },
    },
  ]
  healProfilesModuleFallback(INSTALL_ANCHOR, home)
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  return await boot('dsh-test', rootConfig, patches, (ctx) => {
    provideCmdline(ctx, { args: [], exit: () => {} })
  })
}

live('the shipped Web preset on a real Inventory container', () => {
  it('keeps read, Bash, search, skills, and stdio MCP inside the selected execution world', async () => {
    const home = await mkdtemp(join(tmpdir(), 'sivitacode-web-target-home-'))
    const workspace = await mkdtemp(join(tmpdir(), 'sivitacode-web-target-workspace-'))
    await writeFile(join(workspace, 'proof.txt'), 'target-only-proof\n')
    await mkdir(join(workspace, '.agents', 'skills', 'target-proof'), { recursive: true })
    await writeFile(join(workspace, '.agents', 'skills', 'target-proof', 'SKILL.md'), [
      '---', 'name: target-proof', 'description: Skill stored in the selected execution target.', '---', '',
      'Target skill body.', '',
    ].join('\n'))
    await writeFile(join(workspace, 'mcp_server.py'), [
      'import json, socket, sys',
      'for line in sys.stdin:',
      '    request = json.loads(line)',
      '    if "id" not in request:',
      '        continue',
      '    method = request.get("method")',
      '    if method == "initialize":',
      '        result = {"protocolVersion": request.get("params", {}).get("protocolVersion", "2025-11-25"), "capabilities": {"tools": {}}, "serverInfo": {"name": "web-target-proof", "version": "1"}}',
      '    elif method == "tools/list":',
      '        result = {"tools": [{"name": "hostname", "description": "Return the MCP server hostname.", "inputSchema": {"type": "object", "additionalProperties": False}}]}',
      '    elif method == "tools/call":',
      '        result = {"content": [{"type": "text", "text": socket.gethostname()}]}',
      '    else:',
      '        result = {}',
      '    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)',
      '',
    ].join('\n'))

    const ctx = await bootWeb(home)
    try {
      const login = await ctx.accessControl.login('admin', 'correct horse battery staple')
      const target = await ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.create({
        name: 'web-standard-oci', environment: 'development', transport: 'container',
        containerRuntime: 'podman', containerImage: image!, containerNetwork: 'none',
        workspace, enabled: true, labels: { evidence: 'web-preset-live' },
      }))
      const handle = await ctx.accessControl.runAs(login.actor, () => ctx.agents.create({
        sessionId: SessionId('web-standard-oci-live'),
        meta: { cwd: workspace, executionTarget: target.id as never, agentPreset: 'standard' },
        setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
      }))
      try {
        const execute = async (name: string, args: unknown) => await ctx.tools.execute({
          callId: CallId(`web-target-${name}`), name, arguments: args,
          signal: new AbortController().signal, agent: handle.agent,
        })

        const read = await execute('read', { file_path: 'proof.txt' })
        expect(read.isError).toBe(false)
        expect(JSON.stringify(read.content)).toContain('target-only-proof')

        const bash = await execute('bash', {
          command: 'python3 -c "import socket;print(socket.gethostname(), end=\'\')"',
          description: 'Print selected target hostname',
        })
        expect(bash.isError).toBe(false)
        const bashBlock = bash.content[0]
        if (bashBlock?.type !== 'text') throw new Error('Bash hostname proof returned no text')
        const targetHostname = bashBlock.text.split('\n')[0]
        if (targetHostname === undefined || targetHostname.length === 0) throw new Error('Bash hostname proof returned an empty hostname')
        expect(targetHostname).not.toBe(hostname())

        const grep = await execute('grep', { pattern: 'target-only-proof', path: workspace })
        expect(grep.isError).toBe(false)
        expect(JSON.stringify(grep.content)).toContain('target-only-proof')

        const skills = await ctx.skills.list({ cwd: workspace, scope: handle.agent })
        expect(skills.map(skill => skill.name)).toContain('target-proof')

        const mcpFiber = await handle.agent.ctx.plugin(McpClient, {
          transport: 'stdio', serverName: 'target', command: 'python3', args: [join(workspace, 'mcp_server.py')],
          env: {}, cwd: workspace, shutdownGraceMs: 1_000, toolCallTimeoutMs: 5_000,
          failOnStartupError: true, reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 1 },
        }).await()
        try {
          const mcp = await execute('mcp__target__hostname', {})
          expect(mcp.isError).toBe(false)
          expect(JSON.stringify(mcp.content)).toContain(targetHostname)
        } finally {
          await mcpFiber.dispose()
        }
      } finally {
        await handle.dispose()
      }
    } finally {
      await ctx.fiber.dispose()
      await rm(home, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  }, 300_000)
})
