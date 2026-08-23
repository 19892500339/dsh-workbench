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
import { t, useLocale } from './i18n.js'
import type { MechanismOverrides, OverrideMode, RagOverrideMode, StateSnapshot } from '../shared/types.js'

type Domain = keyof MechanismOverrides

const DOMAINS: Array<{ key: Domain; titleKey: string; icon: string }> = [
  { key: 'rag', titleKey: 'ragTitle', icon: '📚' },
  { key: 'tools', titleKey: 'toolsTitle', icon: '🛠️' },
  { key: 'skills', titleKey: 'skillsTitle', icon: '🧩' },
  { key: 'workflow', titleKey: 'workflowTitle', icon: '🔄' },
]

const OPTIONS: Record<Domain, Array<{ mode: string; titleKey: string; descKey: string }>> = {
  rag: [
    { mode: 'default', titleKey: 'ragDefault', descKey: 'ragDefaultDesc' },
    { mode: 'custom', titleKey: 'ragCustom', descKey: 'ragCustomDesc' },
    { mode: 'workbench', titleKey: 'ragKb', descKey: 'ragKbDesc' },
  ],
  tools: [
    { mode: 'default', titleKey: 'toolsDefault', descKey: 'toolsDefaultDesc' },
    { mode: 'workbench', titleKey: 'toolsWorkbench', descKey: 'toolsWorkbenchDesc' },
  ],
  skills: [
    { mode: 'default', titleKey: 'skillsDefault', descKey: 'skillsDefaultDesc' },
    { mode: 'workbench', titleKey: 'skillsWorkbench', descKey: 'skillsWorkbenchDesc' },
  ],
  workflow: [
    { mode: 'default', titleKey: 'wfDefault', descKey: 'wfDefaultDesc' },
    { mode: 'workbench', titleKey: 'wfWorkbench', descKey: 'wfWorkbenchDesc' },
  ],
}

export function MechanismBar(): React.ReactElement | null {
  useLocale()
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
        const active = overrides[d.key] !== 'default'
        return (
          <button
            key={d.key}
            disabled={busy}
            onClick={() => setOpenDomain(openDomain === d.key ? null : d.key)}
            title={`${d.icon} ${t(d.titleKey)}${active ? t('mechActive') : t('mechDefault')}`}
            style={{ ...iconBtn, background: active ? '#4d7cfe' : 'transparent', borderColor: active ? '#4d7cfe' : '#2a3140' }}
          >
            {d.icon}
          </button>
        )
      })}

      {openDomain && (
        <div style={popover}>
          <div style={popTitle}>
            {DOMAINS.find((d) => d.key === openDomain)?.icon} {t(DOMAINS.find((d) => d.key === openDomain)!.titleKey)}
            {openDomain === 'workflow' && activeWorkflow ? (
              <span style={{ color: '#8b94a7', fontWeight: 400 }}> · {t('wfActive')} {activeWorkflow.name}</span>
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
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{selected ? '● ' : '○ '}{t(opt.titleKey)}</div>
                  <div style={{ color: '#8b94a7', fontSize: 11, marginTop: 2 }}>{t(opt.descKey)}</div>
                </span>
              </button>
            )
          })}
          {openDomain === 'rag' && overrides.rag === 'workbench' && (
            <div style={{ borderTop: `1px solid #2a3140`, marginTop: 6, paddingTop: 6 }}>
              <div style={{ fontSize: 11, color: '#8b94a7', padding: '2px 8px' }}>{t('ragTarget')}</div>
              <button
                disabled={busy}
                onClick={() => void pickRagTarget('')}
                style={{ ...popItem, color: snapshot!.value.rag.ragTargetKbId === '' ? '#4d7cfe' : '#dbe2ee' }}
              >
                {snapshot!.value.rag.ragTargetKbId === '' ? '● ' : '○ '}{t('ragTargetDefault')}
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
              {t('restoreDomain')}
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
