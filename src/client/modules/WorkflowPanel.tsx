/**
 * 工作流模块 (V2): 表单式节点列表编排 + 拖拽画布(@xyflow/react)+ 干运行执行。
 * 节点类型: prompt / transform / tool / output; 画布拖拽节点改变执行顺序。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, styles, okNote, palette } from '../ui.js'
import { WorkflowGraph } from '../WorkflowGraph.js'
import { ErrorBoundary } from '../ErrorBoundary.js'
import { t, useLocale } from '../i18n.js'
import type { StateSnapshot, WorkflowDefinition, WorkflowNode, WorkflowStepLog } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

const NODE_KINDS: Array<{ value: WorkflowNode['kind']; label: string }> = [
  { value: 'prompt', label: '提示词 (prompt)' },
  { value: 'transform', label: '文本变换 (transform)' },
  { value: 'tool', label: '工具 (tool)' },
  { value: 'output', label: '输出 (output)' },
]

export function WorkflowPanel(props: PanelProps) {
  useLocale()
  const { snapshot, refresh } = props
  const workflows = snapshot.value.workflows
  const [selectedId, setSelectedId] = React.useState<string | null>(workflows[0]?.id ?? null)
  const [draft, setDraft] = React.useState<WorkflowDefinition | null>(null)
  const [logs, setLogs] = React.useState<WorkflowStepLog[] | null>(null)
  const [inputsText, setInputsText] = React.useState('')
  const [newKind, setNewKind] = React.useState<WorkflowNode['kind']>('prompt')
  const [newLabel, setNewLabel] = React.useState('')
  const [newParams, setNewParams] = React.useState('')
  const [view, setView] = React.useState<'list' | 'graph'>('list')
  const [graphSelected, setGraphSelected] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (selectedId && !workflows.some((w) => w.id === selectedId)) setSelectedId(null)
    const active = workflows.find((w) => w.id === selectedId) ?? workflows[0] ?? null
    setDraft(active ? structuredClone(active) : null)
    setLogs(null)
  }, [workflows, selectedId])

  function select(id: string) {
    setSelectedId(id)
    setLogs(null)
  }

  async function save() {
    if (!draft) return
    setErr(null)
    setBusy(true)
    try {
      await call('workflow.save', { workflow: draft })
      await refresh()
      setNote(t('wfSaved'))
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!draft) return
    await call('workflow.remove', { id: draft.id })
    setSelectedId(null)
    await refresh()
  }

  async function run() {
    if (!draft) return
    setErr(null)
    setBusy(true)
    try {
      const inputs = parsePairs(inputsText)
      const result = await call<WorkflowStepLog[]>('workflow.run', { id: draft.id, inputs })
      setLogs(result)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function restoreTemplates() {
    setBusy(true)
    try {
      const templates = await call<WorkflowDefinition[]>('workflow.templates', {})
      for (const t of templates) await call('workflow.save', { workflow: t })
      await refresh()
      setNote(t('wfRestored'))
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function addNode() {
    if (!draft || !newLabel.trim()) return
    const params = draftParams(newKind, newParams)
    const node: WorkflowNode = {
      id: `n${Date.now().toString(36)}`,
      kind: newKind,
      label: newLabel.trim(),
      params,
    }
    setDraft({ ...draft, nodes: [...draft.nodes, node] })
    setNewLabel('')
    setNewParams('')
  }

  function moveNode(index: number, delta: -1 | 1) {
    if (!draft) return
    const nodes = [...draft.nodes]
    const target = index + delta
    if (target < 0 || target >= nodes.length) return
    const [item] = nodes.splice(index, 1)
    nodes.splice(target, 0, item!)
    setDraft({ ...draft, nodes })
  }

  function removeNode(index: number) {
    if (!draft) return
    setDraft({ ...draft, nodes: draft.nodes.filter((_, i) => i !== index) })
  }

  return (
    <div>
      <Section title={t('wfList')} right={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <Button disabled={busy} onClick={() => void restoreTemplates()}>{t('wfRestore')}</Button>
          <Button variant="primary" onClick={() => { setSelectedId(null); setDraft({ id: '', name: t('wfNewName'), description: '', nodes: [] }) }}>{t('wfNew')}</Button>
        </span>
      }>
        {err && <ErrorNote text={err} />}
        {note && <div style={{ marginBottom: 8 }}>{okNote(note)}</div>}
        {workflows.length === 0 && <Empty text={t('wfEmpty')} />}
        {workflows.map((w) => (
          <div key={w.id} style={{ ...styles.row, marginBottom: 4 }}>
            <button
              style={{ ...styles.button, flex: 1, textAlign: 'left', background: w.id === selectedId ? palette.accent : palette.panelAlt, color: w.id === selectedId ? '#fff' : palette.text, borderColor: w.id === selectedId ? palette.accent : palette.border }}
              onClick={() => select(w.id)}
            >
              <strong>{w.name}</strong>
              {w.id === snapshot.value.activeWorkflowId && <span style={styles.ok}> {t('wfActivated')}</span>}
              <span style={{ marginLeft: 8, opacity: 0.75, fontWeight: 400 }}>{w.description || '—'}</span>
            </button>
            <Button
              variant={w.id === snapshot.value.activeWorkflowId ? 'primary' : undefined}
              onClick={async () => { await call('workflow.activate', { id: w.id }); await refresh() }}
              title={t('wfActivateTitle')}
            >
              {t('wfActivate')}
            </Button>
          </div>
        ))}
      </Section>

      {draft && (
        <Section title={`${t('wfEdit')} ${draft.name || '(—)'}`} right={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button onClick={() => setView(view === 'list' ? 'graph' : 'list')}>
              {view === 'list' ? t('wfGraphView') : t('wfListView')}
            </Button>
            <Button variant="danger" onClick={() => void remove()}>{t('delete')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>{t('save')}</Button>
          </span>
        }>
          <Field label={t('name')}>
            <input style={{ ...styles.input, width: '100%' }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label={t('description')}>
            <input style={{ ...styles.input, width: '100%' }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>

          {view === 'graph' ? (
            <>
              <div style={{ fontSize: 12, color: palette.dim, margin: '10px 0 6px' }}>
                {t('wfNodes')} ({draft.nodes.length}) {t('wfGraphHint')}
              </div>
              <ErrorBoundary label={t('wfGraphView')}>
                <WorkflowGraph
                  nodes={draft.nodes}
                  selectedId={graphSelected}
                  onSelect={setGraphSelected}
                  onChange={(next) => { setDraft({ ...draft, nodes: next }); setGraphSelected(null) }}
                  onAddNode={(kind) => {
                    setDraft({ ...draft, nodes: [...draft.nodes, newNodeOf(kind)] })
                    setGraphSelected(null)
                  }}
                />
              </ErrorBoundary>
              {draft.nodes.length === 0 && <Empty text={t('wfNodeEmptyGraph')} />}
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: palette.dim, margin: '10px 0 6px' }}>{t('wfNodes')} ({draft.nodes.length}) {t('wfInOrder')}</div>
              {draft.nodes.length === 0 && <Empty text={t('wfNodeEmpty')} />}
              {draft.nodes.map((n, i) => (
                <div key={n.id} style={{ ...styles.row, background: palette.panelAlt, borderRadius: 6, padding: '6px 8px', marginBottom: 4 }}>
                  <span style={styles.code}>{i + 1}</span>
                  <span style={styles.code}>{n.kind}</span>
                  <strong style={{ fontSize: 12 }}>{n.label}</strong>
                  <span style={{ ...styles.dim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{paramsSummary(n)}</span>
                  <Button onClick={() => moveNode(i, -1)}>↑</Button>
                  <Button onClick={() => moveNode(i, 1)}>↓</Button>
                  <Button variant="danger" onClick={() => removeNode(i)}>✕</Button>
                </div>
              ))}
            </>
          )}

          {view === 'list' && (
            <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 10, paddingTop: 10 }}>
              <div style={{ fontSize: 12, color: palette.dim, marginBottom: 6 }}>{t('wfAddNode')}</div>
              <div style={styles.row}>
                <select style={styles.input} value={newKind} onChange={(e) => { setNewKind(e.target.value as WorkflowNode['kind']); setNewParams('') }}>
                  {NODE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <input style={{ ...styles.input, flex: 1, minWidth: 140 }} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t('wfNodeName')} />
                <Button variant="primary" onClick={addNode}>{t('add')}</Button>
              </div>
              <input
                style={{ ...styles.input, width: '100%', marginTop: 4 }}
                value={newParams}
                onChange={(e) => setNewParams(e.target.value)}
                placeholder={paramsPlaceholder(newKind)}
              />
            </div>
          )}
        </Section>
      )}

      {draft && (
        <Section title={t('wfRun')}>
          <Field label={t('wfInputVars')}>
            <textarea style={styles.textarea} value={inputsText} onChange={(e) => setInputsText(e.target.value)} placeholder={t('wfInputVarsPh')} />
          </Field>
          <div style={styles.row}>
            <Button variant="primary" disabled={busy} onClick={() => void run()}>{t('run')}</Button>
            {logs && <span style={styles.dim}>{t('wfSteps', { n: logs.length })}</span>}
          </div>
          {logs && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>{t('wfNodes')}</th>
                  <th style={styles.th}>{t('wfStatusOk')}</th>
                  <th style={styles.th}>{t('wfDetail')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((step) => (
                  <tr key={step.index}>
                    <td style={styles.td}>{step.index}</td>
                    <td style={styles.td}>{step.label}</td>
                    <td style={styles.td}>
                      {step.status === 'ok' ? <span style={styles.ok}>{t('wfStatusOk')}</span> : step.status === 'skipped' ? <span style={styles.warn}>{t('wfStatusSkip')}</span> : <span style={styles.danger}>{t('wfStatusErr')}</span>}
                    </td>
                    <td style={styles.td}>{step.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      )}
    </div>
  )
}

function draftParams(kind: WorkflowNode['kind'], raw: string): Record<string, string> {
  if (kind === 'transform') {
    const first = raw.split('\n')[0] ?? ''
    const op = /^(append|prepend|replace)(\s|$)/.test(first) ? first.split(/\s+/)[0]! : 'append'
    const value = first.replace(/^(append|prepend|replace)\s+/, '')
    return { op, value, search: op === 'replace' ? value.split('->')[0]?.trim() ?? '' : '', ...(op === 'replace' && value.includes('->') ? { value: value.split('->')[1]?.trim() ?? '' } : {}) }
  }
  if (kind === 'prompt') return { text: raw }
  if (kind === 'tool') return { name: raw.trim() }
  return { format: raw.trim() || 'markdown' }
}

function paramsPlaceholder(kind: WorkflowNode['kind']): string {
  switch (kind) {
    case 'prompt':
      return t('wfParamTextPh')
    case 'transform':
      return t('wfParamTransformPh')
    case 'tool':
      return t('wfParamToolPh')
    case 'output':
      return t('wfParamOutputPh')
  }
}

function paramsSummary(n: WorkflowNode): string {
  const p = n.params
  switch (n.kind) {
    case 'prompt':
      return (p['text'] ?? '').slice(0, 60)
    case 'transform':
      return `${p['op'] ?? 'append'}: ${(p['value'] ?? '').slice(0, 40)}`
    case 'tool':
      return p['name'] ?? ''
    case 'output':
      return p['format'] ?? 'text'
  }
}

function parsePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq > 0) out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

/** A fresh node with sensible defaults for the canvas add-panel. */
function newNodeOf(kind: WorkflowNode['kind']): WorkflowNode {
  const label = kind === 'transform' ? '文本变换' : kind === 'prompt' ? '提示词' : kind === 'tool' ? '工具调用' : '输出'
  let params: Record<string, string>
  switch (kind) {
    case 'prompt':
      params = { text: '{{input}}' }
      break
    case 'transform':
      params = { op: 'append', value: '' }
      break
    case 'tool':
      params = { name: '' }
      break
    case 'output':
      params = { format: 'markdown' }
      break
  }
  return { id: `n${Date.now().toString(36)}`, kind, label, params }
}
