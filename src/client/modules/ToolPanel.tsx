/**
 * 工具模块 (V2): 查看已注册工具与入参 schema / 测试调用 / 运行时开关。
 * 「对模型隐藏」走宿主 ctx.tools.restrict({ deny }): 立即把工具从模型的
 * 可见工具集中移除, 关闭开关即恢复。测试调用走 ctx.tools.execute,
 * 仍受 DSH 工具策略与守卫约束。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, Toggle, styles, okNote, palette } from '../ui.js'
import type { StateSnapshot, ToolView } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

export function ToolPanel(props: PanelProps) {
  const { snapshot, refresh } = props
  const tools = snapshot.tools
  const toggles = snapshot.value.toolToggles
  const [selected, setSelected] = React.useState<ToolView | null>(null)
  const [argsText, setArgsText] = React.useState('{}')
  const [result, setResult] = React.useState<{ ok: boolean; value?: unknown; error?: string } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (selected && !tools.some((t) => t.name === selected.name)) setSelected(null)
    if (!selected && tools.length > 0) setSelected(tools[0]!)
  }, [tools, selected])

  async function runTest() {
    if (!selected) return
    setErr(null)
    setBusy(true)
    setResult(null)
    try {
      let args: unknown = {}
      try {
        args = JSON.parse(argsText || '{}')
      } catch {
        setErr('入参不是合法 JSON')
        setBusy(false)
        return
      }
      const res = await call<{ ok: boolean; value?: unknown; error?: string }>('tool.test', { name: selected.name, args })
      setResult(res)
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(name: string, enabled: boolean) {
    await call('state.update', { patch: { toolToggles: { ...toggles, [name]: enabled } }, expectedRevision: snapshot.revision })
    await refresh()
  }

  return (
    <div>
      <Section title="已注册工具" right={<span style={styles.dim}>{tools.length} 个</span>}>
        {note && <div style={{ marginBottom: 8 }}>{okNote(note)}</div>}
        {tools.length === 0 && <Empty text="当前没有可展示的工具。" />}
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>工具</th>
              <th style={styles.th}>描述</th>
              <th style={styles.th}>对模型隐藏</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <tr key={t.name}>
                <td style={styles.td}>
                  <button style={{ ...styles.button, padding: '2px 6px', fontSize: 11 }} onClick={() => { setSelected(t); setResult(null) }}>{t.name}</button>
                </td>
                <td style={styles.td}>{t.description}</td>
                <td style={styles.td}>
                  <Toggle checked={toggles[t.name] ?? false} onChange={(next) => void toggle(t.name, next)} label="" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {selected && (
        <Section title={`测试调用: ${selected.name}`}>
          {err && <ErrorNote text={err} />}
          <Field label="入参 JSON">
            <textarea style={{ ...styles.textarea, minHeight: 140 }} value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder='{"key": "value"}' />
          </Field>
          <div style={styles.row}>
            <Button variant="primary" disabled={busy} onClick={() => void runTest()}>调用</Button>
            <span style={styles.dim}>仍受 DSH 工具策略/审批约束; 只读工具可直接调用。</span>
          </div>
          {result && (
            <div>
              <div style={{ marginBottom: 6 }}>
                {result.ok ? okNote('调用成功') : <span style={styles.danger}>✗ 调用失败: {result.error}</span>}
              </div>
              <pre style={styles.pre}>{String(JSON.stringify(result.value ?? result.error, null, 2) ?? '')}</pre>
            </div>
          )}
          {selected.parameters ? (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 12, color: palette.text, cursor: 'pointer' }}>查看入参 schema</summary>
              <pre style={styles.pre}>{String(JSON.stringify(selected.parameters, null, 2) ?? '')}</pre>
            </details>
          ) : null}
        </Section>
      )}
    </div>
  )
}
