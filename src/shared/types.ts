/**
 * Shared JSON wire types between the host RPC routes and the browser panel.
 * Everything here is lossless-JSON friendly — no functions, classes or live
 * harness objects cross the boundary.
 */

/** One MCP server entry the workbench manages (persisted in settings). */
export interface McpServerConfig {
  /** Stable unique id (slug). */
  id: string
  /** Display name. */
  name: string
  /** Transport kind: stdio (local command) or http (remote streamable HTTP). */
  transport: 'stdio' | 'http'
  /** stdio: executable (e.g. npx, node, uvx). */
  command?: string
  /** stdio: extra arguments. */
  args?: string[]
  /** stdio: environment overrides (shallow object). */
  env?: Record<string, string>
  /** http: remote endpoint URL. */
  url?: string
  /** http: extra request headers. */
  headers?: Record<string, string>
  /** Whether the server is enabled (workbench-level toggle). */
  enabled: boolean
}

/** Result of a connection test against one MCP server. */
export interface McpTestResult {
  ok: boolean
  /** Transport description for display. */
  transport: string
  /** Tool names exposed by the server, when the handshake succeeded. */
  tools?: string[]
  /** Human-readable error when !ok. */
  error?: string
}

/** One workflow node. V4 adds `skill` (read a skill body) alongside the V1 kinds. */
export interface WorkflowNode {
  id: string
  /** What this node does. */
  kind: 'prompt' | 'transform' | 'tool' | 'skill' | 'output'
  /** Short display label. */
  label: string
  /** Kind-specific parameters (JSON-friendly). */
  params: Record<string, string>
}

/** V4: workflow script metadata mirroring the DSH `workflow` tool's `meta` block. */
export interface WorkflowScriptMeta {
  name?: string
  description?: string
  whenToUse?: string
  phases?: Array<{ title: string; detail?: string; provider?: string; model?: string }>
}

/** One workflow definition (persisted in settings). */
export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  /** V4: execution mode — `nodes` (visual node list, real execution) or `script` (DSH workflowEngine JS orchestration). */
  mode?: 'nodes' | 'script'
  /** V4: JS orchestration script body (mode = 'script'); mirrors the DSH `workflow` tool's `script` parameter. */
  script?: string
  /** V4: script identity block (mode = 'script'); mirrors the DSH `workflow` tool's `meta` parameter. */
  meta?: WorkflowScriptMeta
}

/** One step of an execution trace (real execution since V4; dry-run in V1–V3). */
export interface WorkflowStepLog {
  index: number
  nodeId: string
  label: string
  status: 'ok' | 'skipped' | 'error' | 'running'
  detail: string
  /** V4.1: full text carried by the `output` node (uncapped), shown expandable in the panel. */
  full?: string
}

/** V4: result of a script-mode workflow run (via ctx.workflowEngine). */
export interface WorkflowScriptResult {
  runId?: string
  agentsStarted?: number
  value?: unknown
  stopReason?: string
  error?: string
}

/** One projected script-mode progress event (from the engine's workflow/* events). */
export interface WorkflowProgressEntry {
  kind: 'phase' | 'log' | 'agent-start' | 'agent-end'
  /** phase/log text. */
  text?: string
  /** agent seq (agent-start / agent-end). */
  seq?: number
  /** agent label (agent-start). */
  label?: string
  /** agent outcome: completed | failed | cancelled (agent-end). */
  outcome?: string
  /** epoch ms of the event. */
  at: number
}

/** V4.1: live progress of one script-mode run, polled by the panel. */
export interface WorkflowProgress {
  runId: string
  status: 'running' | 'completed' | 'cancelled' | 'error'
  agentsStarted: number
  entries: WorkflowProgressEntry[]
  value?: unknown
  error?: string
}

/** One prompt template (persisted in settings). */
export interface PromptTemplate {
  id: string
  name: string
  /** Template body; {{var}} placeholders are substituted on preview. */
  content: string
  /** V2.1: epoch ms of the last activation (drives the "recent" list). */
  lastUsedAt?: number
}

/** V2.1: one knowledge base = one user-selected folder. */
export interface KnowledgeBase {
  id: string
  name: string
  /** Absolute path of the corpus folder. */
  path: string
}

/** A registered tool, projected for display. */
export interface ToolView {
  name: string
  description: string
  /** Compact parameter JSON schema, when available. */
  parameters?: unknown
  /** V2.3: true when this tool is currently hidden from the model by the workbench. */
  hiddenFromModel?: boolean
}

/** A registered skill, projected for display. */
export interface SkillView {
  name: string
  description: string
  whenToUse?: string
  provider: string
}

/** RAG index information. */
export interface RagIndexInfo {
  corpusDir: string
  docCount: number
  chunkCount: number
  lastBuiltAt: number | null
  lastBuildMs: number | null
  error?: string
  /** V2: number of embedded vectors when a vector/hybrid index exists. */
  vectorCount?: number
  /** V2: embedding model label used for the last vector build. */
  embeddingModel?: string
}

/** One search hit from workbench_search / the RAG panel. */
export interface SearchHit {
  score: number
  file: string
  chunkIndex: number
  /** Chunk excerpt with the matched terms. */
  snippet: string
}

/** V2: OpenAI-compatible embeddings endpoint configuration. */
export interface EmbeddingConfig {
  /** e.g. https://api.openai.com/v1 or https://api.deepseek.com */
  baseUrl: string
  apiKey: string
  model: string
}

