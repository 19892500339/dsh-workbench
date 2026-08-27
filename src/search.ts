/**
 * Zero-dependency BM25 keyword retrieval over a local file corpus.
 *
 * Design notes:
 * - Chunks are plain text (utf-8) split by chunkSize with chunkOverlap.
 * - Tokenizer handles both latin words (lowercased, split on non-alphanumeric)
 *   and CJK text (consecutive CJK runs additionally produce bigrams), so
 *   Chinese documents are searchable without a dictionary.
 * - Scoring is classic BM25 (k1 = 1.2, b = 0.75) with logarithmic IDF
 *   smoothing.
 * - The vector interface is intentionally reserved: engine: 'vector' in the
 *   settings is accepted but not implemented yet — the seam is `RetrievalEngine`.
 *
 * This is an original implementation; no third-party code is copied.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { SearchHit } from './shared/types.js'

/** BM25 constants. */
const K1 = 1.2
const B = 0.75

/** One indexed chunk. */
export interface IndexedDoc {
  id: number
  file: string
  chunkIndex: number
  text: string
  terms: string[]
}

/** In-memory inverted index over a corpus. */
export interface CorpusIndex {
  docs: IndexedDoc[]
  /** term -> docId -> term frequency. */
  postings: Map<string, Map<number, number>>
  /** term -> number of docs containing it. */
  df: Map<string, number>
  /** per-doc term count (for average document length). */
  docLengths: number[]
}

/** Reserved seam for a future embedding/vector engine. */
export interface RetrievalEngine {
  readonly name: string
  rebuild(corpusDir: string, chunkSize: number, overlap: number): Promise<CorpusIndex>
  search(index: CorpusIndex, query: string, topK: number): SearchHit[]
}

const CJK_RE = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/

/** Split latin words; for CJK runs emit chars plus bigrams. */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLocaleLowerCase()
  // Latin / digit words.
  for (const match of lower.matchAll(/[a-z0-9_]+/g)) tokens.push(match[0])
  // CJK chars and bigrams.
  const cjk = lower.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g)
  if (cjk) {
    for (const run of cjk) {
      for (let i = 0; i < run.length; i += 1) tokens.push(run[i]!)
      for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

/** Split text into overlapping chunks of approx `size` characters. */
export function chunkText(text: string, size: number, overlap: number): string[] {
  const step = Math.max(1, size - overlap)
  const chunks: string[] = []
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + size))
  }
  return chunks.length > 0 ? chunks : ['']
}

/**
 * Walk a directory tree for text corpus files (.md / .txt).
 *
 * `opts.includeWorkbenchLatest` additionally indexes each `.workbench/latest.md`
 * (the plugin's own per-directory code index pointer) while still skipping the
 * timestamped history snapshots, so code-index retrieval works through the
 * regular `workbench_search` path without bloating the index with history.
 */
export async function listCorpusFiles(
  corpusDir: string,
  opts?: { includeWorkbenchLatest?: boolean },
): Promise<string[]> {
  const includeWorkbench = opts?.includeWorkbenchLatest === true
  const out: string[] = []
  async function walk(dir: string, inWorkbench: boolean): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '.workbench') {
          if (includeWorkbench) await walk(full, true)
          continue
        }
        if (entry.name.startsWith('.')) continue
        await walk(full, inWorkbench)
      } else if (/\.(md|txt)$/i.test(entry.name)) {
        if (inWorkbench && entry.name !== 'latest.md') continue
        out.push(full)
      }
    }
  }
  await walk(corpusDir, false)
  return out.sort()
}

