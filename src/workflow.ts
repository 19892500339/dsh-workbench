/**
 * Workflow orchestration, V4: node-mode REAL execution + DSH workflowEngine
 * script mode.
 *
 * Node mode walks a deterministic node list, but since V4 it is no longer a
 * dry run: `tool` nodes actually execute through the provided env (the agent's
 * own tools instance), `skill` nodes load the skill body, and `prompt` /
 * `transform` / `output` process a text buffer as before. When an env hook is
 * absent the node degrades gracefully (tool = registry check, skill = name
 * only), which keeps the old dry-run behaviour for hosts without the hooks.
 *
 * Script mode is delegated to `ctx.workflowEngine` by the host (see
 * `runScriptWorkflow` in src/index.ts): the DSH engine executes model-written
 * JS orchestration scripts on a worker thread, bridging `agent()` /
 * `pipeline()` / `parallel()` back to the real subagent registry — exactly the
 * DSH `workflow` tool.
 */
import type { WorkflowDefinition, WorkflowNode, WorkflowStepLog } from './shared/types.js'

/** Built-in starter templates shown in the panel. */
export function builtinTemplates(): WorkflowDefinition[] {
  return [
    {
      id: 'resume-writer',
      name: '简历撰写',
      description: '从零开始把岗位信息加工成一份结构化简历要点。',
      nodes: [
        node('n1', 'prompt', '输入岗位信息', { text: '岗位名称: {{job}}\n要求: {{requirements}}' }),
        node('n2', 'transform', '要点补全', { op: 'append', value: '\n技能清单:\n- 与岗位强相关的经验\n- 可量化的成果' }),
        node('n3', 'tool', '校对工具', { name: 'read_document' }),
        node('n4', 'output', '输出简历', { format: 'markdown' }),
      ],
    },
    {
      id: 'recruiter-screen',
      name: '招聘筛选',
      description: '按 JD 要点对候选人简历做结构化筛选清单。',
      nodes: [
        node('n1', 'prompt', '输入简历', { text: '候选人简历:\n{{resume}}' }),
        node('n2', 'transform', '附加 JD', { op: 'append', value: '\n\nJD 硬性要求:\n{{jd}}' }),
        node('n3', 'output', '输出结论', { format: 'markdown' }),
      ],
    },
    {
      id: 'plain-qa',
      name: '通用问答',
      description: '最小工作流: 提示词 → 输出。',
      nodes: [
        node('n1', 'prompt', '输入问题', { text: '{{question}}' }),
        node('n2', 'output', '输出回答', { format: 'markdown' }),
      ],
    },
    {
      id: 'dsh-default-workflow',
      name: 'DSH 默认工作流 (JS 编排)',
      description: 'DeepSeek Harness 原生工作流机制: JS 编排脚本 + worker 线程 + 子代理扇出 (agent / pipeline / parallel)',
      mode: 'script',
      nodes: [],
      script: [
        '// ── DeepSeek Harness 默认工作流机制 ─────────────────────────────',
        '// DSH 的 workflow 机制 = JS 编排脚本 + worker 线程执行 + 子代理扇出。',
        '// 本骨架演示全部钩子, 按需增删。',
        '// 可用: agent(prompt, { label, schema?, provider?, model? })',
        '//       pipeline(items, ...stages)   并行流水线',
        '//       parallel(thunks)             并行屏障',
        '//       phase(title) / log(msg) / args (本工作流的输入变量)',
        '',
        "const topic = args?.topic ?? 'DeepSeek Harness'",
        "phase('准备')",
        'log(`开始: ${topic}`)',
        '',
        "phase('并行研究')",
        'const angles = await parallel([',
        "  () => agent(`研究 \"${topic}\" 的一个关键方面, 输出 2 条要点。`, { label: '研究-1' }),",
        "  () => agent(`研究 \"${topic}\" 的另一个关键方面, 输出 2 条要点。`, { label: '研究-2' }),",
        '])',
        '',
        "phase('汇总')",
        "const summary = await agent(`把以下两份研究结果合并成一段 80 字以内的总结:\\n${angles.join('\\n')}`, { label: '汇总' })",
        '',
        'return { topic, angles, summary }',
      ].join('\n'),
      meta: {
        name: 'dsh-default-workflow',
        description: 'DSH native workflow mechanism skeleton',
        phases: [{ title: '准备' }, { title: '并行研究' }, { title: '汇总' }],
      },
    },
  ]
}

function node(id: string, kind: WorkflowNode['kind'], label: string, params: Record<string, string>): WorkflowNode {
  return { id, kind, label, params }
}

/** Resolve a tool name to a short descriptor, or null. */
export interface ToolResolver {
  resolve(name: string): { name: string; description: string } | null
}

/** V4: real-execution hooks. Each is optional — absence degrades to dry-run. */
export interface WorkflowExecEnv {
  resolve?: (name: string) => { name: string; description: string } | null
  /** Actually execute a tool node through the agent-scope tools instance. */
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; value?: unknown; error?: string }>
  /** Load a skill's full body through the agent-scope skills instance. */
  getSkill?: (name: string) => Promise<{ name: string; description: string; body?: string } | undefined>
}

