/**
 * 项目状态/健康分析 —— 让模型"像人一样看一遍项目大概"。
 *
 * 在代码索引(.workbench)之上再叠加一层「项目体检」:
 * - 依赖图: 解析 import/require/from-import 得到 文件→文件 依赖边;
 * - 调用图: 启发式匹配函数体内标识符, 得到 函数→函数 调用边;
 * - 框架/结构: 每个文件的功能块数、注释覆盖、行数、TODO/FIXME 标记;
 * - 六维状态: RAG / MCP / 技能 / 工具 / 工作流 / 结构(调用依赖拓扑),
 *   每维给出「状态 + 健康度(分数/级别)」, 并附带可定位的代码引用;
 * - 落盘: <root>/.workbench/project-status.md + project-status.json(字符形式)。
 *
 * 本模块只依赖 codeindex.ts(纯函数), 不反向依赖 index.ts; 配置侧健康信号
 * (RAG 索引 / MCP 连接 / 技能 / 工具 / 工作流)由宿主以 ConfigSignals 传入。
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, resolve, relative, dirname, basename, sep } from 'node:path'
import {
  listCodeFiles,
  scanFileText,
  collectWorkbenchIndexes,
  codeDirSignature,
  timestampName,
} from './codeindex.js'
import type { CodeBlock } from './codeindex.js'
import type {
  HealthLevel,
  DimensionId,
  CodeRef,
  DepEdge,
  CallEdge,
  FileStat,
  TodoLocation,
  DimensionStatus,
  ProjectStatusSummary,
  ProjectStatusReport,
  ReadFileResult,
} from './shared/types.js'

// Re-export the wire types so index.ts can import them from this module.
export type {
  HealthLevel,
  DimensionId,
  CodeRef,
  DepEdge,
  CallEdge,
  FileStat,
  TodoLocation,
  DimensionStatus,
  ProjectStatusSummary,
  ProjectStatusReport,
  ReadFileResult,
}

/** Config-side signals handed in by the host (index.ts). */
export interface ConfigSignals {
  rag: {
    configured: boolean
    built: boolean
    docCount: number
    chunkCount: number
    engine: string
    error?: string
  }
  mcp: {
    total: number
    connected: number
    tools: number
    errors: string[]
  }
  skills: { total: number; names: string[] }
  tools: { total: number; hidden: number }
  workflows: { total: number; active: string; activeName: string }
}

// --- constants ----------------------------------------------------------------

const BIG_FILE_LINES = 800
const MAX_DEP_EDGES = 400
const MAX_CALL_EDGES = 600
const MAX_TODO_ITEMS = 200
const MAX_BLOCKS = 100000

// --- posix helpers (report paths are posix relative, like codeindex) ----------

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function posixDirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '.' : p.slice(0, i)
}

function posixJoin(a: string, b: string): string {
  if (a === '.' || a === '') return b
  if (b === '') return a
  return `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`
}

// --- import extraction --------------------------------------------------------

interface ImportInfo {
  spec: string
  /** local names bound by the import (used for call-edge resolution). */
  symbols: string[]
  external: boolean
}

function isRelativeSpec(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/')
}

