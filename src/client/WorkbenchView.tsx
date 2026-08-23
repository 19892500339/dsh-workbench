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

type ModuleId = 'rag' | 'mcp' | 'workflow' | 'skill' | 'tool' | 'prompt'

const MODULES: Array<{ id: ModuleId; label: string; icon: string; hint: string }> = [
  { id: 'rag', label: 'RAG', icon: '📚', hint: '知识检索' },
  { id: 'mcp', label: 'MCP', icon: '🔌', hint: '外部服务' },
  { id: 'workflow', label: '工作流', icon: '🔄', hint: '流程编排' },
  { id: 'skill', label: '技能', icon: '🧩', hint: 'SKILL.md' },
  { id: 'tool', label: '工具', icon: '🛠️', hint: '工具注册表' },
  { id: 'prompt', label: 'Prompt', icon: '📝', hint: '提示词' },
]

export function WorkbenchView(props: { sessionId?: string }) {
  const [active, setActive] = React.useState<ModuleId>('rag')
  const [snapshot, setSnapshot] = React.useState<StateSnapshot | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      const next = await call<StateSnapshot>('state.get', {})
      setSnapshot(next)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

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
              <div style={{ fontSize: 13, lineHeight: 1.2 }}>{m.label}</div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>{m.hint}</div>
            </span>
          </button>
        ))}
        <div style={{ marginTop: 'auto', ...styles.dim }}>
          会话: {props.sessionId ? props.sessionId.slice(0, 8) : '—'}
        </div>
      </nav>
      <div style={styles.content}>
        {error && (
          <div style={{ ...styles.danger, padding: 12, background: palette.panel, borderRadius: 8, marginBottom: 10 }}>
            无法连接宿主服务: {error}
            <div style={{ marginTop: 6 }}>
              <button style={styles.button} onClick={() => void refresh()}>重试</button>
            </div>
          </div>
        )}
        {loading && !snapshot && <div style={{ ...styles.dim, padding: 24 }}>加载中…</div>}
        {!loading && !snapshot && !error && <div style={{ ...styles.dim, padding: 24 }}>等待宿主数据…</div>}
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
