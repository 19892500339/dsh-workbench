/**
 * MCP 模块: 服务器增删改 / 启用禁用 / 连接测试。
 * 测试由宿主用 @modelcontextprotocol/sdk 完成 initialize 握手与工具清单枚举;
 * 「连接并注册工具到 ctx.tools」留给 DSH 自身的 MCP 集成, 避免重复桥接。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, Toggle, styles, okNote, palette } from '../ui.js'
import { t, useLocale } from '../i18n.js'
import type { McpServerConfig, McpTestResult, StateSnapshot } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

const EMPTY_FORM: Omit<McpServerConfig, 'id' | 'enabled'> = {
  name: '',
  transport: 'stdio',
  command: 'npx',
  args: [],
  env: {},
  url: '',
  headers: {},
}

export function McpPanel(props: PanelProps) {
  useLocale()
  const { snapshot, refresh } = props
  const [form, setForm] = React.useState(EMPTY_FORM)
  const [argsText, setArgsText] = React.useState('')
  const [envText, setEnvText] = React.useState('')
  const [headersText, setHeadersText] = React.useState('')
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [testResult, setTestResult] = React.useState<Record<string, McpTestResult>>({})
  const [err, setErr] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  const servers = snapshot.value.mcpServers

  function statusOf(id: string) {
    return snapshot.mcpStatus[id]
  }

  async function saveServer() {
    setErr(null)
    if (!form.name.trim()) {
      setErr(t('mcpNeedName'))
      return
    }
    if (form.transport === 'http' && !(form.url ?? '').trim()) {
      setErr(t('mcpNeedUrl'))
      return
    }
    if (form.transport === 'stdio' && !(form.command ?? '').trim()) {
      setErr(t('mcpNeedCmd'))
      return
    }
    setBusyId('__form__')
    try {
      await call('mcp.save', {
        server: {
          ...form,
          args: splitLines(argsText),
          env: parsePairs(envText),
          headers: parsePairs(headersText),
        },
      })
      await refresh()
      setForm(EMPTY_FORM)
      setArgsText('')
      setEnvText('')
      setHeadersText('')
      setNote(t('mcpSaved'))
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  async function removeServer(id: string) {
    await call('mcp.remove', { id })
    await refresh()
  }

  async function toggleServer(id: string, enabled: boolean) {
    await call('mcp.toggle', { id, enabled })
    await refresh()
  }

  async function testServer(server: McpServerConfig) {
    setBusyId(server.id)
    try {
      const result = await call<McpTestResult>('mcp.test', { serverId: server.id })
      setTestResult((prev) => ({ ...prev, [server.id]: result }))
    } catch (e) {
      setTestResult((prev) => ({ ...prev, [server.id]: { ok: false, transport: server.transport, error: errorMessage(e) } }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <Section title={t('mcpServers')} right={note ? okNote(note) : undefined}>
        {err && <ErrorNote text={err} />}
        {servers.length === 0 && <Empty text={t('mcpEmpty')} />}
        {servers.map((s) => (
          <div key={s.id} style={{ ...styles.card, background: palette.panelAlt, padding: 10 }}>
            <div style={styles.row}>
              <strong style={{ fontSize: 13 }}>{s.name}</strong>
              <span style={styles.code}>{s.transport}</span>
              <span style={styles.dim}>{s.transport === 'stdio' ? (s.command ?? '') : (s.url ?? '')}</span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <Toggle checked={s.enabled} onChange={(next) => void toggleServer(s.id, next)} label={t('enable')} />
                <Button disabled={busyId === s.id} onClick={() => void testServer(s)}>{t('test')}</Button>
                <Button variant="danger" onClick={() => void removeServer(s.id)}>{t('delete')}</Button>
              </span>
            </div>
            {testResult[s.id] && (
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {testResult[s.id]!.ok ? (
                  <div style={styles.ok}>
                    ✓ {t('mcpConnected')} {testResult[s.id]!.tools?.length ? testResult[s.id]!.tools!.join(', ') : '(—)'}
                  </div>
                ) : (
                  <div style={styles.danger}>✗ {t('mcpFailed')} {testResult[s.id]!.error}</div>
                )}
              </div>
            )}
            {statusOf(s.id) && (
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {statusOf(s.id)!.connected ? (
                  <div style={styles.ok}>
                    {t('mcpRunning', { n: statusOf(s.id)!.tools.length })}
                    {statusOf(s.id)!.tools.length > 0 && <div style={{ marginTop: 4, wordBreak: 'break-all' }}>{statusOf(s.id)!.tools.join('、')}</div>}
                    {statusOf(s.id)!.error && <div style={styles.warn}>{t('mcpPartial')} {statusOf(s.id)!.error}</div>}
                  </div>
                ) : (
                  <div style={styles.warn}>
                    {t('mcpOffline')}{s.enabled ? '' : t('mcpDisabled')}
                    {statusOf(s.id)!.error && <span> · {statusOf(s.id)!.error}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title={t('mcpAdd')}>
        <Field label={t('name')}>
          <input style={{ ...styles.input, width: '100%' }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('mcpNamePh')} />
        </Field>
        <Field label={t('mcpTransport')}>
          <select
            style={styles.input}
            value={form.transport}
            onChange={(e) => setForm({ ...form, transport: e.target.value as 'stdio' | 'http' })}
          >
            <option value="stdio">{t('mcpStdio')}</option>
            <option value="http">{t('mcpHttp')}</option>
          </select>
        </Field>
        {form.transport === 'stdio' ? (
          <>
            <Field label={t('mcpCommand')}>
              <input style={{ ...styles.input, width: '100%' }} value={form.command ?? ''} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder={t('mcpCmdPh')} />
            </Field>
            <Field label={t('mcpArgs')}>
              <textarea style={styles.textarea} value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder={t('mcpArgsPh')} />
            </Field>
            <Field label={t('mcpEnv')}>
              <textarea style={styles.textarea} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder={t('mcpEnvPh')} />
            </Field>
          </>
        ) : (
          <>
            <Field label={t('mcpUrl')}>
              <input style={{ ...styles.input, width: '100%' }} value={form.url ?? ''} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={t('mcpUrlPh')} />
            </Field>
            <Field label={t('mcpHeaders')}>
              <textarea style={styles.textarea} value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder={t('mcpHeadersPh')} />
            </Field>
          </>
        )}
        <div style={styles.row}>
          <Button variant="primary" disabled={busyId === '__form__'} onClick={() => void saveServer()}>{t('save')}</Button>
        </div>
      </Section>
    </div>
  )
}

function splitLines(text: string): string[] {
  return text.split('\n').map((s) => s.trim()).filter(Boolean)
}

function parsePairs(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of splitLines(text)) {
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}
