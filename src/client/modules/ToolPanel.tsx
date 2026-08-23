/**
 * 工具模块 (V2): 查看已注册工具与入参 schema / 测试调用 / 运行时开关。
 * 「对模型隐藏」走宿主 ctx.tools.restrict({ deny }): 立即把工具从模型的
 * 可见工具集中移除, 关闭开关即恢复。测试调用走 ctx.tools.execute,
 * 仍受 DSH 工具策略与守卫约束。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, Toggle, styles, okNote, palette } from '../ui.js'
import { t, useLocale } from '../i18n.js'
import type { StateSnapshot, ToolView } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

export function ToolPanel(props: PanelProps) {
  useLocale()
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

  /**
   * 开关语义: toolToggles[name] === false → 隐藏; 否则可见。
   * checked 表示「已对模型隐藏」。
   */
  function isHidden(name: string): boolean {
    return toggles[name] === false
  }

  async function toggle(name: string, wantHidden: boolean) {
    // 勾选=隐藏(存 false), 取消勾选=恢复可见(存 true)。
    await call('state.update', { patch: { toolToggles: { ...toggles, [name]: wantHidden ? false : true } }, expectedRevision: snapshot.revision })
    await refresh()
  }

  const hiddenCount = tools.filter((t) => t.hiddenFromModel).length

  return (
    <div>
      <Section title={t('tlAll')} right={<span style={styles.dim}>{tools.length} {t('tlCount', { n: hiddenCount })}</span>}>
        {note && <div style={{ marginBottom: 8 }}>{okNote(note)}</div>}
        {tools.length === 0 && <Empty text={t('tlEmpty')} />}
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>{t('navTools')}</th>
              <th style={styles.th}>{t('description')}</th>
              <th style={styles.th}>{t('tlHide')}</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool.name} style={tool.hiddenFromModel ? { opacity: 0.65 } : undefined}>
                <td style={styles.td}>
                  <button style={{ ...styles.button, padding: '2px 6px', fontSize: 11 }} onClick={() => { setSelected(tool); setResult(null) }}>{tool.name}</button>
                  {tool.hiddenFromModel && <span style={{ ...styles.warn, marginLeft: 6 }}>{t('tlHiddenBadge')}</span>}
                </td>
                <td style={styles.td}>{tool.description}</td>
                <td style={styles.td}>
                  <Toggle checked={isHidden(tool.name)} onChange={(next) => void toggle(tool.name, next)} label="" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={styles.dim}>
          {t('tlNote')}
        </div>
      </Section>

      {selected && (
        <Section title={`${t('tlTest')} ${selected.name}`}>
          {err && <ErrorNote text={err} />}
          <Field label={t('tlArgs')}>
            <textarea style={{ ...styles.textarea, minHeight: 140 }} value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder={t('tlArgsPh')} />
          </Field>
          <div style={styles.row}>
            <Button variant="primary" disabled={busy} onClick={() => void runTest()}>{t('tlCall')}</Button>
            <span style={styles.dim}>{t('tlPolicyNote')}</span>
          </div>
          {result && (
            <div>
              <div style={{ marginBottom: 6 }}>
                {result.ok ? okNote(t('tlSuccess')) : <span style={styles.danger}>✗ {t('tlFailed')} {result.error}</span>}
              </div>
              <pre style={styles.pre}>{String(JSON.stringify(result.value ?? result.error, null, 2) ?? '')}</pre>
            </div>
          )}
          {selected.parameters ? (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 12, color: palette.text, cursor: 'pointer' }}>{t('tlSchema')}</summary>
              <pre style={styles.pre}>{String(JSON.stringify(selected.parameters, null, 2) ?? '')}</pre>
            </details>
          ) : null}
        </Section>
      )}
    </div>
  )
}
