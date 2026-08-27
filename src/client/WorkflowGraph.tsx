/**
 * 工作流拖拽画布 (V2.2 → V4.1):
 *
 * - 引擎: LogicFlow(didi 出品, 11k+ star)提供拖拽、缩放、事件与数据模型;
 * - 节点: 自定义 RectNode 视图, 颜色/描边等全部通过模型属性内联渲染
 *   (不引入官方 CSS, 避免复制第三方样式, 仓库零版权风险);
 * - 交互: 左侧节点面板点击添加节点; 画布内拖拽节点 — 引擎实时跟随,
 *   拖动中按 y 坐标实时重链执行顺序边, 松手后把新顺序写回工作流;
 * - 选中节点高亮, 面板按钮删除选中节点;
 * - V4.1: 全屏作用于整个布局(左面板保留), 选中节点出现内联编辑面板
 *   (label + kind 参数; tool/skill 从传入的工具/技能列表下拉选择)。
 */
import React from 'react'
import LogicFlowDefault, { RectNode, RectNodeModel, h } from '@logicflow/core'
import type { ToolView, SkillView, WorkflowNode } from '../shared/types.js'
import { t, useLocale } from './i18n.js'
import { palette } from './ui.js'
import { resolveCanvasTheme, useThemeVersion } from './theme.js'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Interop guard: in a CJS client bundle rolldown's node-mode interop can bind
 * the default import to the whole module.exports object instead of the class.
 * Prefer the named class when the default is itself the constructor.
 */
const LogicFlowCtor = ((LogicFlowDefault as unknown as { default?: unknown })?.default ??
  LogicFlowDefault) as unknown as new (options: Record<string, unknown>) => InstanceType<typeof LogicFlowDefault>

export interface WorkflowGraphProps {
  nodes: WorkflowNode[]
  selectedId: string | null
  onSelect(id: string | null): void
  onChange(nodes: WorkflowNode[]): void
  /** Add a node of the given kind to the end of the chain. */
  onAddNode(kind: WorkflowNode['kind']): void
  /** V4.1: partially update one node (label/params) from the inline editor. */
  onUpdateNode(id: string, patch: Partial<WorkflowNode>): void
  /** V4.1: live tool/skill catalogs for the node editor dropdowns. */
  tools?: ToolView[]
  skills?: SkillView[]
}

const NODE_GAP = 90

/** Live canvas palette, refreshed before each LogicFlow render (see below). */
let canvasTheme = resolveCanvasTheme()

/** Apply the edge color to a LogicFlow instance from the resolved theme. */
function applyEdgeTheme(lf: InstanceType<typeof LogicFlowDefault>): void {
  lf.setTheme({
    line: { stroke: canvasTheme.border, strokeWidth: 2 },
    polyline: { stroke: canvasTheme.border, strokeWidth: 2 },
    bezier: { stroke: canvasTheme.border, strokeWidth: 2 },
  })
}

const KIND_COLOR: Record<WorkflowNode['kind'], string> = {
  prompt: '#3f6fe0',
  transform: '#8a5fd8',
  tool: '#c8912f',
  skill: '#2f9e9e',
  output: '#2f9457',
}

const NODE_KINDS: Array<{ kind: WorkflowNode['kind']; label: string }> = [
  { kind: 'prompt', label: '+ 提示词' },
  { kind: 'transform', label: '+ 文本变换' },
  { kind: 'tool', label: '+ 工具' },
  { kind: 'skill', label: '+ 技能' },
  { kind: 'output', label: '+ 输出' },
]

/** Custom node model: size + inline fill/stroke colors driven by kind. */
class WbNodeModel extends RectNodeModel {
  override initNodeData(data: any): void {
    super.initNodeData(data)
    this.width = 210
    this.height = 56
  }
  override setAttributes(): void {
    const kind = (this.properties as { kind?: string }).kind
    const color = (kind && KIND_COLOR[kind as WorkflowNode['kind']]) || KIND_COLOR.prompt
    const selected = Boolean((this.properties as { selected?: boolean }).selected)
    this.fill = selected ? canvasTheme.selected : canvasTheme.panel
    this.stroke = selected ? canvasTheme.accent : color
    this.strokeWidth = 2
    this.radius = 8
    // 故意不设置 this.text: LogicFlow 基类会额外渲染一层 text,
    // 与自定义视图里的文字重复并重叠。文字完全由 getShape 从 properties 绘制。
  }
}

