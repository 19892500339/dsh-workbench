/**
 * MCP 模块: 服务器增删改 / 启用禁用 / 连接测试。
 * 测试由宿主用 @modelcontextprotocol/sdk 完成 initialize 握手与工具清单枚举;
 * 「连接并注册工具到 ctx.tools」留给 DSH 自身的 MCP 集成, 避免重复桥接。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, Toggle, styles, okNote, palette } from '../ui.js'
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

  async function saveServer() {
    setErr(null)
    if (!form.name.trim()) {
      setErr('请填写名称')
      return
    }
    if (form.transport === 'http' && !(form.url ?? '').trim()) {
      setErr('http 服务器需要 url')
      return
    }
    if (form.transport === 'stdio' && !(form.command ?? '').trim()) {
      setErr('stdio 服务器需要 command')
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
      setNote('服务器已保存')
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
      <Section title="MCP 服务器" right={note ? okNote(note) : undefined}>
        {err && <ErrorNote text={err} />}
        {servers.length === 0 && <Empty text="还没有配置 MCP 服务器, 在下方添加。" />}
        {servers.map((s) => (
          <div key={s.id} style={{ ...styles.card, background: palette.panelAlt, padding: 10 }}>
            <div style={styles.row}>
              <strong style={{ fontSize: 13 }}>{s.name}</strong>
              <span style={styles.code}>{s.transport}</span>
              <span style={styles.dim}>{s.transport === 'stdio' ? (s.command ?? '') : (s.url ?? '')}</span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <Toggle checked={s.enabled} onChange={(next) => void toggleServer(s.id, next)} label="启用" />
                <Button disabled={busyId === s.id} onClick={() => void testServer(s)}>测试</Button>
                <Button variant="danger" onClick={() => void removeServer(s.id)}>删除</Button>
              </span>
            </div>
            {testResult[s.id] && (
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {testResult[s.id]!.ok ? (
                  <div style={styles.ok}>
                    ✓ 连接成功 · 工具: {testResult[s.id]!.tools?.length ? testResult[s.id]!.tools!.join(', ') : '(无)'}
                  </div>
                ) : (
                  <div style={styles.danger}>✗ 连接失败: {testResult[s.id]!.error}</div>
                )}
              </div>
            )}
          </div>
        ))}
      </Section>

      <Section title="添加服务器">
        <Field label="名称">
          <input style={{ ...styles.input, width: '100%' }} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如: exa-search" />
        </Field>
        <Field label="传输方式">
          <select
            style={styles.input}
            value={form.transport}
            onChange={(e) => setForm({ ...form, transport: e.target.value as 'stdio' | 'http' })}
          >
            <option value="stdio">stdio (本地命令)</option>
            <option value="http">http (远程 streamable HTTP)</option>
          </select>
        </Field>
        {form.transport === 'stdio' ? (
          <>
            <Field label="命令">
              <input style={{ ...styles.input, width: '100%' }} value={form.command ?? ''} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="npx / node / uvx" />
            </Field>
            <Field label="参数">
              <textarea style={styles.textarea} value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder="每行一个参数" />
            </Field>
            <Field label="环境变量">
              <textarea style={styles.textarea} value={envText} onChange={(e) => setEnvText(e.target.value)} placeholder="KEY=VALUE, 每行一个" />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <input style={{ ...styles.input, width: '100%' }} value={form.url ?? ''} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
            </Field>
            <Field label="Headers">
              <textarea style={styles.textarea} value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder="Authorization=Bearer xxx, 每行一个" />
            </Field>
          </>
        )}
        <div style={styles.row}>
          <Button variant="primary" disabled={busyId === '__form__'} onClick={() => void saveServer()}>保存</Button>
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
