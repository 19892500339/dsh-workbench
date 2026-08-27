/**
 * `.workbench` code index — scan code structure, render compact markdown
 * indexes, and locate functions/components through the indexes.
 *
 * Design goals (token economy):
 * - `scan` returns ONLY structural facts (file, name, kind, start/end line,
 *   signature, one-line doc, short preview) instead of full file bodies, so the
 *   model can annotate without re-reading files.
 * - `commit` merges the model's functional annotations and writes one
 *   `.workbench/` folder per code directory: a timestamped snapshot plus a
 *   `latest.md` pointer. Retrieval always reads `latest.md`, never history.
 * - `locate` searches every `.workbench/latest.md` under a directory and
 *   returns «file + line range + summary», letting later sessions jump
 *   straight to the code instead of scanning whole files.
 *
 * The parser is intentionally heuristic (regex + brace matching, no
 * tree-sitter dependency): it targets the common declaration shapes of the
 * JS/TS, Python, Go, Rust and Java/C# families plus a generic fallback.
 * Line ranges only need to be approximately right — the model annotates them
 * and the caller reads by line range.
 */
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { join, relative, dirname, basename, resolve, sep } from 'node:path'

/**
 * Tokenizer mirroring `search.ts` (latin words + CJK chars/bigrams), inlined
 * so this module has no runtime import of a sibling `.js` module — `node --test`
 * executes the TS sources directly, where `.js` specifiers would not resolve.
 * Keep in sync with `search.ts`.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLocaleLowerCase()
  for (const match of lower.matchAll(/[a-z0-9_]+/g)) tokens.push(match[0])
  const cjk = lower.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g)
  if (cjk) {
    for (const run of cjk) {
      for (let i = 0; i < run.length; i += 1) tokens.push(run[i]!)
      for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

/** Functional block kind, used both for scan output and markdown rendering. */
export type BlockKind = 'function' | 'method' | 'class' | 'component' | 'const' | 'type' | 'other'

/** One indexed functional block. `path` is relative to the scan root (posix). */
export interface CodeBlock {
  path: string
  name: string
  kind: BlockKind
  /** 1-based inclusive line range. */
  startLine: number
  endLine: number
  signature: string
  doc: string
  preview: string
  summary?: string
  inputs?: string
  outputs?: string
  sideEffects?: string
  dependsOn?: string
}

/** One code file summary line. */
export interface IndexedFile {
  path: string
  lines: number
  blocks: number
}

export interface ScanResult {
  root: string
  files: IndexedFile[]
  blocks: CodeBlock[]
  /** Directories (relative to root) that directly contain code files. */
  indexDirs: string[]
  skipped: number
  truncated: boolean
}

export interface LocateHit {
  file: string
  name: string
  kind: BlockKind
  startLine: number
  endLine: number
  summary?: string
  score: number
}

export interface CommitResult {
  root: string
  written: string[]
  dirs: Array<{ dir: string; added: number; updated: number; removed: number; total: number }>
  annotated: number
  warnings: string[]
  total_blocks: number
}

// --- configuration -----------------------------------------------------------

const CODE_EXTS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx',
  'py', 'go', 'rs', 'java', 'cs', 'c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx',
  'php', 'rb', 'kt', 'kts', 'swift', 'sh', 'dart', 'lua', 'm', 'mm', 'scala', 'groovy', 'pl', 'pm',
  'vue', 'svelte',
])

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.workbench', 'dist', 'build', 'out', 'coverage', '__pycache__',
  '.venv', 'venv', 'target', '.next', '.nuxt', '.cache', '.idea', '.vscode', '.turbo',
])

const KIND_ICON: Record<BlockKind, string> = {
  function: '🔧',
  method: '⚙️',
  class: '🏷️',
  component: '🧩',
  const: '📦',
  type: '🧬',
  other: '📄',
}

const KIND_LABEL: Record<BlockKind, string> = {
  function: '函数',
  method: '方法',
  class: '类',
  component: '组件',
  const: '常量',
  type: '类型',
  other: '其它',
}

const MAX_FILE_BYTES = 1024 * 1024
const MAX_DEPTH = 12
const MAX_FILES = 2000
const MAX_SIG_CHARS = 90
const MAX_DOC_CHARS = 80
const MAX_PREVIEW_CHARS = 120
const MAX_BLOCKS_DEFAULT = 500

// --- directory walking -------------------------------------------------------

export async function listCodeFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        await walk(full, depth + 1)
      } else {
        if (entry.name.endsWith('.d.ts')) continue
        const dot = entry.name.lastIndexOf('.')
        const ext = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : ''
        if (CODE_EXTS.has(ext)) out.push(full)
      }
    }
  }
  await walk(root, 0)
  return out.sort()
}

// --- character scanner for brace matching ------------------------------------

/**
 * Walk code characters line by line, maintaining string / template-literal /
 * block-comment / regex-literal state (C-family syntax), and invoke `onChar`
 * for every significant character with the current parenthesis and brace
 * depth. Braces inside strings, template literals, regex literals and comments
 * are ignored, so backticks or braces inside regexes (`/^### `(.+)`$/`,
 * `/a{2,3}/`) can never corrupt the brace balance. Returns the line index
 * where `onChar` returned true, or null.
 *
 * Regex literals are distinguished from division by the standard heuristic:
 * a `/` starts a regex when the previous significant character cannot end an
 * expression (start of line, an opener, an operator, a comma/colon/equal, or
 * a keyword such as `return`/`typeof`/`case`).
 */
// `<`/`>` are deliberately absent: JSX closing tags (`</div>`) and generic
// comparisons would otherwise misclassify a `/` as the start of a regex.
const REGEX_PREV_CHARS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^'])
const REGEX_PREV_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'new', 'delete', 'void', 'yield', 'await', 'do', 'else', 'throw'])