/** Custom node view: rect + text, everything inline (no CSS dependency). */
class WbNodeView extends RectNode {
  override getShape(): ReturnType<typeof h> {
    const model = this.props.model as any
    const { x, y, width, height, radius, fill, stroke, strokeWidth } = model
    const properties = (model.properties ?? {}) as {
      label?: string
      kind?: string
      params?: Record<string, string>
    }
    const label = String(properties.label ?? '')
    const kind = String(properties.kind ?? '')
    const params = properties.params ?? {}
    const summary = Object.entries(params)
      .map(([k, v]) => `${k}=${v.slice(0, 24)}`)
      .join(' · ')
    const line1 = `${label}${kind ? ` · ${kind}` : ''}`.trim()
    const line2 = summary
    return h('g', {}, [
      h('rect', {
        x: x - width / 2,
        y: y - height / 2,
        width,
        height,
        rx: radius,
        fill,
        stroke,
        strokeWidth,
        cursor: 'grab',
      }),
      h('text', {
        x,
        y: y - 7,
        fill: canvasTheme.text,
        'font-size': 12,
        'font-weight': 600,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      }, line1.slice(0, 30)),
      line2
        ? h('text', {
            x,
            y: y + 15,
            fill: canvasTheme.dim,
            'font-size': 10,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
          }, line2.slice(0, 44))
        : null,
    ]) as ReturnType<typeof h>
  }
}

/** Minimal inline edit form for the selected node. */
function NodeEditor(props: {
  node: WorkflowNode
  tools: ToolView[]
  skills: SkillView[]
  onUpdate(id: string, patch: Partial<WorkflowNode>): void
  onClose(): void
}) {
  useLocale()
  const { node, tools, skills, onUpdate, onClose } = props
  const patch = (p: Partial<WorkflowNode>) => onUpdate(node.id, p)
  const params = (next: Record<string, string>) => patch({ params: next })

  const inputStyle: React.CSSProperties = {
    background: palette.panelAlt, border: `1px solid ${palette.border}`, color: palette.text,
    borderRadius: 6, padding: '5px 8px', fontSize: 12, fontFamily: 'inherit',
    width: '100%', boxSizing: 'border-box', marginBottom: 6, outline: 'none',
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: palette.dim, display: 'block', marginBottom: 3 }

  return (
    <div style={{
      border: `1px solid ${palette.border}`, borderRadius: 8, background: palette.panel,
      padding: 10, marginTop: 10, minWidth: 240,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: palette.text }}>{t('wfEditNode')}</span>
        <span style={{ fontSize: 11, color: KIND_COLOR[node.kind] }}>{node.kind}</span>
        <span style={{ marginLeft: 'auto' }}>
          <button onClick={onClose} style={{ ...panelButtonStyle, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconCloseOutline16 size={14} />{t('close')}
          </button>
        </span>
      </div>

      <label style={labelStyle}>{t('wfParamLabel')}</label>
      <input style={inputStyle} value={node.label} onChange={(e) => patch({ label: e.target.value })} />

      {node.kind === 'prompt' && (
        <>
          <label style={labelStyle}>{t('wfParamText')}</label>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }}
            value={node.params['text'] ?? ''}
            onChange={(e) => params({ ...node.params, text: e.target.value })}
            placeholder="支持 {{var}} 占位符" />
        </>
      )}

      {node.kind === 'transform' && (
        <>
          <label style={labelStyle}>{t('wfParamOp')}</label>
          <select style={inputStyle} value={node.params['op'] ?? 'append'}
            onChange={(e) => params({ ...node.params, op: e.target.value })}>
            <option value="append">{t('wfParamOpAppend')}</option>
            <option value="prepend">{t('wfParamOpPrepend')}</option>
            <option value="replace">{t('wfParamOpReplace')}</option>
          </select>
          {(node.params['op'] ?? 'append') === 'replace' && (
            <>
              <label style={labelStyle}>{t('wfParamSearch')}</label>
              <input style={inputStyle} value={node.params['search'] ?? ''}
                onChange={(e) => params({ ...node.params, search: e.target.value })} />
            </>
          )}
          <label style={labelStyle}>{t('wfParamValue')}</label>
          <textarea style={{ ...inputStyle, minHeight: 48, resize: 'vertical' }} value={node.params['value'] ?? ''}
            onChange={(e) => params({ ...node.params, value: e.target.value })} />
        </>
      )}

      {node.kind === 'tool' && (
        <>
          <label style={labelStyle}>{t('wfParamToolName')}</label>
          <select style={inputStyle} value={node.params['name'] ?? ''}
            onChange={(e) => params({ ...node.params, name: e.target.value })}>
            <option value="">{t('wfSelectTool')}</option>
            {tools.map((tool) => (
              <option key={tool.name} value={tool.name}>{tool.name}</option>
            ))}
          </select>
          <label style={labelStyle}>{t('wfParamToolArgs')}</label>
          <textarea style={{ ...inputStyle, minHeight: 48, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }}
            value={node.params['args'] ?? ''}
            onChange={(e) => params({ ...node.params, args: e.target.value })}
            placeholder={t('wfArgsJson')} />
        </>
      )}

      {node.kind === 'skill' && (
        <>
          <label style={labelStyle}>{t('wfParamSkillName')}</label>
          <select style={inputStyle} value={node.params['name'] ?? ''}
            onChange={(e) => params({ ...node.params, name: e.target.value })}>
            <option value="">{t('wfSelectSkill')}</option>
            {skills.map((skill) => (
              <option key={skill.name} value={skill.name}>{skill.name}</option>
            ))}
          </select>
        </>
      )}

      {node.kind === 'output' && (
        <>
          <label style={labelStyle}>{t('wfParamFormat')}</label>
          <input style={inputStyle} value={node.params['format'] ?? 'text'}
            onChange={(e) => params({ ...node.params, format: e.target.value })} placeholder="markdown / text" />
        </>
      )}
    </div>
  )
}

