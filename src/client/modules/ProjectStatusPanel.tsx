/**
 * 项目状态模块 (V7): 代码索引之上的「项目体检」总览。
 *
 * - 六维状态卡: RAG / MCP / 技能 / 工具 / 工作流 / 结构, 每维「状态 + 健康度」;
 * - 总体健康分数 + 注释覆盖 / TODO / 依赖边 / 调用边统计;
 * - 框架树(文件→功能块) / 依赖图(SVG) / 调用图(SVG);
 * - 点击任一代码引用 → 面板内直接展开源码(按行范围读取)。
 *
 * 数据经 /workbench/api 的 projectstatus.get / scan / readFile RPC 从宿主读取。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Button, Empty, ErrorNote, styles, palette } from '../ui.js'
import { t, useLocale } from '../i18n.js'
import type {
  ProjectStatusReport,
  DimensionStatus,
  DimensionId,
  CodeRef,
  ReadFileResult,
  HealthLevel,
  StateSnapshot,
} from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
  sessionId?: string
}

const DIM_LABELS: Record<DimensionId, string> = {
  rag: 'RAG',
  mcp: 'MCP',
  skill: 'Skill',
  tool: 'Tool',
  workflow: 'Workflow',
  structure: 'Structure',
}

const HEALTH_COLOR: Record<HealthLevel, string> = {
  good: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-label)',
  error: 'var(--dsw-alias-state-error-primary)',
}

const HEALTH_TEXT: Record<HealthLevel, string> = { good: '健康', warn: '注意', error: '异常' }

function basenameOf(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] ?? p
}

/** Shorten a path to keep graph labels readable. */
function shortLabel(p: string): string {
  const parts = p.split('/')
  if (parts.length <= 2) return p
  return `…/${parts.slice(-2).join('/')}`
}

function HealthBadge(props: { health: HealthLevel; score: number }) {
  const color = HEALTH_COLOR[props.health]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 11,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: '1px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, display: 'inline-block' }} />
      {HEALTH_TEXT[props.health]} · {props.score}
    </span>
  )
}

interface GraphNode {
  id: string
  label: string
}

function buildGraphNodes(edges: Array<{ from: string; to: string; external?: boolean }>, labelOf: (id: string) => string, cap: number): GraphNode[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (!seen.has(id) && ids.length < cap) {
      seen.add(id)
      ids.push(id)
    }
  }
  for (const e of edges) {
    if (e.external) continue
    push(e.from)
    if (ids.length < cap) push(e.to)
    if (ids.length >= cap) break
  }
  return ids.map((id) => ({ id, label: labelOf(id) }))
}