function iterateCodeChars(
  lines: string[],
  fromLine: number,
  maxLines: number,
  onChar: (ch: string, lineIdx: number, parenDepth: number, braceDepth: number, col: number) => boolean,
  startCol = 0,
): number | null {
  let inStr: string | null = null
  let inTmpl = false
  let inBlock = false
  let inRegex = false
  let inCharClass = false
  let prevSig = '\u0000'
  let prevWord = ''
  let parenDepth = 0
  let braceDepth = 0
  const limit = Math.min(lines.length, fromLine + maxLines)
  for (let i = fromLine; i < limit; i++) {
    const line = lines[i]!
    let j = i === fromLine ? startCol : 0
    while (j < line.length) {
      const ch = line[j]!
      const next = line[j + 1]
      if (inBlock) {
        if (ch === '*' && next === '/') {
          inBlock = false
          prevSig = '/'
          j += 2
        } else {
          j += 1
        }
        continue
      }
      if (inTmpl) {
        // Braces inside template literals (including `${...}`) are content,
        // not block structure, so they are ignored entirely.
        if (ch === '`') inTmpl = false
        else if (ch === '\\') j += 1
        j += 1
        continue
      }
      if (inRegex) {
        if (inCharClass) {
          if (ch === '\\') j += 1
          else if (ch === ']') inCharClass = false
        } else if (ch === '\\') {
          j += 1
        } else if (ch === '[') {
          inCharClass = true
        } else if (ch === '/') {
          inRegex = false
          prevSig = '/'
        }
        j += 1
        continue
      }
      if (inStr) {
        if (ch === '\\') j += 1
        else if (ch === inStr) inStr = null
        j += 1
        continue
      }
      if (ch === '/' && next === '/') break
      if (ch === '/' && next === '*') {
        inBlock = true
        j += 2
        continue
      }
      if (ch === '"' || ch === "'") {
        inStr = ch
        prevSig = ch
        prevWord = ''
        j += 1
        continue
      }
      if (ch === '`') {
        inTmpl = true
        prevSig = '`'
        prevWord = ''
        j += 1
        continue
      }
      if (ch === '/') {
        // Regex literal vs division, decided by the previous significant char.
        const startsRegex =
          prevSig === '\u0000' ||
          REGEX_PREV_CHARS.has(prevSig) ||
          (prevWord.length > 0 && REGEX_PREV_WORDS.has(prevWord))
        if (startsRegex) {
          inRegex = true
          inCharClass = false
          prevSig = '/'
          prevWord = ''
          j += 1
          continue
        }
        prevSig = '/'
        j += 1
        continue
      }
      if (/[A-Za-z0-9_$]/.test(ch)) {
        if (/[A-Za-z0-9_$]/.test(prevSig)) prevWord += ch
        else prevWord = ch
      } else {
        prevWord = ''
      }
      if (onChar(ch, i, parenDepth, braceDepth, j)) return i
      if (ch === '(') parenDepth += 1
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1)
      else if (ch === '{') braceDepth += 1
      else if (ch === '}') braceDepth = Math.max(0, braceDepth - 1)
      if (!/\s/.test(ch)) prevSig = ch
      j += 1
    }
  }
  return null
}

/**
 * Position of the body-opening `{` after `fromLine`, or null.
 *
 * Type annotations may contain inline object literals (`): { a: 1 } | null {`),
 * default values (`payload: unknown = {}`), generics and return types — so the
 * naive "first `{`" is wrong. The body brace is the LAST `{` at parenthesis and
 * brace depth 0 on the declaration line itself (the body opens after all
 * annotations), falling back to the FIRST depth-0 `{` on the following lines
 * for declarations whose parameter list wraps. Returning the column lets the
 * block-end scan start at the body brace instead of re-balancing the
 * annotation literals that precede it.
 */
function firstOpenBraceLine(lines: string[], fromLine: number): { line: number; col: number } | null {
  let declLineHit: { line: number; col: number } | null = null
  iterateCodeChars(lines, fromLine, 1, (ch, _lineIdx, parenDepth, braceDepth, col) => {
    if (ch === '{' && parenDepth === 0 && braceDepth === 0) {
      declLineHit = { line: fromLine, col }
    }
    return false
  })
  if (declLineHit !== null) return declLineHit
  let found: { line: number; col: number } | null = null
  // Wrapped parameter lists can span many lines; 16 lines is generous while
  // the FIRST depth-0 `{` is always this declaration's body brace (a sibling
  // declaration cannot appear before the body opens).
  iterateCodeChars(lines, fromLine, 16, (ch, lineIdx, parenDepth, braceDepth, col) => {
    if (found === null && ch === '{' && parenDepth === 0 && braceDepth === 0) {
      found = { line: lineIdx, col }
      return true
    }
    return false
  })
  return found
}

/**
 * Line index where the block opened at `(openLine, startCol)` closes
 * (balanced braces). Only braces at parenthesis depth 0 participate: braces
 * inside parens (parameter-type literals, default values, call arguments) are
 * self-balanced by construction, and counting them misbalances blocks whose
 * declaration carries an inline type literal before the body.
 */
function findBlockEnd(lines: string[], openLine: number, startCol = 0): number {
  let depth = 0
  let end = openLine
  iterateCodeChars(lines, openLine, lines.length - openLine, (ch, lineIdx, parenDepth) => {
    if (parenDepth > 0) return false
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = lineIdx
        return true
      }
    }
    return false
  }, startCol)
  return end
}

// --- declaration detection ---------------------------------------------------