export function WorkflowGraph(props: WorkflowGraphProps) {
  useLocale()
  const themeVersion = useThemeVersion()
  const { nodes, selectedId, onSelect, onChange, onAddNode, onUpdateNode, tools = [], skills = [] } = props
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const lfRef = React.useRef<InstanceType<typeof LogicFlowDefault> | null>(null)
  const draggingRef = React.useRef(false)
  const selectedIdRef = React.useRef(selectedId)
  selectedIdRef.current = selectedId

  // Live mirrors so event handlers never read stale closures.
  const nodesRef = React.useRef(nodes)
  nodesRef.current = nodes
  const positionsRef = React.useRef<Record<string, number>>({})
  const handlersRef = React.useRef({ onSelect, onChange })
  handlersRef.current = { onSelect, onChange }

  // --- fullscreen mode -------------------------------------------------------
  const [fullscreen, setFullscreen] = React.useState(false)

  const syncSize = React.useCallback(() => {
    const container = containerRef.current
    const lf = lfRef.current
    if (!container || !lf) return
    lf.resize(container.clientWidth || 640, container.clientHeight || 380)
    lf.fitView()
  }, [])

  React.useEffect(() => {
    // Wait a frame for the layout change, then fit the graph to the new size.
    const timer = setTimeout(syncSize, 80)
    return () => clearTimeout(timer)
  }, [fullscreen, syncSize])

  React.useEffect(() => {
    if (!fullscreen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  // --- one-time engine setup -------------------------------------------------
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    canvasTheme = resolveCanvasTheme()

    const lf = new LogicFlowCtor({
      container,
      width: container.clientWidth || 640,
      height: container.clientHeight || 380,
      grid: false,
      stopScrollGraph: true,
      keyboard: { enabled: true },
      // V4.1: disable the built-in double-click text editor — our nodes render
      // their own labels (no `text`), so the TextEditTool would pop an input
      // over the graph and hide everything. Editing happens in the side panel.
      textEdit: false,
      // The container div supplies the themed background; keep LogicFlow's own
      // background layer transparent so light/dark follows the CSS variable.
      background: { background: 'transparent' },
    })
    lf.register({ type: 'wbNode', view: WbNodeView, model: WbNodeModel })
    applyEdgeTheme(lf)
    lfRef.current = lf

    const orderByPositions = () => {
      const pos = positionsRef.current
      const fallback = new Map(nodesRef.current.map((n, i) => [n.id, i]))
      return [...nodesRef.current].sort((a, b) => {
        const ya = pos[a.id] ?? (fallback.get(a.id) ?? 0) * NODE_GAP
        const yb = pos[b.id] ?? (fallback.get(b.id) ?? 0) * NODE_GAP
        return ya - yb
      })
    }

    const applyChainEdges = (order: WorkflowNode[]) => {
      if (!lfRef.current) return
      lfRef.current.getEdgeData().forEach((edge: { id: string }) => lfRef.current!.deleteEdge(edge.id))
      for (let i = 0; i < order.length - 1; i += 1) {
        lfRef.current.addEdge({
          sourceNodeId: order[i]!.id,
          targetNodeId: order[i + 1]!.id,
          type: 'polyline',
        })
      }
    }

    lf.on('node:click', ({ data }: { data: { id: string } }) => {
      handlersRef.current.onSelect(data.id === selectedIdRef.current ? null : data.id)
    })
    // V4.1: double-click opens the inline editor — force-select the node so a
    // prior single-click toggle (which may have deselected it) cannot win.
    lf.on('node:dbclick', ({ data }: { data: { id: string } }) => {
      handlersRef.current.onSelect(data.id)
    })
    lf.on('blank:click', () => handlersRef.current.onSelect(null))
    lf.on('node:dragstart', () => { draggingRef.current = true })
    lf.on('node:drag', ({ data }: { data: { id: string; y: number } }) => {
      positionsRef.current[data.id] = data.y
      // LIVE: re-chain the order edges as the dragged node crosses neighbours.
      const order = orderByPositions()
      if (order.some((n, i) => n.id !== nodesRef.current[i]?.id)) applyChainEdges(order)
    })
    lf.on('node:dragend', ({ data }: { data: { id: string; y: number } }) => {
      positionsRef.current[data.id] = data.y
      draggingRef.current = false
      const order = orderByPositions()
      const { onChange: change } = handlersRef.current
      if (order.some((n, i) => n.id !== nodesRef.current[i]?.id)) change(order)
      else applyChainEdges(order)
    })
    lf.on('node:delete', ({ data }: { data: { id: string } }) => {
      const { onChange: change } = handlersRef.current
      change(nodesRef.current.filter((n) => n.id !== data.id))
    })
    lf.render({ nodes: [], edges: [] })

    return () => {
      lf.destroy()
      lfRef.current = null
      draggingRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- re-render when the workflow or selection changes ----------------------
  const idKey = nodes.map((n) => n.id).join(',')
  React.useEffect(() => {
    if (draggingRef.current || !lfRef.current) return
    // Refresh resolved tokens so SVG node/edge colors track the host theme.
    canvasTheme = resolveCanvasTheme()
    applyEdgeTheme(lfRef.current)
    const pos = positionsRef.current
    const graphNodes = nodes.map((n, i) => ({
      id: n.id,
      type: 'wbNode',
      x: 0,
      y: pos[n.id] ?? i * NODE_GAP,
      properties: { label: n.label, kind: n.kind, params: n.params, selected: n.id === selectedId },
    }))
    const graphEdges = nodes.slice(0, -1).map((n, i) => ({
      id: `e-${n.id}-${nodes[i + 1]!.id}`,
      sourceNodeId: n.id,
      targetNodeId: nodes[i + 1]!.id,
      type: 'polyline',
    }))
    lfRef.current.render({ nodes: graphNodes, edges: graphEdges })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, selectedId, nodes, themeVersion])

  function deleteSelected() {
    if (!selectedId) return
    if (!window.confirm(t('wfDeleteConfirm', { label: nodes.find((n) => n.id === selectedId)?.label ?? '' }))) return
    onChange(nodes.filter((n) => n.id !== selectedId))
  }

  const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null

  return (
    <div style={fullscreen ? fullscreenLayoutStyle : { display: 'flex', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 118 }}>
        {NODE_KINDS.map((k) => (
          <button
            key={k.kind}
            style={{ ...panelButtonStyle, borderLeftColor: KIND_COLOR[k.kind] }}
            onClick={() => onAddNode(k.kind)}
          >
            {k.label}
          </button>
        ))}
        <button style={{ ...panelButtonStyle, color: palette.danger }} onClick={deleteSelected} disabled={!selectedId}>
          {t('wfDeleteNode')}
        </button>
        <div style={{ fontSize: 11, color: palette.dim, marginTop: 4 }}>
          {t('wfEditHint')}
        </div>
        {selectedNode && (
          <NodeEditor
            node={selectedNode}
            tools={tools}
            skills={skills}
            onUpdate={onUpdateNode}
            onClose={() => onSelect(null)}
          />
        )}
      </div>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <div
          ref={containerRef}
          style={fullscreen ? fullscreenCanvasStyle : normalStyle}
        />
        <button
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? t('wfFullscreenExit') : t('wfFullscreenEnter')}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 10,
            background: palette.panel,
            border: `1px solid ${palette.border}`,
            color: palette.text,
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {fullscreen ? t('wfFullscreenExit') : '⛶ ' + t('wfToggleFullscreen')}
        </button>
      </div>
    </div>
  )
}

/** Inline (embedded) canvas container. */
const normalStyle: React.CSSProperties = {
  height: 380,
  border: `1px solid ${palette.border}`,
  borderRadius: 8,
  overflow: 'hidden',
  background: palette.bg,
}

/** Fullscreen canvas container filling the viewport (left panel stays). */
const fullscreenCanvasStyle: React.CSSProperties = {
  height: 'calc(100vh - 24px)',
  border: `1px solid ${palette.border}`,
  borderRadius: 8,
  overflow: 'hidden',
  background: palette.bg,
}

/** Fullscreen outer layout covering the viewport with the node panel intact. */
const fullscreenLayoutStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  background: palette.bg,
  padding: 12,
  boxSizing: 'border-box',
  display: 'flex',
  gap: 10,
}

const panelButtonStyle: React.CSSProperties = {
  background: palette.panel,
  border: `1px solid ${palette.border}`,
  borderLeftWidth: 3,
  color: palette.text,
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
