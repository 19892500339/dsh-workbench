/**
 * Minimal UI primitives for the workbench panels (plain inline styles; no
 * icon/CSS dependency so the client bundle stays small).
 */
import React from 'react'
import { IconCheckOutline16, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * DSW design-token palette. Every value is a `--dsw-*` semantic token declared
 * by the DSH web shell on `body`, so the workbench follows the host theme
 * (`light` / `dark` / `system`) with zero runtime wiring of its own.
 */
export const palette = {
  bg: 'var(--dsw-alias-bg-base)',
  panel: 'var(--dsw-alias-bg-layer-1)',
  panelAlt: 'var(--dsw-alias-bg-layer-2)',
  border: 'var(--dsw-alias-border-l2)',
  text: 'var(--dsw-alias-label-primary)',
  dim: 'var(--dsw-alias-label-tertiary)',
  accent: 'var(--dsw-alias-button-info-fill)',
  accentText: 'var(--dsw-alias-label-primary-foreground)',
  ok: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-label)',
  danger: 'var(--dsw-alias-state-error-primary)',
  dangerBg: 'var(--dsw-alias-interactive-bg-hover-danger)',
  selectedBg: 'var(--dsw-alias-interactive-bg-hover-accent)',
  hover: 'var(--dsw-alias-interactive-bg-hover)',
}

export const styles = {
  root: { display: 'flex', gap: 14, height: '100%', padding: 12, boxSizing: 'border-box' as const },
  nav: {
    display: 'flex', flexDirection: 'column' as const, gap: 6, minWidth: 150, flexShrink: 0,
    borderRight: `1px solid ${palette.border}`, paddingRight: 12, overflowY: 'auto' as const,
  },
  navItem: (active: boolean) => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
    background: active ? palette.accent : 'transparent', color: active ? palette.accentText : palette.text,
    fontSize: 13, border: 'none', textAlign: 'left' as const, fontFamily: 'inherit',
  }),
  content: { flex: 1, minWidth: 0, overflowY: 'auto' as const },
  card: { background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 12, marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: palette.text, margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' as const },
  label: { fontSize: 12, color: palette.dim, minWidth: 72 },
  input: {
    background: palette.panelAlt, border: `1px solid ${palette.border}`, color: palette.text,
    borderRadius: 6, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  },
  textarea: {
    background: palette.panelAlt, border: `1px solid ${palette.border}`, color: palette.text,
    borderRadius: 6, padding: 8, fontSize: 12, fontFamily: 'ui-monospace, monospace', outline: 'none',
    resize: 'vertical' as const, width: '100%', boxSizing: 'border-box' as const, minHeight: 90,
  },
  button: {
    background: palette.panelAlt, border: `1px solid ${palette.border}`, color: palette.text,
    borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  },
  buttonPrimary: { background: palette.accent, borderColor: palette.accent, color: palette.accentText },
  buttonDanger: { color: palette.danger, borderColor: palette.danger },
  dim: { color: palette.dim, fontSize: 12 },
  ok: { color: palette.ok, fontSize: 12 },
  danger: { color: palette.danger, fontSize: 12 },
  warn: { color: palette.warn, fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, color: palette.dim, padding: '6px 8px', borderBottom: `1px solid ${palette.border}`, fontWeight: 600 },
  td: { padding: '6px 8px', borderBottom: `1px solid ${palette.border}`, color: palette.text, verticalAlign: 'top' as const },
  code: {
    background: palette.panelAlt, border: `1px solid ${palette.border}`, borderRadius: 4,
    padding: '2px 6px', fontSize: 11, fontFamily: 'ui-monospace, monospace', color: palette.text,
  },
  pre: {
    background: palette.panelAlt, border: `1px solid ${palette.border}`, borderRadius: 6,
    padding: 8, fontSize: 11, fontFamily: 'ui-monospace, monospace', color: palette.text,
    whiteSpace: 'pre-wrap' as const, wordBreak: 'break-all' as const, maxHeight: 260, overflowY: 'auto' as const,
  },
}

export function Section(props: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>
        <span>{props.title}</span>
        <span style={{ marginLeft: 'auto' }}>{props.right}</span>
      </div>
      {props.children}
    </div>
  )
}

export function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{props.label}</span>
      <div style={{ flex: 1, minWidth: 220 }}>{props.children}</div>
    </div>
  )
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' }) {
  const extra = props.variant === 'primary' ? styles.buttonPrimary : props.variant === 'danger' ? styles.buttonDanger : undefined
  return (
    <button {...props} style={{ ...styles.button, ...extra, ...(props.style ?? {}) }}>
      {props.children}
    </button>
  )
}

export function Toggle(props: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: palette.text, cursor: 'pointer' }}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} style={{ accentColor: palette.accent }} />
      {props.label}
    </label>
  )
}

export function Empty(props: { text: string }) {
  return <div style={{ ...styles.dim, padding: '18px 0', textAlign: 'center' }}>{props.text}</div>
}

export function ErrorNote(props: { text: string }) {
  return (
    <div style={{ ...styles.danger, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <IconWarningOutline16 size={14} /> {props.text}
    </div>
  )
}

export function okNote(text: string) {
  return (
    <span style={{ ...styles.ok, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <IconCheckOutline16 size={12} /> {text}
    </span>
  )
}