const JS_CTRL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'else', 'do', 'new', 'throw',
  'delete', 'typeof', 'instanceof', 'in', 'of', 'void', 'yield', 'await', 'this', 'super',
  'case', 'default', 'try', 'finally', 'class', 'function', 'var', 'let', 'const', 'import',
  'export', 'extends', 'implements', 'break', 'continue',
])

function detectJsTs(t: string, indent: number): { name: string; kind: BlockKind } | null {
  let m = t.match(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*)?\s+([A-Za-z_$][\w$]*)/)
  if (m) return { name: m[1]!, kind: 'function' }
  m = t.match(/^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/)
  if (m) return { name: m[1]!, kind: 'class' }
  m = t.match(/^(?:export\s+(?:default\s+)?)?(?:interface|enum)\s+([A-Za-z_$][\w$]*)/)
  if (m) return { name: m[1]!, kind: 'type' }
  m = t.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/)
  if (m) return { name: m[1]!, kind: 'type' }
  m = t.match(/^(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/)
  if (m) return { name: m[1]!, kind: 'const' }
  m = t.match(/^export\s+default\s+(?:async\s+)?function\s*\(/)
  if (m) return { name: 'default', kind: 'function' }
  m = t.match(/^(?:(?:static|async|get|set|public|private|protected|readonly|abstract|override|#)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{}]*?)?\{/)
  if (m && indent > 0 && !JS_CTRL.has(m[1]!)) return { name: m[1]!, kind: 'method' }
  m = t.match(/^([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/)
  if (m && indent > 0) return { name: m[1]!, kind: 'const' }
  return null
}

function detectPy(t: string, indent: number): { name: string; kind: BlockKind } | null {
  const m = t.match(/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/)
  if (m) return { name: m[1]!, kind: indent > 0 ? 'method' : 'function' }
  const c = t.match(/^class\s+([A-Za-z_]\w*)/)
  if (c) return { name: c[1]!, kind: 'class' }
  return null
}

function detectGo(t: string): { name: string; kind: BlockKind } | null {
  let m = t.match(/^func\s+\([^)]*\)\s+([A-Za-z_]\w*)\s*\(/)
  if (m) return { name: m[1]!, kind: 'method' }
  m = t.match(/^func\s+([A-Za-z_]\w*)\s*\(/)
  if (m) return { name: m[1]!, kind: 'function' }
  m = t.match(/^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/)
  if (m) return { name: m[1]!, kind: 'class' }
  return null
}

const RS_PRE = '(?:pub(?:\\s*\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?'

function detectRs(t: string, indent: number): { name: string; kind: BlockKind } | null {
  let m = t.match(new RegExp('^' + RS_PRE + 'fn\\s+([A-Za-z_]\\w*)\\s*<'))
  if (!m) m = t.match(new RegExp('^' + RS_PRE + 'fn\\s+([A-Za-z_]\\w*)\\s*\\('))
  if (m) return { name: m[1]!, kind: indent > 0 ? 'method' : 'function' }
  m = t.match(new RegExp('^' + RS_PRE + '(?:struct|enum)\\s+([A-Za-z_]\\w*)'))
  if (m) return { name: m[1]!, kind: 'class' }
  m = t.match(new RegExp('^' + RS_PRE + 'trait\\s+([A-Za-z_]\\w*)'))
  if (m) return { name: m[1]!, kind: 'type' }
  return null
}

const JAVA_MODS = '(?:(?:public|private|protected|internal|static|final|abstract|synchronized|native|transient|volatile|sealed|partial|readonly|async|virtual|override|new|strictfp|default|const|let|var)\\s+)*'
const JAVA_CTRL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'new', 'throw', 'class', 'interface', 'enum', 'record', 'struct', 'try', 'finally', 'case', 'default'])

function detectJavaCs(t: string): { name: string; kind: BlockKind } | null {
  const firstWord = t.match(/^[A-Za-z_]\w*/)?.[0]
  if (firstWord && JAVA_CTRL.has(firstWord)) return null
  const m = t.match(new RegExp('^' + JAVA_MODS + '(?:class|interface|enum|record|struct)\\s+([A-Za-z_]\\w*)'))
  if (m) return { name: m[1]!, kind: 'class' }
  const fn = t.match(new RegExp('^' + JAVA_MODS + '([\\w<>\\[\\],\\s]+?)\\s+([A-Za-z_]\\w*)\\s*\\([^;{}]*\\)\\s*(?:throws\\s+[^{]*)?\\{'))
  if (fn && !JAVA_CTRL.has(fn[2]!) && fn[1]!.trim().length > 0) return { name: fn[2]!, kind: 'method' }
  return null
}

function detectSh(t: string): { name: string; kind: BlockKind } | null {
  let m = t.match(/^([A-Za-z_]\w*)\s*\(\s*\)\s*\{/)
  if (m) return { name: m[1]!, kind: 'function' }
  m = t.match(/^function\s+([A-Za-z_]\w*)\s*(?:\{|\()/)
  if (m) return { name: m[1]!, kind: 'function' }
  return null
}

const GENERIC_KW = '(?:public|private|protected|internal|static|inline|export|final|abstract|const|constexpr|let|var|async|virtual|override|def|sub|fun|func|function|fn|macro|guard|nonisolated|mutating|init|local|global)\\s+'

/** Control-flow / structural words that must never be read as a type or name.
 * NB: NOT `void`/`auto`/`constexpr` — those are valid C-family return types. */
const GENERIC_CTRL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'new', 'throw', 'case', 'default',
  'try', 'finally', 'break', 'continue', 'typedef', 'using', 'import', 'export', 'package', 'include',
  'define', 'elif', 'endif', 'pragma', 'template', 'namespace', 'extends', 'implements', 'super', 'this',
  'sizeof', 'typeof', 'instanceof', 'delete', 'yield', 'await', 'in', 'of',
])

function detectGeneric(t: string, indent: number): { name: string; kind: BlockKind } | null {
  const firstWord = t.match(/^[A-Za-z_]\w*/)?.[0]
  if (firstWord && GENERIC_CTRL.has(firstWord)) return null
  // Keyword-prefixed declarations: `static int foo(`, `def foo(`, `fun foo(`,
  // `function foo(`, `func foo(`, `fn foo(` … (the `->` term covers Swift's
  // `-> ReturnType {` style; PHP/Ruby/Lua-style `function name(` needs none).
  let m = t.match(new RegExp('^(?:' + GENERIC_KW + ')+([A-Za-z_]\\w*)\\s*\\([^)]*\\)\\s*(?::\\s*[^{}]*?)?(?:\\{|do|then|=>|->)'))
  if (m) return { name: m[1]!, kind: indent > 0 ? 'method' : 'function' }
  // C-family return-type style: `int add(int a) {` / `char *name(void) {` —
  // the first word is a type, the second the function name.
  m = t.match(/^([A-Za-z_]\w*(?:\s*[*&]+\s*)?)\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:\{|do|then|=>|->)/)
  if (m && !GENERIC_CTRL.has(m[1]!) && !GENERIC_CTRL.has(m[2]!)) return { name: m[2]!, kind: indent > 0 ? 'method' : 'function' }
  // Objective-C methods: `- (void)viewDidLoad {` / `+ (instancetype)new {`.
  m = t.match(/^[+-]\s*\([^)]*\)\s*([A-Za-z_]\w*)\s*\(/)
  if (m) return { name: m[1]!, kind: 'method' }
  m = t.match(/^(?:public|private|protected|internal|final|abstract|sealed|data|case|open|enum class|object|class|struct|interface|trait|enum|module|namespace|protocol|extension)\s+([A-Za-z_]\w*)/)
  if (m) return { name: m[1]!, kind: /class|struct|object|interface|trait|protocol|enum/.test(m[0]!) ? 'class' : 'type' }
  if (indent > 0) {
    m = t.match(/^([A-Za-z_]\w*)\s*\([^)]*\)\s*\{/)
    if (m && !GENERIC_CTRL.has(m[1]!)) return { name: m[1]!, kind: 'method' }
  }
  return null
}

/**
 * End-of-block style languages without braces (Ruby `def … end`, Lua
 * `function … end`): declarations are keyword-prefixed, bodies are indented.
 */
function detectEndStyle(t: string, indent: number): { name: string; kind: BlockKind } | null {
  let m = t.match(/^(?:local\s+)?function\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/)
  if (m) return { name: m[1]!, kind: indent > 0 ? 'method' : 'function' }
  m = t.match(/^(?:def|def\s+self\.)\s+([A-Za-z_]\w*[!?=]?)/)
  if (m) return { name: m[1]!, kind: indent > 0 ? 'method' : 'function' }
  m = t.match(/^(?:class|module)\s+([A-Za-z_]\w*)/)
  if (m) return { name: m[1]!, kind: /class/.test(m[0]!) ? 'class' : 'type' }
  return null
}

// --- per-file block extraction ------------------------------------------------

/** End line (0-based) of a Python-style indented body. */
function pythonBodyEnd(lines: string[], declIdx: number, declIndent: number): number {
  let end = declIdx
  for (let i = declIdx + 1; i < lines.length; i++) {
    const l = lines[i]!
    if (!l.trim() || l.trim().startsWith('#')) continue
    const ind = l.length - l.trimStart().length
    if (ind <= declIndent) break
    end = i
  }
  return end
}

/** End line (0-based) of a brace-less declaration body (indented continuation). */
function declEndHeuristic(lines: string[], declIdx: number, declIndent: number): number {
  let end = declIdx
  for (let i = declIdx + 1; i < Math.min(lines.length, declIdx + 80); i++) {
    const l = lines[i]!
    if (!l.trim()) break
    const ind = l.length - l.trimStart().length
    if (ind <= declIndent) break
    end = i
  }
  return end
}

interface DeclShape {
  name: string
  kind: BlockKind
  openLine: number | null
  openCol?: number
  endLine?: number
}

function detectDeclaration(
  family: string,
  t: string,
  indent: number,
  lines: string[],
  idx: number,
): DeclShape | null {
  // Vue/Svelte scripts are extracted by scanFileText and parsed as JS.
  if (family === 'vue') family = 'js'
  let decl: { name: string; kind: BlockKind } | null = null
  if (family === 'js') decl = detectJsTs(t, indent)
  else if (family === 'py') decl = detectPy(t, indent)
  else if (family === 'go') decl = detectGo(t)
  else if (family === 'rs') decl = detectRs(t, indent)
  else if (family === 'java') decl = detectJavaCs(t)
  else if (family === 'sh') decl = detectSh(t)
  else if (family === 'endstyle') decl = detectEndStyle(t, indent)
  else if (family === 'generic') decl = detectGeneric(t, indent)
  if (!decl) return null
  if (family === 'py' || family === 'endstyle') {
    return { ...decl, openLine: null, endLine: pythonBodyEnd(lines, idx, indent) }
  }
  const open = firstOpenBraceLine(lines, idx)
  if (open !== null) return { ...decl, openLine: open.line, openCol: open.col }
  return { ...decl, openLine: null, endLine: declEndHeuristic(lines, idx, indent) }
}

function collectDoc(lines: string[], declIdx: number, family: string): string {
  const doc: string[] = []
  for (let i = declIdx - 1; i >= 0; i--) {
    const t = lines[i]!.trim()
    if (!t) break
    if (family === 'py') {
      if (t.startsWith('#')) doc.unshift(t.replace(/^#\s*/, ''))
      else if (t.startsWith('"""') || t.startsWith("'''")) {
        const cleaned = t.replace(/^("""|''')\s*/, '').replace(/\s*("""|''')$/, '').trim()
        if (cleaned) doc.unshift(cleaned)
        break
      } else break
    } else if (t.startsWith('//')) {
      doc.unshift(t.replace(/^\/\/\s*/, ''))
    } else if (t.startsWith('*')) {
      doc.unshift(t.replace(/^\*\s*/, ''))
    } else if (t.startsWith('/*') || t.startsWith('*/')) {
      const cleaned = t.replace(/^\/\*+/, '').replace(/\*\/$/, '').trim()
      if (cleaned) doc.unshift(cleaned)
      if (t.startsWith('/*')) break
    } else if (t.startsWith('#') || t.startsWith('--') || t.startsWith('<!--')) {
      break
    } else break
  }
  return doc.join(' ').trim()
}

function buildPreview(lines: string[], from: number, to: number): string {
  const parts: string[] = []
  for (let i = from; i <= to && parts.length < 4; i++) {
    const t = lines[i]!.trim()
    if (t) parts.push(t)
  }
  return parts.join(' ').slice(0, MAX_PREVIEW_CHARS)
}

/** A block parsed from a single file (before it is stamped with its path). */
export interface ParsedBlock {
  name: string
  kind: BlockKind
  startLine: number
  endLine: number
  signature: string
  doc: string
  preview: string
}

function extFamily(ext: string): string {
  if (['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx'].includes(ext)) return 'js'
  if (ext === 'py') return 'py'
  if (ext === 'go') return 'go'
  if (ext === 'rs') return 'rs'
  if (ext === 'java' || ext === 'cs') return 'java'
  if (ext === 'sh') return 'sh'
  if (ext === 'rb' || ext === 'lua') return 'endstyle'
  if (['vue', 'svelte'].includes(ext)) return 'vue'
  if (['c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'hxx', 'php', 'kt', 'kts', 'swift', 'dart', 'm', 'mm', 'scala', 'groovy', 'pl', 'pm'].includes(ext)) return 'generic'
  return 'other'
}

export function scanFileText(relPath: string, text: string): ParsedBlock[] {
  const ext = relPath.split('.').pop()?.toLowerCase() ?? ''
  const family = extFamily(ext)
  let lines = text.split(/\r?\n/)
  // Vue / Svelte single-file components: only the <script> block is code; the
  // parsed line numbers are offset back to the original file positions.
  let lineOffset = 0
  if (family === 'vue') {
    const script = text.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)
    if (!script) return []
    lineOffset = text.slice(0, script.index ?? 0).split(/\r?\n/).length - 1
    lines = script[1]!.split(/\r?\n/)
  }
  if (lines.length === 0) return []
  // Minified / generated single-line blobs: not worth indexing.
  if (lines.some((l) => l.length > 4000)) return []
  const blocks: ParsedBlock[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (!trimmed) continue
    const indent = line.length - line.trimStart().length
    const decl = detectDeclaration(family, trimmed, indent, lines, i)
    if (!decl) continue
    const end = decl.openLine !== null ? findBlockEnd(lines, decl.openLine, decl.openCol ?? 0) : (decl.endLine ?? i)
    if (end < i) continue
    const preview = buildPreview(lines, i + 1, end)
    let kind = decl.kind
    // Heuristic component detection for arrow constants: PascalCase name and a
    // JSX-ish body (a `return` or a leading tag).
    if (kind === 'const' && /^[A-Z]/.test(decl.name) && /<[A-Za-z][^>]*>|return\s*\(?\s*</.test(preview)) {
      kind = 'component'
    }
    blocks.push({
      name: decl.name,
      kind,
      startLine: i + 1 + lineOffset,
      endLine: end + 1 + lineOffset,
      signature: trimmed.slice(0, MAX_SIG_CHARS),
      doc: collectDoc(lines, i, 'js').slice(0, MAX_DOC_CHARS),
      preview,
    })
  }
  return blocks
}

// --- scan ---------------------------------------------------------------------

export async function scanDirectory(root: string, opts?: { maxBlocks?: number }): Promise<ScanResult> {
  const maxBlocks = Math.max(1, opts?.maxBlocks ?? MAX_BLOCKS_DEFAULT)
  const absRoot = resolve(root)
  const files = await listCodeFiles(absRoot)
  const blocks: CodeBlock[] = []
  const filesOut: IndexedFile[] = []
  const dirSet = new Set<string>()
  let skipped = 0
  let truncated = false
  for (const file of files) {
    if (blocks.length >= maxBlocks) {
      truncated = true
      break
    }
    const rel = relative(absRoot, file).split(sep).join('/')
    let text: string
    try {
      const buf = await readFile(file)
      if (buf.subarray(0, 1024).includes(0)) {
        skipped += 1
        continue
      }
      text = buf.toString('utf8')
    } catch {
      skipped += 1
      continue
    }
    if (text.length > MAX_FILE_BYTES) {
      skipped += 1
      continue
    }
    const parsed = scanFileText(rel, text)
    dirSet.add(dirname(rel))
    filesOut.push({ path: rel, lines: text.split(/\r?\n/).length, blocks: parsed.length })
    for (const b of parsed) blocks.push({ ...b, path: rel })
  }
  return {
    root: absRoot,
    files: filesOut,
    blocks,
    indexDirs: [...dirSet].sort(),
    skipped,
    truncated,
  }
}

// --- markdown rendering ---------------------------------------------------------

export interface RenderOptions {
  root: string
  files: IndexedFile[]
  blocks: CodeBlock[]
  timestamp: string
  note?: string
  changed?: { added: number; updated: number; removed: number; total: number }
}

export function renderIndexMd(opts: RenderOptions): string {
  const { root, files, blocks, timestamp, note, changed } = opts
  const out: string[] = []
  out.push(`# 📇 代码索引 · ${root} · ${timestamp}`)
  out.push('')
  out.push('> 由 dsh-workbench `workbench_code_index` 生成 · 每块记录「文件 + 起始行/结束行」· 检索直达请用 `workbench_code_locate` · 本目录最新索引始终在 `latest.md`')
  out.push('')
  if (changed) {
    out.push('## 🔄 本次变更')
    out.push(`- 新增: ${changed.added} · 更新: ${changed.updated} · 移除: ${changed.removed} · 当前块总数: ${changed.total}`)
    if (note) out.push(`- 说明: ${note}`)
    out.push('')
  }
  out.push('## 📄 文件清单')
  out.push('| 文件 | 块数 | 行数 |')
  out.push('|---|---|---|')
  for (const f of files) out.push(`| \`${f.path}\` | ${f.blocks} | ${f.lines} |`)
  out.push('')
  out.push('## 🧩 功能块')
  let curFile = ''
  for (const b of blocks) {
    if (b.path !== curFile) {
      curFile = b.path
      out.push(`### \`${b.path}\``)
    }
    out.push(`#### ${KIND_ICON[b.kind] ?? '📄'} ${KIND_LABEL[b.kind] ?? '其它'} \`${b.name}\` · L${b.startLine}-L${b.endLine}`)
    if (b.signature) out.push(`- 签名: \`${b.signature}\``)
    if (b.summary) out.push(`- 功能: ${b.summary}`)
    if (b.inputs) out.push(`- 入参: ${b.inputs}`)
    if (b.outputs) out.push(`- 返回: ${b.outputs}`)
    if (b.sideEffects) out.push(`- 副作用: ${b.sideEffects}`)
    if (b.dependsOn) out.push(`- 依赖: ${b.dependsOn}`)
    out.push('')
  }
  return out.join('\n').trimEnd() + '\n'
}

export function parseIndexMd(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = []
  let curFile = ''
  let cur: Partial<CodeBlock> | null = null
  const flush = (): void => {
    if (cur && cur.path && cur.name && cur.startLine) {
      blocks.push(cur as CodeBlock)
    }
    cur = null
  }
  for (const line of text.split(/\r?\n/)) {
    let m = line.match(/^### `(.+)`$/)
    if (m) {
      flush()
      curFile = m[1]!
      continue
    }
    m = line.match(/^#### (?:.*?) (函数|方法|类|组件|常量|类型|其它) `([^`]+)` · L(\d+)-L(\d+)/)
    if (m) {
      flush()
      const kindLabel = m[1]!
      const kind: BlockKind =
        kindLabel === '函数' ? 'function'
        : kindLabel === '方法' ? 'method'
        : kindLabel === '类' ? 'class'
        : kindLabel === '组件' ? 'component'
        : kindLabel === '常量' ? 'const'
        : kindLabel === '类型' ? 'type'
        : 'other'
      cur = { path: curFile, name: m[2]!, kind, startLine: Number(m[3]!), endLine: Number(m[4]!), signature: '', doc: '', preview: '' }
      continue
    }
    if (cur) {
      m = line.match(/^- (签名|功能|入参|返回|副作用|依赖): (.*)$/)
      if (m) {
        const value = m[2]!
        switch (m[1]) {
          case '签名': cur.signature = value; break
          case '功能': cur.summary = value; break
          case '入参': cur.inputs = value; break
          case '返回': cur.outputs = value; break
          case '副作用': cur.sideEffects = value; break
          case '依赖': cur.dependsOn = value; break
        }
      }
    }
  }
  flush()
  return blocks
}

// --- snapshot naming -----------------------------------------------------------

export function timestampName(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// --- commit ---------------------------------------------------------------------

function blockKey(b: Pick<CodeBlock, 'path' | 'name' | 'startLine'>): string {
  return `${b.path}#${b.name}@L${b.startLine}`
}

function diffBlocks(prev: CodeBlock[], cur: CodeBlock[]): { added: number; updated: number; removed: number; total: number } {
  const prevKeys = new Map(prev.map((b) => [blockKey(b), b]))
  const curKeys = new Map(cur.map((b) => [blockKey(b), b]))
  let added = 0
  let updated = 0
  for (const [key, b] of curKeys) {
    const p = prevKeys.get(key)
    if (!p) added += 1
    else if ((p.summary ?? '') !== (b.summary ?? '')) updated += 1
  }
  let removed = 0
  for (const key of prevKeys.keys()) if (!curKeys.has(key)) removed += 1
  return { added, updated, removed, total: cur.length }
}

async function uniqueSnapshotName(wbDir: string, timestamp: string): Promise<string> {
  let name = `${timestamp}.md`
  let n = 2
  while ((await stat(join(wbDir, name)).catch(() => null)) !== null) {
    name = `${timestamp}-${n}.md`
    n += 1
  }
  return name
}

/**
 * Merge the model's annotations into a fresh scan and write one `.workbench/`
 * folder per code directory (timestamped snapshot + `latest.md` pointer).
 */
export async function commitIndex(
  root: string,
  annotations: Array<Pick<CodeBlock, 'path' | 'name' | 'startLine'> & Partial<CodeBlock>>,
  note = '',
): Promise<CommitResult> {
  const absRoot = resolve(root)
  const scan = await scanDirectory(absRoot, { maxBlocks: 100000 })
  if (scan.blocks.length === 0 && scan.files.length === 0) {
    return { root: absRoot, written: [], dirs: [], annotated: 0, warnings: ['目录下未发现可索引的代码文件'], total_blocks: 0 }
  }
  // 先按块键建立本次注解索引(不立即应用), 使「继承已有注释 → 覆盖本次注解」的顺序可控。
  const annotationByKey = new Map<string, Pick<CodeBlock, 'path' | 'name' | 'startLine'> & Partial<CodeBlock>>()
  for (const a of annotations) annotationByKey.set(blockKey(a), a)
  const warnings: string[] = []
  let annotated = 0
  const matchedKeys = new Set<string>()
  const groups = new Map<string, CodeBlock[]>()
  for (const b of scan.blocks) {
    const dir = dirname(b.path)
    const arr = groups.get(dir) ?? []
    arr.push(b)
    groups.set(dir, arr)
  }
  const timestamp = timestampName()
  const written: string[] = []
  const dirs: CommitResult['dirs'] = []
  for (const [dir, dirBlocks] of groups) {
    const wbDir = join(absRoot, dir, '.workbench')
    await mkdir(wbDir, { recursive: true })
    const prev = await readIndexFile(join(wbDir, 'latest.md')).catch(() => [])
    // 先继承上一版 latest.md 里已有的功能注释, 再叠加本次提交的注解:
    // 避免「只提交新增块的注释却冲掉旧注释」的覆盖式丢失(与 refreshIndex 一致)。
    inheritAnnotations(prev, dirBlocks)
    for (const b of dirBlocks) {
      const a = annotationByKey.get(blockKey(b))
      if (!a) continue
      matchedKeys.add(blockKey(b))
      if (a.summary !== undefined) {
        b.summary = a.summary
        annotated += 1
      }
      if (a.inputs !== undefined) b.inputs = a.inputs
      if (a.outputs !== undefined) b.outputs = a.outputs
      if (a.sideEffects !== undefined) b.sideEffects = a.sideEffects
      if (a.dependsOn !== undefined) b.dependsOn = a.dependsOn
    }
    const changed = diffBlocks(prev, dirBlocks)
    const snapshotName = await uniqueSnapshotName(wbDir, timestamp)
    const displayRoot = dir === '.' ? absRoot : join(absRoot, dir)
    const md = renderIndexMd({
      root: displayRoot,
      files: scan.files.filter((f) => dirname(f.path) === dir).map((f) => ({ ...f, path: basename(f.path) })),
      blocks: dirBlocks.map((b) => ({ ...b, path: basename(b.path) })),
      timestamp,
      note,
      changed,
    })
    await writeFile(join(wbDir, snapshotName), md, 'utf8')
    await writeFile(join(wbDir, 'latest.md'), md, 'utf8')
    written.push(join(wbDir, snapshotName))
    dirs.push({ dir: dir === '.' ? '.' : dir, ...changed })
  }
  // 未匹配到任何功能块的注解 → 提示(代码可能已改动, 需重新 scan)。
  for (const a of annotations) {
    if (!matchedKeys.has(blockKey(a))) {
      warnings.push(`未匹配: ${a.path}#${a.name}@L${a.startLine}(代码可能已被修改, 请重新 scan)`)
    }
  }
  return { root: absRoot, written, dirs, annotated, warnings, total_blocks: scan.blocks.length }
}

// --- auto refresh (line-number sync) -------------------------------------------

/**
 * Lightweight signature of a code tree (file count + per-file mtime/size),
 * used by watchers to detect changes cheaply before paying for a full scan.
 */
export async function codeDirSignature(root: string): Promise<string> {
  const absRoot = resolve(root)
  const files = await listCodeFiles(absRoot)
  let sig = ''
  for (const file of files.slice(0, 500)) {
    const info = await stat(file).catch(() => null)
    sig += `${file}:${info?.mtimeMs ?? 0}:${info?.size ?? 0};`
  }
  return `${files.length}#${sig}`
}

/** True when a timestamped snapshot newer than `withinMs` already exists. */
async function recentSnapshotWithin(wbDir: string, now: number, withinMs: number): Promise<boolean> {
  const entries = await readdir(wbDir).catch(() => [])
  for (const name of entries) {
    if (!/^\d{4}-\d{2}-\d{2}_\d{6}(-\d+)?\.md$/.test(name)) continue
    const info = await stat(join(wbDir, name)).catch(() => null)
    if (info && now - info.mtimeMs < withinMs) return true
  }
  return false
}

/**
 * Carry annotations from the previous index into fresh blocks. Matches by
 * `basename(path) + name` with the nearest old start line (each old block used
 * once), so line shifts from edits do not lose the functional notes. The
 * basename is used because every directory's index only contains that
 * directory's direct files, where the basename is unique. Only blocks that had
 * a summary count as inherited.
 */
function inheritAnnotations(oldBlocks: CodeBlock[], newBlocks: CodeBlock[]): number {
  let inherited = 0
  const pool = new Map<string, CodeBlock[]>()
  for (const b of oldBlocks) {
    const arr = pool.get(basename(b.path)) ?? []
    arr.push(b)
    pool.set(basename(b.path), arr)
  }
  for (const nb of newBlocks) {
    const candidates = pool.get(basename(nb.path)) ?? []
    let bestIdx = -1
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < candidates.length; i += 1) {
      const o = candidates[i]!
      if (o.name !== nb.name) continue
      const dist = Math.abs(o.startLine - nb.startLine)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }
    if (bestIdx < 0) continue
    const old = candidates.splice(bestIdx, 1)[0]!
    nb.summary = old.summary
    nb.inputs = old.inputs
    nb.outputs = old.outputs
    nb.sideEffects = old.sideEffects
    nb.dependsOn = old.dependsOn
    if (nb.summary) inherited += 1
  }
  return inherited
}

export interface RefreshOptions {
  note?: string
  /** Throttle timestamped snapshots: when a snapshot younger than this exists,
   * only `latest.md` is rewritten (keeps watcher-driven updates from flooding
   * the history folder). 0 = always write a snapshot. */
  snapshotThrottleMs?: number
}

/**
 * Rebuild every `.workbench` index under `root` WITHOUT model participation:
 * fresh scan, annotations inherited from the previous `latest.md` (matched by
 * path+name, nearest line), line numbers refreshed. This is what a file
 * watcher / git hook / build step calls to keep the index in sync with code.
 */
export async function refreshIndex(root: string, opts: RefreshOptions = {}): Promise<CommitResult> {
  const absRoot = resolve(root)
  const scan = await scanDirectory(absRoot, { maxBlocks: 100000 })
  if (scan.blocks.length === 0 && scan.files.length === 0) {
    return { root: absRoot, written: [], dirs: [], annotated: 0, warnings: ['目录下未发现可索引的代码文件'], total_blocks: 0 }
  }
  const groups = new Map<string, CodeBlock[]>()
  for (const b of scan.blocks) {
    const dir = dirname(b.path)
    const arr = groups.get(dir) ?? []
    arr.push(b)
    groups.set(dir, arr)
  }
  const timestamp = timestampName()
  const now = Date.now()
  const written: string[] = []
  const dirs: CommitResult['dirs'] = []
  let annotated = 0
  for (const [dir, dirBlocks] of groups) {
    const wbDir = join(absRoot, dir, '.workbench')
    await mkdir(wbDir, { recursive: true })
    const prev = await readIndexFile(join(wbDir, 'latest.md')).catch(() => [])
    annotated += inheritAnnotations(prev, dirBlocks)
    const changed = diffBlocks(prev, dirBlocks)
    const displayRoot = dir === '.' ? absRoot : join(absRoot, dir)
    const md = renderIndexMd({
      root: displayRoot,
      files: scan.files.filter((f) => dirname(f.path) === dir).map((f) => ({ ...f, path: basename(f.path) })),
      blocks: dirBlocks.map((b) => ({ ...b, path: basename(b.path) })),
      timestamp,
      note: opts.note ?? '自动刷新(行号同步)',
      changed,
    })
    const throttle = opts.snapshotThrottleMs ?? 0
    const skipSnapshot = throttle > 0 && (await recentSnapshotWithin(wbDir, now, throttle))
    if (!skipSnapshot) {
      const snapshotName = await uniqueSnapshotName(wbDir, timestamp)
      await writeFile(join(wbDir, snapshotName), md, 'utf8')
      written.push(join(wbDir, snapshotName))
    } else {
      written.push(join(wbDir, 'latest.md'))
    }
    await writeFile(join(wbDir, 'latest.md'), md, 'utf8')
    dirs.push({ dir: dir === '.' ? '.' : dir, ...changed })
  }
  return { root: absRoot, written, dirs, annotated, warnings: [], total_blocks: scan.blocks.length }
}

// --- locate ----------------------------------------------------------------------

export async function readIndexFile(file: string): Promise<CodeBlock[]> {
  const text = await readFile(file, 'utf8')
  return parseIndexMd(text)
}

/**
 * Collect every `.workbench/latest.md` under `dir` (bounded walk). Each entry
 * carries its owning directory so callers can reconstruct absolute paths.
 */
export async function collectWorkbenchIndexes(
  dir: string,
): Promise<Array<{ indexDir: string; blocks: CodeBlock[] }>> {
  const absRoot = resolve(dir)
  const out: Array<{ indexDir: string; blocks: CodeBlock[] }> = []
  let count = 0
  async function walk(d: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || count > 500) return
    const latest = join(d, '.workbench', 'latest.md')
    const blocks = await readIndexFile(latest).catch(() => null)
    if (blocks) {
      out.push({ indexDir: d, blocks })
      count += 1
    }
    const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue
      await walk(join(d, e.name), depth + 1)
    }
  }
  await walk(absRoot, 0)
  return out
}

/**
 * Search all `.workbench/latest.md` under `dir` for blocks matching `query`.
 * Returns per-index-directory hit groups; each hit carries the file (relative
 * to that index directory) and the exact line range to read.
 */
export async function locateInIndexes(
  dir: string,
  query: string,
  topK = 10,
): Promise<Array<{ indexDir: string; hits: LocateHit[] }>> {
  const terms = new Set(tokenize(query))
  if (terms.size === 0) return []
  const indexes = await collectWorkbenchIndexes(dir)
  const scored: Array<LocateHit & { indexDir: string }> = []
  for (const { indexDir, blocks } of indexes) {
    for (const b of blocks) {
      const tokens = tokenize(`${b.name} ${b.summary ?? ''} ${b.signature} ${b.doc} ${b.path}`)
      let score = 0
      for (const t of tokens) {
        if (terms.has(t)) score += t === b.name.toLocaleLowerCase() ? 3 : 1
      }
      if (score > 0) {
        scored.push({
          indexDir,
          file: b.path,
          name: b.name,
          kind: b.kind,
          startLine: b.startLine,
          endLine: b.endLine,
          summary: b.summary,
          score,
        })
      }
    }
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, Math.max(1, topK))
  const byDir = new Map<string, LocateHit[]>()
  for (const s of top) {
    const arr = byDir.get(s.indexDir) ?? []
    arr.push({ file: s.file, name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine, summary: s.summary, score: s.score })
    byDir.set(s.indexDir, arr)
  }
  return [...byDir.entries()].map(([indexDir, hits]) => ({ indexDir, hits }))
}
