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

/** One workflow node. V1 kinds are deterministic, side-effect-free steps. */
export interface WorkflowNode {
  id: string
  /** What this node does. */
  kind: 'prompt' | 'transform' | 'tool' | 'output'
  /** Short display label. */
  label: string
  /** Kind-specific parameters (JSON-friendly). */
  params: Record<string, string>
}

/** One workflow definition (persisted in settings). */
export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
}

/** One step of a dry-run execution trace. */
export interface WorkflowStepLog {
  index: number
  nodeId: string
  label: string
  status: 'ok' | 'skipped' | 'error'
  detail: string
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
  }
  mcpServers: McpServerConfig[]
  workflows: WorkflowDefinition[]
  prompts: PromptTemplate[]
  activePromptId: string
  /** Workbench-local enable flags per tool name. */
  toolToggles: Record<string, boolean>
  /** Workbench-local enable flags per skill name. */
  skillToggles: Record<string, boolean>
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
}
