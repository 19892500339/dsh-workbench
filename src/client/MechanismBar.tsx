/**
 * 对话输入框(composer)内部的「机制选项」— 注册于 conversation.input.left。
 * 四个纯图标按钮: 📚 RAG · 🛠️ 工具 · 🧩 技能 · 🔄 工作流。
 * 点击图标弹出该机制的选择面板:
 * - 每项两个单选卡片: 「DSH 默认机制」/「工作台内容」;
 * - 工作流面板额外显示当前激活的工作流;
 * - 面板内可单独「还原该机制」; 激活的图标高亮。
 * 数据经 /workbench/api RPC 从宿主读取。
 */
import React from 'react'
import { call } from './api.js'
import type { MechanismOverrides, OverrideMode, RagOverrideMode, StateSnapshot } from '../shared/types.js'

type Domain = keyof MechanismOverrides

const DOMAINS: Array<{ key: Domain; label: string; icon: string }> = [
  { key: 'rag', label: 'RAG · 知识检索', icon: '📚' },
  { key: 'tools', label: '工具 · 可见性', icon: '🛠️' },
  { key: 'skills', label: '技能 · 清单', icon: '🧩' },
  { key: 'workflow', label: '工作流 · 执行', icon: '🔄' },
]

const OPTIONS: Record<Domain, Array<{ mode: string; title: string; desc: string }>> = {
  rag: [
    { mode: 'default', title: 'DSH 默认检索机制', desc: '不注入任何内容, 保持 DSH 原有行为' },
    { mode: 'custom', title: '自定义检索', desc: '注入自定义检索参数(topK / 相似度阈值, 可在工作台 RAG 面板调整)' },
    { mode: 'workbench', title: '工作台知识库', desc: '选择下方知识库后, 模型按该知识库检索 (workbench_search + kb_id)' },
  ],
  tools: [
    { mode: 'default', title: '全部工具可见', desc: 'DSH 工具注册表全量对模型开放' },
    { mode: 'workbench', title: '按工作台配置过滤', desc: '对模型隐藏的工具不可调用 (restrict 生效)' },
  ],
  skills: [
    { mode: 'default', title: 'DSH 原生技能目录', desc: '技能由 DSH 注册表/预设决定' },
    { mode: 'workbench', title: '注入工作台技能清单', desc: '模型按工作台技能清单使用技能' },
  ],
  workflow: [
    { mode: 'default', title: 'DSH 原生工作流机制', desc: '不注入工作流步骤' },
    { mode: 'workbench', title: '按激活工作流执行', desc: '注入激活工作流的名称与步骤, 模型严格按步骤执行' },
  ],
}

