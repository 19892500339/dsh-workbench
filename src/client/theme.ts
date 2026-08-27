/**
 * DSW design-token bridge for the workbench client.
 *
 * Most surfaces consume `--dsw-*` tokens directly as CSS custom properties in
 * inline styles (the DSH web shell defines them on `body` and toggles them via
 * `body[data-ds-dark-theme]`, so `var(...)` stays theme-reactive for free).
 *
 * The LogicFlow canvas is the one exception: its nodes/edges are SVG, where
 * `var()` inside presentation attributes is unreliable, so we resolve tokens
 * to concrete colors here and re-render the graph whenever the theme flips.
 */
import React from 'react'

/**
 * Read the *computed* value of a CSS custom property declared on `body`.
 * Custom properties resolve their `var(...)` references at computed-value
 * time, so this returns a concrete color (e.g. `rgb(15, 17, 21)`) rather than
 * a nested `var(...)` string. Falls back when the host hasn't mounted yet.
 */
export function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const value = getComputedStyle(document.body).getPropertyValue(name).trim()
  return value || fallback
}

/** Resolved colors consumed by the LogicFlow canvas (SVG attributes). */
export function resolveCanvasTheme() {
  return {
    panel: readCssVar('--dsw-alias-bg-layer-1', '#171b22'),
    panelAlt: readCssVar('--dsw-alias-bg-layer-2', '#1d222b'),
    border: readCssVar('--dsw-alias-border-l2', 'rgba(255,255,255,0.12)'),
    text: readCssVar('--dsw-alias-label-primary', '#dbe2ee'),
    dim: readCssVar('--dsw-alias-label-tertiary', '#8b94a7'),
    accent: readCssVar('--dsw-alias-button-info-fill', '#4d7cfe'),
    selected: readCssVar('--dsw-alias-interactive-bg-hover-accent', 'rgba(255,255,255,0.24)'),
  }
}

export type CanvasTheme = ReturnType<typeof resolveCanvasTheme>

/**
 * Re-render trigger that bumps whenever the effective theme changes: observes
 * `body[data-ds-dark-theme]` (the DSH presenter's dark-theme flag) plus the
 * OS `prefers-color-scheme` media query (for the `system` preference).
 */
export function useThemeVersion(): number {
  const [version, setVersion] = React.useState(0)
  React.useEffect(() => {
    const bump = () => setVersion((v) => v + 1)

    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver((mutations) => {
            if (mutations.some((m) => m.attributeName === 'data-ds-dark-theme')) bump()
          })
        : null
    observer?.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })

    const media = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null
    media?.addEventListener?.('change', bump)

    return () => {
      observer?.disconnect()
      media?.removeEventListener?.('change', bump)
    }
  }, [])
  return version
}
