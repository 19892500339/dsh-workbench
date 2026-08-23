/**
 * RAG 模块: 多知识库(选定文件夹为库, 可增删改/上传文档) + 分块参数 +
 * 引擎选择 (bm25 | vector | hybrid) + 嵌入端点配置 + 按库重建/检索。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, styles, okNote, palette } from '../ui.js'
import { t, useLocale } from '../i18n.js'
import type { KnowledgeBase, SearchHit, StateSnapshot } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

const DEFAULT_KB = 'default'

export function RagPanel(props: PanelProps) {
  useLocale()
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
      setNote(t('saved'))
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
      setNote(t('rebuilt'))
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function addKnowledgeBase() {
    if (!kbName.trim() || !kbPath.trim()) {
      setErr(t('kbMissing'))
      return
    }
    setErr(null)
    setBusy(true)
    try {
      await call('kb.save', { kb: { name: kbName.trim(), path: kbPath.trim() } })
      await refresh()
      setKbName('')
      setKbPath('')
      setNote(t('kbAdded'))
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

  /** Upload a pdf/txt/md file into a knowledge base (auto chunk + index). */
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
        setNote(t('kbUploaded', { name: result.name ?? '', kb: kb.name, chars: result.chars ?? 0, chunks: result.chunks ?? 0 }))
      } else {
        setErr(result.error ?? t('uploadFailed'))
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
      <Section title={t('kbSection')} right={<span style={styles.dim}>{knowledgeBases.length} {t('kbCount')}</span>}>
        {knowledgeBases.length === 0 && <Empty text={t('kbEmpty')} />}
        {knowledgeBases.map((kb) => (
          <div key={kb.id} style={{ ...styles.row, background: palette.panelAlt, borderRadius: 6, padding: '6px 8px', marginBottom: 4 }}>
            <strong style={{ fontSize: 13 }}>{kb.name}</strong>
            <span style={styles.code}>{kb.path}</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
              <label style={{ ...styles.button, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                {t('upload')}
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
              <Button onClick={() => setTargetKb(kb.id)}>{t('kbSearchThis')}</Button>
              <Button variant="danger" onClick={() => void removeKnowledgeBase(kb)}>{t('delete')}</Button>
            </span>
          </div>
        ))}
        <div style={{ ...styles.dim, marginTop: 6 }}>{t('kbUploadHint')}</div>
        <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 10, paddingTop: 10 }}>
          <div style={{ fontSize: 12, color: palette.dim, marginBottom: 6 }}>{t('kbAdd')}</div>
          <div style={styles.row}>
            <input style={{ ...styles.input, width: 160 }} value={kbName} onChange={(e) => setKbName(e.target.value)} placeholder={t('name')} />
            <input style={{ ...styles.input, flex: 1, minWidth: 200 }} value={kbPath} onChange={(e) => setKbPath(e.target.value)} placeholder={t('kbPathPh')} />
            <Button variant="primary" disabled={busy} onClick={() => void addKnowledgeBase()}>{t('add')}</Button>
          </div>
        </div>
      </Section>

      <Section title={t('ragConfig')} right={note ? okNote(note) : undefined}>
        {err && <ErrorNote text={err} />}
        <Field label={t('ragDefaultDir')}>
          <input style={{ ...styles.input, width: '100%' }} value={corpusDir} onChange={(e) => setCorpusDir(e.target.value)} placeholder={t('ragDefaultDirPh')} />
        </Field>
        <div style={styles.row}>
          <Field label={t('chunkSize')}>
            <input style={{ ...styles.input, width: 110 }} value={chunkSize} onChange={(e) => setChunkSize(e.target.value)} />
          </Field>
          <Field label={t('overlap')}>
            <input style={{ ...styles.input, width: 110 }} value={chunkOverlap} onChange={(e) => setChunkOverlap(e.target.value)} />
          </Field>
          <Field label={t('topK')}>
            <input style={{ ...styles.input, width: 110 }} value={topK} onChange={(e) => setTopK(e.target.value)} />
          </Field>
        </div>
        <div style={styles.row}>
          <Field label={t('engine')}>
            <select style={styles.input} value={engine} onChange={(e) => setEngine(e.target.value as 'bm25' | 'vector' | 'hybrid')}>
              <option value="bm25">{t('engineBm25')}</option>
              <option value="vector">{t('engineVector')}</option>
              <option value="hybrid">{t('engineHybrid')}</option>
            </select>
          </Field>
        </div>
        {(engine === 'vector' || engine === 'hybrid') && (
          <div style={{ background: palette.panelAlt, borderRadius: 6, padding: '8px 10px', margin: '8px 0' }}>
            <div style={{ fontSize: 12, color: palette.dim, marginBottom: 6 }}>{t('embedSection')}</div>
            <Field label={t('embedBaseUrl')}>
              <input style={{ ...styles.input, width: '100%' }} value={embedBaseUrl} onChange={(e) => setEmbedBaseUrl(e.target.value)} placeholder={t('embedBasePh')} />
            </Field>
            <Field label={t('embedKey')}>
              <input style={{ ...styles.input, width: '100%' }} type="password" value={embedApiKey} onChange={(e) => setEmbedApiKey(e.target.value)} placeholder={t('embedKeyPh')} />
            </Field>
            <Field label={t('embedModel')}>
              <input style={{ ...styles.input, width: '100%' }} value={embedModel} onChange={(e) => setEmbedModel(e.target.value)} placeholder={t('embedModelPh')} />
            </Field>
          </div>
        )}
        <div style={styles.row}>
          <Button variant="primary" disabled={busy} onClick={() => void saveSettings()}>{t('save')}</Button>
          <Button disabled={busy} onClick={() => void rebuild()}>{t('rebuild')}{targetKb !== DEFAULT_KB ? `(${kbNameOf(knowledgeBases, targetKb)})` : ''}</Button>
        </div>
        <div style={styles.dim}>
          {t('ragEngineHint')}
        </div>
        {rag && (
          <div style={{ marginTop: 8, fontSize: 12, color: palette.text }}>
            {t('ragIndexStatus')} {rag.docCount} {t('chunksLabel')}{rag.vectorCount !== undefined && ` · ${rag.vectorCount} ${t('vectorsLabel')}${rag.embeddingModel ? ` (${rag.embeddingModel})` : ''}`}
            {' '}· {t('lastBuilt')} {rag.lastBuiltAt ? new Date(rag.lastBuiltAt).toLocaleString() : t('neverBuilt')}
            {rag.lastBuildMs !== null && ` · ${t('buildMs')} ${rag.lastBuildMs}ms`}
            {rag.error && <span style={styles.danger}> · {rag.error}</span>}
          </div>
        )}
      </Section>

      <Section title={t('ragSearchTest')}>
        <div style={styles.row}>
          <select
            style={styles.input}
            value={targetKb}
            onChange={(e) => setTargetKb(e.target.value)}
          >
            <option value={DEFAULT_KB}>{t('ragTargetDefault')}</option>
            {knowledgeBases.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>
          <input
            style={{ ...styles.input, flex: 1, minWidth: 200 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ragQueryPh')}
            onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
          />
          <Button variant="primary" disabled={busy || !query.trim()} onClick={() => void runSearch()}>{t('search')}</Button>
        </div>
        {hits !== null && hits.length === 0 && <Empty text={t('noHits')} />}
        {hits && hits.length > 0 && (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>{t('colScore')}</th>
                <th style={styles.th}>{t('colFile')}</th>
                <th style={styles.th}>{t('colSnippet')}</th>
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
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
