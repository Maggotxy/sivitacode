import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import AccessControl from '@deepseek-ai/dsh-access-control'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import CredentialProvider from '@deepseek-ai/dsh-credentials'
import ExecutionWorldRouter from '@deepseek-ai/dsh-execution-world'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import * as ToolFsSearch from '@deepseek-ai/dsh-tool-fs-search'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import Inventory from '../src/index.ts'

const execute = promisify(execFile)
const runtime = process.env.SIVITACODE_OCI_E2E_RUNTIME
const image = process.env.SIVITACODE_OCI_E2E_IMAGE
const immutableImage = image !== undefined && (image.includes('@sha256:') || image.startsWith('sha256:'))
const enabled = runtime === 'podman' && immutableImage
const live = enabled ? describe : describe.skip
let workspace: string | undefined

afterEach(async () => {
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  workspace = undefined
})

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(AccessControl, {
    bootstrapUsername: 'admin', bootstrapPassword: 'correct horse battery staple',
    idleTimeoutMinutes: 60, absoluteTimeoutHours: 24,
  })
  class Credentials extends CredentialProvider {
    async resolve() { return undefined }
    async describe() { return { configured: false, source: 'test', writable: false } }
    async set() { throw new Error('read only') }
    async unset() { throw new Error('read only') }
  }
  new Credentials(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(ExecutionWorldRouter)
  await ctx.plugin(Inventory)
  await ctx.plugin(AgentLoop, { agents: [] })
  return ctx
}

