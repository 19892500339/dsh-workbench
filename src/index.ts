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
import { join, basename, resolve } from 'node:path'
import { mkdir, copyFile, stat, writeFile } from 'node:fs/promises'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { CallId, ToolSchema } from '@deepseek-ai/dsh-llm'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { SETTINGS_NS, WorkbenchSchema, defaultState } from './config.js'
import { bm25Engine, corpusSignature, chunkText, buildCorpusIndex } from './search.js'
import type { CorpusIndex } from './search.js'
import { scanDirectory, commitIndex, locateInIndexes, refreshIndex, codeDirSignature } from './codeindex.js'
import type { CodeBlock } from './codeindex.js'
import { analyzeCode, buildReport, writeProjectStatus, readFileRange } from './projectstatus.js'
import type { ConfigSignals, ProjectStatusReport, ReadFileResult } from './projectstatus.js'
import { extractDocumentText } from './documents.js'
import { testMcpServer, makeServerId, connectMcpServer } from './mcp.js'
import { embedTexts, buildVectorIndex, searchVectors, fuseRrf, isEmbeddingConfigured } from './embedding.js'
import type { VectorIndex } from './embedding.js'
import { executeWorkflow, builtinTemplates } from './workflow.js'
import { builtinPromptTemplates, safePromptText } from './prompts.js'
import { registerApiRoutes, WorkbenchApiError } from './api.js'
import type { SettingsView, WorkbenchRuntime } from './api.js'
import { runPublishPipeline } from './publish.js'
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
  WorkflowProgress,
  WorkflowScriptResult,
  WorkflowStepLog,
} from './shared/types.js'

/** Cordis plugin name — must match the row id in cordis.patch.yml. */
export const name = 'workbench'

/** Hard service dependencies. */
export const inject = ['tools', 'webServer', 'settings', 'systemPrompt', 'skills', 'agents', 'agentPresets']

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
  execute(input: { callId: CallId; name: string; arguments: unknown; signal: AbortSignal; agent?: unknown }): Promise<unknown>
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
  get?(name: string, options?: unknown): Promise<{ name: string; description: string; body?: string } | undefined>
}

/** Minimal face of the DSH workflowEngine service (`@deepseek-ai/dsh-workflow`). */
interface WorkflowEngineLike {
  start(request: {
    script: string
    meta: { name: string; description: string; whenToUse?: string; phases?: Array<{ title: string; detail?: string; provider?: string; model?: string }> }
    args?: Record<string, string>
    parent?: unknown
    signal?: AbortSignal
  }): {
    id: string
    result: Promise<{ stopReason: string; agentsStarted: number; value?: unknown; error?: string }>
    cancel(reason: string): void
    dispose(): Promise<void>
  }
}
interface SystemPromptLike {
  section(section: unknown): () => void
  variable(name: string, provider: () => string | undefined): () => void
}

/** A live agent: its scope context resolves the agent's own tools/skills instances. */
interface AgentLike {
  id: string
  ctx: { get(name: string): unknown }
}
interface AgentsServiceLike {
  get(id: string): AgentLike | undefined
}
interface AgentPresetsServiceLike {
  /** Read one agent's realm-provided service (e.g. workflowEngine lives behind an isolate realm). */
  serviceFor(agent: { ctx: unknown }, name: string): unknown
  /** V6: mount-validate one preset id (the roster's real composition check). */
  standingKeyFor?(id?: string): Promise<unknown>
}
interface CtxLike {
  tools: ToolsServiceLike
  webServer: WebServerLike
  settings: SettingsServiceLike
  systemPrompt: SystemPromptLike
  skills: SkillsServiceLike
  agents: AgentsServiceLike
  agentPresets: AgentPresetsServiceLike
  get(name: string): unknown
  effect(fn: () => void, label?: string): void
  /** Cordis event bus — used to project workflow/* engine events into run progress. */
  on?(event: string, handler: (...args: unknown[]) => void): () => void
}

/**
 * Resolve the tools/skills services as the agent's scope sees them.
 *
 * DSH's tools/skills services are per-scope: rows mounted by an agent preset
 * (the model-facing tool plugins, skill providers) register into the agent's
 * scope instance, which a host-plane reader like this workbench does NOT see
 * through its own `ctx.tools`/`ctx.skills` (that resolves the host instance,
 * whose global layer only carries host-registered tools such as
 * `workbench_search`). Reading `agent.ctx.get(...)` walks the agent's own
 * context chain and returns the instance whose layers hold the preset's
 * registrations, so `schemas(agent)` / `list({ scope: agent })` then return
 * exactly the tools and skills that agent's model sees.
 */
