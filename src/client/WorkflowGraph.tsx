/**
 * 工作流拖拽画布 (V2, @xyflow/react):
 * - 每个节点卡片按顺序垂直排列, 相邻节点自动生成链式边;
 * - 拖拽节点改变垂直位置 → 松手后按 y 坐标重新排序, 写回 WorkflowDefinition.nodes;
 * - 点击节点选中(高亮), 卡片上可直接删除;
 * - 参数/文本编辑仍走工作台的表单(列表视图), 画布负责「可视化排序 + 连线」。
 *
 * 样式为本仓库原创的最小样式集(通过 <style> 注入, 随组件卸载清理);
 * 不使用 ReactFlow 发行包中的样式文件, 避免复制第三方 CSS。
 */
import React from 'react'
import {
  ReactFlow,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import { palette } from './ui.js'
import type { WorkflowNode } from '../shared/types.js'

export interface WorkflowGraphProps {
  nodes: WorkflowNode[]
  selectedId: string | null
  onSelect(id: string | null): void
  onChange(nodes: WorkflowNode[]): void
}

const NODE_GAP = 150

const KIND_COLOR: Record<WorkflowNode['kind'], string> = {
  prompt: '#4d7cfe',
  transform: '#b078e8',
  tool: '#e2b93b',
  output: '#3fb96f',
}

function WorkbenchGraphNode(props: NodeProps) {
  const data = props.data as {
    label: string
    kind: WorkflowNode['kind']
    params: Record<string, string>
    selected: boolean
    onDelete(): void
    onSelect(): void
  }
  return (
    <div
      onClick={data.onSelect}
      style={{
        background: palette.panel,
        border: `1.5px solid ${data.selected ? palette.accent : palette.border}`,
        borderRadius: 8,
        padding: '8px 12px',
        minWidth: 180,
        cursor: 'grab',
        boxShadow: '0 2px 8px rgba(0,0,0,.35)',
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: palette.border }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            background: KIND_COLOR[data.kind] ?? palette.border,
            color: '#fff',
            borderRadius: 4,
            padding: '2px 6px',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {data.kind}
        </span>
        <strong style={{ fontSize: 13, color: palette.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.label}
        </strong>
        <button
          onClick={(e) => { e.stopPropagation(); data.onDelete() }}
          style={{ border: 'none', background: 'transparent', color: palette.danger, cursor: 'pointer', fontSize: 13 }}
          title="删除节点"
        >
          ✕
        </button>
      </div>
      <div style={{ fontSize: 11, color: palette.dim, marginTop: 4, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {paramsSummary(data.params)}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: palette.border }} />
    </div>
  )
}

const nodeTypes = { workbenchNode: WorkbenchGraphNode }

export function WorkflowGraph(props: WorkflowGraphProps) {
  const { nodes, selectedId, onSelect, onChange } = props
  const [positions, setPositions] = React.useState<Record<string, { x: number; y: number }>>({})

  // Reset positions when the node id set changes (add/remove).
  const idKey = nodes.map((n) => n.id).join(',')
  React.useEffect(() => {
    const next: Record<string, { x: number; y: number }> = {}
    nodes.forEach((n, i) => { next[n.id] = { x: 0, y: i * NODE_GAP } })
    setPositions(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey])

  const graphNodes: Node[] = React.useMemo(
    () =>
      nodes.map((n, i) => ({
        id: n.id,
        type: 'workbenchNode',
        position: positions[n.id] ?? { x: 0, y: i * NODE_GAP },
        data: {
          label: n.label,
          kind: n.kind,
          params: n.params,
          selected: n.id === selectedId,
          onDelete: () => onChange(nodes.filter((x) => x.id !== n.id)),
          onSelect: () => onSelect(n.id === selectedId ? null : n.id),
        },
      })),
    // positions intentionally excluded: drag positions are mirrored into the map live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, selectedId, onChange, onSelect],
  )

  const edges: Edge[] = React.useMemo(
    () =>
      nodes.slice(0, -1).map((n, i) => {
        const next = nodes[i + 1]!
        return {
          id: `e-${n.id}-${next.id}`,
          source: n.id,
          target: next.id,
          markerEnd: { type: 'arrowclosed', color: palette.border },
          style: { stroke: palette.border, strokeWidth: 1.5 },
        }
      }),
    [nodes],
  )

  // Refs mirror live positions/nodes so drag handlers never read stale state.
  const nodesRef = React.useRef(nodes)
  nodesRef.current = nodes
  const positionsRef = React.useRef(positions)
  positionsRef.current = positions

  /** Sort nodes by their current vertical position (stable fallback to index). */
  const sortByY = React.useCallback((list: WorkflowNode[], pos: Record<string, { x: number; y: number }>) => {
    const fallback = new Map(list.map((n, i) => [n.id, i]))
    return [...list].sort((a, b) => {
      const ya = pos[a.id]?.y ?? (fallback.get(a.id) ?? 0) * NODE_GAP
      const yb = pos[b.id]?.y ?? (fallback.get(b.id) ?? 0) * NODE_GAP
      if (ya !== yb) return ya - yb
      return (fallback.get(a.id) ?? 0) - (fallback.get(b.id) ?? 0)
    })
  }, [])

  const orderChanged = React.useCallback(
    (a: WorkflowNode[], b: WorkflowNode[]) => a.some((n, i) => n.id !== b[i]?.id),
    [],
  )

  const onNodesChange = React.useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const position = change.position
          const next = { ...positionsRef.current, [change.id]: { x: position.x, y: position.y } }
          positionsRef.current = next
          setPositions(next)
          // LIVE reorder while dragging: as the node crosses a neighbour, the
          // chain edges re-order immediately (no waiting for mouse-up).
          if (change.dragging) {
            const sorted = sortByY(nodesRef.current, next)
            if (orderChanged(nodesRef.current, sorted)) onChange(sorted)
          }
        }
      }
    },
    [onChange, sortByY, orderChanged],
  )

  const onNodeDragStop = React.useCallback(() => {
    const sorted = sortByY(nodesRef.current, positionsRef.current)
    if (orderChanged(nodesRef.current, sorted)) onChange(sorted)
    // Settle into a clean vertical stack without visual jumps in order.
    const next: Record<string, { x: number; y: number }> = {}
    sorted.forEach((n, i) => { next[n.id] = { x: 0, y: i * NODE_GAP } })
    positionsRef.current = next
    setPositions(next)
  }, [onChange, sortByY, orderChanged])

  return (
    <div style={{ width: '100%', height: 420, border: `1px solid ${palette.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <style>{graphCss}</style>
      <ReactFlow
        nodes={graphNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_, node) => onSelect(node.id === selectedId ? null : node.id)}
        nodesConnectable={false}
        fitView
        minZoom={0.4}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
      />
    </div>
  )
}

function paramsSummary(p: Record<string, string>): string {
  const entries = Object.entries(p)
  return entries.length === 0 ? '(无参数)' : entries.map(([k, v]) => `${k}=${v.slice(0, 30)}`).join(' · ')
}

/** Minimal original stylesheet for the canvas (not copied from the library). */
const graphCss = `
  .react-flow { width: 100%; height: 100%; background: #0b0e13; }
  .react-flow__edge-path { stroke: #2a3140; stroke-width: 1.5; }
  .react-flow__handle { width: 8px; height: 8px; }
  .react-flow__attribution { display: none; }
`