/** Extract JS/TS import/require statements. */
function extractJsTsImports(text: string): ImportInfo[] {
  const out: ImportInfo[] = []
  const push = (spec: string, symbols: string[]): void => {
    spec = spec.trim()
    if (!spec) return
    out.push({ spec, symbols: symbols.filter(Boolean), external: !isRelativeSpec(spec) })
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let m: RegExpMatchArray | null

    // import def from 'spec'
    m = line.match(/^import\s+([A-Za-z_$][\w$]*)\s*,\s*(\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/)
    if (m) {
      push(m[3]!, [m[1]!, ...m[2]!.replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!)])
      continue
    }
    // import * as ns from 'spec'
    m = line.match(/^import\s+\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/)
    if (m) {
      push(m[2]!, [m[1]!])
      continue
    }
    // import { a, b as c } from 'spec'
    m = line.match(/^import\s+(\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/)
    if (m) {
      push(m[2]!, m[1]!.replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!))
      continue
    }
    // import def from 'spec'
    m = line.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/)
    if (m) {
      push(m[2]!, [m[1]!])
      continue
    }
    // import 'spec' (side effect)
    m = line.match(/^import\s+['"]([^'"]+)['"]/)
    if (m) {
      push(m[1]!, [])
      continue
    }
    // export ... from 'spec'
    m = line.match(/^export\s+(?:\{[^}]*\}|\*\s*as\s+[A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]/)
    if (m) {
      push(m[1]!, [])
      continue
    }
    // const x = require('spec')  /  require('spec')
    const reqRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    let rm: RegExpExecArray | null
    while ((rm = reqRe.exec(rawLine)) !== null) push(rm[1]!, [])
    // dynamic import('spec')
    const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    let dm: RegExpExecArray | null
    while ((dm = dynRe.exec(rawLine)) !== null) push(dm[1]!, [])
  }
  return out
}

/** Extract Python import statements. */
function extractPyImports(text: string): ImportInfo[] {
  const out: ImportInfo[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    let m = line.match(/^from\s+([.\w]+)\s+import\s+(.+)$/)
    if (m) {
      const names = m[2]!.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!).filter((s) => s && s !== '*')
      out.push({ spec: m[1]!, symbols: names, external: !isRelativeSpec(m[1]!) && !m[1]!.startsWith('.') })
      continue
    }
    m = line.match(/^import\s+([.\w]+)(?:\s+as\s+\w+)?$/)
    if (m) out.push({ spec: m[1]!, symbols: [m[1]!.split('.').pop()!], external: !m[1]!.startsWith('.') })
  }
  return out
}

function extractImports(relPath: string, text: string): ImportInfo[] {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'py') return extractPyImports(text)
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'svelte'].includes(ext)) {
    return extractJsTsImports(text)
  }
  return []
}

// --- TODO/FIXME extraction ----------------------------------------------------

function extractTodos(relPath: string, lines: string[]): TodoLocation[] {
  const out: TodoLocation[] = []
  const re = /\b(TODO|FIXME|HACK|XXX)\b[:\s-]*(.*)$/i
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // Only count when the marker appears in a comment or after //, #, /*, *.
    const t = line.trim()
    const inComment = t.startsWith('//') || t.startsWith('#') || t.startsWith('*') || t.startsWith('/*') || /\/\/.*(TODO|FIXME|HACK|XXX)/i.test(line)
    if (!inComment) continue
    const m = re.exec(t)
    if (m) {
      out.push({ file: relPath, line: i + 1, tag: m[1]!.toUpperCase(), text: (m[2] ?? '').slice(0, 80) })
      if (out.length >= MAX_TODO_ITEMS) return out
    }
  }
  return out
}

// --- call graph -----------------------------------------------------------------

const IDENT_RE = /[A-Za-z_$][\w$]*/g

function tokenizeIdentifiers(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(IDENT_RE)) {
    const w = m[0]
    if (!seen.has(w) && w.length > 1) {
      seen.add(w)
      out.push(w)
    }
  }
  return out
}

/**
 * Resolve a relative import specifier to a known project file (relative posix).
 * Tries common extensions and /index fallbacks.
 */
