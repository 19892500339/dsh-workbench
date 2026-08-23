/**
 * Unit tests for the V2 vector engine (node --test).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVectorIndex,
  searchVectors,
  fuseRrf,
  isEmbeddingConfigured,
  normalizeInto,
} from '../src/embedding.ts'
import type { SearchHit } from '../src/shared/types.ts'

test('normalizeInto produces unit vectors', () => {
  const v = normalizeInto([3, 4])
  assert.ok(Math.abs(Math.hypot(v[0]!, v[1]!) - 1) < 1e-6)
})

test('vector search ranks the closest doc first', () => {
  const index = buildVectorIndex(
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      { docId: 0, file: 'a.md', chunkIndex: 0, text: 'alpha' },
      { docId: 1, file: 'b.md', chunkIndex: 0, text: 'beta' },
      { docId: 2, file: 'c.md', chunkIndex: 0, text: 'gamma' },
    ],
  )
  const hits = searchVectors(index, [0.9, 0.1, 0], 2)
  assert.equal(hits[0]!.docIndex, 0)
  assert.ok(hits[0]!.score > hits[1]!.score)
})

test('fuseRrf merges BM25 and vector hits by reciprocal rank', () => {
  const bm25: SearchHit[] = [
    { score: 1, file: 'a.md', chunkIndex: 0, snippet: 'short' },
    { score: 2, file: 'b.md', chunkIndex: 0, snippet: 'b snippet' },
  ]
  const vector: SearchHit[] = [
    { score: 0.9, file: 'b.md', chunkIndex: 0, snippet: 'b snippet long' },
    { score: 0.8, file: 'c.md', chunkIndex: 0, snippet: 'c snippet' },
  ]
  const fused = fuseRrf(bm25, vector, 3)
  // b appears in both lists → highest fused score.
  assert.equal(fused[0]!.file, 'b.md')
  assert.ok(fused.length >= 3)
})

test('isEmbeddingConfigured requires baseUrl and model', () => {
  assert.equal(isEmbeddingConfigured({ baseUrl: '', apiKey: '', model: 'm' }), false)
  assert.equal(isEmbeddingConfigured({ baseUrl: 'https://x/v1', apiKey: '', model: '' }), false)
  assert.equal(isEmbeddingConfigured({ baseUrl: 'https://x/v1', apiKey: 'k', model: 'm' }), true)
})