function GraphSvg(props: { nodes: GraphNode[]; edges: Array<{ from: string; to: string; external?: boolean }>; onNode: (id: string) => void; highlight?: string }) {
  const n = props.nodes.length
  if (n === 0) return <Empty text={t('psNoEdges')} />
  const size = 560
  const cx = size / 2
  const cy = size / 2
  const r = Math.min(cx, cy) - 46
  const pos = new Map<string, { x: number; y: number }>()
  props.nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    pos.set(node.id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  })
  const internal = props.edges.filter((e) => !e.external && pos.has(e.from) && pos.has(e.to))
  return (
    <svg width="100%" viewBox={`0 0 ${size} ${size}`} style={{ background: palette.panelAlt, border: `1px solid ${palette.border}`, borderRadius: 8, display: 'block' }}>
      {internal.map((e, i) => {
        const a = pos.get(e.from)!
        const b = pos.get(e.to)!
        return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={palette.border} strokeWidth={1} opacity={0.8} />
      })}
      {props.nodes.map((node) => {
        const p = pos.get(node.id)!
        const active = props.highlight === node.id
        return (
          <g key={node.id} onClick={() => props.onNode(node.id)} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r={active ? 8 : 6} fill={active ? palette.accent : palette.ok} />
            <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize={10} fill={active ? palette.accent : palette.text}>
              {node.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function FileTree(props: { report: ProjectStatusReport; onOpen: (ref: CodeRef) => void }) {
  // group files by top-level directory
  const groups = new Map<string, ProjectStatusReport['files']>()
  for (const f of props.report.files) {
    const dir = f.file.includes('/') ? f.file.split('/')[0]! : '(root)'
    const arr = groups.get(dir) ?? []
    arr.push(f)
    groups.set(dir, arr)
  }
  const sorted = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return (
    <div>
      {sorted.map(([dir, files]) => (
        <div key={dir} style={{ marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: palette.text, marginBottom: 4 }}>📁 {dir}</div>
          <table style={styles.table}>
            <tbody>
              {files.map((f) => (
                <tr key={f.file}>
                  <td style={styles.td}>
                    <button
                      style={{ ...styles.button, padding: '2px 6px', fontSize: 11, border: 'none', background: 'transparent', color: palette.text, cursor: 'pointer' }}
                      onClick={() => props.onOpen({ file: f.file, name: f.file, kind: 'other', startLine: 1, endLine: Math.min(f.lines, 60) })}
                      title={t('psOpenCode')}
                    >
                      {basenameOf(f.file)}
                    </button>
                  </td>
                  <td style={{ ...styles.td, color: palette.dim, fontSize: 11 }}>{f.lines} 行</td>
                  <td style={{ ...styles.td, color: palette.dim, fontSize: 11 }}>{f.blocks} 块</td>
                  <td style={{ ...styles.td, fontSize: 11 }}>
                    <span style={{ color: f.blocks > 0 ? (f.annotated / f.blocks >= 0.5 ? palette.ok : palette.warn) : palette.dim }}>
                      注释 {f.annotated}/{f.blocks}
                    </span>
                  </td>
                  {(f.todos > 0 || f.fixmes > 0) && (
                    <td style={{ ...styles.td, fontSize: 11, color: palette.warn }}>
                      {f.todos > 0 ? `TODO ${f.todos}` : ''}
                      {f.todos > 0 && f.fixmes > 0 ? ' · ' : ''}
                      {f.fixmes > 0 ? `FIXME ${f.fixmes}` : ''}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function CodeViewer(props: { dir: string; ref: CodeRef | null; onClose: () => void }) {
  const [data, setData] = React.useState<ReadFileResult | null>(null)
  const [err, setErr] = React.useState<string | null>(null)
  React.useEffect(() => {
    const ref = props.ref
    if (!ref) {
      setData(null)
      return
    }
    setErr(null)
    setData(null)
    void (async () => {
      try {
        const res = await call<ReadFileResult>('projectstatus.readFile', {
          dir: props.dir,
          file: ref.file,
          startLine: ref.startLine,
          endLine: ref.endLine,
        })
        setData(res)
      } catch (e) {
        setErr(errorMessage(e))
      }
    })()
  }, [props.ref, props.dir])

  if (!props.ref) return null
  return (
    <Section
      title={
        <span>
          📄 {props.ref.file} · L{props.ref.startLine}-L{props.ref.endLine}
          {props.ref.summary ? <span style={{ color: palette.dim, fontWeight: 400 }}> — {props.ref.summary}</span> : null}
        </span>
      }
      right={<Button onClick={props.onClose}>{t('psClose')}</Button>}
    >
      {err && <ErrorNote text={err} />}
      {!data && !err && <div style={styles.dim}>{t('loading')}</div>}
      {data && (
        <pre style={{ ...styles.pre, maxHeight: 420, overflowY: 'auto', margin: 0 }}>
          {data.lines.map((l) => (
            <div key={l.n} style={{ display: 'flex', fontFamily: 'ui-monospace, monospace' }}>
              <span style={{ color: palette.dim, minWidth: 44, textAlign: 'right', marginRight: 12, userSelect: 'none' }}>{l.n}</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{l.text}</span>
            </div>
          ))}
        </pre>
      )}
    </Section>
  )
}

export function ProjectStatusPanel(props: PanelProps) {
  useLocale()
  const { snapshot, refresh, sessionId } = props
  const dirs = snapshot.value.indexWatchDirs.map((d) => d.trim()).filter((d) => d.length > 0)
  const [dir, setDir] = React.useState<string>(dirs[0] ?? '')
  const [report, setReport] = React.useState<ProjectStatusReport | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [view, setView] = React.useState<'overview' | 'structure' | 'deps' | 'calls'>('overview')
  const [openRef, setOpenRef] = React.useState<CodeRef | null>(null)

  const load = React.useCallback(
    async (scan: boolean) => {
      if (!dir) return
      setBusy(true)
      setErr(null)
      try {
        const payload: Record<string, unknown> = { dir }
        if (sessionId) payload.sessionId = sessionId
        const res = await call<ProjectStatusReport>(scan ? 'projectstatus.scan' : 'projectstatus.get', payload)
        setReport(res)
      } catch (e) {
        setErr(errorMessage(e))
      } finally {
        setBusy(false)
      }
    },
    [dir, sessionId],
  )

  React.useEffect(() => {
    if (dir) void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir])

  React.useEffect(() => {
    setOpenRef(null)
  }, [view, dir])

  if (dirs.length === 0) {
    return <Empty text={t('psNoDir')} />
  }

  const openCode = (ref: CodeRef) => {
    setOpenRef(ref)
    setView('overview')
  }

  return (
    <div>
      <Section
        title="🩺 项目状态"
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select style={{ ...styles.input, maxWidth: 320 }} value={dir} onChange={(e) => setDir(e.target.value)}>
              {dirs.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <Button disabled={busy} onClick={() => void load(false)}>
              {t('psLoad')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void load(true)}>
              {t('psRescan')}
            </Button>
          </div>
        }
      >
        {err && <ErrorNote text={err} />}
        {busy && !report && <div style={{ ...styles.dim, padding: 16 }}>{t('loading')}</div>}

        {report && (
          <div>
            {/* overall health */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
              <HealthBadge health={report.summary.health} score={report.summary.healthScore} />
              <span style={styles.dim}>
                {report.summary.files} {t('psFiles')} · {report.summary.blocks} {t('psBlocks')} · {t('psCoverage')}{' '}
                {report.summary.annotationCoverage}% · TODO {report.summary.todoCount} · FIXME {report.summary.fixmeCount} ·{' '}
                {t('psDepEdges')} {report.summary.dependencyCount} · {t('psCallEdges')} {report.summary.callCount}
              </span>
            </div>

            {/* view tabs */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {(
                [
                  ['overview', t('psOverview')],
                  ['structure', t('psStructure')],
                  ['deps', t('psDeps')],
                  ['calls', t('psCalls')],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  style={{
                    ...styles.button,
                    background: view === id ? palette.accent : 'transparent',
                    color: view === id ? palette.accentText : palette.text,
                    borderColor: view === id ? palette.accent : palette.border,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {view === 'overview' && (
              <div>
                {/* six dimension cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
                  {report.dimensions.map((d) => (
                    <DimensionCard key={d.id} dim={d} onClick={() => setView('overview')} onOpen={openCode} />
                  ))}
                </div>

                {/* TODO list */}
                {report.todos.length > 0 && (
                  <Section title={`TODO / FIXME (${report.todos.length})`}>
                    {report.todos.slice(0, 40).map((todo, i) => (
                      <div key={i} style={{ fontSize: 12, color: palette.dim, padding: '2px 0' }}>
                        <span style={{ color: palette.warn }}>[{todo.tag}]</span>{' '}
                        <button
                          style={{ ...styles.button, padding: '1px 5px', fontSize: 11, border: 'none', background: 'transparent', color: palette.text, cursor: 'pointer' }}
                          onClick={() => openCode({ file: todo.file, name: basenameOf(todo.file), kind: 'other', startLine: Math.max(1, todo.line - 2), endLine: todo.line + 2 })}
                        >
                          {shortLabel(todo.file)} L{todo.line}
                        </button>{' '}
                        {todo.text}
                      </div>
                    ))}
                  </Section>
                )}
              </div>
            )}

            {view === 'structure' && <FileTree report={report} onOpen={openCode} />}

            {view === 'deps' && (
              <Section title={`${t('psDepEdges')} · ${report.dependencies.length}`}>
                <GraphSvg
                  nodes={buildGraphNodes(report.dependencies as Array<{ from: string; to: string; external?: boolean }>, shortLabel, 40)}
                  edges={report.dependencies as Array<{ from: string; to: string; external?: boolean }>}
                  onNode={(id) => {
                    const f = report.files.find((x) => x.file === id)
                    if (f) openCode({ file: id, name: basenameOf(id), kind: 'other', startLine: 1, endLine: Math.min(f.lines, 60) })
                  }}
                />
                <div style={styles.dim}>{t('psDepNote')}</div>
              </Section>
            )}

            {view === 'calls' && (
              <Section title={`${t('psCallEdges')} · ${report.calls.length}`}>
                <GraphSvg
                  nodes={buildGraphNodes(report.calls as Array<{ from: string; to: string; external?: boolean }>, shortLabel, 40)}
                  edges={report.calls as Array<{ from: string; to: string; external?: boolean }>}
                  onNode={(id) => {
                    const parts = id.split('#')
                    const file = parts[0] ?? ''
                    const name = parts[1] ?? ''
                    const ref = report.calls.find((c) => c.from === file && c.fromBlock === name)
                    if (ref) openCode({ file, name, kind: 'function', startLine: ref.fromLine, endLine: Math.min(ref.fromLine + 40, 100000) })
                  }}
                />
                <div style={styles.dim}>{t('psCallNote')}</div>
              </Section>
            )}

            {openRef && <CodeViewer dir={dir} ref={openRef} onClose={() => setOpenRef(null)} />}
          </div>
        )}
      </Section>
    </div>
  )
}

function DimensionCard(props: { dim: DimensionStatus; onClick: () => void; onOpen: (ref: CodeRef) => void }) {
  const d = props.dim
  return (
    <div
      style={{
        background: palette.panelAlt,
        border: `1px solid ${palette.border}`,
        borderRadius: 8,
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{DIM_LABELS[d.id]}</strong>
        <span style={{ marginLeft: 'auto' }}>
          <HealthBadge health={d.health} score={d.score} />
        </span>
      </div>
      <div style={{ fontSize: 12, color: palette.text }}>{d.status}</div>
      <div style={{ fontSize: 11, color: palette.dim, lineHeight: 1.5 }}>{d.detail}</div>
      {/* score bar */}
      <div style={{ height: 4, background: palette.border, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${d.score}%`, height: '100%', background: HEALTH_COLOR[d.health] }} />
      </div>
      {d.refs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {d.refs.slice(0, 5).map((r, i) => (
            <button
              key={i}
              style={{ ...styles.button, padding: '1px 6px', fontSize: 10 }}
              onClick={() => props.onOpen(r)}
              title={`${r.file} L${r.startLine}-L${r.endLine}`}
            >
              {basenameOf(r.file)}:{r.startLine}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
