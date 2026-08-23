/**
 * Prompt 模块: 提示词模板 CRUD / 变量占位符预览 / 切换生效模板。
 * 「切换生效」把 activePromptId 写入设置; 宿主通过动态 section
 * workbench:active-prompt 在每个模型步骤组装提示词时注入当前模板内容
 * (未激活时为空 section, 不占上下文)。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, styles, okNote, palette } from '../ui.js'
import { t, useLocale } from '../i18n.js'
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
  useLocale()
  const { snapshot, refresh } = props
  const prompts = snapshot.value.prompts
  const activeId = snapshot.value.activePromptId
  const [draft, setDraft] = React.useState<PromptTemplate | null>(null)
  const [previewVars, setPreviewVars] = React.useState('topic=示例主题')
  const [err, setErr] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  React.useEffect(() => {
    // 仅当 draft 是已保存模板(id 非空)且被删除时清空;
    // 新建模板 id 为空字符串, 不能被这里误清(修复"点新建没反应")。
    if (draft && draft.id && !prompts.some((p) => p.id === draft.id)) setDraft(null)
  }, [prompts, draft])

  async function save() {
    if (!draft || !draft.name.trim()) {
      setErr(t('ppNeedName'))
      return
    }
    setErr(null)
    try {
      await call('prompt.save', { prompt: draft })
      await refresh()
      setNote(t('ppSaved'))
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
    setNote(t('ppActivated'))
  }

  async function restoreTemplates() {
    setErr(null)
    try {
      const templates = await call<PromptTemplate[]>('prompt.templates', {})
      for (const tmpl of templates) await call('prompt.save', { prompt: tmpl })
      await refresh()
      setNote(t('ppRestored'))
    } catch (e) {
      setErr(errorMessage(e))
    }
  }

  // 最近使用过的 3 个提示词(按 lastUsedAt 倒序; 0 = 从未使用)。
  const recent = [...prompts]
    .filter((p) => (p.lastUsedAt ?? 0) > 0)
    .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    .slice(0, 3)

  const preview = draft ? substitute(draft.content, mergeVars(previewVars)) : ''

  return (
    <div>
      {recent.length > 0 && (
        <Section title={t('ppRecent')} right={<span style={styles.dim}>{t('ppRecentHint')}</span>}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {recent.map((p) => (
              <button
                key={p.id}
                style={{ ...styles.button, flex: '1 1 180px', textAlign: 'left', background: p.id === activeId ? palette.accent : palette.panelAlt, color: p.id === activeId ? '#fff' : palette.text }}
                onClick={() => void activate(p.id)}
                title={p.content.slice(0, 80)}
              >
                <strong style={{ fontSize: 12 }}>{p.name}</strong>
                {p.id === activeId && <span style={{ marginLeft: 6 }}>●</span>}
                <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{new Date(p.lastUsedAt ?? 0).toLocaleTimeString()}</div>
              </button>
            ))}
          </div>
          <div style={{ ...styles.dim, marginTop: 6 }}>{t('ppRecentTip')}</div>
        </Section>
      )}

      <Section title={t('ppTemplates')} right={
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <Button disabled={false} onClick={() => void restoreTemplates()}>{t('ppRestore')}</Button>
          <Button variant="primary" onClick={() => setDraft({ id: '', name: t('ppNewName'), content: '你是{role}。主题: {topic}' })}>{t('ppNew')}</Button>
        </span>
      }>
        {err && <ErrorNote text={err} />}
        {note && <div style={{ marginBottom: 8 }}>{okNote(note)}</div>}
        {prompts.length === 0 && <Empty text={t('ppEmpty')} />}
        {prompts.map((p) => (
          <div key={p.id} style={{ padding: '8px 0', borderBottom: `1px solid ${palette.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{p.name}</strong>
              {p.id === activeId && <span style={styles.ok}>{t('ppActive')}</span>}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                <Button onClick={() => { setDraft({ ...p }); setErr(null) }}>{t('edit')}</Button>
                <Button variant="primary" onClick={() => void activate(p.id)}>{t('ppSwitch')}</Button>
                <Button variant="danger" onClick={() => void remove(p.id)}>{t('delete')}</Button>
              </span>
            </div>
            <div style={{ ...styles.dim, marginTop: 2, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'hidden' }}>{p.content}</div>
          </div>
        ))}
      </Section>

      {draft && (
        <Section title={`${t('ppEdit')} ${draft.name || '(—)'}`}>
          <Field label={t('name')}>
            <input style={{ ...styles.input, width: '100%' }} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label={t('ppBody')}>
            <textarea style={{ ...styles.textarea, minHeight: 160 }} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder={t('ppBodyPh')} />
          </Field>
          <div style={styles.row}>
            <Button variant="primary" onClick={() => void save()}>{t('save')}</Button>
            <span style={styles.dim}>{t('ppPlaceholderNote')}</span>
          </div>

          <div style={{ borderTop: `1px solid ${palette.border}`, marginTop: 10, paddingTop: 10 }}>
            <Field label={t('ppPreviewVars')}>
              <input style={{ ...styles.input, width: '100%' }} value={previewVars} onChange={(e) => setPreviewVars(e.target.value)} placeholder={t('ppPreviewVarsPh')} />
            </Field>
            <div style={{ fontSize: 12, color: palette.dim, margin: '6px 0' }}>{t('ppPreview')}</div>
            <pre style={styles.pre}>{preview || t('ppEmpty')}</pre>
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
