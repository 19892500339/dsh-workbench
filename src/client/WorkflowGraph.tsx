/**
 * 工作流拖拽画布 (V2.2, 现成编排引擎 @logicflow/core, Apache-2.0):
 *
 * - 引擎: LogicFlow(didi 出品, 11k+ star)提供拖拽、缩放、事件与数据模型;
 * - 节点: 自定义 RectNode 视图, 颜色/描边等全部通过模型属性内联渲染
 *   (不引入官方 CSS, 避免复制第三方样式, 仓库零版权风险);
 * - 交互: 左侧节点面板点击添加节点; 画布内拖拽节点 — 引擎实时跟随,
 *   拖动中按 y 坐标实时重链执行顺序边, 松手后把新顺序写回工作流;
 * - 选中节点高亮, 面板按钮删除选中节点。
 */
import React from 'react'
import LogicFlow, { RectNode, RectNodeModel, h } from '@logicflow/core'
import type { WorkflowNode } from '../shared/types.js'

export interface WorkflowGraphProps {
  nodes: WorkflowNode[]
  selectedId: string | null
  onSelect(id: string | null): void
  onChange(nodes: WorkflowNode[]): void
  /** Add a node of the given kind to the end of the chain. */
  onAddNode(kind: WorkflowNode['kind']): void
}

const NODE_GAP = 90

const KIND_COLOR: Record<WorkflowNode['kind'], string> = {
  prompt: '#3f6fe0',
  transform: '#8a5fd8',
  tool: '#c8912f',
  output: '#2f9457',
}

const NODE_KINDS: Array<{ kind: WorkflowNode['kind']; label: string }> = [
  { kind: 'prompt', label: '+ 提示词' },
  { kind: 'transform', label: '+ 文本变换' },
  { kind: 'tool', label: '+ 工具' },
  { kind: 'output', label: '+ 输出' },
]

/** Custom node model: size + inline fill/stroke colors driven by kind. */
class WbNodeModel extends RectNodeModel {
  override initNodeData(data: any): void {
    super.initNodeData(data)
    this.width = 210
    this.height = 52
  }
  override setAttributes(): void {
    const kind = (this.properties as { kind?: string }).kind
    const color = (kind && KIND_COLOR[kind as WorkflowNode['kind']]) || KIND_COLOR.prompt
    const selected = Boolean((this.properties as { selected?: boolean }).selected)
    this.fill = selected ? '#233252' : '#1b2230'
    this.stroke = selected ? '#4d7cfe' : color
    this.strokeWidth = 2
    this.radius = 8
    const params = (this.properties as { params?: Record<string, string> }).params ?? {}
    const summary = Object.entries(params)
      .map(([k, v]) => `${k}=${v.slice(0, 24)}`)
      .join(' · ')
    this.text = {
      x: this.x,
      y: this.y,
      value: `${(this.properties as { label?: string }).label ?? ''} · ${kind ?? ''}${summary ? `\n${summary}` : ''}`,
    }
  }
}

/** Custom node view: rect + text, everything inline (no CSS dependency). */
class WbNodeView extends RectNode {
  override getShape(): ReturnType<typeof h> {
    const model = this.props.model as any
    const { x, y, width, height, radius, fill, stroke, strokeWidth, text } = model
    const lines = String(text?.value ?? '').split('\n')
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
        y: y - 6,
        fill: '#dbe2ee',
        'font-size': 12,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
      }, lines[0] ?? ''),
      lines[1]
        ? h('text', {
            x,
            y: y + 14,
            fill: '#8b94a7',
            'font-size': 10,
            'text-anchor': 'middle',
            'dominant-baseline': 'middle',
          }, lines[1].slice(0, 44))
        : null,
    ]) as ReturnType<typeof h>
  }
}

export function WorkflowGraph(props: WorkflowGraphProps) {
  const { nodes, selectedId, onSelect, onChange, onAddNode } = props
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const lfRef = React.useRef<LogicFlow | null>(null)
  const draggingRef = React.useRef(false)
  const selectedIdRef = React.useRef(selectedId)
  selectedIdRef.current = selectedId

  // Live mirrors so event handlers never read stale closures.
  const nodesRef = React.useRef(nodes)
  nodesRef.current = nodes
  const positionsRef = React.useRef<Record<string, number>>({})
  const handlersRef = React.useRef({ onSelect, onChange })
  handlersRef.current = { onSelect, onChange }

  // --- one-time engine setup -------------------------------------------------
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const lf = new LogicFlow({
      container,
      width: 640,
      height: 380,
      grid: false,
      stopScrollGraph: true,
      keyboard: { enabled: true },
      background: { color: '#0d1117' },
    })
    lf.register({ type: 'wbNode', view: WbNodeView, model: WbNodeModel })
    lf.setTheme({
      line: { stroke: '#2a3140', strokeWidth: 2 },
      polyline: { stroke: '#2a3140', strokeWidth: 2 },
      bezier: { stroke: '#2a3140', strokeWidth: 2 },
    })
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
  }, [idKey, selectedId, nodes])

  function deleteSelected() {
    if (!selectedId) return
    onChange(nodes.filter((n) => n.id !== selectedId))
  }

  return (
    <div style={{ display: 'flex', gap: 10 }}>
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
        <button style={{ ...panelButtonStyle, color: '#e2544d' }} onClick={deleteSelected} disabled={!selectedId}>
          删除选中
        </button>
        <div style={{ fontSize: 11, color: '#8b94a7', marginTop: 4 }}>
          拖拽节点改变执行顺序; 连线按顺序自动生成; 点击节点选中。
        </div>
      </div>
      <div
        ref={containerRef}
        style={{ flex: 1, height: 380, border: '1px solid #2a3140', borderRadius: 8, overflow: 'hidden', background: '#0d1117' }}
      />
    </div>
  )
}

const panelButtonStyle: React.CSSProperties = {
  background: '#171b22',
  border: '1px solid #2a3140',
  borderLeftWidth: 3,
  color: '#dbe2ee',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  fontFamily: 'inherit',
}
