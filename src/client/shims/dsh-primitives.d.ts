/**
 * Ambient types for the DSH shared primitives that the workbench consumes.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is a platform module provided by the
 * web shell at runtime (it's listed in `tsdown.config.ts` CLIENT_EXTERNALS and
 * kept external in the client bundle), so the workbench never bundles it. This
 * declaration exposes only the icon surface we import, keeping the plugin
 * self-contained for typechecking without pulling the package's full (heavy)
 * markdown/code-inspector type graph. Signatures mirror the real
 * `lib/types/icons/index.d.ts` so the swap is drop-in.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export interface IconProps {
    /** Glyph size in px; defaults to the icon's native size. */
    size?: number
    /** Extra class for layout placement; color rides `currentColor`. */
    className?: string
  }

  export const IconDataOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconApiOutline14: (props: IconProps) => import('react').JSX.Element
  export const IconBranchOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconSkillOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconCordisPluginOutline14: (props: IconProps) => import('react').JSX.Element
  export const IconListPenOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconWarningOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconCheckOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconRefreshOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconCodeOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconCloseOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconFolderOpenOutline16: (props: IconProps) => import('react').JSX.Element
  export const IconFolderClose16: (props: IconProps) => import('react').JSX.Element
}