const MAX_DETAIL = 400
const MAX_SKILL_BODY = 2000

function clip(text: string, max = MAX_DETAIL): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/**
 * Execute one workflow's node list in order. Returns the per-node trace; the
 * final `output` node carries the accumulated buffer in its detail.
 */
export async function executeWorkflow(
  workflow: WorkflowDefinition,
  inputs: Record<string, string>,
  env: WorkflowExecEnv,
): Promise<WorkflowStepLog[]> {
  const logs: WorkflowStepLog[] = []
  let buffer = ''
  let index = 0
  for (const n of workflow.nodes) {
    index += 1
    const entry: WorkflowStepLog = { index, nodeId: n.id, label: n.label, status: 'ok', detail: '' }
    try {
      switch (n.kind) {
        case 'prompt': {
          buffer = substitute(n.params['text'] ?? '', inputs)
          entry.detail = `载入提示词 (${buffer.length} 字符)`
          break
        }
        case 'transform': {
          const op = n.params['op'] ?? 'append'
          const value = substitute(n.params['value'] ?? '', inputs)
          if (op === 'append') {
            buffer += value
            entry.detail = `追加 ${value.length} 字符`
          } else if (op === 'prepend') {
            buffer = value + buffer
            entry.detail = `前置 ${value.length} 字符`
          } else if (op === 'replace') {
            const search = n.params['search'] ?? ''
            if (!search) {
              buffer = value
              entry.detail = '整体替换'
            } else if (buffer.includes(search)) {
              buffer = buffer.split(search).join(value)
              entry.detail = `替换 "${search}"`
            } else {
              entry.status = 'skipped'
              entry.detail = `未找到 "${search}", 跳过`
            }
          } else {
            entry.status = 'error'
            entry.detail = `未知操作 "${op}"`
          }
          break
        }
        case 'tool': {
          const name = n.params['name'] ?? ''
          const resolved = env.resolve ? env.resolve(name) : null
          if (resolved) {
            entry.detail = `工具 "${name}" 已注册`
          } else {
            entry.status = 'skipped'
            entry.detail = `工具 "${name}" 未注册 (执行器仅校验)`
            break
          }
          if (env.executeTool) {
            entry.status = 'running'
            let args: Record<string, unknown> = {}
            const rawArgs = n.params['args'] ?? ''
            if (rawArgs.trim()) {
              try {
                // V4.1: substitute {{var}} placeholders before parsing so input
                // variables reach tool arguments, matching prompt/transform.
                const parsed: unknown = JSON.parse(substitute(rawArgs, inputs))
                if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  args = parsed as Record<string, unknown>
                } else {
                  entry.status = 'error'
                  entry.detail = `入参不是 JSON 对象: ${clip(rawArgs, 80)}`
                  break
                }
              } catch {
                entry.status = 'error'
                entry.detail = `入参不是合法 JSON: ${clip(rawArgs, 80)}`
                break
              }
            }
            const result = await env.executeTool(name, args)
            if (result.ok) {
              const value = typeof result.value === 'string' ? result.value : JSON.stringify(result.value)
              buffer += `\n\n[工具 ${name} 结果]\n${clip(value ?? '')}`
              entry.status = 'ok'
              entry.detail = `已调用 ${name} → ${clip(value ?? '(空结果)', 240)}`
            } else {
              entry.status = 'error'
              entry.detail = `调用失败: ${result.error ?? '未知错误'}`
            }
          }
          break
        }
        case 'skill': {
          const name = n.params['name'] ?? ''
          const skill = env.getSkill ? await env.getSkill(name) : undefined
          if (skill) {
            const body = (skill.body ?? '').slice(0, MAX_SKILL_BODY)
            buffer += `\n\n[技能 ${skill.name}]\n${skill.description}\n${body}`
            entry.detail = `已载入技能 "${skill.name}"${body ? ` (${body.length} 字符)` : ' (无正文)'}`
          } else {
            entry.status = 'skipped'
            entry.detail = `技能 "${name}" 未找到 (执行器仅校验)`
          }
          break
        }
        case 'output': {
          // V4.1: carry the full accumulated buffer so the panel can show it uncapped.
          entry.full = buffer
          entry.detail = `输出 ${buffer.length} 字符 (${n.params['format'] ?? 'text'}) — ${clip(buffer, 200)}`
          break
        }
      }
    } catch (error) {
      entry.status = 'error'
      entry.detail = error instanceof Error ? error.message : String(error)
    }
    logs.push(entry)
  }
  return logs
}

/**
 * Backwards-compatible dry run: execute the node list with no real hooks.
 * Kept for callers that only want structure validation.
 */
export function dryRunWorkflow(
  workflow: WorkflowDefinition,
  inputs: Record<string, string>,
  resolver: ToolResolver | null,
): Promise<WorkflowStepLog[]> {
  return executeWorkflow(workflow, inputs, {
    resolve: (name) => resolver?.resolve(name) ?? null,
  })
}

/** Replace {{key}} placeholders with provided inputs (missing keys stay). */
export function substitute(template: string, inputs: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => inputs[key] ?? `{{${key}}}`)
}
