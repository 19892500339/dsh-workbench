/**
 * 对话输入区上方 (conversation.input.dock) 的「机制选项」条:
 * RAG / 工具 / 技能 / 工作流 四个开关。
 *
 * - ○ = DSH 原有机制(默认状态), 不注入任何内容;
 * - ● = 已切换为工作台内容: 宿主向模型注入对应机制的说明
 *   (检索知识库指引 / 工具可见性 / 技能清单 / 激活工作流步骤),
 *   模型每一步都能读到当前机制状态;
 * - 「一键还原默认」把全部机制恢复为 DSH 默认并清空隐藏配置。
 */
import React from 'react'
import { call } from './api.js'
import type { MechanismOverrides, OverrideMode, StateSnapshot } from '../shared/types.js'

const DOMAINS: Array<{ key: keyof MechanismOverrides; label: string; icon: string; hint: string }> = [
  { key: 'rag', label: 'RAG', icon: '📚', hint: '知识检索: 默认=DSH 原有, 工作台=workbench_search+知识库' },
  { key: 'tools', label: '工具', icon: '🛠️', hint: '工具可见性: 默认=全部工具, 工作台=按隐藏配置过滤' },
  { key: 'skills', label: '技能', icon: '🧩', hint: '技能清单: 默认=DSH 原生, 工作台=注入工作台清单' },
  { key: 'workflow', label: '工作流', icon: '🔄', hint: '流程执行: 默认=DSH 原生, 工作台=按激活工作流执行' },
]

export function MechanismBar(): React.ReactElement | null {
  const [snapshot, setSnapshot] = React.useState<StateSnapshot | null>(null)
  const [busy, setBusy] = React.useState(false)

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

  const overrides = snapshot?.value.overrides
  if (!overrides) return null

  const anyWorkbench = (Object.values(overrides) as OverrideMode[]).some((m) => m === 'workbench')

  async function flip(domain: keyof MechanismOverrides) {
    const ov = snapshot?.value.overrides
    if (!ov) return
    const current: OverrideMode = ov[domain] ?? 'default'
    const next: OverrideMode = current === 'default' ? 'workbench' : 'default'
    setBusy(true)
    try {
      await call('override.set', { domain, mode: next })
      await load()
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  async function resetAll() {
    setBusy(true)
    try {
      await call('override.resetAll', {})
      await load()
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '2px 0' }}>
      <span style={{ fontSize: 11, color: '#8b94a7' }}>⚙️ 机制:</span>
      {DOMAINS.map((d) => {
        const active = overrides[d.key] === 'workbench'
        return (
          <button
            key={d.key}
            disabled={busy}
            onClick={() => void flip(d.key)}
            title={`${d.hint}。${active ? '当前=工作台配置, 点击还原为 DSH 默认' : '当前=DSH 默认机制, 点击切换为工作台配置'}`}
            style={{ ...pill, background: active ? '#4d7cfe' : '#171b22', color: active ? '#fff' : '#dbe2ee' }}
          >
            {d.icon} {d.label} {active ? ' ●' : ' ○'}
          </button>
        )
      })}
      {anyWorkbench && (
        <button
          onClick={() => void resetAll()}
          title="全部机制恢复为 DSH 默认状态, 并清空工具/技能隐藏配置"
          style={{ ...pill, background: '#171b22', color: '#e2544d' }}
        >
          一键还原默认
        </button>
      )}
    </div>
  )
}

const pill: React.CSSProperties = {
  border: '1px solid #2a3140',
  borderRadius: 999,
  padding: '2px 10px',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
