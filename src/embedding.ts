/**
 * V2 RAG vector engine (original implementation, zero native dependencies):
 *
 * - `embedTexts` calls any OpenAI-compatible `/embeddings` endpoint (OpenAI,
 *   DeepSeek, SiliconFlow, local gateways…) configured by the user — the key
 *   never leaves the host and is only sent in the Authorization header.
 * - `buildVectorIndex` keeps normalized embeddings in one flat Float32Array
 *   (memory friendly); cosine similarity degenerates to a dot product.
 * - `fuseRrf` blends BM25 and vector rankings with Reciprocal Rank Fusion.
 *
 * Deliberately no code is taken from AGPL-licensed DSH RAG projects; the
 * AGPL dsh-knowledge plugin was studied only as a product reference.
 */
import type { EmbeddingConfig, SearchHit } from './shared/types.js'

/** Raised for any embedding endpoint failure, with a human-readable message. */
export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbeddingError'
  }
}

/** One embedded chunk (kept aligned with the BM25 IndexedDoc order). */
export interface VectorDoc {
  docId: number
  file: string
  chunkIndex: number
  text: string
}

/** In-memory cosine index: normalized vectors in one flat Float32Array. */
export interface VectorIndex {
  /** dim * n normalized values. */
  data: Float32Array
  dim: number
  docs: VectorDoc[]
}

export function isEmbeddingConfigured(cfg: EmbeddingConfig): boolean {
  return cfg.baseUrl.trim() !== '' && cfg.model.trim() !== ''
}

/** Embed a batch of texts through the configured endpoint. */
export async function embedTexts(texts: string[], cfg: EmbeddingConfig): Promise<number[][]> {
  const baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '')
  const model = cfg.model.trim()
  if (!baseUrl || !model) throw new EmbeddingError('未配置 embedding 端点 (baseUrl/model)')
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey.trim()}` } : {}),
    },
    body: JSON.stringify({ model, input: texts }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new EmbeddingError(`embeddings 请求失败 (HTTP ${response.status}): ${body.slice(0, 300)}`)
  }
  const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> }
  const vectors = (data.data ?? []).map((entry) => entry.embedding ?? [])
  if (vectors.length !== texts.length || vectors.some((v) => v.length === 0)) {
    throw new EmbeddingError('embeddings 响应异常: 返回数量或维度与请求不匹配')
  }
  return vectors
}

/** L2-normalize one vector (in place). */
export function normalizeInto(v: number[]): Float32Array {
  const out = new Float32Array(v.length)
  let norm = 0
  for (let i = 0; i < v.length; i += 1) {
    out[i] = v[i]!
    norm += v[i]! * v[i]!
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < out.length; i += 1) out[i] = out[i]! / norm
  return out
}

/** Build the flat cosine index from aligned docs and vectors. */
export function buildVectorIndex(vectors: number[][], docs: VectorDoc[]): VectorIndex {
  const dim = vectors[0]?.length ?? 0
  const data = new Float32Array(dim * vectors.length)
  for (let n = 0; n < vectors.length; n += 1) {
    const normalized = normalizeInto(vectors[n]!)
    data.set(normalized, n * dim)
  }
  return { data, dim, docs }
}

/** Cosine similarity between a normalized query and every indexed doc. */
export function searchVectors(index: VectorIndex, query: number[], topK: number): Array<{ docIndex: number; score: number }> {
  const q = normalizeInto(query)
  const n = index.docs.length
  const scores: Array<{ docIndex: number; score: number }> = []
  for (let doc = 0; doc < n; doc += 1) {
    let dot = 0
    const offset = doc * index.dim
    for (let i = 0; i < index.dim; i += 1) dot += q[i]! * index.data[offset + i]!
    scores.push({ docIndex: doc, score: dot })
  }
  return scores.sort((a, b) => b.score - a.score).slice(0, Math.max(1, topK))
}

/** Reciprocal Rank Fusion of BM25 and vector hit lists. */
export function fuseRrf(bm25: SearchHit[], vector: SearchHit[], topK: number, k = 60): SearchHit[] {
  const fused = new Map<string, SearchHit>()
  const rankOf = (lists: SearchHit[]) => {
    for (let rank = 0; rank < lists.length; rank += 1) {
      const hit = lists[rank]!
      const key = `${hit.file}\u0000${hit.chunkIndex}`
      const current = fused.get(key)
      const score = (current?.score ?? 0) + 1 / (k + rank + 1)
      const kept: SearchHit = {
        ...hit,
        score: Math.round(score * 1000) / 1000,
      }
      // Prefer the hit whose snippet is more informative (longer).
      if (!current || kept.snippet.length > current.snippet.length) fused.set(key, kept)
    }
  }
  rankOf(bm25)
  rankOf(vector)
  return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(1, topK))
}