function resolveRelativeImport(fromFile: string, spec: string, knownFiles: Set<string>): string | null {
  if (!isRelativeSpec(spec)) return null
  const base = posixJoin(posixDirname(fromFile), spec.replace(/\\/g, '/')).replace(/^\.\//, '')
  const candidates = [
    base,
    `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.cjs`,
    `${base}.vue`, `${base}.svelte`, `${base}.py`,
    `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`, `${base}/index.py`,
  ]
  for (const c of candidates) if (knownFiles.has(c)) return c
  for (const f of knownFiles) if (f === base || f.startsWith(base + '.') || f.startsWith(base + '/')) return f
  return null
}

// --- code analysis ---------------------------------------------------------------

export interface CodeAnalysis {
  files: FileStat[]
  blocks: CodeBlock[]
  dependencies: DepEdge[]
  calls: CallEdge[]
  todos: TodoLocation[]
  bigFiles: string[]
  signature: string
  indexMissing: boolean
  staleIndex: boolean
  annotatedNames: Set<string>
}

/** Annotated block keys from existing .workbench indexes (basename#name). */
async function collectAnnotatedKeys(root: string): Promise<Set<string>> {
  const keys = new Set<string>()
  const indexes = await collectWorkbenchIndexes(root)
  for (const { blocks } of indexes) {
    for (const b of blocks) {
      if (b.summary) keys.add(`${basename(b.path)}#${b.name}`)
    }
  }
  return keys
}

async function indexFreshness(root: string): Promise<{ indexMissing: boolean; staleIndex: boolean }> {
  const latest = join(root, '.workbench', 'latest.md')
  const info = await stat(latest).catch(() => null)
  if (!info) {
    // A subdirectory index may exist even without a root one.
    const indexes = await collectWorkbenchIndexes(root)
    if (indexes.length === 0) return { indexMissing: true, staleIndex: false }
    return { indexMissing: false, staleIndex: false }
  }
  const files = await listCodeFiles(root)
  let newestCode = info.mtimeMs
  for (const f of files.slice(0, 500)) {
    const fi = await stat(f).catch(() => null)
    if (fi && fi.mtimeMs > newestCode) newestCode = fi.mtimeMs
  }
  return { indexMissing: false, staleIndex: newestCode > info.mtimeMs + 2000 }
}

/** Pure code analysis over one project root (no config signals involved). */
export async function analyzeCode(root: string): Promise<CodeAnalysis> {
  const absRoot = resolve(root)
  const files = await listCodeFiles(absRoot)
  const knownFiles = new Set(files.map((f) => toPosix(relative(absRoot, f))))

  const filesOut: FileStat[] = []
  const blocks: CodeBlock[] = []
  const dependencies: DepEdge[] = []
  const calls: CallEdge[] = []
  const todos: TodoLocation[] = []
  const bigFiles: string[] = []

  // First pass: read every file, extract blocks + imports + todos.
  const perFile: Array<{ file: string; lines: string[]; imports: ImportInfo[] }> = []
  for (const file of files) {
    const rel = toPosix(relative(absRoot, file))
    let buf: Buffer
    try {
      buf = await readFile(file)
      if (buf.subarray(0, 1024).includes(0)) continue
    } catch {
      continue
    }
    const text = buf.toString('utf8')
    const lines = text.split(/\r?\n/)
    const parsed = scanFileText(rel, text)
    const imports = extractImports(rel, text)
    const fileTodos = extractTodos(rel, lines)

    perFile.push({ file: rel, lines, imports })
    filesOut.push({ file: rel, lines: lines.length, blocks: parsed.length, annotated: 0, todos: fileTodos.filter((t) => t.tag === 'TODO').length, fixmes: fileTodos.filter((t) => t.tag !== 'TODO').length })
    for (const b of parsed) blocks.push({ ...b, path: rel })
    for (const t of fileTodos) todos.push(t)
    if (lines.length > BIG_FILE_LINES) bigFiles.push(rel)

    // dependency edges
    for (const imp of imports) {
      if (dependencies.length >= MAX_DEP_EDGES) break
      const resolved = imp.external ? null : resolveRelativeImport(rel, imp.spec, knownFiles)
      dependencies.push({ from: rel, to: resolved ?? imp.spec, external: imp.external || resolved === null })
    }
  }

  // Second pass: call graph. Build symbol→file maps.
  const definedSymbols = new Map<string, string>() // name -> file (first definition wins)
  for (const b of blocks) {
    if (!definedSymbols.has(b.name)) definedSymbols.set(b.name, b.path)
  }
  const importMap = new Map<string, { file: string; symbol: string }[]>() // per file: local symbol -> (file, symbol)
  for (const pf of perFile) {
    const list: { file: string; symbol: string }[] = []
    for (const imp of pf.imports) {
      const resolved = imp.external ? null : resolveRelativeImport(pf.file, imp.spec, knownFiles)
      for (const s of imp.symbols) {
        list.push({ file: resolved ?? '', symbol: s })
      }
    }
    importMap.set(pf.file, list)
  }

  for (const pf of perFile) {
    if (calls.length >= MAX_CALL_EDGES) break
    const fileBlocks = blocks.filter((b) => b.path === pf.file)
    const fileImports = importMap.get(pf.file) ?? []
    for (const b of fileBlocks) {
      if (calls.length >= MAX_CALL_EDGES) break
      // body = lines between startLine and endLine
      const body = pf.lines.slice(b.startLine, b.endLine + 1).join('\n')
      for (const ident of tokenizeIdentifiers(body)) {
        if (ident === b.name) continue
        if (calls.length >= MAX_CALL_EDGES) break
        // same-file definition
        if (definedSymbols.get(ident) === pf.file) {
          calls.push({ from: pf.file, fromBlock: b.name, fromLine: b.startLine, to: ident, toFile: pf.file, external: false })
          continue
        }
        // imported symbol
        const imp = fileImports.find((i) => i.symbol === ident)
        if (imp) {
          calls.push({ from: pf.file, fromBlock: b.name, fromLine: b.startLine, to: ident, toFile: imp.file, external: imp.file === '' })
        }
      }
    }
  }

  // annotation coverage via existing indexes
  const annotatedNames = await collectAnnotatedKeys(absRoot)
  for (const f of filesOut) {
    const fileBlocks = blocks.filter((b) => b.path === f.file)
    f.annotated = fileBlocks.filter((b) => annotatedNames.has(`${basename(b.path)}#${b.name}`)).length
  }

  const { indexMissing, staleIndex } = await indexFreshness(absRoot)
  const signature = await codeDirSignature(absRoot)

  return {
    files: filesOut,
    blocks,
    dependencies,
    calls,
    todos,
    bigFiles,
    signature,
    indexMissing,
    staleIndex,
    annotatedNames,
  }
}

// --- report assembly -------------------------------------------------------------

const DIM_LABEL: Record<DimensionId, string> = {
  rag: 'RAG · 知识检索',
  mcp: 'MCP · 外部服务',
  skill: '技能 · Skills',
  tool: '工具 · Tools',
  workflow: '工作流 · Workflow',
  structure: '项目结构 · 调用/依赖',
}

function healthOf(score: number): HealthLevel {
  if (score >= 80) return 'good'
  if (score >= 50) return 'warn'
  return 'error'
}

/** Top structure refs: most-connected files and biggest modules. */
function structureRefs(code: CodeAnalysis, root: string): CodeRef[] {
  const degree = new Map<string, number>()
  for (const d of code.dependencies) {
    degree.set(d.from, (degree.get(d.from) ?? 0) + 1)
    if (!d.external) degree.set(d.to, (degree.get(d.to) ?? 0) + 1)
  }
  const topFiles = [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([f]) => f)
  const refs: CodeRef[] = []
  for (const f of topFiles) {
    const block = code.blocks.find((b) => b.path === f)
    if (block) {
      refs.push({ file: block.path, name: block.name, kind: block.kind, startLine: block.startLine, endLine: block.endLine, summary: block.summary })
    }
  }
  return refs.slice(0, 8)
}

function ragDimension(sig: ConfigSignals['rag']): DimensionStatus {
  if (!sig.configured) {
    return { id: 'rag', status: '未配置', health: 'warn', score: 50, detail: '尚未配置知识库或语料目录, 模型无法通过 workbench_search 检索项目语料。', refs: [] }
  }
  if (sig.error) {
    return { id: 'rag', status: '构建失败', health: 'error', score: 25, detail: `索引构建出错: ${sig.error}`, refs: [] }
  }
  if (!sig.built) {
    return { id: 'rag', status: '未构建索引', health: 'warn', score: 60, detail: '知识库已配置但索引尚未构建, 首次检索时自动构建。', refs: [] }
  }
  return { id: 'rag', status: `已构建 · ${sig.docCount} 文档 / ${sig.chunkCount} 分块`, health: 'good', score: 100, detail: `检索引擎: ${sig.engine}; 索引健康可用。`, refs: [] }
}

function mcpDimension(sig: ConfigSignals['mcp']): DimensionStatus {
  if (sig.total === 0) {
    return { id: 'mcp', status: '未配置', health: 'warn', score: 50, detail: '未配置 MCP 服务器。', refs: [] }
  }
  if (sig.errors.length > 0) {
    return { id: 'mcp', status: `部分失败 · ${sig.connected}/${sig.total} 已连接`, health: 'error', score: 25, detail: `连接失败: ${sig.errors.join('; ')}`, refs: [] }
  }
  return { id: 'mcp', status: `${sig.connected}/${sig.total} 已连接 · ${sig.tools} 工具`, health: 'good', score: 100, detail: '所有启用的 MCP 服务器连接正常。', refs: [] }
}

function skillDimension(sig: ConfigSignals['skills']): DimensionStatus {
  if (sig.total === 0) {
    return { id: 'skill', status: '未加载', health: 'warn', score: 50, detail: '当前会话没有可展示的技能。', refs: [] }
  }
  return { id: 'skill', status: `${sig.total} 个技能`, health: 'good', score: 100, detail: sig.names.slice(0, 12).join(', ') + (sig.names.length > 12 ? ' …' : ''), refs: [] }
}

function toolDimension(sig: ConfigSignals['tools']): DimensionStatus {
  if (sig.total === 0) {
    return { id: 'tool', status: '未注册', health: 'warn', score: 50, detail: '没有可展示的工具。', refs: [] }
  }
  const ratio = sig.hidden / sig.total
  const health = ratio > 0.5 ? 'warn' : 'good'
  const score = ratio > 0.5 ? 65 : 100
  return { id: 'tool', status: `${sig.total} 个工具 · 隐藏 ${sig.hidden}`, health, score, detail: `工具注册表可用${sig.hidden > 0 ? `, 其中 ${sig.hidden} 个已对模型隐藏` : ''}。`, refs: [] }
}

function workflowDimension(sig: ConfigSignals['workflows']): DimensionStatus {
  if (sig.total === 0) {
    return { id: 'workflow', status: '未配置', health: 'warn', score: 50, detail: '尚未配置工作流。', refs: [] }
  }
  if (!sig.active) {
    return { id: 'workflow', status: `${sig.total} 个工作流 · 未激活`, health: 'warn', score: 65, detail: '已有工作流但未指定激活的工作流。', refs: [] }
  }
  return { id: 'workflow', status: `激活: ${sig.activeName || sig.active}`, health: 'good', score: 100, detail: `共 ${sig.total} 个工作流, 当前激活 ${sig.activeName || sig.active}。`, refs: [] }
}

function structureDimension(code: CodeAnalysis, root: string): DimensionStatus {
  const total = code.files.reduce((a, f) => a + f.blocks, 0)
  const annotated = code.files.reduce((a, f) => a + f.annotated, 0)
  const coverage = total > 0 ? Math.round((annotated / total) * 100) : 0
  const problems: string[] = []
  if (code.indexMissing) problems.push('尚未建立 .workbench 代码索引')
  else if (code.staleIndex) problems.push('代码索引已过期(行号可能不准)')
  if (coverage < 50) problems.push(`注释覆盖率仅 ${coverage}%`)
  if (code.todos.length > 0) problems.push(`${code.todos.length} 处 TODO/FIXME`)
  if (code.bigFiles.length > 0) problems.push(`${code.bigFiles.length} 个超大文件(>${BIG_FILE_LINES} 行)`)
  const health = problems.length === 0 ? 'good' : problems.length === 1 ? 'warn' : 'warn'
  const score = problems.length === 0 ? 100 : problems.length === 1 ? 70 : 55
  return {
    id: 'structure',
    status: `${code.files.length} 文件 · ${total} 功能块 · 覆盖 ${coverage}%`,
    health,
    score,
    detail: problems.length > 0 ? problems.join('; ') : `依赖边 ${code.dependencies.length} 条 · 调用边 ${code.calls.length} 条 · 结构健康。`,
    refs: structureRefs(code, root),
  }
}

export function buildReport(root: string, code: CodeAnalysis, signals: ConfigSignals): ProjectStatusReport {
  const total = code.files.reduce((a, f) => a + f.blocks, 0)
  const annotated = code.files.reduce((a, f) => a + f.annotated, 0)
  const coverage = total > 0 ? Math.round((annotated / total) * 100) : 0
  const dimensions: DimensionStatus[] = [
    ragDimension(signals.rag),
    mcpDimension(signals.mcp),
    skillDimension(signals.skills),
    toolDimension(signals.tools),
    workflowDimension(signals.workflows),
    structureDimension(code, root),
  ]
  const healthScore = Math.round(dimensions.reduce((a, d) => a + d.score, 0) / Math.max(1, dimensions.length))
  return {
    root: resolve(root),
    generatedAt: Date.now(),
    signature: code.signature,
    summary: {
      files: code.files.length,
      blocks: total,
      annotatedBlocks: annotated,
      annotationCoverage: coverage,
      todoCount: code.todos.filter((t) => t.tag === 'TODO').length,
      fixmeCount: code.todos.filter((t) => t.tag !== 'TODO').length,
      bigFiles: code.bigFiles,
      indexMissing: code.indexMissing,
      staleIndex: code.staleIndex,
      healthScore,
      health: healthOf(healthScore),
      dependencyCount: code.dependencies.length,
      callCount: code.calls.length,
    },
    dimensions,
    files: code.files,
    dependencies: code.dependencies,
    calls: code.calls,
    todos: code.todos,
  }
}

// --- markdown rendering ----------------------------------------------------------

const HEALTH_ICON: Record<HealthLevel, string> = { good: '🟢', warn: '🟡', error: '🔴' }

export function renderProjectStatusMd(report: ProjectStatusReport): string {
  const out: string[] = []
  const s = report.summary
  const stamp = timestampName(new Date(report.generatedAt))
  out.push(`# 🩺 项目状态 · ${report.root} · ${stamp}`)
  out.push('')
  out.push('> 由 dsh-workbench `workbench_project_status` 生成 · 状态+健康度(分数/级别) · 点击任一维度可定位相关代码 · 本文件每次扫描覆盖更新')
  out.push('')
  out.push(`## 总体健康: ${HEALTH_ICON[s.health]} ${s.healthScore}/100`)
  out.push('')
  out.push('| 指标 | 值 |')
  out.push('|---|---|')
  out.push(`| 文件数 | ${s.files} |`)
  out.push(`| 功能块 | ${s.blocks} (已注释 ${s.annotatedBlocks}, 覆盖 ${s.annotationCoverage}%) |`)
  out.push(`| TODO / FIXME | ${s.todoCount} / ${s.fixmeCount} |`)
  out.push(`| 依赖边 / 调用边 | ${s.dependencyCount} / ${s.callCount} |`)
  out.push(`| 超大文件(>${BIG_FILE_LINES}行) | ${s.bigFiles.length === 0 ? '无' : s.bigFiles.join(', ')} |`)
  out.push(`| 代码索引 | ${s.indexMissing ? '未建立' : s.staleIndex ? '已过期' : '最新'} |`)
  out.push('')
  out.push('## 六维状态')
  out.push('')
  out.push('| 维度 | 状态 | 健康度 | 分数 | 说明 |')
  out.push('|---|---|---|---|---|')
  for (const d of report.dimensions) {
    out.push(`| ${DIM_LABEL[d.id]} | ${d.status} | ${HEALTH_ICON[d.health]} ${d.health} | ${d.score} | ${d.detail} |`)
  }
  out.push('')
  out.push('## 文件清单')
  out.push('')
  out.push('| 文件 | 行数 | 功能块 | 已注释 | TODO/FIXME |')
  out.push('|---|---|---|---|---|')
  for (const f of report.files) {
    out.push(`| \`${f.file}\` | ${f.lines} | ${f.blocks} | ${f.annotated} | ${f.todos}/${f.fixmes} |`)
  }
  out.push('')
  if (report.dependencies.length > 0) {
    out.push('## 依赖图 (文件 → 文件)')
    out.push('')
    for (const d of report.dependencies.slice(0, 60)) {
      out.push(`- \`${d.from}\` → ${d.external ? `📦 ${d.to}` : `\`${d.to}\``}`)
    }
    if (report.dependencies.length > 60) out.push(`- … 共 ${report.dependencies.length} 条依赖边`)
    out.push('')
  }
  if (report.calls.length > 0) {
    out.push('## 调用图 (函数 → 函数)')
    out.push('')
    for (const c of report.calls.slice(0, 60)) {
      out.push(`- \`${c.from}\`#\`${c.fromBlock}\` → ${c.toFile ? `\`${c.toFile}\`#` : ''}\`${c.to}\``)
    }
    if (report.calls.length > 60) out.push(`- … 共 ${report.calls.length} 条调用边`)
    out.push('')
  }
  if (report.todos.length > 0) {
    out.push('## TODO / FIXME 清单')
    out.push('')
    for (const t of report.todos.slice(0, 50)) {
      out.push(`- \`${t.file}\` L${t.line} [${t.tag}] ${t.text}`)
    }
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}

