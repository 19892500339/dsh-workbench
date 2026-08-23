/**
 * dsh-workbench client entry: injects the 「工作台」 tab into the
 * conversation.view ring (after Chat / Trajectory).
 */
import React from 'react'
import { WorkbenchView } from './WorkbenchView.js'

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
}
