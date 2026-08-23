/**
 * 对话输入框(composer)内部的「提示词」入口 — 注册于 conversation.input.left。
 * 点击 📝 图标弹出选择框:
 * - 「最近使用过的 3 个提示词」, 点击一键切换为生效提示词;
 * - 有生效提示词时提供「取消生效」;
 * - 数据经 /workbench/api RPC 从宿主读取(打开与操作后刷新)。
 */
import React from 'react'
import { call } from './api.js'
import type { StateSnapshot } from '../shared/types.js'

export function PromptQuickBar(): React.ReactElement | null {
  const [snapshot, setSnapshot] = React.useState<StateSnapshot | null>(null)
  const [open, setOpen] = React.useState(false)
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
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const prompts = snapshot?.value.prompts ?? []
  const activeId = snapshot?.value.activePromptId ?? ''
  const recent = prompts
    .filter((p) => (p.lastUsedAt ?? 0) > 0)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, 3)
  const activePrompt = activeId ? (prompts.find((p) => p.id === activeId) ?? null) : null

  async function pick(id: string) {
    setBusy(true)
    try {
      await call('prompt.activate', { id })
      await load()
      setOpen(false)
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
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        title={activeId ? '提示词: 切换最近使用 / 取消生效' : '提示词: 从最近使用中选择并生效'}
        style={{ ...iconBtn, background: activeId ? '#3a5c9e' : 'transparent', borderColor: activeId ? '#3a5c9e' : '#2a3140' }}
      >
        📝{activeId ? '●' : ''}
      </button>
      {open && (
        <div style={popover}>
          <div style={popTitle}>🕘 提示词 · 最近使用</div>
          {activePrompt && (
            <div style={{ border: '1px solid #2f5d50', background: '#14211d', borderRadius: 6, padding: 8, marginBottom: 6 }}>
              <div style={{ color: '#3fb96f', fontWeight: 600, fontSize: 12, marginBottom: 4 }}>
                ● 当前生效: {activePrompt.name}
              </div>
              <pre style={{ margin: 0, color: '#9fb8ae', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 160, overflowY: 'auto' }}>
                {injectedPreview(activePrompt)}
              </pre>
              <div style={{ color: '#8b94a7', fontSize: 10, marginTop: 4 }}>
                以上为模型每个步骤实际收到的注入内容(轨迹视图不显示系统提示词, 属 DSH 平台行为)。
              </div>
            </div>
          )}
          {recent.length === 0 && (
            <div style={{ color: '#8b94a7', padding: '6px 10px', fontSize: 12 }}>
              还没有使用过的提示词, 去工作台「📝 Prompt」面板选用模板。
            </div>
          )}
          {recent.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => void pick(p.id)}
              style={{ ...popItem, background: p.id === activeId ? '#233252' : 'transparent' }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {p.id === activeId && <span style={{ color: '#3fb96f' }}>● 生效中</span>}
            </button>
          ))}
          {activeId ? (
            <button disabled={busy} onClick={() => void clear()} style={{ ...popItem, color: '#e2544d' }}>
              取消生效
            </button>
          ) : null}
        </div>
      )}
    </div>
  )
}

/** Mirror of the host injection (safePromptText): {{var}} → {var}. */
function injectedPreview(p: { name: string; content: string }): string {
  const safe = p.content.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, '{$1}')
  return `【生效提示词: ${p.name}】(以下为当前必须严格遵守的指令, 请完整按其要求执行, 不要省略其中的格式与步骤要求)\n${safe}`
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
  width: 260,
  zIndex: 1000,
  background: '#171b22',
  border: '1px solid #2a3140',
  borderRadius: 8,
  boxShadow: '0 6px 24px rgba(0,0,0,.5)',
  padding: 6,
}

const popTitle: React.CSSProperties = {
  fontSize: 11,
  color: '#8b94a7',
  padding: '4px 8px',
}

const popItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  width: '100%',
  textAlign: 'left',
  border: 'none',
  background: 'transparent',
  color: '#dbe2ee',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