/** Build the inverted index over a corpus directory. */
export async function buildCorpusIndex(
  corpusDir: string,
  chunkSize: number,
  overlap: number,
  opts?: { includeWorkbenchLatest?: boolean },
): Promise<CorpusIndex> {
  const files = await listCorpusFiles(corpusDir, opts)
  const docs: IndexedDoc[] = []
  const postings = new Map<string, Map<number, number>>()
  const df = new Map<string, number>()
  const docLengths: number[] = []

  let docId = 0
  for (const file of files) {
    const content = await readFile(file, 'utf8').catch(() => '')
    if (!content.trim()) continue
    const chunks = chunkText(content, chunkSize, overlap)
    for (let i = 0; i < chunks.length; i += 1) {
      const terms = tokenize(chunks[i]!)
      const seen = new Set<string>()
      const tf = new Map<string, number>()
      for (const term of terms) {
        tf.set(term, (tf.get(term) ?? 0) + 1)
      }
      docs.push({ id: docId, file: relative(corpusDir, file).split(sep).join('/'), chunkIndex: i, text: chunks[i]!, terms })
      docLengths.push(terms.length)
      for (const [term, count] of tf) {
        if (!seen.has(term)) {
          seen.add(term)
          df.set(term, (df.get(term) ?? 0) + 1)
        }
        let list = postings.get(term)
        if (!list) {
          list = new Map()
          postings.set(term, list)
        }
        list.set(docId, count)
      }
      docId += 1
    }
  }
  return { docs, postings, df, docLengths }
}

/** BM25 score of one document for one term. */
function termScore(
  index: CorpusIndex,
  term: string,
  docId: number,
  docLen: number,
  avgDl: number,
): number {
  const df = index.df.get(term)
  if (df === undefined || df === 0) return 0
  const n = index.docs.length
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
  const tf = index.postings.get(term)?.get(docId) ?? 0
  if (tf === 0) return 0
  return idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * docLen) / Math.max(1, avgDl))))
}

/** Build an excerpt around the first matched term. */
function makeSnippet(text: string, queryTerms: Set<string>, radius = 70): string {
  const lower = text.toLocaleLowerCase()
  let at = -1
  for (const term of queryTerms) {
    const hit = lower.indexOf(term)
    if (hit >= 0 && (at === -1 || hit < at)) at = hit
  }
  if (at < 0) return text.slice(0, radius * 2)
  const start = Math.max(0, at - radius)
  const end = Math.min(text.length, at + radius * 2)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < text.length ? '…' : ''
  return prefix + text.slice(start, end).replace(/\s+/g, ' ').trim() + suffix
}

/** Run BM25 retrieval. */
export function searchIndex(index: CorpusIndex, query: string, topK: number): SearchHit[] {
  const terms = tokenize(query)
  if (terms.length === 0 || index.docs.length === 0) return []
  const avgDl = index.docLengths.reduce((a, b) => a + b, 0) / index.docs.length
  const unique = [...new Set(terms)].filter((t) => index.df.has(t))
  if (unique.length === 0) return []
  const scores = new Map<number, number>()
  for (const doc of index.docs) {
    let score = 0
    for (const term of unique) score += termScore(index, term, doc.id, index.docLengths[doc.id] ?? 0, avgDl)
    if (score > 0) scores.set(doc.id, score)
  }
  const queryTerms = new Set(unique)
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, topK))
    .map(([docId, score]) => {
      const doc = index.docs[docId]!
      return {
        score: Math.round(score * 1000) / 1000,
        file: doc.file,
        chunkIndex: doc.chunkIndex,
        snippet: makeSnippet(doc.text, queryTerms),
      }
    })
}

/** Signature of a corpus (dir + per-file mtime) used for cache invalidation. */
export async function corpusSignature(corpusDir: string, opts?: { includeWorkbenchLatest?: boolean }): Promise<string> {
  const files = await listCorpusFiles(corpusDir, opts)
  let sig = ''
  for (const file of files.slice(0, 200)) {
    const info = await stat(file).catch(() => null)
    sig += `${file}:${info?.mtimeMs ?? 0};`
  }
  return `${files.length}#${sig}`
}

/** The default engine implementation used by the workbench. */
export const bm25Engine: RetrievalEngine = {
  name: 'bm25',
  rebuild: buildCorpusIndex,
  search: searchIndex,
}
