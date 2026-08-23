/**
 * Workflow orchestration, V1: form-based node lists with a deterministic
 * dry-run runner.
 *
 * Agreed scope: nodes are added/reordered/removed through the panel's forms
 * (no graph editor yet — that is a V2 candidate with @xyflow/react). "Run"
 * executes a dry-run trace: transform nodes really apply to a text buffer so
 * the user sees step-by-step logs, tool nodes resolve against the registry
 * without executing, and LLM-driven execution is a documented V2 extension.
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
  ]
}

function node(id: string, kind: WorkflowNode['kind'], label: string, params: Record<string, string>): WorkflowNode {
  return { id, kind, label, params }
}

export interface ToolResolver {
  /** Resolve a tool name to a short descriptor, or null. */
  resolve(name: string): { name: string; description: string } | null
}

/**
 * Execute a deterministic dry-run trace of one workflow.
 * @param resolver - registry accessor (null means tools are unresolved).
 */
export function dryRunWorkflow(
  workflow: WorkflowDefinition,
  inputs: Record<string, string>,
  resolver: ToolResolver | null,
): WorkflowStepLog[] {
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
              entry.detail = `整体替换`
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
          const resolved = resolver?.resolve(name) ?? null
          if (resolved) {
            entry.detail = `工具 "${name}" 已注册, 干运行不执行`
          } else {
            entry.status = 'skipped'
            entry.detail = `工具 "${name}" 未注册(干运行仅校验)`
          }
          break
        }
        case 'output': {
          entry.detail = `输出 ${buffer.length} 字符 (${n.params['format'] ?? 'text'})`
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

/** Replace {{key}} placeholders with provided inputs (missing keys stay). */
export function substitute(template: string, inputs: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => inputs[key] ?? `{{${key}}}`)
}
