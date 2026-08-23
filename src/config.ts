/**
 * Workbench settings namespace: schema, defaults and a small helper over the
 * DSH `settings` service. Everything the panel edits persists here through the
 * provider's document (e.g. ~/.dsh/settings.yaml), so it survives restarts.
 */
import z from '@deepseek-ai/schemastery'
import type { WorkbenchState } from './shared/types.js'

/** Settings namespace owned by this plugin. */
export const SETTINGS_NS = 'workbench'

/** The schemastery schema that validates the whole persisted state. */
export const WorkbenchSchema = z.object({
  rag: z.object({
    corpusDir: z.string().default(''),
    chunkSize: z.number().default(800),
    chunkOverlap: z.number().default(120),
    topK: z.number().default(5),
    engine: z.string().default('bm25'),
  }),
  mcpServers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        transport: z.string(),
        command: z.string().default(''),
        args: z.array(z.string()).default([]),
        env: z.dict(z.string()).default({}),
        url: z.string().default(''),
        headers: z.dict(z.string()).default({}),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
  workflows: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().default(''),
        nodes: z
          .array(
            z.object({
              id: z.string(),
              kind: z.string(),
              label: z.string(),
              params: z.dict(z.string()).default({}),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
  prompts: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        content: z.string().default(''),
      }),
    )
    .default([]),
  activePromptId: z.string().default(''),
  toolToggles: z.dict(z.boolean()).default({}),
  skillToggles: z.dict(z.boolean()).default({}),
})

/** Defaults used when a fresh document has no user layer yet. */
export function defaultState(): WorkbenchState {
  return {
    rag: { corpusDir: '', chunkSize: 800, chunkOverlap: 120, topK: 5, engine: 'bm25' },
    mcpServers: [],
    workflows: [],
    prompts: [],
    activePromptId: '',
    toolToggles: {},
    skillToggles: {},
  }
}

/** Minimal access surface over the settings service used by the API handlers. */
export interface SettingsFace {
  /** Resolved value + revision for revision-guarded writes. */
  view(): { value: WorkbenchState; revision: number }
  /** Merge a shallow patch into the user layer and return the fresh view. */
  update(patch: object, expectedRevision?: number): Promise<{ value: WorkbenchState; revision: number }>
}
