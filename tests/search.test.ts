/**
 * Unit tests for the BM25 retrieval engine (node --test).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { tokenize, chunkText, buildCorpusIndex, searchIndex } from '../src/search.ts'

test('tokenize splits latin words and CJK bigrams', () => {
  const tokens = tokenize('Hello World, 你好世界')
  assert.ok(tokens.includes('hello'))
  assert.ok(tokens.includes('world'))
  assert.ok(tokens.includes('你'))
  assert.ok(tokens.includes('你好'))
  assert.ok(tokens.includes('好世'))
})

test('chunkText produces overlapping chunks', () => {
  const chunks = chunkText('a'.repeat(100), 40, 10)
  assert.ok(chunks.length >= 3)
  assert.ok(chunks[0]!.length <= 40)
})

test('index + search roundtrip over a temp corpus', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-test-'))
  try {
    await writeFile(join(dir, 'a.md'), 'DeepSeek Harness 插件开发指南。', 'utf8')
    await writeFile(join(dir, 'b.txt'), 'React 组件与插槽注册。', 'utf8')
    const index = await buildCorpusIndex(dir, 200, 20)
    assert.ok(index.docs.length >= 2)

    const hits = searchIndex(index, '插件', 5)
    assert.ok(hits.length > 0)
    assert.equal(hits[0]!.file, 'a.md')
    assert.ok(hits[0]!.snippet.includes('插件'))

    const miss = searchIndex(index, '不存在的词xyz', 5)
    assert.equal(miss.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
