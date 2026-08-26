/**
 * 工作台页签主视图: 左侧六大模块导航, 右侧当前模块的可视化面板。
 * 数据经 /workbench/api RPC 从宿主读取; 所有配置持久化到宿主 settings。
 */
import React from 'react'
import { call, errorMessage } from './api.js'
import { styles, palette } from './ui.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import { RagPanel } from './modules/RagPanel.js'
import { McpPanel } from './modules/McpPanel.js'
import { WorkflowPanel } from './modules/WorkflowPanel.js'
import { SkillPanel } from './modules/SkillPanel.js'
import { ToolPanel } from './modules/ToolPanel.js'
import { PromptPanel } from './modules/PromptPanel.js'
import type { StateSnapshot } from '../shared/types.js'
import { t, useLocale } from './i18n.js'

type ModuleId = 'rag' | 'mcp' | 'workflow' | 'skill' | 'tool' | 'prompt'

const MODULES: Array<{ id: ModuleId; labelKey: string; icon: string; hintKey: string }> = [
  { id: 'rag', labelKey: 'navRag', icon: '📚', hintKey: 'navRagHint' },
  { id: 'mcp', labelKey: 'navMcp', icon: '🔌', hintKey: 'navMcpHint' },
  { id: 'workflow', labelKey: 'navWorkflow', icon: '🔄', hintKey: 'navWorkflowHint' },
  { id: 'skill', labelKey: 'navSkills', icon: '🧩', hintKey: 'navSkillsHint' },
  { id: 'tool', labelKey: 'navTools', icon: '🛠️', hintKey: 'navToolsHint' },
  { id: 'prompt', labelKey: 'navPrompt', icon: '📝', hintKey: 'navPromptHint' },
]

export function WorkbenchView(props: { sessionId?: string }) {
  useLocale()
  const [active, setActive] = React.useState<ModuleId>('rag')
  const [snapshot, setSnapshot] = React.useState<StateSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      // 带上 sessionId: 宿主按该会话 agent 的 scope 投影工具/技能, 面板才能
      // 显示模型真实可见的工具与技能(而非宿主全局层的那几个)。
      const next = await call<StateSnapshot>('state.get', props.sessionId ? { sessionId: props.sessionId } : {})
      setSnapshot(next)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [props.sessionId])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const panelProps = { snapshot, refresh }

  return (
    <div style={{ ...styles.root, minHeight: 480 }}>
      <nav style={styles.nav}>
        {MODULES.map((m) => (
          <button key={m.id} style={styles.navItem(active === m.id)} onClick={() => setActive(m.id)}>
            <span>{m.icon}</span>
            <span>
              <div style={{ fontSize: 13, lineHeight: 1.2 }}>{t(m.labelKey)}</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{t(m.hintKey)}</div>
            </span>
          </button>
        ))}
        <div style={{ marginTop: 'auto', ...styles.dim }}>
          {t('session')}: {props.sessionId ? props.sessionId.slice(0, 8) : '—'}
        </div>
      </nav>
      <div style={styles.content}>
        {error && (
          <div style={{ ...styles.danger, padding: 12, background: palette.panel, borderRadius: 8, marginBottom: 10 }}>
            {t('hostUnreachable')} {error}
            <div style={{ marginTop: 6 }}>
              <button style={styles.button} onClick={() => void refresh()}>{t('retry')}</button>
            </div>
          </div>
        )}
        {loading && !snapshot && <div style={{ ...styles.dim, padding: 24 }}>{t('loading')}</div>}
        {!loading && !snapshot && !error && <div style={{ ...styles.dim, padding: 24 }}>{t('waitingHost')}</div>}
        {snapshot && (
          <ErrorBoundary label="工作台面板">
            {active === 'rag' && <RagPanel snapshot={snapshot} refresh={refresh} />}
            {active === 'mcp' && <McpPanel snapshot={snapshot} refresh={refresh} />}
            {active === 'workflow' && <WorkflowPanel snapshot={snapshot} refresh={refresh} />}
            {active === 'skill' && <SkillPanel snapshot={snapshot} refresh={refresh} />}
            {active === 'tool' && <ToolPanel snapshot={snapshot} refresh={refresh} />}
            {active === 'prompt' && <PromptPanel snapshot={snapshot} refresh={refresh} />}
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}