export function MechanismBar(): React.ReactElement | null {
  const [snapshot, setSnapshot] = React.useState<StateSnapshot | null>(null)
  const [openDomain, setOpenDomain] = React.useState<Domain | null>(null)
  const [busy, setBusy] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement | null>(null)

  const load = React.useCallback(async () => {
    try {
      setSnapshot(await call<StateSnapshot>('state.get', {}))
    } catch {
      // host not reachable: stay quiet
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  // Click outside closes the picker.
  React.useEffect(() => {
    if (!openDomain) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpenDomain(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openDomain])

  const overrides = snapshot?.value.overrides
  if (!overrides) return null

  const activeWorkflow =
    snapshot?.value.workflows.find((w) => w.id === snapshot.value.activeWorkflowId) ?? snapshot?.value.workflows[0]

  async function choose(domain: Domain, mode: OverrideMode | RagOverrideMode) {
    setBusy(true)
    try {
      await call('override.set', { domain, mode })
      await load()
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  /** Pick the RAG target knowledge base and ensure the rag switch is on. */
  async function pickRagTarget(kbId: string) {
    const snap = snapshot
    if (!snap) return
    setBusy(true)
    try {
      await call('state.update', {
        patch: { rag: { ...snap.value.rag, ragTargetKbId: kbId } },
        expectedRevision: snap.revision,
      })
      await call('override.set', { domain: 'rag', mode: 'workbench' })
      await load()
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  async function resetDomain(domain: Domain) {
    setBusy(true)
    try {
      await call('override.set', { domain, mode: 'default' })
      await load()
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, padding: '0 2px' }}>
      {DOMAINS.map((d) => {
        const active = overrides[d.key] === 'workbench'
        return (
          <button
            key={d.key}
            disabled={busy}
            onClick={() => setOpenDomain(openDomain === d.key ? null : d.key)}
            title={`${d.icon} ${d.label}${active ? ' (工作台配置, 点击选择/还原)' : ' (DSH 默认, 点击选择)'}`}
            style={{ ...iconBtn, background: active ? '#4d7cfe' : 'transparent', borderColor: active ? '#4d7cfe' : '#2a3140' }}
          >
            {d.icon}
          </button>
        )
      })}

      {openDomain && (
        <div style={popover}>
          <div style={popTitle}>
            {DOMAINS.find((d) => d.key === openDomain)?.icon} {DOMAINS.find((d) => d.key === openDomain)?.label}
            {openDomain === 'workflow' && activeWorkflow ? (
              <span style={{ color: '#8b94a7', fontWeight: 400 }}> · 当前激活: {activeWorkflow.name}</span>
            ) : null}
          </div>
          {OPTIONS[openDomain].map((opt) => {
            const selected = overrides[openDomain] === opt.mode
            return (
              <button
                key={opt.mode}
                disabled={busy}
                onClick={() => void choose(openDomain, opt.mode as OverrideMode & RagOverrideMode)}
                style={{
                  ...popItem,
                  background: selected ? '#233252' : 'transparent',
                  border: `1px solid ${selected ? '#4d7cfe' : 'transparent'}`,
                }}
              >
                <span style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{selected ? '● ' : '○ '}{opt.title}</div>
                  <div style={{ color: '#8b94a7', fontSize: 11, marginTop: 2 }}>{opt.desc}</div>
                </span>
              </button>
            )
          })}
          {openDomain === 'rag' && overrides.rag === 'workbench' && (
            <div style={{ borderTop: `1px solid #2a3140`, marginTop: 6, paddingTop: 6 }}>
              <div style={{ fontSize: 11, color: '#8b94a7', padding: '2px 8px' }}>检索目标知识库:</div>
              <button
                disabled={busy}
                onClick={() => void pickRagTarget('')}
                style={{ ...popItem, color: snapshot!.value.rag.ragTargetKbId === '' ? '#4d7cfe' : '#dbe2ee' }}
              >
                {snapshot!.value.rag.ragTargetKbId === '' ? '● ' : '○ '}默认语料目录
              </button>
              {(snapshot?.value.rag.knowledgeBases ?? []).map((kb) => {
                const sel = snapshot!.value.rag.ragTargetKbId === kb.id
                return (
                  <button key={kb.id} disabled={busy} onClick={() => void pickRagTarget(kb.id)} style={{ ...popItem, color: sel ? '#4d7cfe' : '#dbe2ee' }}>
                    {sel ? '● ' : '○ '}{kb.name}
                    <span style={{ color: '#8b94a7', marginLeft: 6 }}>{kb.path}</span>
                  </button>
                )
              })}
            </div>
          )}
          {overrides[openDomain] !== 'default' && (
            <button disabled={busy} onClick={() => void resetDomain(openDomain)} style={{ ...popItem, color: '#e2544d' }}>
              还原该机制为 DSH 默认
            </button>
          )}
        </div>
      )}
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  border: '1px solid #2a3140',
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const popover: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  width: 300,
  zIndex: 1000,
  background: '#171b22',
  border: '1px solid #2a3140',
  borderRadius: 8,
  boxShadow: '0 6px 24px rgba(0,0,0,.5)',
  padding: 6,
}

const popTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#dbe2ee',
  padding: '4px 8px',
  display: 'flex',
  gap: 6,
}

const popItem: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: '#dbe2ee',
  marginBottom: 2,
}
