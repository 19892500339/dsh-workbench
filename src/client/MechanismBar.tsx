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
import { palette } from './ui.js'
import { t, useLocale } from './i18n.js'
import type { MechanismOverrides, OverrideMode, RagOverrideMode, StateSnapshot } from '../shared/types.js'
import {
  IconBranchOutline16,
  IconCordisPluginOutline14,
  IconDataOutline16,
  IconSkillOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'

type Domain = keyof MechanismOverrides

const DOMAINS: Array<{ key: Domain; titleKey: string; icon: React.ReactNode }> = [
  { key: 'rag', titleKey: 'ragTitle', icon: <IconDataOutline16 size={14} /> },
  { key: 'tools', titleKey: 'toolsTitle', icon: <IconCordisPluginOutline14 size={14} /> },
  { key: 'skills', titleKey: 'skillsTitle', icon: <IconSkillOutline16 size={14} /> },
  { key: 'workflow', titleKey: 'workflowTitle', icon: <IconBranchOutline16 size={14} /> },
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
            title={`${t(d.titleKey)}${active ? t('mechActive') : t('mechDefault')}`}
            style={{
              ...iconBtn,
              background: active ? palette.accent : 'transparent',
              borderColor: active ? palette.accent : palette.border,
              color: active ? palette.accentText : palette.text,
            }}
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
              <span style={{ color: palette.dim, fontWeight: 400 }}> · {t('wfActive')} {activeWorkflow.name}</span>
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
                  background: selected ? palette.selectedBg : 'transparent',
                  border: `1px solid ${selected ? palette.accent : 'transparent'}`,
                }}
              >
                <span style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{selected ? '● ' : '○ '}{t(opt.titleKey)}</div>
                  <div style={{ color: palette.dim, fontSize: 11, marginTop: 2 }}>{t(opt.descKey)}</div>
                </span>
              </button>
            )
          })}
          {openDomain === 'rag' && overrides.rag === 'workbench' && (
            <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 6, paddingTop: 6 }}>
              <div style={{ fontSize: 11, color: palette.dim, padding: '2px 8px' }}>{t('ragTarget')}</div>
              <button
                disabled={busy}
                onClick={() => void pickRagTarget('')}
                style={{ ...popItem, color: snapshot!.value.rag.ragTargetKbId === '' ? palette.accent : palette.text }}
              >
                {snapshot!.value.rag.ragTargetKbId === '' ? '● ' : '○ '}{t('ragTargetDefault')}
              </button>
              {(snapshot?.value.rag.knowledgeBases ?? []).map((kb) => {
                const sel = snapshot!.value.rag.ragTargetKbId === kb.id
                return (
                  <button key={kb.id} disabled={busy} onClick={() => void pickRagTarget(kb.id)} style={{ ...popItem, color: sel ? palette.accent : palette.text }}>
                    {sel ? '● ' : '○ '}{kb.name}
                    <span style={{ color: palette.dim, marginLeft: 6 }}>{kb.path}</span>
                  </button>
                )
              })}
            </div>
          )}
          {overrides[openDomain] !== 'default' && (
            <button disabled={busy} onClick={() => void resetDomain(openDomain)} style={{ ...popItem, color: palette.danger }}>
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
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: 12,
  lineHeight: 1,
  cursor: 'pointer',
  fontFamily: 'inherit',
  color: palette.text,
}

const popover: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: 0,
  width: 300,
  zIndex: 1000,
  background: palette.panel,
  border: `1px solid ${palette.border}`,
  borderRadius: 8,
  boxShadow: 'var(--dsw-shadow-lv3)',
  padding: 6,
}

const popTitle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: palette.text,
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
  color: palette.text,
  marginBottom: 2,
}
