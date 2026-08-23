/**
 * Host RPC surface: one prefix route under /workbench/api/<method> that the
 * browser panel calls with fetch(). This mirrors the wire pattern used by
 * shipped hybrid plugins (a `webServer` prefix route plus a { ok, value }
 * envelope); the implementation here is original.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  McpServerConfig,
  McpTestResult,
  PromptTemplate,
  RagIndexInfo,
  SearchHit,
  StateSnapshot,
  WorkbenchState,
  WorkflowDefinition,
  WorkflowStepLog,
} from './shared/types.js'

/** A settings view (resolved value + revision for guarded writes). */
export interface SettingsView {
  value: WorkbenchState
  revision: number
}

/** Everything the handlers need — implemented by the plugin entry. */
export interface WorkbenchRuntime {
  state(): Promise<StateSnapshot>
  updateState(patch: object, expectedRevision?: number): Promise<SettingsView>
  rebuildRag(kbId?: string): Promise<RagIndexInfo>
  searchRag(query: string, topK?: number, kbId?: string): Promise<SearchHit[]>
  upsertKnowledgeBase(kb: { id?: string; name: string; path: string }): Promise<SettingsView>
  removeKnowledgeBase(id: string): Promise<SettingsView>
  testServer(serverId: string): Promise<McpTestResult>
  upsertServer(server: McpServerConfig): Promise<SettingsView>
  removeServer(id: string): Promise<SettingsView>
  toggleServer(id: string, enabled: boolean): Promise<SettingsView>
  upsertWorkflow(workflow: WorkflowDefinition): Promise<SettingsView>
  removeWorkflow(id: string): Promise<SettingsView>
  runWorkflow(id: string, inputs: Record<string, string>): Promise<WorkflowStepLog[]>
  /** The built-in starter templates (for restoring after deletion). */
  workflowTemplates(): WorkflowDefinition[]
  testTool(name: string, args: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }>
  importSkill(path: string): Promise<{ ok: boolean; name?: string; error?: string }>
  upsertPrompt(prompt: PromptTemplate): Promise<SettingsView>
  removePrompt(id: string): Promise<SettingsView>
  activatePrompt(id: string): Promise<SettingsView>
  /** V2.1: built-in domain prompt templates. */
  promptTemplates(): PromptTemplate[]
}

/** Wire-level error with a stable code for the panel. */
export class WorkbenchApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Coerce one handler payload field. */
function str(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new WorkbenchApiError('bad-request', `${field} 必须是字符串`)
  return value
}

function num(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new WorkbenchApiError('bad-request', `${field} 必须是数字`)
  return value
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new WorkbenchApiError('bad-request', `${field} 必须是布尔值`)
  return value
}

/** Dispatch one method against the runtime. */
export async function dispatch(runtime: WorkbenchRuntime, method: string, payload: unknown): Promise<unknown> {
  const p = isRecord(payload) ? payload : {}
  switch (method) {
    case 'state.get':
      return runtime.state()
    case 'state.update': {
      const patch = p['patch']
      if (!isRecord(patch)) throw new WorkbenchApiError('bad-request', 'patch 必须是对象')
      const revision = p['expectedRevision'] === undefined ? undefined : num(p['expectedRevision'], 'expectedRevision')
      return runtime.updateState(patch, revision)
    }
    case 'rag.rebuild':
      return runtime.rebuildRag(p['kbId'] === undefined ? undefined : str(p['kbId'], 'kbId'))
    case 'rag.search':
      return runtime.searchRag(
        str(p['query'], 'query'),
        p['topK'] === undefined ? undefined : num(p['topK'], 'topK'),
        p['kbId'] === undefined ? undefined : str(p['kbId'], 'kbId'),
      )
    case 'kb.save': {
      const kb = p['kb']
      if (!isRecord(kb)) throw new WorkbenchApiError('bad-request', 'kb 必须是对象')
      return runtime.upsertKnowledgeBase(kb as unknown as { id?: string; name: string; path: string })
    }
    case 'kb.remove':
      return runtime.removeKnowledgeBase(str(p['id'], 'id'))
    case 'mcp.test':
      return runtime.testServer(str(p['serverId'], 'serverId'))
    case 'mcp.save': {
      const server = p['server']
      if (!isRecord(server)) throw new WorkbenchApiError('bad-request', 'server 必须是对象')
      return runtime.upsertServer(server as unknown as McpServerConfig)
    }
    case 'mcp.remove':
      return runtime.removeServer(str(p['id'], 'id'))
    case 'mcp.toggle':
      return runtime.toggleServer(str(p['id'], 'id'), bool(p['enabled'], 'enabled'))
    case 'workflow.save': {
      const workflow = p['workflow']
      if (!isRecord(workflow)) throw new WorkbenchApiError('bad-request', 'workflow 必须是对象')
      return runtime.upsertWorkflow(workflow as unknown as WorkflowDefinition)
    }
    case 'workflow.remove':
      return runtime.removeWorkflow(str(p['id'], 'id'))
    case 'workflow.run': {
      const inputs = isRecord(p['inputs']) ? p['inputs'] : {}
      return runtime.runWorkflow(str(p['id'], 'id'), inputs as Record<string, string>)
    }
    case 'workflow.templates':
      return runtime.workflowTemplates()
    case 'tool.test':
      return runtime.testTool(str(p['name'], 'name'), p['args'])
    case 'skill.import':
      return runtime.importSkill(str(p['path'], 'path'))
    case 'prompt.save': {
      const prompt = p['prompt']
      if (!isRecord(prompt)) throw new WorkbenchApiError('bad-request', 'prompt 必须是对象')
      return runtime.upsertPrompt(prompt as unknown as PromptTemplate)
    }
    case 'prompt.remove':
      return runtime.removePrompt(str(p['id'], 'id'))
    case 'prompt.activate':
      return runtime.activatePrompt(str(p['id'], 'id'))
    case 'prompt.templates':
      return runtime.promptTemplates()
    default:
      throw new WorkbenchApiError('not-found', `未知方法 "${method}"`, 404)
  }
}

/** Same-origin fence: only the browser page may call the workbench API. */
export function sameOriginFence(req: IncomingMessage): boolean {
  const origin = req.headers['origin']
  const host = req.headers['host']
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read a JSON request body (bounded). */
export async function readJsonBody(req: IncomingMessage, limit = 1 << 20): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > limit) throw new WorkbenchApiError('too-large', '请求体过大', 413)
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new WorkbenchApiError('bad-json', '请求体不是合法 JSON')
  }
}

export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(text)
}

export function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

export function writeError(res: ServerResponse, error: unknown): void {
  const apiError = error instanceof WorkbenchApiError ? error : new WorkbenchApiError('internal', error instanceof Error ? error.message : String(error), 500)
  writeJson(res, apiError.status, { ok: false, error: { code: apiError.code, message: apiError.message } })
}

/**
 * Register the /workbench/api prefix route on the host webserver. The returned
 * disposer removes the route on plugin unload.
 */
export function registerApiRoutes(
  webServer: { register(route: unknown): () => void },
  runtime: WorkbenchRuntime,
): () => void {
  return webServer.register({
    kind: 'prefix',
    path: '/workbench/api',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (!sameOriginFence(req)) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const prefix = '/workbench/api/'
      const method = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeError(res, new WorkbenchApiError('not-found', '未知工作台 API 方法', 404))
        return
      }
      try {
        const payload = await readJsonBody(req)
        writeOk(res, await dispatch(runtime, method, payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  })
}
