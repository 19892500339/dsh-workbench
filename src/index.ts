/**
 * dsh-workbench host entry.
 *
 * Registers:
 * - the `workbench_search` model tool (BM25 / vector / hybrid retrieval over
 *   the configured corpus; vector uses an OpenAI-compatible embeddings endpoint),
 * - a systemPrompt section advertising the tool and a `workbench:active-prompt`
 *   dynamic section that injects the active prompt template at assembly time,
 * - the /workbench/api RPC surface for the browser panel (persisted through
 *   the `settings` service, so all edits survive restarts),
 * - V2: dynamic MCP server connection that registers `wb_mcp__*` tools onto
 *   ctx.tools (effect-scoped, coexists with the official `mcp__*` bridge),
 * - V2: runtime tool visibility restrictions from the panel's toggles
 *   (ctx.tools.restrict).
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
import { testMcpServer, makeServerId, connectMcpServer } from './mcp.js'
import { embedTexts, buildVectorIndex, searchVectors, fuseRrf, isEmbeddingConfigured } from './embedding.js'
import type { VectorIndex } from './embedding.js'
import { dryRunWorkflow, builtinTemplates } from './workflow.js'
import { builtinPromptTemplates, safePromptText } from './prompts.js'
import { registerApiRoutes, WorkbenchApiError } from './api.js'
import type { SettingsView, WorkbenchRuntime } from './api.js'
import type {
  McpConnectionStatus,
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
  restrict(restriction: { deny?: string[]; allow?: string[] }): () => void
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
    await syncOverrides()
    return viewOf()
  }

  // --- V3: mechanism overrides (default = DSH original behavior) -------------
  type OverrideDomain = 'rag' | 'tools' | 'skills' | 'workflow'
  const overrideDisposers = new Map<OverrideDomain, () => void>()

  function disposeOverride(domain: OverrideDomain): void {
    const dispose = overrideDisposers.get(domain)
    if (dispose) {
      dispose()
      overrideDisposers.delete(domain)
    }
  }

  /** Text describing which skills the model should use under the workbench. */
  async function skillsNarrative(): Promise<string> {
    const summaries = await ctx.skills.list().catch(() => [] as SkillSummary[])
    if (summaries.length === 0) return '当前未发现可用技能。'
    return summaries
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n')
  }

  /** Text describing the currently active workflow. */
  function activeWorkflowNarrative(state: WorkbenchState): string {
    const active = state.workflows.find((w) => w.id === state.activeWorkflowId) ?? state.workflows[0]
    if (!active) return '尚未配置工作流, 请在工作台「工作流」模块新建或恢复内置模板。'
    const steps = active.nodes.map((n) => `${n.label}(${n.kind})`).join(' → ')
    return `当前工作流: ${active.name} — ${steps}${active.description ? `; 说明: ${active.description}` : ''}`
  }

  /**
   * Reconcile the four mechanism switches with DSH:
   * - rag:      inject a prompt section telling the model the retrieval
   *             mechanism now points at the workbench knowledge base;
   * - tools:    gate ctx.tools.restrict on the switch (default = no filter,
   *             all tools visible; workbench = per-tool hide list applies)
   *             plus an explanatory prompt section;
   * - skills:   inject the workbench skills list as the operative catalog;
   * - workflow: inject the active workflow steps as the operative procedure.
   * Every section is effect-scoped via systemPrompt.section() and its disposer
   * is swapped when the switch flips, so "一键还原" fully restores DSH defaults.
   */
  async function syncOverrides(): Promise<void> {
    const state = viewOf().value
    const o = state.overrides

    // rag
    if (o.rag === 'workbench') {
      if (!overrideDisposers.has('rag')) {
        overrideDisposers.set('rag', ctx.systemPrompt.section({
          name: 'workbench:mechanism:rag',
          order: 910,
          text: '工作台已将「知识检索」机制替换为工作台知识库: 需要检索本地语料/项目文档时调用 workbench_search(可传 kb_id 指定知识库); 如需恢复 DSH 原有检索机制, 请点击对话输入区工作台选项的「还原」。',
        }))
      }
    } else {
      disposeOverride('rag')
    }

    // tools
    applyToolRestrictions()
    if (o.tools === 'workbench') {
      if (!overrideDisposers.has('tools')) {
        overrideDisposers.set('tools', ctx.systemPrompt.section({
          name: 'workbench:mechanism:tools',
          order: 920,
          text: '工作台已将「工具」机制替换为工作台配置: 模型只能看到工作台未隐藏的工具(被隐藏的工具不可调用); 如需恢复 DSH 原有全量工具机制, 请点击「还原」。',
        }))
      }
    } else {
      disposeOverride('tools')
    }

    // skills
    if (o.skills === 'workbench') {
      if (!overrideDisposers.has('skills')) {
        const narrative = await skillsNarrative()
        overrideDisposers.set('skills', ctx.systemPrompt.section({
          name: 'workbench:mechanism:skills',
          order: 930,
          text: `工作台已将「技能」机制替换为工作台技能清单, 请按以下清单使用技能:\n${narrative}\n如需恢复 DSH 原有技能机制, 请点击「还原」。`,
        }))
      }
    } else {
      disposeOverride('skills')
    }

    // workflow
    if (o.workflow === 'workbench') {
      if (!overrideDisposers.has('workflow')) {
        overrideDisposers.set('workflow', ctx.systemPrompt.section({
          name: 'workbench:mechanism:workflow',
          order: 940,
          text: `工作台已将「工作流」机制替换为工作台工作流, 请严格按步骤执行:\n${activeWorkflowNarrative(state)}\n如需恢复 DSH 原有工作流机制, 请点击「还原」。`,
        }))
      }
    } else {
      disposeOverride('workflow')
    }
  }

  // --- V2: runtime tool visibility (panel toggles → ctx.tools.restrict) -----
  let toolRestrictDispose: (() => void) | null = null
  function applyToolRestrictions(): void {
    if (toolRestrictDispose) {
      toolRestrictDispose()
      toolRestrictDispose = null
    }
    const state = viewOf().value
    // 仅当「工具」机制开关为 workbench 时才过滤; 默认(default)时全部工具可见。
    if (state.overrides.tools !== 'workbench') return
    const denied = Object.entries(state.toolToggles)
      .filter(([, on]) => on === false)
      .map(([name]) => name)
    if (denied.length > 0) toolRestrictDispose = ctx.tools.restrict({ deny: denied })
  }

  // --- RAG engine caches (one per knowledge base; 'default' = corpusDir) ----
  type RagEntry = { sig: string; index: CorpusIndex; vindex?: VectorIndex; info: RagIndexInfo }
  const ragCaches = new Map<string, RagEntry>()

  const defaultKbId = 'default'
  const ragConfigOf = (state: WorkbenchState): string => state.rag.corpusDir || config.corpusDir || defaultCorpusDir()

  /** Resolve a kbId to its corpus directory; unknown ids fall back to default. */
  function corpusDirOf(state: WorkbenchState, kbId?: string): string {
    if (kbId && kbId !== defaultKbId) {
      const kb = state.rag.knowledgeBases.find((k) => k.id === kbId)
      if (kb && kb.path.trim()) return kb.path.trim()
    }
    return ragConfigOf(state)
  }

  const wantsVectors = (state: WorkbenchState): boolean =>
    (state.rag.engine === 'vector' || state.rag.engine === 'hybrid') && isEmbeddingConfigured(state.rag.embedding)

  async function rebuildRag(kbId?: string): Promise<RagIndexInfo> {
    const state = viewOf().value
    const corpusDir = corpusDirOf(state, kbId)
    await mkdir(corpusDir, { recursive: true })
    const started = Date.now()
    try {
      const index = await bm25Engine.rebuild(corpusDir, state.rag.chunkSize, state.rag.chunkOverlap)
      const sig = await corpusSignature(corpusDir)
      let vindex: VectorIndex | undefined
      let vectorCount: number | undefined
      let embeddingModel: string | undefined
      if (wantsVectors(state) && index.docs.length > 0) {
        const vectors = await embedTexts(
          index.docs.map((d) => d.text),
          state.rag.embedding,
        )
        vindex = buildVectorIndex(
          vectors,
          index.docs.map((d) => ({ docId: d.id, file: d.file, chunkIndex: d.chunkIndex, text: d.text })),
        )
        vectorCount = index.docs.length
        embeddingModel = state.rag.embedding.model.trim()
      }
      const info: RagIndexInfo = {
        corpusDir,
        docCount: index.docs.length,
        chunkCount: index.docs.length,
        lastBuiltAt: Date.now(),
        lastBuildMs: Date.now() - started,
        vectorCount,
        embeddingModel,
      }
      ragCaches.set(kbId ?? defaultKbId, { sig, index, vindex, info })
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

  /** Ensure the cache for kbId is fresh, rebuilding when stale or missing. */
  async function ensureRag(kbId?: string): Promise<RagEntry | null> {
    const state = viewOf().value
    const key = kbId ?? defaultKbId
    const corpusDir = corpusDirOf(state, kbId)
    await mkdir(corpusDir, { recursive: true })
    const cached = ragCaches.get(key)
    if (cached === undefined || cached.info.corpusDir !== corpusDir) {
      await rebuildRag(kbId)
    } else {
      const sig = await corpusSignature(corpusDir)
      if (sig !== cached.sig) await rebuildRag(kbId)
    }
    return ragCaches.get(key) ?? null
  }

  async function searchRag(query: string, topK?: number, kbId?: string): Promise<SearchHit[]> {
    const state = viewOf().value
    const entry = await ensureRag(kbId)
    if (!entry) return []
    const index = entry.index
    const limit = Math.max(1, Math.min(topK ?? state.rag.topK, 50))

    // bm25-only, or vector requested but not configured → lexical path.
    if (state.rag.engine === 'bm25' || !isEmbeddingConfigured(state.rag.embedding)) {
      return bm25Engine.search(index, query, limit)
    }

    // vector / hybrid path (embed the query; rebuild lazily when no vectors).
    try {
      if (!entry.vindex) await rebuildRag(kbId)
      const vindex = ragCaches.get(kbId ?? defaultKbId)?.vindex
      if (!vindex) return bm25Engine.search(index, query, limit)
      const queryVec = (await embedTexts([query], state.rag.embedding))[0]
      if (!queryVec) return bm25Engine.search(index, query, limit)
      const vectorHits: SearchHit[] = searchVectors(vindex, queryVec, limit).map(({ docIndex, score }) => {
        const doc = vindex.docs[docIndex]!
        return {
          score: Math.round(score * 1000) / 1000,
          file: doc.file,
          chunkIndex: doc.chunkIndex,
          snippet: doc.text.replace(/\s+/g, ' ').trim().slice(0, 200),
        }
      })
      if (state.rag.engine === 'hybrid') {
        return fuseRrf(bm25Engine.search(index, query, limit), vectorHits, limit)
      }
      return vectorHits
    } catch (error) {
      console.error('[dsh-workbench] 向量检索失败, 回退 BM25:', error)
      return bm25Engine.search(index, query, limit)
    }
  }

  // --- V2.1: knowledge base CRUD --------------------------------------------
  async function upsertKnowledgeBase(kb: { id?: string; name: string; path: string }): Promise<SettingsView> {
    const state = viewOf().value
    const trimmed = { name: kb.name.trim(), path: kb.path.trim() }
    if (!trimmed.name || !trimmed.path) throw new WorkbenchApiError('bad-request', '知识库需要名称与路径')
    const next = kb.id
      ? { id: kb.id, ...trimmed }
      : { id: `kb-${Date.now().toString(36)}`, ...trimmed }
    const rest = state.rag.knowledgeBases.filter((k) => k.id !== next.id)
    const view = await updateState({ rag: { ...state.rag, knowledgeBases: [...rest, next] } })
    ragCaches.delete(next.id)
    return view
  }
  async function removeKnowledgeBase(id: string): Promise<SettingsView> {
    const state = viewOf().value
    ragCaches.delete(id)
    return updateState({ rag: { ...state.rag, knowledgeBases: state.rag.knowledgeBases.filter((k) => k.id !== id) } })
  }

  // --- tool registration ----------------------------------------------------
  try {
    ctx.effect(() =>
      tools.register(
        defineTool({
          name: 'workbench_search',
          description:
            '在工作台配置的知识库(本地语料目录)中检索相关内容, 支持 BM25 关键词 / 向量 / 混合检索。当问题需要引用工作台语料、项目文档或用户上传的文本语料时使用。',
          parameters: {
            query: { type: 'string', required: true, description: '检索关键词或问题' },
            top_k: { type: 'number', description: '返回条数, 默认使用工作台配置' },
            kb_id: { type: 'string', description: '知识库 id(工作台 RAG 面板中创建); 省略时检索默认语料目录' },
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
            return searchRag(args.query, args.top_k, args.kb_id)
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
  // V3 fix: the active prompt is injected as a DYNAMIC section — DSH only
  // interpolates {{variable}} references that appear inside a section/persona,
  // so registering a bare variable never reaches the model. A section whose
  // text() resolves empty is dropped from the assembly, so an inactive prompt
  // costs zero context.
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'workbench:active-prompt',
      order: 950,
      text: () => {
        const state = viewOf().value
        const active = state.prompts.find((p) => p.id === state.activePromptId)
        if (!active) return ''
        // safePromptText: DSH treats {{var}} as a strict variable reference and
        // throws on unknowns, which would break assembly for any template with
        // unfilled placeholders. {var} keeps them readable without triggering.
        return `【生效提示词: ${active.name}】\n${safePromptText(active.content)}`
      },
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

  /**
   * List EVERY registered tool: visible ones from the registry plus the ones
   * this workbench has hidden via restrict (they read as absent from the
   * registry, so they are re-attached here with a hidden marker so the panel
   * can still show and restore them).
   */
  function listTools(): ToolView[] {
    const state = viewOf().value
    // 「对模型隐藏」仅在「工具」机制开关 = workbench 时生效; 默认(default)
    // 模式下全部工具可见, 不标注隐藏。
    const toolsMode = state.overrides.tools === 'workbench'
    const denied = new Set(
      toolsMode
        ? Object.entries(state.toolToggles)
            .filter(([, on]) => on === false)
            .map(([name]) => name)
        : [],
    )
    const visible: ToolView[] = tools.schemas().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      hiddenFromModel: denied.has(t.name) ? true : undefined,
    }))
    const seen = new Set(visible.map((t) => t.name))
    for (const name of denied) {
      if (seen.has(name)) continue
      // Restricted-away: the registry no longer serves its schema, so only the
      // name (and the fact it is hidden) can be shown until it is re-enabled.
      visible.push({
        name,
        description: '(已对模型隐藏 — 注册表暂不可见, 取消隐藏后恢复)',
        hiddenFromModel: true,
      })
    }
    return visible
  }

  // --- mutations over the persisted state -----------------------------------
  async function upsertServer(server: McpServerConfig): Promise<SettingsView> {
    const state = viewOf().value
    if (!server.id) server = { ...server, id: makeServerId(server.name || 'server') }
    const rest = state.mcpServers.filter((s) => s.id !== server.id)
    const next = await updateState({ mcpServers: [...rest, server] })
    await syncServerConnection(server)
    return next
  }
  async function removeServer(id: string): Promise<SettingsView> {
    const state = viewOf().value
    disposeConnection(id)
    return updateState({ mcpServers: state.mcpServers.filter((s) => s.id !== id) })
  }
  async function toggleServer(id: string, enabled: boolean): Promise<SettingsView> {
    const state = viewOf().value
    const server = state.mcpServers.find((s) => s.id === id)
    if (!server) throw new WorkbenchApiError('not-found', `MCP 服务器 "${id}" 不存在`, 404)
    const next = await updateState({ mcpServers: state.mcpServers.map((s) => (s.id === id ? { ...s, enabled } : s)) })
    await syncServerConnection({ ...server, enabled })
    return next
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
  async function activateWorkflow(id: string): Promise<SettingsView> {
    return updateState({ activeWorkflowId: id })
  }

  // --- V3: mechanism switch API ----------------------------------------------
  async function setOverride(domain: OverrideDomain, mode: 'default' | 'workbench'): Promise<SettingsView> {
    const state = viewOf().value
    const next = { ...state.overrides, [domain]: mode }
    return updateState({ overrides: next })
  }
  async function resetAllOverrides(): Promise<SettingsView> {
    // 一键还原: 所有机制回到 DSH 默认, 并清空工具/技能隐藏配置。
    return updateState({
      overrides: { rag: 'default', tools: 'default', skills: 'default', workflow: 'default' },
      toolToggles: {},
      skillToggles: {},
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
    const state = viewOf().value
    // V2.1: stamp lastUsedAt so the panel can show the 3 most recent prompts.
    const prompts = state.prompts.map((p) => (p.id === id ? { ...p, lastUsedAt: Date.now() } : p))
    return updateState({ prompts, activePromptId: id })
  }
  async function deactivatePrompt(): Promise<SettingsView> {
    return updateState({ activePromptId: '' })
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

  // --- V2: dynamic MCP connection (tools auto-registered on ctx.tools) -------
  const mcpConnections = new Map<string, McpConnectionStatus & { disposer: () => void }>()

  function disposeConnection(id: string): void {
    const existing = mcpConnections.get(id)
    if (existing) {
      existing.disposer()
      mcpConnections.delete(id)
    }
  }

  /** Connect (when enabled) or disconnect one server; never throws. */
  async function syncServerConnection(server: McpServerConfig): Promise<void> {
    disposeConnection(server.id)
    if (!server.enabled) return
    try {
      const { disposer, result } = await connectMcpServer(server, tools)
      mcpConnections.set(server.id, {
        disposer,
        connected: result.ok,
        tools: result.tools,
        ...(result.error ? { error: result.error } : {}),
      })
    } catch (error) {
      mcpConnections.set(server.id, {
        disposer: () => undefined,
        connected: false,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // --- the runtime consumed by the RPC layer --------------------------------
  const runtime: WorkbenchRuntime = {
    async state(): Promise<StateSnapshot> {
      const view = viewOf()
      const mcpStatus: Record<string, McpConnectionStatus> = {}
      for (const [id, conn] of mcpConnections) {
        mcpStatus[id] = { connected: conn.connected, tools: conn.tools, error: conn.error }
      }
      return {
        value: view.value,
        revision: view.revision,
        skills: await listSkills(),
        tools: listTools(),
        rag: ragCaches.get(defaultKbId) ? { ...ragCaches.get(defaultKbId)!.info } : null,
        mcpStatus,
      }
    },
    updateState,
    rebuildRag,
    searchRag,
    upsertKnowledgeBase,
    removeKnowledgeBase,
    testServer,
    upsertServer,
    removeServer,
    toggleServer,
    upsertWorkflow,
    removeWorkflow,
    runWorkflow,
    activateWorkflow,
    setOverride,
    resetAllOverrides,
    workflowTemplates: () => builtinTemplates(),
    testTool,
    importSkill,
    upsertPrompt,
    removePrompt,
    activatePrompt,
    deactivatePrompt,
    promptTemplates: () => builtinPromptTemplates(),
  }

  // --- RPC route ------------------------------------------------------------
  ctx.effect(() => registerApiRoutes(ctx.webServer, runtime), 'dsh-workbench: /workbench/api routes')

  // Warm the template lists only when the user has none yet (first run).
  const initial = viewOf().value
  if (initial.workflows.length === 0) {
    void updateState({ workflows: builtinTemplates() }).catch(() => undefined)
  }
  if (initial.prompts.length === 0) {
    void updateState({ prompts: builtinPromptTemplates() }).catch(() => undefined)
  }

  // V3: reconcile the persisted mechanism switches (default = DSH behavior)
  // and connect enabled MCP servers asynchronously (never block the tree).
  void syncOverrides()
  for (const server of initial.mcpServers) {
    if (server.enabled) void syncServerConnection(server)
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
