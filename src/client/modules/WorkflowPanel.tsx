/**
 * 工作流模块 (V4): 双模式编排 + 真实执行。
 *
 * - 节点模式 (mode='nodes'): prompt / transform / tool / skill / output 节点
 *   列表(或拖拽画布)。tool 节点从「工具」模块读到的 agent 视角工具列表
 *   下拉选择, skill 节点从「技能」模块读到的技能列表下拉选择; 运行时
 *   tool 节点真实调用工具(经宿主以当前会话 agent 的 scope 执行), skill
 *   节点载入技能正文。
 * - 脚本模式 (mode='script'): 直接编排 DSH workflowEngine 的 JS 脚本
 *   (meta/script/args), 宿主委托 ctx.workflowEngine 执行 —— 与模型侧
 *   `workflow` 工具完全一致的能力: agent()/pipeline()/parallel() 子代理编排。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, styles, okNote, palette } from '../ui.js'
import { WorkflowGraph } from '../WorkflowGraph.js'
import { ErrorBoundary } from '../ErrorBoundary.js'
import { t, useLocale } from '../i18n.js'
import type {
  StateSnapshot,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowScriptResult,
  WorkflowStepLog,
} from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
  /** V4: the session this panel belongs to — enables agent-scope real execution. */
  sessionId?: string
}

const NODE_KINDS: Array<{ value: WorkflowNode['kind']; label: string }> = [
  { value: 'prompt', label: '提示词 (prompt)' },
  { value: 'transform', label: '文本变换 (transform)' },
  { value: 'tool', label: '工具 (tool)' },
  { value: 'skill', label: '技能 (skill)' },
  { value: 'output', label: '输出 (output)' },
]

