/**
 * dsh-workbench client entry: injects the 「工作台」 tab into the
 * conversation.view ring (after Chat / Trajectory), a prompt quick bar under
 * the composer, and the V3 mechanism switches above the composer.
 */
import React from 'react'
import { WorkbenchView } from './WorkbenchView.js'
import { PromptQuickBar } from './PromptQuickBar.js'
import { MechanismBar } from './MechanismBar.js'

/** Hard dependency: the slot registry must be ready before we register. */
export const inject = ['slots'] as const

interface SlotsServiceLike {
  inject(key: string, callback: () => unknown): () => void
  register(options: Record<string, unknown>, component: unknown): unknown
}

interface WorkbenchClientCtx {
  slots: SlotsServiceLike
  effect(fn: () => void, label?: string): void
}

export function apply(ctx: WorkbenchClientCtx): void {
  ctx.effect(() =>
    ctx.slots.inject('conversation.view', () =>
      ctx.slots.register(
        {
          name: 'conversation.view',
          id: 'workbench',
          order: 5,
          label: '工作台',
        },
        (props: { sessionId?: string }) => React.createElement(WorkbenchView, props),
      ),
    ),
  )
  // V2.2: recent-prompt quick switcher under the composer (对话框下方快捷条).
  ctx.effect(() =>
    ctx.slots.inject('conversation.composer.dock', () =>
      ctx.slots.register(
        {
          name: 'conversation.composer.dock',
          id: 'workbench-prompts',
          order: 10,
          label: '提示词快捷',
        },
        () => React.createElement(PromptQuickBar),
      ),
    ),
  )
  // V3: mechanism switches (RAG / 工具 / 技能 / 工作流) INSIDE the composer,
  // in the left tool row next to the attach/upload chrome.
  ctx.effect(() =>
    ctx.slots.inject('conversation.input.left', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.left',
          id: 'workbench-mechanisms',
          order: 2,
          label: '工作台机制',
        },
        () => React.createElement(MechanismBar),
      ),
    ),
  )
}
