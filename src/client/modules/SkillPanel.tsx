/**
 * 技能模块: 查看已安装技能 / 从本地 SKILL.md 导入 / 工作台级开关。
 * 说明: 技能的实际挂载由 DSH 技能注册表管理; 这里的开关是工作台本地偏好,
 * 用于「置顶关注」, 不直接卸载运行时的技能。
 */
import React from 'react'
import { call, errorMessage } from '../api.js'
import { Section, Field, Button, Empty, ErrorNote, Toggle, styles, okNote } from '../ui.js'
import type { StateSnapshot } from '../../shared/types.js'

export interface PanelProps {
  snapshot: StateSnapshot
  refresh: () => Promise<void>
}

export function SkillPanel(props: PanelProps) {
  const { snapshot, refresh } = props
  const [path, setPath] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  const skills = snapshot.skills
  const toggles = snapshot.value.skillToggles

  async function importSkill() {
    if (!path.trim()) return
    setErr(null)
    setBusy(true)
    try {
      const result = await call<{ ok: boolean; name?: string; error?: string }>('skill.import', { path: path.trim() })
      if (result.ok) {
        setNote(`已导入 ${result.name} → ~/.dsh/skills/`)
        setPath('')
      } else {
        setErr(result.error ?? '导入失败')
      }
    } catch (e) {
      setErr(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(name: string, enabled: boolean) {
    await call('state.update', { patch: { skillToggles: { ...toggles, [name]: enabled } }, expectedRevision: snapshot.revision })
    await refresh()
  }

  return (
    <div>
      <Section title="已安装技能" right={<span style={styles.dim}>{skills.length} 个</span>}>
        {err && <ErrorNote text={err} />}
        {note && <div style={{ marginBottom: 8 }}>{okNote(note)}</div>}
        {skills.length === 0 && <Empty text="当前会话没有可展示的技能。" />}
        {skills.map((s) => (
          <div key={s.name} style={{ padding: '8px 0', borderBottom: '1px solid #2a3140' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <strong style={{ fontSize: 13 }}>{s.name}</strong>
              <span style={{ fontSize: 11, color: '#8b94a7' }}>provider: {s.provider}</span>
              <span style={{ marginLeft: 'auto' }}>
                <Toggle checked={toggles[s.name] ?? false} onChange={(next) => void toggle(s.name, next)} label="关注" />
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#8b94a7', marginTop: 2 }}>{s.description}</div>
            {s.whenToUse && <div style={{ fontSize: 11, color: '#e2b93b', marginTop: 2 }}>适用: {s.whenToUse}</div>}
          </div>
        ))}
      </Section>

      <Section title="从本地导入 SKILL.md">
        <Field label="文件路径">
          <input style={{ ...styles.input, width: '100%' }} value={path} onChange={(e) => setPath(e.target.value)} placeholder="例如 C:\\path\\to\\SKILL.md" />
        </Field>
        <div style={styles.row}>
          <Button variant="primary" disabled={busy || !path.trim()} onClick={() => void importSkill()}>导入</Button>
        </div>
        <div style={styles.dim}>
          导入会把文件复制到 ~/.dsh/skills/ 目录; 技能是否被会话加载取决于 DSH 技能文件系统的扫描配置。
        </div>
      </Section>
    </div>
  )
}
