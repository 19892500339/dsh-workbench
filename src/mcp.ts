/**
 * MCP server management for the workbench.
 *
 * V1 scope (agreed): the panel CRUDs server entries (persisted in settings)
 * and can run a connection test per server — an initialize handshake plus a
 * tools/list enumeration over the standard MCP protocol. Registering the
 * discovered tools onto `ctx.tools` is intentionally left to DSH's own MCP
 * integration (`@deepseek-ai/dsh-mcp-client`), avoiding a duplicate bridge.
 *
 * The SDK is a declared dependency (@modelcontextprotocol/sdk, MIT). All code
 * here is original.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
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
