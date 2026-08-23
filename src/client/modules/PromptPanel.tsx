/**
 * Prompt 模块: 提示词模板 CRUD / 变量占位符预览 / 切换生效模板。
 * 「切换生效」把 activePromptId 写入设置; 宿主在每个模型步骤组装提示词时
 * 通过 systemPrompt.variable('workbench_active_prompt') 注入当前模板内容。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, styles, okNote, palette } from '../ui.js'
import type { PromptTemplate, StateSnapshot } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

const SAMPLE_VARS: Record<string, string> = {
  topic: 'DeepSeek Harness 插件开发',
  role: '资深架构师',
  question: '如何注册一个对话页签?',
  resume: '示例简历文本',
  jd: '示例 JD 文本',
  requirements: '示例要求',
  job: '示例岗位',
}

export function PromptPanel(props: PanelProps) {
  const { snapshot, refresh } = props
  const prompts = snapshot.value.prompts
  const activeId = snapshot.value.activePromptId
  const [draft, setDraft] = React.useState<PromptTemplate | null>(null)
  const [previewVars, setPreviewVars] = React.useState('topic=示例主题')
  const [err, setErr] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (draft && !prompts.some((p) => p.id === draft.id)) setDraft(null)
  }, [prompts, draft])

  async function save() {
    if (!draft || !draft.name.trim()) {
      setErr('请填写名称')
      return
    }
    setErr(null)
    try {
      await call('prompt.save', { prompt: draft })
      await refresh()
      setNote('模板已保存')
    } catch (e) {
      setErr(errorMessage(e))
    }
  }

  async function remove(id: string) {
    await call('prompt.remove', { id })
    if (draft?.id === id) setDraft(null)
    await refresh()
  }

  async function activate(id: string) {
    await call('prompt.activate', { id })
    await refresh()
    setNote('已切换生效提示词 (下一个模型步骤生效)')
  }

  const preview = draft ? substitute(draft.content, mergeVars(previewVars)) : ''

  return (
    <div>
      <Section title="提示词模板" right={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <Button variant="primary" onClick={() => setDraft({ id: '', name: '新模板', content: '你是{{role}}。主题: {{topic}}' })}>新建</Button>
        </span>
      }>
        {err && <ErrorNote text={err} />}
        {note && <div style={{ marginBottom: 8 }}>{okNote(note)}</div>}
        {prompts.length === 0 && <Empty text="还没有提示词模板。" />}
        {prompts.map((p) => (
          <div key={p.id} style={{ padding: '8px 0', borderBottom: `1px solid ${palette.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{p.name}</strong>
              {p.id === activeId && <span style={styles.ok}>● 生效中</span>}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                <Button onClick={() => { setDraft({ ...p }); setErr(null) }}>编辑</Button>
                <Button variant="primary" onClick={() => void activate(p.id)}>切换生效</Button>
                <Button variant="danger" onClick={() => void remove(p.id)}>删除</Button>
              </span>
            </div>
            <div style={{ ...styles.dim, marginTop: 2, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{p.content}</div>
          </div>
        ))}
      </Section>

      {draft && (
        <Section title={`编辑模板: ${draft.name || '(未命名)'}`}>
          <Field label="名称">
            <input style={{ ...styles.input, width: '100%' }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="正文">
            <textarea style={{ ...styles.textarea, minHeight: 160 }} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="支持 {{变量}} 占位符, 如 {{role}} / {{topic}}" />
          </Field>
          <div style={styles.row}>
            <Button variant="primary" onClick={() => void save()}>保存</Button>
            <span style={styles.dim}>占位符将在预览与注入时替换。</span>
          </div>

          <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 10, paddingTop: 10 }}>
            <Field label="预览变量">
              <input style={{ ...styles.input, width: '100%' }} value={previewVars} onChange={(e) => setPreviewVars(e.target.value)} placeholder="var=value, 逗号分隔" />
            </Field>
            <div style={{ fontSize: 12, color: palette.dim, margin: '6px 0' }}>渲染效果预览:</div>
            <pre style={styles.pre}>{preview || '(空)'}</pre>
          </div>
        </Section>
      )}
    </div>
  )
}

function mergeVars(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of text.split(/[,，]/)) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return { ...SAMPLE_VARS, ...out }
}

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}
