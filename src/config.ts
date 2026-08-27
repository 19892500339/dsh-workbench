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
    knowledgeBases: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          path: z.string(),
        }),
      )
      .default([]),
    chunkSize: z.number().default(800),
    chunkOverlap: z.number().default(120),
    topK: z.number().default(5),
    engine: z.string().default('bm25'),
    embedding: z
      .object({
        baseUrl: z.string().default(''),
        apiKey: z.string().default(''),
        model: z.string().default(''),
      })
      .default({ baseUrl: '', apiKey: '', model: '' }),
    ragTargetKbId: z.string().default(''),
    ragCustom: z
      .object({
        topK: z.number().default(5),
        threshold: z.number().default(0.5),
      })
      .default({ topK: 5, threshold: 0.5 }),
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
        // V4: script-mode workflow (DSH workflowEngine orchestration).
        mode: z.string().default('nodes'),
        script: z.string().default(''),
        meta: z
          .object({
            name: z.string().default(''),
            description: z.string().default(''),
            whenToUse: z.string().default(''),
            phases: z
              .array(
                z.object({
                  title: z.string(),
                  detail: z.string().default(''),
                  provider: z.string().default(''),
                  model: z.string().default(''),
                }),
              )
              .default([]),
          })
          .default({ name: '', description: '', whenToUse: '', phases: [] }),
      }),
    )
    .default([]),
  activeWorkflowId: z.string().default(''),
  prompts: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        content: z.string().default(''),
        // 0 = never used; schemastery has no .optional(), so default fills it.
        lastUsedAt: z.number().default(0),
      }),
    )
    .default([]),
  activePromptId: z.string().default(''),
  toolToggles: z.dict(z.boolean()).default({}),
  skillToggles: z.dict(z.boolean()).default({}),
  overrides: z
    .object({
      rag: z.string().default('default'),
      tools: z.string().default('default'),
      skills: z.string().default('default'),
      workflow: z.string().default('default'),
    })
    .default({ rag: 'default', tools: 'default', skills: 'default', workflow: 'default' }),
  // V5: directories whose `.workbench` indexes the host maintains itself
  // (built-in file watcher — no external script needed).
  indexWatchDirs: z.array(z.string()).default([]),
  // V6: preset auto-configure → verify → GitHub publish pipeline.
  publish: z
    .object({
      enabled: z.boolean().default(true),
      presetId: z.string().default('workbench'),
      repo: z.string().default('https://github.com/19892500339/dsh-workbench.git'),
      branch: z.string().default('main'),
      autoPush: z.boolean().default(true),
      lastStatus: z.string().default(''),
      lastAt: z.number().default(0),
    })
    .default({
      enabled: true,
      presetId: 'workbench',
      repo: 'https://github.com/19892500339/dsh-workbench.git',
      branch: 'main',
      autoPush: true,
      lastStatus: '',
      lastAt: 0,
    }),
})

/** Defaults used when a fresh document has no user layer yet. */
export function defaultState(): WorkbenchState {
  return {
    rag: {
      corpusDir: '',
      knowledgeBases: [],
      chunkSize: 800,
      chunkOverlap: 120,
      topK: 5,
      engine: 'bm25',
      embedding: { baseUrl: '', apiKey: '', model: '' },
      ragTargetKbId: '',
      ragCustom: { topK: 5, threshold: 0.5 },
    },
    mcpServers: [],
    workflows: [],
    activeWorkflowId: '',
    prompts: [],
    activePromptId: '',
    toolToggles: {},
    skillToggles: {},
    overrides: { rag: 'default', tools: 'default', skills: 'default', workflow: 'default' },
    indexWatchDirs: [],
    publish: {
      enabled: true,
      presetId: 'workbench',
      repo: 'https://github.com/19892500339/dsh-workbench.git',
      branch: 'main',
      autoPush: true,
      lastStatus: '',
      lastAt: 0,
    },
  }
}

/** Minimal access surface over the settings service used by the API handlers. */
export interface SettingsFace {
  /** Resolved value + revision for revision-guarded writes. */
  view(): { value: WorkbenchState; revision: number }
  /** Merge a shallow patch into the user layer and return the fresh view. */
  update(patch: object, expectedRevision?: number): Promise<{ value: WorkbenchState; revision: number }>
}