function serviceFromAgent<T>(agent: AgentLike | undefined, name: string, fallback: T): T {
  if (agent === undefined) return fallback
  const resolved = agent.ctx.get(name)
  return (resolved as T | undefined) ?? fallback
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
    restartIndexWatch()
    return viewOf()
  }

  // --- V5: built-in .workbench index watcher -----------------------------------
  // Maintains the configured directories' `.workbench` indexes inside the host:
  // polls each dir's lightweight signature and refreshes on change, so line
  // numbers always match the current code — no external script and no model
  // needing to remember to commit. Reconfigured on every settings update.
  const INDEX_WATCH_INTERVAL_MS = 2000
  const INDEX_WATCH_SNAPSHOT_MS = 60_000

  let indexWatchDispose: (() => void) | null = null

  function restartIndexWatch(): void {
    if (indexWatchDispose) {
      indexWatchDispose()
      indexWatchDispose = null
    }
    const dirs = viewOf().value.indexWatchDirs.map((d) => d.trim()).filter((d) => d.length > 0)
    if (dirs.length === 0) return
    const signatures = new Map<string, string>()
    for (const dir of dirs) {
      const abs = resolve(dir)
      void codeDirSignature(abs)
        .then((sig) => signatures.set(abs, sig))
        .catch(() => undefined)
    }
    const timer = setInterval(() => {
      for (const dir of dirs) {
        const abs = resolve(dir)
        void (async () => {
          const sig = await codeDirSignature(abs).catch(() => null)
          if (sig === null || sig === signatures.get(abs)) return
          signatures.set(abs, sig)
          const res = await refreshIndex(abs, {
            note: '宿主内置 watch 自动同步',
            snapshotThrottleMs: INDEX_WATCH_SNAPSHOT_MS,
          }).catch(() => null)
          if (res) {
            const added = res.dirs.reduce((a, d) => a + d.added, 0)
            const updated = res.dirs.reduce((a, d) => a + d.updated, 0)
            console.log(`[dsh-workbench] 索引已自动同步 ${abs}: ${res.total_blocks} 块 (新增 ${added} / 更新 ${updated})`)
          }
        })()
      }
    }, INDEX_WATCH_INTERVAL_MS)
    indexWatchDispose = () => {
      clearInterval(timer)
      signatures.clear()
    }
    console.log(`[dsh-workbench] 内置索引 watch 已启动: ${dirs.join(', ')}`)
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

    // rag — three modes: default | workbench (target KB) | custom retrieval.
    // The section is rebuilt on every sync so a changed target KB or custom
    // parameters are reflected in the injected text immediately.
    if (o.rag !== 'default') {
      disposeOverride('rag')
      let ragText: string
      if (o.rag === 'custom') {
        ragText = `工作台已将「知识检索」机制替换为自定义检索: 调用 workbench_search 时使用自定义参数(topK=${state.rag.ragCustom.topK}, 相似度阈值=${state.rag.ragCustom.threshold}); 如需恢复 DSH 原有检索机制, 请点击「还原」。`
      } else {
        const kb = state.rag.knowledgeBases.find((k) => k.id === state.rag.ragTargetKbId)
        ragText = kb
          ? `工作台已将「知识检索」机制替换为工作台知识库「${kb.name}」(kb_id=${kb.id}): 检索该知识库时调用 workbench_search 并传 kb_id=${kb.id}; 如需恢复 DSH 原有检索机制, 请点击「还原」。`
          : '工作台已将「知识检索」机制替换为工作台知识库(默认语料目录): 调用 workbench_search 检索; 如需恢复 DSH 原有检索机制, 请点击「还原」。'
      }
      overrideDisposers.set('rag', ctx.systemPrompt.section({
        name: 'workbench:mechanism:rag',
        order: 910,
        text: ragText,
      }))
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
      // includeWorkbenchLatest: also index every `.workbench/latest.md` under
      // the corpus so code-index entries are retrievable via workbench_search.
      const index = await buildCorpusIndex(corpusDir, state.rag.chunkSize, state.rag.chunkOverlap, {
        includeWorkbenchLatest: true,
      })
      const sig = await corpusSignature(corpusDir, { includeWorkbenchLatest: true })
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
      const sig = await corpusSignature(corpusDir, { includeWorkbenchLatest: true })
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

  /**
   * V3.1: upload a document (pdf/txt/md) into a knowledge base folder.
   * The raw file is saved into the KB corpus directory (so the corpus scan and
   * the vector index pick it up), then the KB index is rebuilt immediately —
   * including embeddings when the engine is vector/hybrid and configured.
   */
  async function uploadDocument(input: {
    kbId?: string
    fileName: string
    contentBase64: string
  }): Promise<{ ok: boolean; name?: string; chars?: number; chunks?: number; error?: string }> {
    const state = viewOf().value
    const kbId = input.kbId ?? defaultKbId
    const corpusDir = corpusDirOf(state, kbId)
    const fileName = basename(String(input.fileName ?? 'document.txt')).replace(/[\\/:*?"<>|]/g, '_')
    const ext = fileName.toLowerCase().split('.').pop() ?? ''
    if (!['pdf', 'txt', 'md'].includes(ext)) {
      throw new WorkbenchApiError('bad-request', '仅支持 .pdf / .txt / .md 文件')
    }
    const buffer = Buffer.from(String(input.contentBase64 ?? ''), 'base64')
    if (buffer.length === 0) throw new WorkbenchApiError('bad-request', '文件内容为空')
    if (buffer.length > 20 * 1024 * 1024) throw new WorkbenchApiError('too-large', '文件超过 20MB 限制', 413)

    await mkdir(corpusDir, { recursive: true })
    const text = await extractDocumentText(fileName, buffer)
    if (!text.trim()) throw new WorkbenchApiError('bad-request', '解析后没有可索引的文本内容')

    // Avoid clobbering: suffix the timestamp when the name already exists.
    let target = join(corpusDir, fileName)
    if ((await stat(target).catch(() => null)) !== null) {
      const dot = fileName.lastIndexOf('.')
      const base = dot > 0 ? fileName.slice(0, dot) : fileName
      const suffix = dot > 0 ? fileName.slice(dot) : ''
      target = join(corpusDir, `${base}-${Date.now().toString(36)}${suffix}`)
    }
    await writeFile(target, buffer)

    const chunks = chunkText(text, state.rag.chunkSize, state.rag.chunkOverlap).length
    // Rebuild the KB index (BM25 + vectors when configured) so retrieval is fresh.
    await rebuildRag(kbId).catch(() => undefined)
    return { ok: true, name: basename(target), chars: text.length, chunks }
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

  // --- V4.2: .workbench code index tools -------------------------------------
  // workbench_code_index keeps the per-directory `.workbench` index fresh:
  // `scan` returns the structural outline (blocks with line ranges) so the
  // model can annotate without re-reading files, then `commit` merges the
  // annotations and writes `<dir>/.workbench/<timestamp>.md` + `latest.md`.
  // workbench_code_locate searches those indexes and returns exact line
  // ranges, so later sessions jump straight to the code.
  try {
    ctx.effect(() =>
      tools.register(
        defineTool({
          name: 'workbench_code_index',
          description:
            '维护目录的 .workbench 代码索引(功能块 → 文件+起始/结束行)。每次生成或修改代码后调用: 先用 action=scan 查看该目录的功能块结构(无需读整文件), 再调用 action=commit 提交每个功能块的功能注释, 工具会为目录下每个含代码的子目录分别写入 .workbench/<时间戳>.md 快照与 latest.md。',
          parameters: {
            action: {
              type: 'string',
              enum: ['scan', 'commit'],
              required: true,
              description: 'scan=扫描目录返回功能块结构(供你注释); commit=合并功能注释并写入 .workbench 索引',
            },
            dir: { type: 'string', required: true, description: '要索引的代码目录(绝对路径)' },
            max_blocks: { type: 'number', description: 'scan 时最多返回的功能块数, 默认 500' },
            note: { type: 'string', description: 'commit 时本次变更说明(写入快照的「本次变更」小节)' },
            annotations: {
              type: 'array',
              description: 'commit 时每个功能块的功能注释; 按 scan 返回的 path + name + start_line 匹配',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true, description: '相对扫描根的路径(scan 返回的 path)' },
                  name: { type: 'string', required: true, description: '功能块名称(scan 返回的 name)' },
                  start_line: { type: 'integer', required: true, description: '起始行(scan 返回的 start_line)' },
                  summary: { type: 'string', description: '功能描述(一句话, 检索命中的主要依据)' },
                  inputs: { type: 'string', description: '输入/入参' },
                  outputs: { type: 'string', description: '输出/返回' },
                  side_effects: { type: 'string', description: '副作用/外部影响' },
                  depends_on: { type: 'string', description: '依赖的其它块/模块' },
                },
              },
            },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          async execute(args): Promise<Record<string, JsonValue>> {
            const root = String(args.dir ?? '').trim()
            if (!root) throw new Error('缺少 dir 参数')
            if (args.action === 'scan') {
              const res = await scanDirectory(root, {
                maxBlocks: typeof args.max_blocks === 'number' ? args.max_blocks : undefined,
              })
              return {
                action: 'scan',
                root: res.root,
                index_dirs: res.indexDirs,
                files: res.files,
                blocks: res.blocks,
                skipped: res.skipped,
                truncated: res.truncated,
              } as unknown as Record<string, JsonValue>
            }
            const raw = Array.isArray(args.annotations) ? args.annotations : []
            const annotations: CodeBlock[] = raw.map((a) => {
              const item = a as Record<string, unknown>
              return {
                path: String(item.path ?? ''),
                name: String(item.name ?? ''),
                startLine: Number(item.start_line ?? 0),
                endLine: 0,
                kind: 'other',
                signature: '',
                doc: '',
                preview: '',
                summary: typeof item.summary === 'string' ? item.summary : undefined,
                inputs: typeof item.inputs === 'string' ? item.inputs : undefined,
                outputs: typeof item.outputs === 'string' ? item.outputs : undefined,
                sideEffects: typeof item.side_effects === 'string' ? item.side_effects : undefined,
                dependsOn: typeof item.depends_on === 'string' ? item.depends_on : undefined,
              }
            })
            const res = await commitIndex(root, annotations, typeof args.note === 'string' ? args.note : '')
            return { action: 'commit', ...res } as unknown as Record<string, JsonValue>
          },
        }),
      ),
    )
  } catch (error) {
    console.error('[dsh-workbench] workbench_code_index 注册失败:', error)
  }

  try {
    ctx.effect(() =>
      tools.register(
        defineTool({
          name: 'workbench_code_locate',
          description:
            '在目录(及其子目录)的 .workbench 代码索引中定位功能块, 返回「文件 + 起始行/结束行 + 功能描述」。写代码前需要找到已有函数/组件/类/方法的位置时使用; 命中后直接按行读取对应文件, 不要整文件扫描。',
          parameters: {
            query: { type: 'string', required: true, description: '要定位的功能关键词或描述(函数名/组件名/功能点)' },
            dir: { type: 'string', required: true, description: '代码目录(绝对路径); 会递归搜索其下所有 .workbench/latest.md' },
            top_k: { type: 'number', description: '最多返回条数, 默认 10' },
          },
          output: {
            schema: {
              type: 'array',
              items: { type: 'object', additionalProperties: true },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          async execute(args): Promise<Record<string, JsonValue>[]> {
            const dir = String(args.dir ?? '').trim()
            if (!dir) throw new Error('缺少 dir 参数')
            const groups = await locateInIndexes(dir, String(args.query ?? ''), typeof args.top_k === 'number' ? args.top_k : 10)
            if (groups.length === 0) {
              return [
                {
                  hint: `目录 ${dir} 下未找到 .workbench 索引; 请先调用 workbench_code_index(action=scan, dir=...) 查看结构并 action=commit 生成索引`,
                },
              ] as unknown as Record<string, JsonValue>[]
            }
            return groups as unknown as Record<string, JsonValue>[]
          },
        }),
      ),
    )
  } catch (error) {
    console.error('[dsh-workbench] workbench_code_locate 注册失败:', error)
  }

  // --- V7: project status / health (项目状态) ---------------------------------
  // 在代码索引之上叠加「项目体检」: 依赖图 / 调用图 / 注释覆盖 / TODO 标记,
  // 结合工作台配置侧能力(RAG/MCP/技能/工具/工作流)的实时健康, 合成六维
  // 状态报告并落盘 <root>/.workbench/project-status.{md,json}。面板与模型
  // 工具 workbench_project_status 均读取同一份报告, 让模型改代码前先看概况。
  const projectStatusCache = new Map<string, { sig: string; report: ProjectStatusReport }>()

  function defaultProjectDir(state: WorkbenchState): string {
    const dirs = state.indexWatchDirs.map((d) => d.trim()).filter((d) => d.length > 0)
    return dirs[0] ?? ''
  }

  /** Collect the config-side health signals from the live workbench state. */
  async function buildProjectSignals(agent: AgentLike | undefined): Promise<ConfigSignals> {
    const state = viewOf().value
    const ragInfo = ragCaches.get(defaultKbId)?.info
    const ragConfigured = state.rag.knowledgeBases.length > 0 || (state.rag.corpusDir || config.corpusDir) !== ''
    const servers = state.mcpServers
    const connectedCount = servers.filter((s) => s.enabled && mcpConnections.get(s.id)?.connected).length
    const mcpTools = servers.reduce((a, s) => a + (mcpConnections.get(s.id)?.tools.length ?? 0), 0)
    const mcpErrors: string[] = []
    for (const [, conn] of mcpConnections) if (conn.error) mcpErrors.push(conn.error)
    const skillsSvc = serviceFromAgent(agent, 'skills', ctx.skills)
    const skills = await listSkills(agent ?? undefined, skillsSvc)
    const toolsSvc = serviceFromAgent(agent, 'tools', tools)
    const toolList = listTools(agent ?? undefined, toolsSvc)
    const workflows = state.workflows
    const active = workflows.find((w) => w.id === state.activeWorkflowId) ?? workflows[0]
    return {
      rag: {
        configured: ragConfigured,
        built: ragInfo !== undefined && ragInfo.lastBuiltAt !== null,
        docCount: ragInfo?.docCount ?? 0,
        chunkCount: ragInfo?.chunkCount ?? 0,
        engine: state.rag.engine,
        error: ragInfo?.error,
      },
      mcp: { total: servers.length, connected: connectedCount, tools: mcpTools, errors: mcpErrors },
      skills: { total: skills.length, names: skills.map((s) => s.name) },
      tools: { total: toolList.length, hidden: toolList.filter((t) => t.hiddenFromModel).length },
      workflows: { total: workflows.length, active: active?.id ?? '', activeName: active?.name ?? '' },
    }
  }

  async function getProjectStatus(dir: string, force = false, sessionId?: string): Promise<ProjectStatusReport> {
    const target = dir.trim() || defaultProjectDir(viewOf().value)
    if (!target) throw new WorkbenchApiError('bad-request', '缺少项目目录且未配置 indexWatchDirs')
    const root = resolve(target)
    const cached = projectStatusCache.get(root)
    if (!force && cached) {
      const sig = await codeDirSignature(root).catch(() => '')
      if (sig === cached.sig) return cached.report
    }
    const agent = sessionId === undefined ? undefined : ctx.agents.get(sessionId)
    const code = await analyzeCode(root)
    const signals = await buildProjectSignals(agent)
    const report = buildReport(root, code, signals)
    projectStatusCache.set(root, { sig: report.signature, report })
    await writeProjectStatus(root, report).catch((e) => console.error('[dsh-workbench] 项目状态落盘失败:', e))
    return report
  }

  async function readProjectFile(dir: string, file: string, startLine: number, endLine: number): Promise<ReadFileResult> {
    return readFileRange(dir, file, startLine, endLine)
  }

  try {
    ctx.effect(() =>
      tools.register(
        defineTool({
          name: 'workbench_project_status',
          description:
            '读取工作区项目代码的整体状态与健康报告(依赖图/调用图/注释覆盖/TODO标记, 以及 RAG/MCP/技能/工具/工作流 六维健康度), 并返回可定位的代码文件+行号。改代码或加功能前先调用它"看一遍项目大概", 避免盲目改动引入兼容性问题。',
          parameters: {
            dir: { type: 'string', description: '项目代码目录(绝对路径); 省略时使用 settings 中 indexWatchDirs 的第一个目录' },
            refresh: { type: 'boolean', description: '是否强制重新扫描(默认读取缓存, 代码变化会自动失效)' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          async execute(args): Promise<Record<string, JsonValue>> {
            const state = viewOf().value
            const dir = String(args.dir ?? '').trim() || defaultProjectDir(state)
            if (!dir) throw new Error('缺少 dir 参数且未配置 indexWatchDirs')
            const report = await getProjectStatus(dir, args.refresh === true)
            return report as unknown as Record<string, JsonValue>
          },
        }),
      ),
    )
  } catch (error) {
    console.error('[dsh-workbench] workbench_project_status 注册失败:', error)
  }

  // --- system prompt wiring -------------------------------------------------
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'workbench:search',
      order: 120,
      text: '工作台知识库已可用: 当问题需要检索工作台语料(本地文档目录)时调用 workbench_search。',
    }),
  )
  // V4.2: code-index convention — keep the per-directory .workbench indexes
  // fresh after every code change, and locate existing code through them
  // instead of re-reading whole files (saves tokens and keeps line ranges).
  // V5: directories listed in settings `indexWatchDirs` are auto-maintained by
  // the host watcher, so their line numbers are always current.
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'workbench:code-index',
      order: 130,
      text: '代码索引强制约定(.workbench): ① 修改 src 下任何代码前, 必须先调用 workbench_code_locate(dir=<代码目录>, query=<要修改的函数/组件/类名或功能点>) 定位涉及的功能块, 再按返回的「文件+起始/结束行」精确读取; 禁止直接 read 整个文件——仅当 locate 无命中或返回范围不足以覆盖修改点时, 才允许降级为 read 相关文件并按行读取。② workbench_code_find 作为补充: locate 未命中(目录尚无索引)或索引疑似过期时, 先用它按符号名实时扫描。③ 每次生成或修改代码后, 必须调用 workbench_code_index(action=scan 查看功能块结构与行范围 → action=commit 提交功能注释) 更新索引; settings 中 indexWatchDirs 配置的目录由宿主自动维护行号, 行号始终与当前代码一致。',
    }),
  )
  // V7: project status convention — read the health report before touching code.
  ctx.effect(() =>
    ctx.systemPrompt.section({
      name: 'workbench:project-status',
      order: 140,
      text: '项目状态约定: 在修改工作区代码或新增功能前, 先调用 workbench_project_status(dir=<项目代码目录>) 读取项目的依赖图/调用图/注释覆盖与六维健康度, 像人一样先看清项目全貌, 再决定改动点, 避免盲目修改引发兼容性或其它意外问题。',
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
        return `【生效提示词: ${active.name}】(以下为当前必须严格遵守的指令, 请完整按其要求执行, 不要省略其中的格式与步骤要求)\n${safePromptText(active.content)}`
      },
    }),
  )

  // --- projections ----------------------------------------------------------
  /**
   * Project the skill catalog as one scope sees it. `agentScope` is the live
   * agent (viewed through the agent's own skills instance); when absent, the
   * host skills instance's global view is used.
   */
  async function listSkills(agentScope: unknown, svc: SkillsServiceLike): Promise<SkillView[]> {
    const summaries = await svc.list({ scope: agentScope }).catch(() => [] as SkillSummary[])
    return summaries.map((s) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse,
      provider: s.provider,
    }))
  }

  /**
   * List EVERY registered tool as one scope sees them: visible ones from the
   * registry plus the ones this workbench has hidden via restrict (they read
   * as absent from the registry, so they are re-attached here with a hidden
   * marker so the panel can still show and restore them). `agentScope` is the
   * live agent (viewed through the agent's own tools instance); when absent,
   * the host tools instance's global view is used.
   */
  function listTools(agentScope: unknown, svc: ToolsServiceLike): ToolView[] {
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
    const visible: ToolView[] = svc.schemas(agentScope ?? undefined).map((t) => ({
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
  /**
   * V4: run one workflow. Node mode walks the node list with REAL execution:
   * `tool` nodes call the agent's own tools instance (same scope as the
   * session's model), `skill` nodes load the skill body. `sessionId` selects
   * the live agent so the agent-scope registries are used. Without an agent the
   * old dry-run (registry check only) applies.
   */
  async function runWorkflow(id: string, inputs: Record<string, string>, sessionId?: string): Promise<WorkflowStepLog[]> {
    const state = viewOf().value
    const workflow = state.workflows.find((w) => w.id === id)
    if (!workflow) throw new WorkbenchApiError('not-found', `工作流 "${id}" 不存在`, 404)
    const agent = sessionId === undefined ? undefined : ctx.agents.get(sessionId)
    const toolsSvc = serviceFromAgent(agent, 'tools', tools)
    const skillsSvc = serviceFromAgent(agent, 'skills', ctx.skills)
    return executeWorkflow(workflow, inputs, {
      resolve: (toolName) => {
        const def = toolsSvc.get(toolName, agent ?? undefined)
        return def ? { name: def.name, description: def.description } : null
      },
      executeTool: async (name, args) => {
        if (agent === undefined) return { ok: false, error: '真实执行需要活跃会话 (sessionId)' }
        const def = toolsSvc.get(name, agent)
        if (!def) return { ok: false, error: `工具 "${name}" 未注册` }
        try {
          const result = await toolsSvc.execute({
            callId: `workbench-wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as unknown as CallId,
            name,
            arguments: args ?? {},
            agent,
            signal: new AbortController().signal,
          })
          return { ok: true, value: projectResult(result) }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
      getSkill: async (name) => {
        if (agent === undefined || typeof skillsSvc.get !== 'function') return undefined
        try {
          const skill = await skillsSvc.get(name, { scope: agent })
          if (!skill) return undefined
          return { name: skill.name, description: skill.description, body: skill.body }
        } catch {
          return undefined
        }
      },
    })
  }
  /**
   * V4.1: live script-run registry. `workflow.runScript` publishes its run here
   * and the engine's `workflow/*` events project into each run's progress so
   * the panel can poll `workflow.progress` and cancel via `workflow.cancel`.
   */
  type ScriptRunEntry = { run: ReturnType<WorkflowEngineLike['start']>; progress: WorkflowProgress }
  const scriptRuns = new Map<string, ScriptRunEntry>()

  const progressOf = (info: unknown): WorkflowProgress | undefined => {
    const id = isRecord(info) ? (info as { id?: unknown }).id : undefined
    return typeof id === 'string' ? scriptRuns.get(id)?.progress : undefined
  }

  // Project the engine's workflow/* lifecycle events into the matching run's
  // progress buffer. The listeners live for the plugin's whole lifetime and
  // filter by run id, so concurrent runs never cross-contaminate.
  if (ctx.on) {
    const disposers: Array<() => void> = []
    disposers.push(ctx.on('workflow/phase', (info: unknown, title: unknown) => {
      const p = progressOf(info)
      if (p) p.entries.push({ kind: 'phase', text: String(title ?? ''), at: Date.now() })
    }))
    disposers.push(ctx.on('workflow/log', (info: unknown, message: unknown) => {
      const p = progressOf(info)
      if (p) p.entries.push({ kind: 'log', text: String(message ?? ''), at: Date.now() })
    }))
    disposers.push(ctx.on('workflow/agent-start', (info: unknown, agent: unknown) => {
      const p = progressOf(info)
      if (!p || !isRecord(agent)) return
      p.entries.push({
        kind: 'agent-start',
        seq: typeof agent['seq'] === 'number' ? agent['seq'] : undefined,
        label: typeof agent['label'] === 'string' ? agent['label'] : undefined,
        at: Date.now(),
      })
    }))
    disposers.push(ctx.on('workflow/agent-end', (info: unknown, agent: unknown) => {
      const p = progressOf(info)
      if (!p || !isRecord(agent)) return
      p.entries.push({
        kind: 'agent-end',
        seq: typeof agent['seq'] === 'number' ? agent['seq'] : undefined,
        outcome: typeof agent['outcome'] === 'string' ? agent['outcome'] : undefined,
        at: Date.now(),
      })
    }))
    ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-workbench: workflow progress projection')
  }

  /**
   * V4.1: run one workflow in SCRIPT mode — delegates to the DSH workflowEngine
   * (the same engine behind the model-facing `workflow` tool): the JS
   * orchestration script runs on a worker thread and fans out real subagents
   * via agent()/pipeline()/parallel(). Returns IMMEDIATELY with the runId;
   * the run settles in the background and its outcome lands on
   * `workflow.progress` (status + value + error), which the panel polls.
   */
  async function runScriptWorkflow(id: string, inputs: Record<string, string>, sessionId?: string): Promise<WorkflowScriptResult> {
    const state = viewOf().value
    const workflow = state.workflows.find((w) => w.id === id)
    if (!workflow) throw new WorkbenchApiError('not-found', `工作流 "${id}" 不存在`, 404)
    const script = workflow.script ?? ''
    if (!script.trim()) throw new WorkbenchApiError('bad-request', '脚本工作流缺少 script 正文')
    const agent = sessionId === undefined ? undefined : ctx.agents.get(sessionId)
    // workflowEngine lives behind the preset's `isolate: { workflowEngine }` realm,
    // so it is invisible to host ctx.get() AND agent.ctx.get(); agentPresets.
    // serviceFor() is the documented way a host reader holding the agent reads it.
    const engine =
      (agent !== undefined
        ? (ctx.agentPresets.serviceFor(agent, 'workflowEngine') as WorkflowEngineLike | undefined)
        : undefined) ?? (ctx.get('workflowEngine') as WorkflowEngineLike | undefined)
    if (!engine || typeof engine.start !== 'function') {
      throw new WorkbenchApiError('unavailable', 'workflowEngine 服务不可用 (当前预设未挂载工作流引擎)', 503)
    }
    const meta = workflow.meta ?? { name: workflow.name, description: workflow.description }
    const run = engine.start({
      script,
      meta: {
        name: meta.name || workflow.name,
        description: meta.description || workflow.description,
        ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
        ...(meta.phases && meta.phases.length > 0 ? { phases: meta.phases } : {}),
      },
      ...(Object.keys(inputs).length > 0 ? { args: inputs } : {}),
      ...(agent !== undefined ? { parent: agent } : {}),
      signal: new AbortController().signal,
    })
    // Publish the run so workflow/* events project into live progress and the
    // panel can cancel by runId. Settlement happens in the background.
    const progress: WorkflowProgress = { runId: run.id, status: 'running', agentsStarted: 0, entries: [] }
    scriptRuns.set(run.id, { run, progress })
    void run.result
      .then((result) => {
        progress.status = result.stopReason === 'completed' ? 'completed' : result.stopReason === 'cancelled' ? 'cancelled' : 'error'
        progress.agentsStarted = result.agentsStarted
        if (result.value !== undefined) progress.value = result.value
        if (result.error) progress.error = result.error
      })
      .catch((error) => {
        progress.status = 'error'
        progress.error = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        void run.dispose().catch(() => undefined)
        // Keep the progress readable briefly after settling so a racing poll
        // does not 404, then drop the entry.
        const runId = run.id
        setTimeout(() => scriptRuns.delete(runId), 60_000).unref?.()
      })
    return { runId: run.id, agentsStarted: 0, stopReason: 'running' }
  }
  /** V4.1: read the live progress of one script-mode run (or 404 when expired). */
  async function workflowProgress(runId: string): Promise<WorkflowProgress> {
    const entry = scriptRuns.get(runId)
    if (!entry) throw new WorkbenchApiError('not-found', `运行 "${runId}" 不存在或已过期`, 404)
    return entry.progress
  }

  /** V4.1: cancel a running script-mode workflow by run id. Idempotent no-op for unknown ids. */
  async function cancelScript(runId: string): Promise<{ cancelled: boolean }> {
    const entry = scriptRuns.get(runId)
    if (!entry || entry.progress.status !== 'running') return { cancelled: false }
    entry.run.cancel('user cancelled from the workbench panel')
    return { cancelled: true }
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
    /**
     * Snapshot for the browser panel. `sessionId` (when the panel knows it)
     * lets the projection resolve the LIVE agent's own tools/skills instances,
     * so the 「工具」「技能」 modules show exactly what that session's model
     * sees — not just the host-plane global registrations. Without an agent
     * (cold/blank session) the global view is used.
     */
    async state(sessionId?: string): Promise<StateSnapshot> {
      const view = viewOf()
      const agent = sessionId === undefined ? undefined : ctx.agents.get(sessionId)
      const toolsSvc = serviceFromAgent(agent, 'tools', tools)
      const skillsSvc = serviceFromAgent(agent, 'skills', ctx.skills)
      const mcpStatus: Record<string, McpConnectionStatus> = {}
      for (const [id, conn] of mcpConnections) {
        mcpStatus[id] = { connected: conn.connected, tools: conn.tools, error: conn.error }
      }
      return {
        value: view.value,
        revision: view.revision,
        skills: await listSkills(agent ?? undefined, skillsSvc),
        tools: listTools(agent ?? undefined, toolsSvc),
        rag: ragCaches.get(defaultKbId) ? { ...ragCaches.get(defaultKbId)!.info } : null,
        mcpStatus,
      }
    },
    updateState,
    rebuildRag,
    searchRag,
    upsertKnowledgeBase,
    removeKnowledgeBase,
    uploadDocument,
    testServer,
    upsertServer,
    removeServer,
    toggleServer,
    upsertWorkflow,
    removeWorkflow,
    runWorkflow,
    runScript: (id: string, inputs: Record<string, string>, sessionId?: string) => runScriptWorkflow(id, inputs, sessionId),
    scriptProgress: (runId: string) => workflowProgress(runId),
    cancelScript: (runId: string) => cancelScript(runId),
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
    // V7: project status / health.
    projectStatus: (dir: string, force: boolean, sessionId?: string) => getProjectStatus(dir, force, sessionId),
    readProjectFile: (dir: string, file: string, startLine: number, endLine: number) => readProjectFile(dir, file, startLine, endLine),
  }

  // --- RPC route ------------------------------------------------------------
  ctx.effect(() => registerApiRoutes(ctx.webServer, runtime), 'dsh-workbench: /workbench/api routes')

  // V5: built-in .workbench index watcher lifecycle. Reconfigured by every
  // settings update (restartIndexWatch) and fully disposed with the plugin.
  ctx.effect(() => {
    restartIndexWatch()
    return () => {
      if (indexWatchDispose) {
        indexWatchDispose()
        indexWatchDispose = null
      }
    }
  }, 'dsh-workbench: built-in index watch')

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

  // V6: preset auto-configure → mount-verify → GitHub publish pipeline.
  // Runs once per plugin activation — i.e. whenever someone downloads/installs
  // this plugin into a DSH. Configures the bundled workbench preset into
  // $DSH_HOME/.agent-presets, verifies it mounts (standingKeyFor), and after
  // verification uploads the workspace to GitHub as the updated version (only
  // from the owner's git worktree; downloader installs skip the push).
  void runPublishPipeline({
    agentPresets: ctx.agentPresets,
    dshHome: homedir(),
    getState: () => viewOf().value.publish,
    recordStatus: async (status: string) => {
      const view = viewOf()
      await ctx.settings
        .update(SETTINGS_NS, { publish: { ...view.value.publish, lastStatus: status, lastAt: Date.now() } })
        .catch(() => undefined)
    },
  })
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