export function WorkflowPanel(props: PanelProps) {
  useLocale()
  const { snapshot, refresh, sessionId } = props
  const workflows = snapshot.value.workflows
  // V4: agent 视角的真实工具/技能列表(由宿主 state.get 投影)。
  const tools = snapshot.tools ?? []
  const skills = snapshot.skills ?? []
  const [selectedId, setSelectedId] = React.useState<string | null>(workflows[0]?.id ?? null)
  const [draft, setDraft] = React.useState<WorkflowDefinition | null>(null)
  const [logs, setLogs] = React.useState<WorkflowStepLog[] | null>(null)
  const [scriptResult, setScriptResult] = React.useState<WorkflowScriptResult | null>(null)
  const [inputsText, setInputsText] = React.useState('')
  const [newKind, setNewKind] = React.useState<WorkflowNode['kind']>('prompt')
  const [newLabel, setNewLabel] = React.useState('')
  const [newParams, setNewParams] = React.useState('')
  const [newToolName, setNewToolName] = React.useState('')
  const [newSkillName, setNewSkillName] = React.useState('')
  const [newArgs, setNewArgs] = React.useState('')
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
    setScriptResult(null)
  }, [workflows, selectedId])

  function select(id: string) {
    setSelectedId(id)
    setLogs(null)
    setScriptResult(null)
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
      if (draft.mode === 'script') {
        const result = await call<WorkflowScriptResult>('workflow.runScript', { id: draft.id, inputs: {}, sessionId })
        setScriptResult(result)
        setLogs(null)
      } else {
        const inputs = parsePairs(inputsText)
        const result = await call<WorkflowStepLog[]>('workflow.run', { id: draft.id, inputs, sessionId })
        setLogs(result)
        setScriptResult(null)
      }
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
      for (const tmpl of templates) await call('workflow.save', { workflow: tmpl })
      await refresh()
      setNote(t('wfRestored'))
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function addNode() {
    if (!draft) return
    let label = newLabel.trim()
    let params: Record<string, string> = {}
    switch (newKind) {
      case 'tool': {
        if (!newToolName) return
        params = { name: newToolName, ...(newArgs.trim() ? { args: newArgs.trim() } : {}) }
        label = newToolName
        break
      }
      case 'skill': {
        if (!newSkillName) return
        params = { name: newSkillName }
        label = newSkillName
        break
      }
      case 'prompt': {
        if (!label) return
        params = { text: newParams }
        break
      }
      case 'transform': {
        if (!label) return
        params = draftParams('transform', newParams)
        break
      }
      case 'output': {
        if (!label) return
        params = draftParams('output', newParams)
        break
      }
    }
    const node: WorkflowNode = { id: `n${Date.now().toString(36)}`, kind: newKind, label, params }
    setDraft({ ...draft, nodes: [...draft.nodes, node] })
    setNewLabel('')
    setNewParams('')
    setNewToolName('')
    setNewSkillName('')
    setNewArgs('')
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

  const mode = draft?.mode ?? 'nodes'

  return (
    <div>
      <Section title={t('wfList')} right={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <Button disabled={busy} onClick={() => void restoreTemplates()}>{t('wfRestore')}</Button>
          <Button variant="primary" onClick={() => {
            setSelectedId(null)
            setDraft({ id: '', name: t('wfNewName'), description: '', nodes: [], mode: 'nodes', script: '', meta: { name: '', description: '', phases: [] } })
          }}>{t('wfNew')}</Button>
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
              {w.mode === 'script' && <span style={{ marginLeft: 6, fontSize: 10, border: `1px solid ${palette.border}`, borderRadius: 4, padding: '0 4px' }}>script</span>}
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
            {mode === 'nodes' && (
              <Button onClick={() => setView(view === 'list' ? 'graph' : 'list')}>
                {view === 'list' ? t('wfGraphView') : t('wfListView')}
              </Button>
            )}
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

          <div style={styles.row}>
            <span style={styles.label}>{t('wfMode')}</span>
            <Button variant={mode === 'nodes' ? 'primary' : undefined} onClick={() => setDraft({ ...draft, mode: 'nodes' })}>{t('wfModeNodes')}</Button>
            <Button variant={mode === 'script' ? 'primary' : undefined} onClick={() => setDraft({ ...draft, mode: 'script' })}>{t('wfModeScript')}</Button>
            <span style={styles.dim}>{mode === 'script' ? t('wfScriptHint') : t('wfNodesHint')}</span>
          </div>

          {mode === 'script' ? (
            <>
              <Field label={t('wfScript')}>
                <textarea
                  style={{ ...styles.textarea, minHeight: 200, fontFamily: 'ui-monospace, monospace' }}
                  value={draft.script ?? ''}
                  onChange={(e) => setDraft({ ...draft, script: e.target.value })}
                  placeholder={t('wfScriptPh')}
                />
              </Field>
              <Field label={t('wfMetaName')}>
                <input style={{ ...styles.input, width: '100%' }} value={draft.meta?.name ?? ''} onChange={(e) => setDraft({ ...draft, meta: { ...(draft.meta ?? {}), name: e.target.value } })} placeholder="kebab-case-name" />
              </Field>
              <Field label={t('wfMetaDesc')}>
                <input style={{ ...styles.input, width: '100%' }} value={draft.meta?.description ?? ''} onChange={(e) => setDraft({ ...draft, meta: { ...(draft.meta ?? {}), description: e.target.value } })} />
              </Field>
              <Field label={t('wfMetaPhases')}>
                <input style={{ ...styles.input, width: '100%' }} value={(draft.meta?.phases ?? []).map((p) => p.title).join(', ')} onChange={(e) => setDraft({ ...draft, meta: { ...(draft.meta ?? {}), phases: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((title) => ({ title })) } })} placeholder={t('wfMetaPhasesPh')} />
              </Field>
              <div style={{ ...styles.dim, marginTop: 4 }}>
                {t('wfScriptNote')}
              </div>
            </>
          ) : (
            <>
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
                    <select style={styles.input} value={newKind} onChange={(e) => { setNewKind(e.target.value as WorkflowNode['kind']); setNewParams(''); setNewToolName(''); setNewSkillName(''); setNewArgs('') }}>
                      {NODE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                    {newKind === 'tool' ? (
                      <select style={{ ...styles.input, flex: 1, minWidth: 180 }} value={newToolName} onChange={(e) => setNewToolName(e.target.value)}>
                        <option value="">{t('wfSelectTool')}</option>
                        {tools.map((tool) => (
                          <option key={tool.name} value={tool.name}>{tool.name} — {(tool.description ?? '').slice(0, 48)}</option>
                        ))}
                      </select>
                    ) : newKind === 'skill' ? (
                      <select style={{ ...styles.input, flex: 1, minWidth: 180 }} value={newSkillName} onChange={(e) => setNewSkillName(e.target.value)}>
                        <option value="">{t('wfSelectSkill')}</option>
                        {skills.map((s) => (
                          <option key={s.name} value={s.name}>{s.name} — {(s.description ?? '').slice(0, 48)}</option>
                        ))}
                      </select>
                    ) : (
                      <input style={{ ...styles.input, flex: 1, minWidth: 140 }} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t('wfNodeName')} />
                    )}
                    <Button variant="primary" onClick={addNode}>{t('add')}</Button>
                  </div>
                  {newKind === 'tool' ? (
                    <input
                      style={{ ...styles.input, width: '100%', marginTop: 4 }}
                      value={newArgs}
                      onChange={(e) => setNewArgs(e.target.value)}
                      placeholder={t('wfArgsJson')}
                    />
                  ) : newKind === 'skill' ? null : (
                    <input
                      style={{ ...styles.input, width: '100%', marginTop: 4 }}
                      value={newParams}
                      onChange={(e) => setNewParams(e.target.value)}
                      placeholder={paramsPlaceholder(newKind)}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </Section>
      )}

      {draft && (
        <Section title={mode === 'script' ? t('wfRunScript') : t('wfRun')}>
          {mode !== 'script' && (
            <Field label={t('wfInputVars')}>
              <textarea style={styles.textarea} value={inputsText} onChange={(e) => setInputsText(e.target.value)} placeholder={t('wfInputVarsPh')} />
            </Field>
          )}
          <div style={styles.row}>
            <Button variant="primary" disabled={busy || !draft.id} onClick={() => void run()}>
              {mode === 'script' ? t('wfRunScriptBtn') : t('wfRealRun')}
            </Button>
            <span style={styles.dim}>{mode === 'script' ? t('wfRunScriptNote') : t('wfRunNote')}</span>
          </div>

          {mode === 'script' && scriptResult && (
            <div>
              <div style={{ marginBottom: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {scriptResult.runId && <span style={styles.dim}>runId: {scriptResult.runId}</span>}
                <span style={styles.ok}>{t('wfAgents')}: {scriptResult.agentsStarted ?? 0}</span>
                <span style={styles.dim}>{t('wfStopReason')}: {scriptResult.stopReason ?? '—'}</span>
                {scriptResult.error && <span style={styles.danger}>⚠ {scriptResult.error}</span>}
              </div>
              <pre style={styles.pre}>{String(JSON.stringify(scriptResult.value ?? null, null, 2))}</pre>
            </div>
          )}

          {mode !== 'script' && logs && (
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
                      {step.status === 'ok' ? <span style={styles.ok}>{t('wfStatusOk')}</span> : step.status === 'running' ? <span style={styles.warn}>{t('wfStatusRun')}</span> : step.status === 'skipped' ? <span style={styles.warn}>{t('wfStatusSkip')}</span> : <span style={styles.danger}>{t('wfStatusErr')}</span>}
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
    case 'skill':
      return t('wfParamSkillPh')
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
      return `${p['name'] ?? ''}${p['args'] ? ` args=${p['args'].slice(0, 30)}` : ''}`
    case 'skill':
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
  const label = kind === 'transform' ? '文本变换' : kind === 'prompt' ? '提示词' : kind === 'tool' ? '工具调用' : kind === 'skill' ? '技能' : '输出'
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
    case 'skill':
      params = { name: '' }
      break
    case 'output':
      params = { format: 'markdown' }
      break
  }
  return { id: `n${Date.now().toString(36)}`, kind, label, params }
}