/** V3: mechanism override mode. 'default' = DSH's original mechanism untouched. */
export type OverrideMode = 'default' | 'workbench'
/** V3.1: RAG mechanism may additionally be a custom retrieval mode. */
export type RagOverrideMode = 'default' | 'workbench' | 'custom'

/** V3: which capability domains the workbench currently replaces. */
export interface MechanismOverrides {
  rag: RagOverrideMode
  tools: OverrideMode
  skills: OverrideMode
  workflow: OverrideMode
}

/** V6: preset auto-configure → verify → GitHub publish pipeline settings. */
export interface PublishSettings {
  /** Master switch for the whole pipeline. */
  enabled: boolean
  /** Agent-preset id the plugin bundles and auto-configures (default workbench). */
  presetId: string
  /** GitHub repository to upload (overwrite) the plugin workspace into. */
  repo: string
  /** Remote branch to push. */
  branch: string
  /** Upload to GitHub automatically after verification (owner worktree only). */
  autoPush: boolean
  /** Last pipeline run result (recorded by the host on each activation). */
  lastStatus: string
  /** Epoch ms of the last pipeline run. */
  lastAt: number
}

/** The complete persisted workbench state (settings view). */
export interface WorkbenchState {
  rag: {
    corpusDir: string
    /** V2.1: user-managed knowledge bases (folder → corpus). */
    knowledgeBases: KnowledgeBase[]
    chunkSize: number
    chunkOverlap: number
    topK: number
    /** bm25 | vector | hybrid (RRF fusion). vector/hybrid need embeddings. */
    engine: 'bm25' | 'vector' | 'hybrid'
    embedding: EmbeddingConfig
    /** V3.1: target knowledge base id when the RAG mechanism points at a KB. */
    ragTargetKbId: string
    /** V3.1: custom retrieval parameters used by the custom RAG mode. */
    ragCustom: { topK: number; threshold: number }
  }
  mcpServers: McpServerConfig[]
  workflows: WorkflowDefinition[]
  /** V3: the workflow the model should execute under the workflow mechanism. */
  activeWorkflowId: string
  prompts: PromptTemplate[]
  activePromptId: string
  /** Workbench-local enable flags per tool name. */
  toolToggles: Record<string, boolean>
  /** Workbench-local enable flags per skill name. */
  skillToggles: Record<string, boolean>
  /** V3: mechanism replacement switches (default = DSH original behavior). */
  overrides: MechanismOverrides
  /** V5: directories whose `.workbench` indexes the host auto-maintains. */
  indexWatchDirs: string[]
  /** V6: preset auto-configure → verify → GitHub publish pipeline. */
  publish: PublishSettings
}

/** V2: live connection status of one MCP server (tools registered on ctx.tools). */
export interface McpConnectionStatus {
  connected: boolean
  /** Public tool names registered on the registry. */
  tools: string[]
  error?: string
}

/** Full panel snapshot returned by workbench.api/state.get. */
export interface StateSnapshot {
  value: WorkbenchState
  revision: number
  skills: SkillView[]
  tools: ToolView[]
  rag: RagIndexInfo | null
  /** V2: live MCP connection status per server id. */
  mcpStatus: Record<string, McpConnectionStatus>
  /** V7: the current session's workspace directory (canonical cwd), or '' when unknown. */
  workspace: string
}

// --- 项目状态 (project status / health report) -------------------------------

export type HealthLevel = 'good' | 'warn' | 'error'

export type DimensionId = 'rag' | 'mcp' | 'skill' | 'tool' | 'workflow' | 'structure'

/** One clickable code reference (file + line range + annotation). */
export interface CodeRef {
  file: string
  name: string
  kind: string
  startLine: number
  endLine: number
  summary?: string
}

/** A file-level dependency edge. */
export interface DepEdge {
  from: string
  to: string
  /** true when `to` is an external package specifier, not a project file. */
  external: boolean
}

/** A function-level call edge. */
export interface CallEdge {
  from: string
  fromBlock: string
  fromLine: number
  to: string
  /** file where `to` is defined ('' when unresolved/external). */
  toFile: string
  external: boolean
}

export interface FileStat {
  file: string
  lines: number
  blocks: number
  annotated: number
  todos: number
  fixmes: number
}

export interface TodoLocation {
  file: string
  line: number
  tag: string
  text: string
}

/** One capability dimension's status + health. */
export interface DimensionStatus {
  id: DimensionId
  status: string
  health: HealthLevel
  /** 0-100 health score. */
  score: number
  detail: string
  refs: CodeRef[]
}

export interface ProjectStatusSummary {
  files: number
  blocks: number
  annotatedBlocks: number
  annotationCoverage: number
  todoCount: number
  fixmeCount: number
  bigFiles: string[]
  indexMissing: boolean
  staleIndex: boolean
  healthScore: number
  health: HealthLevel
  dependencyCount: number
  callCount: number
}

export interface ProjectStatusReport {
  root: string
  generatedAt: number
  signature: string
  summary: ProjectStatusSummary
  dimensions: DimensionStatus[]
  files: FileStat[]
  dependencies: DepEdge[]
  calls: CallEdge[]
  todos: TodoLocation[]
}

/** A bounded source line range returned by projectstatus.readFile. */
export interface ReadFileResult {
  path: string
  startLine: number
  endLine: number
  totalLines: number
  lines: Array<{ n: number; text: string }>
}
