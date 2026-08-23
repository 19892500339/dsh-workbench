/**
 * RAG 模块 (V2.1): 多知识库(选定文件夹为库, 可增删改) + 分块参数 +
 * 引擎选择 (bm25 | vector | hybrid) + 嵌入端点配置 + 按库重建/检索。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, styles, okNote, palette } from '../ui.js'
import type { KnowledgeBase, SearchHit, StateSnapshot } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

const DEFAULT_KB = 'default'

export function RagPanel(props: PanelProps) {
  const { snapshot, refresh } = props
  const state = snapshot.value
  const knowledgeBases = state.rag.knowledgeBases
  const [corpusDir, setCorpusDir] = React.useState(state.rag.corpusDir)
  const [chunkSize, setChunkSize] = React.useState(String(state.rag.chunkSize))
  const [chunkOverlap, setChunkOverlap] = React.useState(String(state.rag.chunkOverlap))
  const [topK, setTopK] = React.useState(String(state.rag.topK))
  const [engine, setEngine] = React.useState(state.rag.engine)
  const [embedBaseUrl, setEmbedBaseUrl] = React.useState(state.rag.embedding.baseUrl)
  const [embedApiKey, setEmbedApiKey] = React.useState(state.rag.embedding.apiKey)
  const [embedModel, setEmbedModel] = React.useState(state.rag.embedding.model)
  const [targetKb, setTargetKb] = React.useState<string>(DEFAULT_KB)
  const [kbName, setKbName] = React.useState('')
  const [kbPath, setKbPath] = React.useState('')
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
      await call('rag.rebuild', { kbId: targetKb })
      await refresh()
      setNote('索引已重建')
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function addKnowledgeBase() {
    if (!kbName.trim() || !kbPath.trim()) {
      setErr('知识库需要名称与文件夹路径')
      return
    }
    setErr(null)
    setBusy(true)
    try {
      await call('kb.save', { kb: { name: kbName.trim(), path: kbPath.trim() } })
      await refresh()
      setKbName('')
      setKbPath('')
      setNote('知识库已添加, 检索时自动建立索引')
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeKnowledgeBase(kb: KnowledgeBase) {
    setErr(null)
    try {
      await call('kb.remove', { id: kb.id })
      if (targetKb === kb.id) setTargetKb(DEFAULT_KB)
      await refresh()
    } catch (e) {
      setErr(errorMessage(e))
    }
  }

  /** V3.1: upload a pdf/txt/md file into a knowledge base (auto chunk + index). */
  async function uploadDocument(kb: KnowledgeBase, file: File) {
    setErr(null)
    setBusy(true)
    try {
      const base64 = await readFileAsBase64(file)
      const result = await call<{ ok: boolean; name?: string; chars?: number; chunks?: number; error?: string }>(
        'kb.uploadDocument',
        { kbId: kb.id, fileName: file.name, contentBase64: base64 },
      )
      if (result.ok) {
        setNote(`已上传「${result.name}」到知识库「${kb.name}」: 解析 ${result.chars} 字符, 切分 ${result.chunks} 块, 索引已重建(向量引擎启用时自动向量化)`)
      } else {
        setErr(result.error ?? '上传失败')
      }
      await refresh()
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
      const result = await call<SearchHit[]>('rag.search', {
        query: query.trim(),
        topK: clampInt(topK, 1, 50, 5),
        kbId: targetKb,
      })
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
      <Section title="知识库 (文件夹)" right={<span style={styles.dim}>{knowledgeBases.length} 个</span>}>
        {knowledgeBases.length === 0 && <Empty text="还没有知识库。把某个文件夹指定为知识库后, 模型可用 workbench_search 检索它。" />}
        {knowledgeBases.map((kb) => (
          <div key={kb.id} style={{ ...styles.row, background: palette.panelAlt, borderRadius: 6, padding: '6px 8px', marginBottom: 4 }}>
            <strong style={{ fontSize: 13 }}>{kb.name}</strong>
            <span style={styles.code}>{kb.path}</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
              <label style={{ ...styles.button, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                上传文档
                <input
                  type="file"
                  accept=".pdf,.txt,.md"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void uploadDocument(kb, file)
                    e.target.value = ''
                  }}
                />
              </label>
              <Button onClick={() => setTargetKb(kb.id)}>检索此库</Button>
              <Button variant="danger" onClick={() => void removeKnowledgeBase(kb)}>删除</Button>
            </span>
          </div>
        ))}
        <div style={{ ...styles.dim, marginTop: 6 }}>
          「上传文档」支持 .pdf / .txt / .md: 自动解析 → 按分块参数切割 → 存入该知识库并重建索引(向量引擎启用时自动向量化)。
        </div>
        <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 12, color: palette.dim, marginBottom: 6 }}>添加知识库 (指定一个文件夹):</div>
          <div style={styles.row}>
            <input style={{ ...styles.input, width: 160 }} value={kbName} onChange={(e) => setKbName(e.target.value)} placeholder="名称" />
            <input style={{ ...styles.input, flex: 1, minWidth: 200 }} value={kbPath} onChange={(e) => setKbPath(e.target.value)} placeholder="文件夹绝对路径, 例如 D:\\docs\\kb1" />
            <Button variant="primary" disabled={busy} onClick={() => void addKnowledgeBase()}>添加</Button>
          </div>
        </div>
      </Section>

      <Section title="检索配置" right={note ? okNote(note) : undefined}>
        {err && <ErrorNote text={err} />}
        <Field label="默认语料目录">
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
          <Button disabled={busy} onClick={() => void rebuild()}>重建索引{targetKb !== DEFAULT_KB ? `(${kbNameOf(knowledgeBases, targetKb)})` : '(默认)'}</Button>
        </div>
        <div style={styles.dim}>
          bm25 内置零依赖; vector/hybrid 需配置嵌入端点(密钥仅发往该端点, 不离开本机)。
          语料支持 .md / .txt, 递归扫描。
        </div>
        {rag && (
          <div style={{ marginTop: 8, fontSize: 12, color: palette.text }}>
            默认库索引: {rag.docCount} 个分块{rag.vectorCount !== undefined && ` · ${rag.vectorCount} 个向量${rag.embeddingModel ? ` (${rag.embeddingModel})` : ''}`}
            {' '}· 上次构建 {rag.lastBuiltAt ? new Date(rag.lastBuiltAt).toLocaleString() : '未构建'}
            {rag.lastBuildMs !== null && ` · 耗时 ${rag.lastBuildMs}ms`}
            {rag.error && <span style={styles.danger}> · {rag.error}</span>}
          </div>
        )}
      </Section>

      <Section title="检索测试">
        <div style={styles.row}>
          <select
            style={styles.input}
            value={targetKb}
            onChange={(e) => setTargetKb(e.target.value)}
          >
            <option value={DEFAULT_KB}>默认语料目录</option>
            {knowledgeBases.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>
          <input
            style={{ ...styles.input, flex: 1, minWidth: 200 }}
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

function kbNameOf(kbs: KnowledgeBase[], id: string): string {
  return kbs.find((k) => k.id === id)?.name ?? id
}

/** Read a File as base64 (data URL payload). */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result ?? '')
      const comma = url.indexOf(',')
      resolve(comma >= 0 ? url.slice(comma + 1) : url)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
