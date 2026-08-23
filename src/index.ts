/**
 * dsh-workbench host entry.
 *
 * Registers:
 * - the `workbench_search` model tool (BM25 retrieval over the configured corpus),
 * - a systemPrompt section advertising the tool and a `workbench.activePrompt`
 *   variable that injects the active prompt template at assembly time,
 * - the /workbench/api RPC surface for the browser panel (persisted through
 *   the `settings` service, so all edits survive restarts).
 */
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { mkdir, copyFile, stat } from 'node:fs/promises'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CallId, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { SETTINGS_NS, WorkbenchSchema, defaultState } from './config.js'
import { bm25Engine, corpusSignature } from './search.js'
import type { CorpusIndex } from './search.js'
import { testMcpServer, makeServerId } from './mcp.js'
import { dryRunWorkflow, builtinTemplates } from './workflow.js'
import { registerApiRoutes, WorkbenchApiError } from './api.js'
import type { SettingsView, WorkbenchRuntime } from './api.js'
import type {
  McpServerConfig,
  McpTestResult,
  PromptTemplate,
  RagIndexInfo,
  SearchHit,
  SkillView,
  StateSnapshot,
  ToolView,
  WorkbenchState,
  WorkflowDefinition,
  WorkflowStepLog,
} from './shared/types.js'

/** Cordis plugin name — must match the row id in cordis.patch.yml. */
export const name = 'workbench'

/** Hard service dependencies. */
export const inject = ['tools', 'webServer', 'settings', 'systemPrompt', 'skills']

/** Optional patch-level defaults (see cordis.patch.yml `config`). */
export const Config = z.object({
  corpusDir: z.string().default(''),
  skillsDir: z.string().default(''),
})

function defaultCorpusDir(): string {
  return join(homedir(), '.dsh', 'workbench', 'corpus')
}

function defaultSkillsDir(): string {
  return join(homedir(), '.dsh', 'skills')
}

