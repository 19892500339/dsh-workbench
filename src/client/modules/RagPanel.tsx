/**
 * RAG 模块 (V2): 语料目录 / 分块参数 / 引擎选择 (bm25 | vector | hybrid) /
 * 嵌入端点配置 / 重建索引 / 检索测试。
 * 检索后端: BM25 (src/search.ts) + 向量 (src/embedding.ts, OpenAI 兼容端点)。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, styles, okNote, palette } from '../ui.js'
import type { SearchHit, StateSnapshot } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

export function RagPanel(props: PanelProps) {
  const { snapshot, refresh } = props
  const state = snapshot.value
  const [corpusDir, setCorpusDir] = React.useState(state.rag.corpusDir)
  const [chunkSize, setChunkSize] = React.useState(String(state.rag.chunkSize))
  const [chunkOverlap, setChunkOverlap] = React.useState(String(state.rag.chunkOverlap))
  const [topK, setTopK] = React.useState(String(state.rag.topK))
  const [engine, setEngine] = React.useState(state.rag.engine)
  const [embedBaseUrl, setEmbedBaseUrl] = React.useState(state.rag.embedding.baseUrl)
  const [embedApiKey, setEmbedApiKey] = React.useState(state.rag.embedding.apiKey)
  const [embedModel, setEmbedModel] = React.useState(state.rag.embedding.model)
  const [busy, setBusy] = React.useState(false)
  const [note, setNote] = React.useState<string | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [hits, setHits] = React.useState<SearchHit[] | null>(null)

  async function saveSettings() {
    setErr(null)
    setBusy(true)
    try {
      await call('state.update', {
        patch: {
          rag: {
            corpusDir: corpusDir.trim(),
            chunkSize: clampInt(chunkSize, 100, 20000, 800),
            chunkOverlap: clampInt(chunkOverlap, 0, 5000, 120),
            topK: clampInt(topK, 1, 50, 5),
            engine,
            embedding: { baseUrl: embedBaseUrl.trim(), apiKey: embedApiKey.trim(), model: embedModel.trim() },
          },
        },
        expectedRevision: snapshot.revision,
      })
      await refresh()
      setNote('配置已保存')
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function rebuild() {
    setErr(null)
    setBusy(true)
    try {
      await call('rag.rebuild', {})
      await refresh()
      setNote('索引已重建')
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function runSearch() {
    if (!query.trim()) return
    setErr(null)
    setBusy(true)
    try {
      const result = await call<SearchHit[]>('rag.search', { query: query.trim(), topK: clampInt(topK, 1, 50, 5) })
      setHits(result)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const rag = snapshot.rag

  return (
    <div>
      <Section title="知识库配置" right={note ? okNote(note) : undefined}>
        {err && <ErrorNote text={err} />}
        <Field label="语料目录">
          <input style={{ ...styles.input, width: '100%' }} value={corpusDir} onChange={(e) => setCorpusDir(e.target.value)} placeholder="留空使用默认 ~/.dsh/workbench/corpus" />
        </Field>
        <div style={styles.row}>
          <Field label="chunk 大小">
            <input style={{ ...styles.input, width: 110 }} value={chunkSize} onChange={(e) => setChunkSize(e.target.value)} />
          </Field>
          <Field label="重叠度">
            <input style={{ ...styles.input, width: 110 }} value={chunkOverlap} onChange={(e) => setChunkOverlap(e.target.value)} />
          </Field>
          <Field label="topK">
            <input style={{ ...styles.input, width: 110 }} value={topK} onChange={(e) => setTopK(e.target.value)} />
          </Field>
        </div>
        <div style={styles.row}>
          <Field label="引擎">
            <select style={styles.input} value={engine} onChange={(e) => setEngine(e.target.value as 'bm25' | 'vector' | 'hybrid')}>
              <option value="bm25">BM25 关键词</option>
              <option value="vector">向量 (需嵌入端点)</option>
              <option value="hybrid">混合 (RRF 融合)</option>
            </select>
          </Field>
        </div>
        {(engine === 'vector' || engine === 'hybrid') && (
          <div style={{ background: palette.panelAlt, borderRadius: 6, padding: '8px 10px', margin: '8px 0' }}>
            <div style={{ fontSize: 12, color: palette.dim, marginBottom: 6 }}>嵌入端点 (OpenAI 兼容 /embeddings):</div>
            <Field label="Base URL">
              <input style={{ ...styles.input, width: '100%' }} value={embedBaseUrl} onChange={(e) => setEmbedBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
            </Field>
            <Field label="API Key">
              <input style={{ ...styles.input, width: '100%' }} type="password" value={embedApiKey} onChange={(e) => setEmbedApiKey(e.target.value)} placeholder="sk-… (仅保存在本机设置)" />
            </Field>
            <Field label="模型">
              <input style={{ ...styles.input, width: '100%' }} value={embedModel} onChange={(e) => setEmbedModel(e.target.value)} placeholder="text-embedding-3-small / bge-m3" />
            </Field>
          </div>
        )}
        <div style={styles.row}>
          <Button variant="primary" disabled={busy} onClick={() => void saveSettings()}>保存配置</Button>
          <Button disabled={busy} onClick={() => void rebuild()}>重建索引</Button>
        </div>
        <div style={styles.dim}>
          bm25 内置零依赖; vector/hybrid 需配置嵌入端点(密钥仅发往该端点, 不离开本机)。
          语料支持 .md / .txt, 递归扫描。
        </div>
        {rag && (
          <div style={{ marginTop: 8, fontSize: 12, color: palette.text }}>
            索引状态: {rag.docCount} 个分块{rag.vectorCount !== undefined && ` · ${rag.vectorCount} 个向量${rag.embeddingModel ? ` (${rag.embeddingModel})` : ''}`}
            {' '}· 上次构建 {rag.lastBuiltAt ? new Date(rag.lastBuiltAt).toLocaleString() : '未构建'}
            {rag.lastBuildMs !== null && ` · 耗时 ${rag.lastBuildMs}ms`}
            {rag.error && <span style={styles.danger}> · {rag.error}</span>}
          </div>
        )}
      </Section>

      <Section title="检索测试">
        <div style={styles.row}>
          <input
            style={{ ...styles.input, flex: 1, minWidth: 240 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入检索关键词或问题…"
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
          />
          <Button variant="primary" disabled={busy || !query.trim()} onClick={() => void runSearch()}>检索</Button>
        </div>
        {hits !== null && hits.length === 0 && <Empty text="没有匹配结果" />}
        {hits && hits.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>得分</th>
                <th style={styles.th}>文件</th>
                <th style={styles.th}>片段</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((hit, i) => (
                <tr key={i}>
                  <td style={styles.td}>{hit.score}</td>
                  <td style={styles.td}><span style={styles.code}>{hit.file} #{hit.chunkIndex}</span></td>
                  <td style={styles.td}>{hit.snippet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
