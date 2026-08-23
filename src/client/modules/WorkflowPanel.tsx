/**
 * 工作流模块 (V1): 表单式节点列表编排 + 干运行执行。
 * 节点类型: prompt / transform / tool / output; 拖拽图编排留待 V2。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, styles, okNote, palette } from '../ui.js'
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
  const { snapshot, refresh } = props
  const workflows = snapshot.value.workflows
  const [selectedId, setSelectedId] = React.useState<string | null>(workflows[0]?.id ?? null)
  const [draft, setDraft] = React.useState<WorkflowDefinition | null>(null)
  const [logs, setLogs] = React.useState<WorkflowStepLog[] | null>(null)
  const [inputsText, setInputsText] = React.useState('')
  const [newKind, setNewKind] = React.useState<WorkflowNode['kind']>('prompt')
  const [newLabel, setNewLabel] = React.useState('')
  const [newParams, setNewParams] = React.useState('')
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
      setNote('工作流已保存')
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
      setNote('内置模板已恢复')
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
      <Section title="工作流列表" right={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <Button disabled={busy} onClick={() => void restoreTemplates()}>恢复内置模板</Button>
          <Button variant="primary" onClick={() => { setSelectedId(null); setDraft({ id: '', name: '新工作流', description: '', nodes: [] }) }}>新建</Button>
        </span>
      }>
        {err && <ErrorNote text={err} />}
        {note && <div style={{ marginBottom: 8 }}>{okNote(note)}</div>}
        {workflows.length === 0 && <Empty text="暂无工作流。点「新建」或「恢复内置模板」。首次启动会自动创建内置模板。" />}
        {workflows.map((w) => (
          <div key={w.id} style={{ ...styles.row, marginBottom: 4 }}>
            <button
              style={{ ...styles.button, flex: 1, textAlign: 'left', background: w.id === selectedId ? palette.accent : palette.panelAlt, color: w.id === selectedId ? '#fff' : palette.text, borderColor: w.id === selectedId ? palette.accent : palette.border }}
              onClick={() => select(w.id)}
            >
              <strong>{w.name}</strong>
              <span style={{ marginLeft: 8, opacity: 0.75, fontWeight: 400 }}>{w.description || '—'}</span>
            </button>
          </div>
        ))}
      </Section>

      {draft && (
        <Section title={`编辑: ${draft.name || '(未命名)'}`} right={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button variant="danger" onClick={() => void remove()}>删除</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>保存</Button>
          </span>
        }>
          <Field label="名称">
            <input style={{ ...styles.input, width: '100%' }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="描述">
            <input style={{ ...styles.input, width: '100%' }} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>

          <div style={{ fontSize: 12, color: palette.dim, margin: '10px 0 6px' }}>节点 ({draft.nodes.length}) — 按顺序执行:</div>
          {draft.nodes.length === 0 && <Empty text="还没有节点。" />}
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

          <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: 12, color: palette.dim, marginBottom: 6 }}>添加节点:</div>
            <div style={styles.row}>
              <select style={styles.input} value={newKind} onChange={(e) => { setNewKind(e.target.value as WorkflowNode['kind']); setNewParams('') }}>
                {NODE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <input style={{ ...styles.input, flex: 1, minWidth: 140 }} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="节点名称" />
              <Button variant="primary" onClick={addNode}>添加</Button>
            </div>
            <input
              style={{ ...styles.input, width: '100%', marginTop: 4 }}
              value={newParams}
              onChange={(e) => setNewParams(e.target.value)}
              placeholder={paramsPlaceholder(newKind)}
            />
          </div>
        </Section>
      )}

      {draft && (
        <Section title="手动运行 (干运行)">
          <Field label="输入变量">
            <textarea style={styles.textarea} value={inputsText} onChange={(e) => setInputsText(e.target.value)} placeholder="var=value, 每行一个; 对应节点里的 {{var}} 占位符" />
          </Field>
          <div style={styles.row}>
            <Button variant="primary" disabled={busy} onClick={() => void run()}>运行</Button>
            {logs && <span style={styles.dim}>共 {logs.length} 步</span>}
          </div>
          {logs && (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>节点</th>
                  <th style={styles.th}>状态</th>
                  <th style={styles.th}>详情</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((step) => (
                  <tr key={step.index}>
                    <td style={styles.td}>{step.index}</td>
                    <td style={styles.td}>{step.label}</td>
                    <td style={styles.td}>
                      {step.status === 'ok' ? <span style={styles.ok}>ok</span> : step.status === 'skipped' ? <span style={styles.warn}>跳过</span> : <span style={styles.danger}>错误</span>}
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
      return '提示词正文, 支持 {{var}} 占位符'
    case 'transform':
      return '变换: append 文本 / prepend 文本 / replace 旧->新'
    case 'tool':
      return '工具名, 例如 read_document'
    case 'output':
      return '输出格式, 例如 markdown'
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