/** Minimal typed faces for the services we touch (runtime shapes verified against DSH 0.1.0-rc.6). */
interface ToolsServiceLike {
  register(definition: unknown): () => void
  get(name: string, scope?: unknown): ToolSchema | undefined
  schemas(scope?: unknown): ToolSchema[]
  execute(input: { callId: CallId; name: string; arguments: unknown; signal: AbortSignal }): Promise<unknown>
}
interface SettingsServiceLike {
  register(ns: string, schema: unknown, options?: unknown): unknown
  describe(options?: { redactSecrets?: boolean }): Array<{ ns: string; value?: unknown; revision?: number }>
  update(ns: string, patch: object, expectedRevision?: number): Promise<void>
}
interface WebServerLike {
  register(route: unknown): () => void
}
interface SkillsServiceLike {
  list(options?: unknown): Promise<SkillSummary[]>
}
interface SystemPromptLike {
  section(section: unknown): () => void
  variable(name: string, provider: () => string | undefined): () => void
}
interface CtxLike {
  tools: ToolsServiceLike
  webServer: WebServerLike
  settings: SettingsServiceLike
  systemPrompt: SystemPromptLike
  skills: SkillsServiceLike
  effect(fn: () => void, label?: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function apply(ctx: CtxLike, config: { corpusDir: string; skillsDir: string }): void {
  const tools = ctx.tools
  const skillsDir = config.skillsDir || defaultSkillsDir()

  // --- settings persistence face -------------------------------------------
  ctx.settings.register(SETTINGS_NS, WorkbenchSchema)

  const viewOf = (): SettingsView => {
    const descriptor = ctx.settings.describe({ redactSecrets: true }).find((candidate) => candidate.ns === SETTINGS_NS)
    return {
      value: (descriptor?.value ?? defaultState()) as WorkbenchState,
      revision: descriptor?.revision ?? 0,
    }
  }
  const updateState = async (patch: object, expectedRevision?: number): Promise<SettingsView> => {
    await ctx.settings.update(SETTINGS_NS, patch, expectedRevision)
    return viewOf()
  }

  // --- RAG engine cache -----------------------------------------------------
  let ragCache: { sig: string; index: CorpusIndex; info: RagIndexInfo } | null = null

  const ragConfigOf = (state: WorkbenchState): string => state.rag.corpusDir || config.corpusDir || defaultCorpusDir()

  async function rebuildRag(): Promise<RagIndexInfo> {
    const state = viewOf().value
    const corpusDir = ragConfigOf(state)
    await mkdir(corpusDir, { recursive: true })
    const started = Date.now()
    try {
      const index = await bm25Engine.rebuild(corpusDir, state.rag.chunkSize, state.rag.chunkOverlap)
      const sig = await corpusSignature(corpusDir)
      const info: RagIndexInfo = {
        corpusDir,
        docCount: index.docs.length,
        chunkCount: index.docs.length,
        lastBuiltAt: Date.now(),
        lastBuildMs: Date.now() - started,
      }
      ragCache = { sig, index, info }
      return info
    } catch (error) {
      return {
        corpusDir,
        docCount: 0,
        chunkCount: 0,
        lastBuiltAt: null,
        lastBuildMs: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async function searchRag(query: string, topK?: number): Promise<SearchHit[]> {
    const state = viewOf().value
    const corpusDir = ragConfigOf(state)
    await mkdir(corpusDir, { recursive: true })
    if (ragCache === null || ragCache.info.corpusDir !== corpusDir) {
      await rebuildRag()
    } else {
      const sig = await corpusSignature(corpusDir)
      if (sig !== ragCache.sig) await rebuildRag()
    }
    const index = ragCache?.index
    if (!index) return []
    const limit = Math.max(1, Math.min(topK ?? state.rag.topK, 50))
    return bm25Engine.search(index, query, limit)
  }

  // --- tool registration ----------------------------------------------------
  try {
    ctx.effect(() =>
      tools.register(
        defineTool({
          name: 'workbench_search',
          description:
            '在工作台配置的知识库(本地语料目录)中检索相关内容, 支持关键词/BM25 检索。当问题需要引用工作台语料、项目文档或用户上传的文本语料时使用。',
          parameters: {
            query: { type: 'string', required: true, description: '检索关键词或问题' },
            top_k: { type: 'number', description: '返回条数, 默认使用工作台配置' },
          },
          output: {
            schema: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  score: { type: 'number', required: true },
                  file: { type: 'string', required: true },
                  chunkIndex: { type: 'integer', required: true },
                  snippet: { type: 'string', required: true },
                },
              },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          async execute(args) {
            return searchRag(args.query, args.top_k)
          },
        }),
      ),
    )
  } catch (error) {
    console.error('[dsh-workbench] workbench_search 注册失败(与其它插件重名?):', error)
  }

  // --- system prompt wiring -------------------------------------------------
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'workbench:search',
      order: 120,
      text: '工作台知识库已可用: 当问题需要检索工作台语料(本地文档目录)时调用 workbench_search。',
    }),
  )
  ctx.effect(() =>
    ctx.systemPrompt.variable('workbench.activePrompt', () => {
      const state = viewOf().value
      const active = state.prompts.find((p) => p.id === state.activePromptId)
      return active ? active.content : undefined
    }),
  )

  // --- projections ----------------------------------------------------------
  async function listSkills(): Promise<SkillView[]> {
    const summaries = await ctx.skills.list().catch(() => [] as SkillSummary[])
    return summaries.map((s) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse,
      provider: s.provider,
    }))
  }

  function listTools(): ToolView[] {
    return tools.schemas().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }))
  }

  // --- mutations over the persisted state -----------------------------------
  async function upsertServer(server: McpServerConfig): Promise<SettingsView> {
    const state = viewOf().value
    if (!server.id) server = { ...server, id: makeServerId(server.name || 'server') }
    const rest = state.mcpServers.filter((s) => s.id !== server.id)
    return updateState({ mcpServers: [...rest, server] })
  }
  async function removeServer(id: string): Promise<SettingsView> {
    const state = viewOf().value
    return updateState({ mcpServers: state.mcpServers.filter((s) => s.id !== id) })
  }
  async function toggleServer(id: string, enabled: boolean): Promise<SettingsView> {
    const state = viewOf().value
    return updateState({ mcpServers: state.mcpServers.map((s) => (s.id === id ? { ...s, enabled } : s)) })
  }
  async function upsertWorkflow(workflow: WorkflowDefinition): Promise<SettingsView> {
    const state = viewOf().value
    if (!workflow.id) workflow = { ...workflow, id: `wf-${Date.now().toString(36)}` }
    const rest = state.workflows.filter((w) => w.id !== workflow.id)
    return updateState({ workflows: [...rest, workflow] })
  }
  async function removeWorkflow(id: string): Promise<SettingsView> {
    const state = viewOf().value
    return updateState({ workflows: state.workflows.filter((w) => w.id !== id) })
  }
  async function runWorkflow(id: string, inputs: Record<string, string>): Promise<WorkflowStepLog[]> {
    const state = viewOf().value
    const workflow = state.workflows.find((w) => w.id === id)
    if (!workflow) throw new WorkbenchApiError('not-found', `工作流 "${id}" 不存在`, 404)
    return dryRunWorkflow(workflow, inputs, {
      resolve: (toolName) => {
        const def = tools.get(toolName)
        return def ? { name: def.name, description: def.description } : null
      },
    })
  }
  async function upsertPrompt(prompt: PromptTemplate): Promise<SettingsView> {
    const state = viewOf().value
    if (!prompt.id) prompt = { ...prompt, id: `p-${Date.now().toString(36)}` }
    const rest = state.prompts.filter((p) => p.id !== prompt.id)
    return updateState({ prompts: [...rest, prompt] })
  }
  async function removePrompt(id: string): Promise<SettingsView> {
    const state = viewOf().value
    return updateState({ prompts: state.prompts.filter((p) => p.id !== id) })
  }
  async function activatePrompt(id: string): Promise<SettingsView> {
    return updateState({ activePromptId: id })
  }

  async function testTool(name: string, args: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> {
    const def = tools.get(name)
    if (!def) return { ok: false, error: `工具 "${name}" 未注册` }
    try {
      const result = await tools.execute({
        callId: `workbench-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as unknown as CallId,
        name,
        arguments: args ?? {},
        signal: new AbortController().signal,
      })
      return { ok: true, value: projectResult(result) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function importSkill(path: string): Promise<{ ok: boolean; name?: string; error?: string }> {
    const info = await stat(path).catch(() => null)
    if (!info || !info.isFile()) return { ok: false, error: `文件不存在: ${path}` }
    try {
      await mkdir(skillsDir, { recursive: true })
      const target = join(skillsDir, basename(path))
      await copyFile(path, target)
      return { ok: true, name: basename(path) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async function testServer(serverId: string): Promise<McpTestResult> {
    const state = viewOf().value
    const server = state.mcpServers.find((s) => s.id === serverId)
    if (!server) throw new WorkbenchApiError('not-found', `MCP 服务器 "${serverId}" 不存在`, 404)
    return testMcpServer(server)
  }

  // --- the runtime consumed by the RPC layer --------------------------------
  const runtime: WorkbenchRuntime = {
    async state(): Promise<StateSnapshot> {
      const view = viewOf()
      return {
        value: view.value,
        revision: view.revision,
        skills: await listSkills(),
        tools: listTools(),
        rag: ragCache ? { ...ragCache.info } : null,
      }
    },
    updateState,
    rebuildRag,
    searchRag,
    testServer,
    upsertServer,
    removeServer,
    toggleServer,
    upsertWorkflow,
    removeWorkflow,
    runWorkflow,
    workflowTemplates: () => builtinTemplates(),
    testTool,
    importSkill,
    upsertPrompt,
    removePrompt,
    activatePrompt,
  }

  // --- RPC route ------------------------------------------------------------
  ctx.effect(() => registerApiRoutes(ctx.webServer, runtime), 'dsh-workbench: /workbench/api routes')

  // Warm the template list only when the user has none yet (first run).
  const initial = viewOf().value
  if (initial.workflows.length === 0) {
    void updateState({ workflows: builtinTemplates() }).catch(() => undefined)
  }
}

/** Project a tool result into lossless-JSON friendly shape for the panel. */
function projectResult(result: unknown): unknown {
  if (!isRecord(result)) return result
  if (Array.isArray(result['content'])) {
    const texts = result['content']
      .map((block) => (isRecord(block) && typeof block['text'] === 'string' ? block['text'] : ''))
      .filter((t) => t.length > 0)
    if (texts.length > 0) return { summary: texts.join('\n').slice(0, 4000) }
  }
  return result
}