// --- persistence -----------------------------------------------------------------

export async function writeProjectStatus(root: string, report: ProjectStatusReport): Promise<{ mdPath: string; jsonPath: string }> {
  const wbDir = join(resolve(root), '.workbench')
  await mkdir(wbDir, { recursive: true })
  const mdPath = join(wbDir, 'project-status.md')
  const jsonPath = join(wbDir, 'project-status.json')
  await writeFile(mdPath, renderProjectStatusMd(report), 'utf8')
  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8')
  return { mdPath, jsonPath }
}

// --- source reader (click-to-code) -------------------------------------------------

/** Read a bounded line range of a file inside `root` (path is root-relative). */
export async function readFileRange(root: string, file: string, startLine: number, endLine: number): Promise<ReadFileResult> {
  const absRoot = resolve(root)
  const rel = toPosix(relative(absRoot, resolve(absRoot, file)))
  if (rel.startsWith('..') || rel === '..') throw new Error('路径超出项目根目录')
  const abs = resolve(absRoot, file)
  const text = await readFile(abs, 'utf8')
  const lines = text.split(/\r?\n/)
  const from = Math.max(1, Math.floor(startLine) || 1)
  const to = Math.min(lines.length, Math.ceil(endLine) || from)
  const picked: Array<{ n: number; text: string }> = []
  for (let i = from; i <= to; i++) picked.push({ n: i, text: lines[i - 1] ?? '' })
  return { path: rel, startLine: from, endLine: to, totalLines: lines.length, lines: picked }
}
