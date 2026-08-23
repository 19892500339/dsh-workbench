/**
 * MCP server management for the workbench.
 *
 * V1: the panel CRUDs server entries (persisted in settings) and runs a
 * connection test per server — an initialize handshake plus tools/list.
 *
 * V2: `connectMcpServer` additionally registers the server's tools onto
 * `ctx.tools` under the `wb_mcp__<serverId>__<rawName>` namespace (distinct
 * from the official `mcp__…` bridge, so both can coexist). The registration
 * is effect-scoped: the returned disposer disconnects and unregisters.
 *
 * The SDK is a declared dependency (@modelcontextprotocol/sdk, MIT). All code
 * here is original; the JSON-Schema → parameter-spec adapter is a small
 * original mapper (complex shapes degrade to `json`).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { McpServerConfig, McpTestResult } from './shared/types.js'

/** One connection attempt, always closed before returning. */
export async function testMcpServer(server: McpServerConfig): Promise<McpTestResult> {
  const client = new Client(
    { name: 'dsh-workbench', version: '0.1.0' },
    { capabilities: {} },
  )
  try {
    if (server.transport === 'stdio') {
      const command = server.command?.trim()
      if (!command) return { ok: false, transport: 'stdio', error: 'stdio 服务器缺少 command' }
      const transport = new StdioClientTransport({
        command,
        args: server.args ?? [],
        env: server.env && Object.keys(server.env).length > 0
          ? { ...(process.env as Record<string, string>), ...server.env }
          : undefined,
      })
      await client.connect(transport)
    } else {
      const raw = server.url?.trim()
      if (!raw) return { ok: false, transport: 'http', error: 'http 服务器缺少 url' }
      const url = new URL(raw)
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: {
          headers: server.headers && Object.keys(server.headers).length > 0 ? server.headers : undefined,
        },
      })
      await client.connect(transport)
    }
    const tools = await client.listTools()
    return {
      ok: true,
      transport: server.transport,
      tools: tools.tools.map((t) => t.name),
    }
  } catch (error) {
    return {
      ok: false,
      transport: server.transport,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await client.close().catch(() => undefined)
  }
}

/** A short stable slug for a new server entry. */
export function makeServerId(name: string): string {
  const base = name
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'server'}-${Date.now().toString(36)}`
}

/** Minimal tool-registry face needed to register proxy tools. */
export interface ToolRegistryLike {
  register(definition: unknown): () => void
}

/** Result of a V2 auto-registration attempt. */
export interface ConnectMcpResult {
  ok: boolean
  /** Registered public tool names. */
  tools: string[]
  error?: string
}

/** Public tool name prefix (distinct from the official `mcp__` bridge). */
export function mcpToolName(serverId: string, rawName: string): string {
  const safeRaw = rawName.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `wb_mcp__${serverId}__${safeRaw}`
}

/**
 * Connect one server and register its tools on the registry. The returned
 * disposer closes the client and unregisters every tool.
 */
export async function connectMcpServer(
  server: McpServerConfig,
  registry: ToolRegistryLike,
): Promise<{ disposer: () => void; result: ConnectMcpResult }> {
  const client = new Client({ name: 'dsh-workbench', version: '0.2.0' }, { capabilities: {} })
  const disposers: Array<() => void> = []
  const registered: string[] = []
  const failures: string[] = []
  try {
    if (server.transport === 'stdio') {
      const command = server.command?.trim()
      if (!command) throw new Error('stdio 服务器缺少 command')
      await client.connect(
        new StdioClientTransport({
          command,
          args: server.args ?? [],
          env: server.env && Object.keys(server.env).length > 0 ? { ...(process.env as Record<string, string>), ...server.env } : undefined,
        }),
      )
    } else {
      const raw = server.url?.trim()
      if (!raw) throw new Error('http 服务器缺少 url')
      await client.connect(
        new StreamableHTTPClientTransport(new URL(raw), {
          requestInit: { headers: server.headers && Object.keys(server.headers).length > 0 ? server.headers : undefined },
        }),
      )
    }
    const { tools } = await client.listTools()
    for (const tool of tools) {
      const publicName = mcpToolName(server.id, tool.name)
      try {
        const rawName = tool.name
        disposers.push(
          registry.register(
            defineTool({
              name: publicName,
              description: tool.description || `MCP 工具 (${server.name}: ${rawName})`,
              parameters: toParameterSpec(tool.inputSchema),
              output: {
                schema: { type: 'json' },
                render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
              },
              async execute(args) {
                const call = await client.callTool({ name: rawName, arguments: args as Record<string, unknown> })
                return extractMcpContent(call)
              },
            }),
          ),
        )
        registered.push(publicName)
      } catch (error) {
        failures.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return {
      disposer: () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // best-effort unregister
          }
        }
        void client.close().catch(() => undefined)
      },
      result: { ok: true, tools: registered, ...(failures.length > 0 ? { error: `部分工具注册失败: ${failures.join('; ')}` } : {}) },
    }
  } catch (error) {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // best-effort unregister
      }
    }
    void client.close().catch(() => undefined)
    return {
      disposer: () => undefined,
      result: { ok: false, tools: [], error: error instanceof Error ? error.message : String(error) },
    }
  }
}

/** Map an MCP JSON-Schema input schema to the dsh-tools parameter spec. */
function toParameterSpec(inputSchema: unknown): ParameterSchemaSpec {
  if (typeof inputSchema !== 'object' || inputSchema === null) return {}
  const schema = inputSchema as { properties?: Record<string, unknown>; required?: string[] }
  const properties = schema.properties ?? {}
  const required = new Set(schema.required ?? [])
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(properties)) {
    const def = (typeof raw === 'object' && raw !== null ? raw : {}) as {
      type?: string
      description?: string
      enum?: unknown[]
    }
    const spec: Record<string, unknown> = {}
    const type = def.type
    if (type === 'string' || type === 'boolean' || type === 'number' || type === 'integer') {
      spec['type'] = type === 'integer' ? 'number' : type
    } else {
      // objects/arrays/complex shapes degrade to the unconstrained json node.
      spec['type'] = 'json'
    }
    if (def.description) spec['description'] = def.description
    if (Array.isArray(def.enum) && def.enum.length > 0) spec['enum'] = def.enum
    if (required.has(key)) spec['required'] = true
    out[key] = spec
  }
  return out as unknown as ParameterSchemaSpec
}

/** Extract human-readable text from an MCP callTool result. */
function extractMcpContent(call: unknown): string {
  if (typeof call !== 'object' || call === null) return JSON.stringify(call)
  const { content } = call as { content?: Array<{ type?: string; text?: string }> }
  if (!Array.isArray(content)) return JSON.stringify(call)
  const parts = content
    .map((block) => {
      if (block.type === 'text' && typeof block.text === 'string') return block.text
      if (block.type === 'image') return '[image]'
      return JSON.stringify(block)
    })
    .filter(Boolean)
  return parts.join('\n') || JSON.stringify(call)
}