live('Inventory rootless OCI integration', () => {
  it('creates an Agent whose files, managed processes, and PTY share the selected container', async () => {
    const targetWorkspace = await mkdtemp(join(tmpdir(), 'sivitacode-inventory-oci-live-'))
    workspace = targetWorkspace
    await writeFile(join(targetWorkspace, 'input.txt'), 'inventory-to-agent\n')
    await writeFile(join(targetWorkspace, 'mcp_server.py'), [
      'import json, socket, sys',
      'for line in sys.stdin:',
      '    request = json.loads(line)',
      '    if "id" not in request:',
      '        continue',
      '    method = request.get("method")',
      '    if method == "initialize":',
      '        result = {"protocolVersion": request.get("params", {}).get("protocolVersion", "2025-11-25"), "capabilities": {"tools": {}}, "serverInfo": {"name": "oci-proof", "version": "1"}}',
      '    elif method == "tools/list":',
      '        result = {"tools": [{"name": "hostname", "description": "Return the MCP server hostname.", "inputSchema": {"type": "object", "additionalProperties": False}}]}',
      '    elif method == "tools/call":',
      '        result = {"content": [{"type": "text", "text": socket.gethostname()}]}',
      '    else:',
      '        result = {}',
      '    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)',
      '',
    ].join('\n'))
    const ctx = await harness()
    let containerName: string | undefined
    try {
      const login = await ctx.accessControl.login('admin', 'correct horse battery staple')
      const target = await ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.create({
        name: 'real-container', environment: 'development', transport: 'container',
        containerRuntime: 'podman', containerImage: image!, containerNetwork: 'none',
        workspace: targetWorkspace, enabled: true, labels: { evidence: 'live-e2e' },
      }))
      await expect(ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.checkHealth(target.id)))
        .resolves.toMatchObject({ status: 'healthy' })

      const handle = await ctx.accessControl.runAs(login.actor, () => ctx.agents.create({
        sessionId: SessionId('inventory-container-live'),
        meta: { cwd: targetWorkspace, executionTarget: target.id as never },
      }))
      const world = handle.agent.ctx.fs.executionWorld
      expect(handle.agent.ctx.subprocess.executionWorld).toBe(world)
      containerName = world.label.split(':').at(-1)
      if (containerName === undefined) throw new Error('routed OCI world did not expose its owned container name')

      const input = await handle.agent.ctx.fs.resolve('input.txt', { cwd: targetWorkspace })
      expect(await handle.agent.ctx.fs.readText(input)).toBe('inventory-to-agent\n')
      const output = await handle.agent.ctx.fs.resolve('output.txt', { cwd: targetWorkspace })
      await handle.agent.ctx.fs.writeText(output, 'written-by-agent-container\n', { kind: 'createIfAbsent' })

      const process = handle.agent.ctx.subprocess.spawn({
        argv: ['python3', '-c', 'import pathlib,sys;sys.stdout.write(pathlib.Path("output.txt").read_text())'],
        cwd: targetWorkspace, env: {}, graceMs: 1_000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1_024 }, stderr: { maxBytes: 1_024 } },
      })
      await expect(process.done).resolves.toEqual({ exitCode: 0, signal: null })
      expect(process.collected.stdout?.readFrom(0).text).toBe('written-by-agent-container\n')

      const shell = await handle.agent.ctx.shell.run(handle.agent.ctx.shell.resolve({
        command: 'printf routed-agent-shell', workdir: targetWorkspace,
      }))
      expect(shell).toMatchObject({ exitCode: 0 })
      expect(shell.stdout.text).toBe('routed-agent-shell')

      const searchFiber = await handle.agent.ctx.plugin(ToolFsSearch, { sampleOverCapGlobResults: false }).await()
      const search = await ctx.tools.execute({
        callId: CallId('inventory-container-grep'), name: 'grep',
        arguments: { pattern: 'inventory-to-agent', path: targetWorkspace },
        signal: new AbortController().signal, agent: handle.agent,
      })
      expect(search.isError).toBe(false)
      expect(JSON.stringify(search.content)).toContain('inventory-to-agent')

      const hostnameProcess = handle.agent.ctx.subprocess.spawn({
        argv: ['python3', '-c', 'import socket;print(socket.gethostname(), end="")'],
        cwd: targetWorkspace, env: {}, graceMs: 1_000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1_024 }, stderr: { maxBytes: 1_024 } },
      })
      await expect(hostnameProcess.done).resolves.toEqual({ exitCode: 0, signal: null })
      const targetHostname = hostnameProcess.collected.stdout?.readFrom(0).text
      expect(targetHostname).toBeDefined()
      expect(targetHostname).not.toBe(hostname())

      const mcpFiber = await handle.agent.ctx.plugin(McpClient, {
        transport: 'stdio', serverName: 'oci', command: 'python3', args: [join(targetWorkspace, 'mcp_server.py')],
        env: {}, cwd: targetWorkspace, shutdownGraceMs: 1_000, toolCallTimeoutMs: 5_000,
        failOnStartupError: true, reconnect: { enabled: false, initialDelayMs: 10, maxDelayMs: 10, maxAttempts: 1 },
      }).await()
      const mcpResult = await ctx.tools.execute({
        callId: CallId('inventory-container-mcp'), name: 'mcp__oci__hostname', arguments: {},
        signal: new AbortController().signal, agent: handle.agent,
      })
      expect(mcpResult.isError).toBe(false)
      expect(JSON.stringify(mcpResult.content)).toContain(targetHostname)

      const repository = await handle.agent.ctx.shell.run(handle.agent.ctx.shell.resolve({
        command: 'git init -b main && git config user.email test@example.com && git config user.name "SivitaCode Test" && git add input.txt && git commit -m initial',
        workdir: targetWorkspace,
      }))
      expect(repository).toMatchObject({ exitCode: 0 })
      const createdWorktree = await ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.createWorktree({
        targetId: target.id, branch: 'feature/oci-live', createBranch: true,
      }))
      expect(createdWorktree).toMatchObject({ branch: 'feature/oci-live' })
      expect(await ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.listWorktrees(target.id)))
        .toEqual(expect.arrayContaining([expect.objectContaining({ path: createdWorktree.path })]))
      await ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.removeWorktree(target.id, createdWorktree.path))

      const terminal = await handle.agent.ctx.subprocess.spawnTerminal({
        argv: ['python3', '-c', 'print("inventory-agent-pty", flush=True)'],
        cwd: targetWorkspace, env: {}, rows: 24, cols: 80, graceMs: 1_000,
      })
      let terminalOutput = ''
      terminal.output.setEncoding('utf8')
      terminal.output.on('data', (chunk) => { terminalOutput += String(chunk) })
      await expect(terminal.done).resolves.toMatchObject({ exitCode: 0 })
      expect(terminalOutput).toContain('inventory-agent-pty')

      const plan = await ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.createPlan({
        targetId: target.id, argv: ['python3', '-c', 'print("inventory-container-plan", end="")'],
      }))
      await expect(ctx.accessControl.runAs(login.actor, () => ctx.deploymentInventory.executePlan(plan.id, plan.revision)))
        .resolves.toMatchObject({ status: 'succeeded', output: 'inventory-container-plan' })

      await mcpFiber.dispose()
      await searchFiber.dispose()
      await handle.dispose()
      await expect(execute('podman', ['container', 'exists', containerName])).rejects.toMatchObject({ code: 1 })
    } finally {
      await ctx.fiber.dispose()
      if (containerName !== undefined) {
        await expect(execute('podman', ['container', 'exists', containerName])).rejects.toMatchObject({ code: 1 })
      }
    }
  }, 240_000)
})
