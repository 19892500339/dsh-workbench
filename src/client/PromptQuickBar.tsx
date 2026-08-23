/**
 * 输入框下方(conversation.composer.dock)的提示词快捷条:
 * 显示「最近使用过的 3 个提示词」, 点击一键切换为生效提示词;
 * 点击「取消」清除当前生效提示词。
 * 数据经 /workbench/api RPC 从宿主读取(挂载与操作后刷新)。
 */
import React from 'react'
import { call } from './api.js'
import type { StateSnapshot } from '../shared/types.js'

export function PromptQuickBar(): React.ReactElement | null {
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

  const prompts = snapshot?.value.prompts ?? []
  const activeId = snapshot?.value.activePromptId ?? ''
  const recent = prompts
    .filter((p) => (p.lastUsedAt ?? 0) > 0)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, 3)

  if (recent.length === 0 && !activeId) return null

  async function pick(id: string) {
    setBusy(true)
    try {
      await call('prompt.activate', { id })
      await load()
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  async function clear() {
    setBusy(true)
    try {
      await call('prompt.deactivate', {})
      await load()
    } catch {
      // ignore
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '2px 0' }}>
      <span style={{ fontSize: 11, color: '#8b94a7' }}>🕘 提示词:</span>
      {recent.map((p) => (
        <button
          key={p.id}
          disabled={busy}
          onClick={() => void pick(p.id)}
          title={p.content.slice(0, 120)}
          style={{ ...pill, background: p.id === activeId ? '#4d7cfe' : '#171b22', color: p.id === activeId ? '#fff' : '#dbe2ee' }}
        >
          {p.name}
          {p.id === activeId ? ' ●' : ''}
        </button>
      ))}
      {activeId ? (
        <button disabled={busy} onClick={() => void clear()} style={{ ...pill, background: '#171b22', color: '#e2544d' }}>
          取消
        </button>
      ) : null}
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
