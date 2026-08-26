/**
 * Lightweight client i18n: the whole workbench follows the DSH web UI locale
 * (zh / en). A module-level dictionary + subscription keeps every component in
 * sync — the client entry seeds the language from ctx.locale and components
 * re-render via useLocale() whenever DSH's language switches.
 */
import React from 'react'

export type Lang = 'zh' | 'en'

type Dict = Record<string, string>

const zh: Dict = {
  // nav
  navRag: 'RAG', navTools: '工具', navSkills: '技能', navWorkflow: '工作流', navPrompt: 'Prompt',
  navMcp: 'MCP', navRagHint: '知识检索', navToolsHint: '工具注册表', navSkillsHint: 'SKILL.md', navWorkflowHint: '流程编排', navPromptHint: '提示词', navMcpHint: '外部服务',
  loading: '加载中…', waitingHost: '等待宿主数据…', hostUnreachable: '无法连接宿主服务: ', retry: '重试', session: '会话',

  // common
  ok: '保存', cancel: '取消', save: '保存', delete: '删除', add: '添加', edit: '编辑', run: '运行',
  name: '名称', description: '描述', test: '测试', enable: '启用', upload: '上传', rebuild: '重建索引',
  search: '检索', path: '路径', engine: '引擎', close: '关闭',

  // mechanism bar
  mech: '⚙️ 机制', restoreAll: '一键还原默认', restoreDomain: '还原该机制为 DSH 默认',
  mechActive: ' (工作台配置, 点击选择/还原)', mechDefault: ' (DSH 默认, 点击选择)',
  ragTitle: 'RAG · 知识检索', toolsTitle: '工具 · 可见性', skillsTitle: '技能 · 清单', workflowTitle: '工作流 · 执行',
  ragDefault: 'DSH 默认检索机制', ragDefaultDesc: '不注入任何内容, 保持 DSH 原有行为',
  ragCustom: '自定义检索', ragCustomDesc: '注入自定义检索参数(topK / 相似度阈值, 可在工作台 RAG 面板调整)',
  ragKb: '工作台知识库', ragKbDesc: '选择下方知识库后, 模型按该知识库检索 (workbench_search + kb_id)',
  ragTarget: '检索目标知识库:', ragTargetDefault: '默认语料目录',
  toolsDefault: '全部工具可见', toolsDefaultDesc: 'DSH 工具注册表全量对模型开放',
  toolsWorkbench: '按工作台配置过滤', toolsWorkbenchDesc: '对模型隐藏的工具不可调用 (restrict 生效)',
  skillsDefault: 'DSH 原生技能目录', skillsDefaultDesc: '技能由 DSH 注册表/预设决定',
  skillsWorkbench: '注入工作台技能清单', skillsWorkbenchDesc: '模型按工作台技能清单使用技能',
  wfDefault: 'DSH 原生工作流机制', wfDefaultDesc: '不注入工作流步骤',
  wfWorkbench: '按激活工作流执行', wfWorkbenchDesc: '注入激活工作流的名称与步骤, 模型严格按步骤执行',
  wfActive: '当前激活:',

  // prompt quick bar
  promptPicker: '🕘 提示词 · 最近使用', promptEmpty: '还没有使用过的提示词, 去工作台「📝 Prompt」面板选用模板。',
  promptClear: '取消生效', promptActive: '● 当前生效:', promptInjectedNote: '以上为模型每个步骤实际收到的注入内容(轨迹视图不显示系统提示词, 属 DSH 平台行为)。',
  promptTitle: '提示词', promptSwitch: '提示词: 切换最近使用 / 取消生效', promptPick: '提示词: 从最近使用中选择并生效',

  // rag panel
  kbSection: '知识库 (文件夹)', kbEmpty: '还没有知识库。把某个文件夹指定为知识库后, 模型可用 workbench_search 检索它。',
  kbAdd: '添加知识库 (指定一个文件夹):', kbName: '名称', kbPathPh: '文件夹绝对路径, 例如 D:\\docs\\kb1',
  kbUploadHint: '「上传文档」支持 .pdf / .txt / .md: 自动解析 → 按分块参数切割 → 存入该知识库并重建索引(向量引擎启用时自动向量化)。',
  kbSearchThis: '检索此库', kbUploaded: '已上传「{name}」到知识库「{kb}」: 解析 {chars} 字符, 切分 {chunks} 块, 索引已重建(向量引擎启用时自动向量化)',
  ragConfig: '检索配置', ragDefaultDir: '默认语料目录', ragDefaultDirPh: '留空使用默认 ~/.dsh/workbench/corpus',
  chunkSize: 'chunk 大小', overlap: '重叠度', topK: 'topK',
  engineBm25: 'BM25 关键词', engineVector: '向量 (需嵌入端点)', engineHybrid: '混合 (RRF 融合)',
  embedSection: '嵌入端点 (OpenAI 兼容 /embeddings):', embedBaseUrl: 'Base URL', embedKey: 'API Key',
  embedModel: '模型', embedKeyPh: 'sk-… (仅保存在本机设置)', embedBasePh: 'https://api.openai.com/v1', embedModelPh: 'text-embedding-3-small / bge-m3',
  saved: '配置已保存', rebuilt: '索引已重建',
  ragSearchTest: '检索测试', ragQueryPh: '输入检索关键词或问题…', noHits: '没有匹配结果', colScore: '得分', colFile: '文件', colSnippet: '片段',
  ragIndexStatus: '默认库索引:', chunksLabel: '个分块', vectorsLabel: '个向量', lastBuilt: '上次构建', neverBuilt: '未构建', buildMs: '耗时',
  kbCount: '个', ragEngineHint: 'bm25 内置零依赖; vector/hybrid 需配置嵌入端点(密钥仅发往该端点, 不离开本机)。语料支持 .md / .txt, 递归扫描。',
  kbMissing: '知识库需要名称与文件夹路径', kbAdded: '知识库已添加, 检索时自动建立索引', uploadOnly: '仅支持 .pdf / .txt / .md 文件', uploadFailed: '上传失败',

  // mcp panel
  mcpServers: 'MCP 服务器', mcpEmpty: '还没有配置 MCP 服务器, 在下方添加。', mcpAdd: '添加服务器',
  mcpTransport: '传输方式', mcpStdio: 'stdio (本地命令)', mcpHttp: 'http (远程 streamable HTTP)',
  mcpCommand: '命令', mcpArgs: '参数', mcpArgsPh: '每行一个参数', mcpEnv: '环境变量', mcpEnvPh: 'KEY=VALUE, 每行一个',
  mcpUrl: 'URL', mcpHeaders: 'Headers', mcpHeadersPh: 'Authorization=Bearer xxx, 每行一个',
  mcpNeedName: '请填写名称', mcpNeedUrl: 'http 服务器需要 url', mcpNeedCmd: 'stdio 服务器需要 command', mcpSaved: '服务器已保存',
  mcpConnected: '连接成功 · 工具:', mcpFailed: '连接失败:', mcpRunning: '● 运行中 · 已注册 {n} 个工具到 ctx.tools (wb_mcp__ 前缀)',
  mcpOffline: '● 未连接', mcpDisabled: ' (已禁用)', mcpPartial: '部分失败:', mcpNamePh: '例如: exa-search', mcpCmdPh: 'npx / node / uvx', mcpUrlPh: 'https://mcp.example.com/mcp',

  // workflow panel
  wfList: '工作流列表', wfEmpty: '暂无工作流。点「新建」或「恢复内置模板」。首次启动会自动创建内置模板。',
  wfRestore: '恢复内置模板', wfNew: '新建', wfEdit: '编辑:', wfGraphView: '🎨 拖拽画布', wfListView: '📋 列表视图',
  wfNodes: '节点', wfInOrder: '— 按顺序执行:', wfGraphHint: '— 用左侧面板添加节点, 画布内拖拽节点改变执行顺序(连线自动更新):',
  wfNodeEmpty: '还没有节点。', wfNodeEmptyGraph: '还没有节点, 用左侧面板添加。',
  wfAddNode: '添加节点:', wfNodeName: '节点名称', wfActivate: '激活', wfActivated: '● 激活中', wfActivateTitle: '设为模型执行的工作流(工作流机制开启时生效)',
  wfRun: '手动运行 (干运行)', wfInputVars: '输入变量', wfInputVarsPh: 'var=value, 每行一个; 对应节点里的 {var} 占位符',
  wfSteps: '共 {n} 步', wfStatusOk: 'ok', wfStatusSkip: '跳过', wfStatusErr: '错误', wfDetail: '详情', wfSaved: '工作流已保存', wfRestored: '内置模板已恢复',
  wfNewName: '新工作流', wfParamTextPh: '提示词正文, 支持 {var} 占位符', wfParamTransformPh: '变换: append 文本 / prepend 文本 / replace 旧->新',
  wfParamToolPh: '工具名, 例如 read_document', wfParamOutputPh: '输出格式, 例如 markdown',
  // V4: 双模式 + 真实执行
  wfMode: '模式', wfModeNodes: '节点模式', wfModeScript: '脚本模式 (DSH workflowEngine)',
  wfNodesHint: '节点按顺序执行; tool 节点真实调用、skill 节点载入技能正文。',
  wfScriptHint: 'JS 编排脚本, 子代理扇出 —— 与模型侧 workflow 工具一致。',
  wfScript: '编排脚本 (JS)', wfScriptPh: '顶层 await; 结尾 return <json>; 可用 agent() / pipeline() / parallel() / phase() / log() / args',
  wfMetaName: '脚本名 (kebab-case)', wfMetaDesc: '脚本描述', wfMetaPhases: '阶段 (逗号分隔)', wfMetaPhasesPh: '例如: 调研, 实现, 验证',
  wfScriptNote: '运行通过 DSH workflowEngine 在 worker 线程执行脚本, 以当前会话为父代理起子代理; 结果在完成后返回。',
  wfRunScript: '脚本运行', wfRunScriptBtn: '运行脚本', wfRunScriptNote: '整个脚本完成后返回 (agentsStarted + 结果 JSON)。',
  wfRealRun: '真实运行', wfRunNote: 'tool 节点真实调用 (以当前会话 agent 权限), skill 节点载入技能正文; 先保存再运行。',
  wfAgents: '子代理', wfStopReason: '结束原因', wfStatusRun: '运行中…',
  wfSelectTool: '选择工具…', wfSelectSkill: '选择技能…', wfArgsJson: '入参 JSON (可选), 如 {"path": "..."}',
  wfParamSkillPh: '技能名 (运行时从技能列表载入正文)',

  // skills panel
  skInstalled: '已安装技能', skEmpty: '当前会话没有可展示的技能。', skImport: '从本地导入 SKILL.md',
  skPath: '文件路径', skImportBtn: '导入', skPathPh: '例如 C:\\path\\to\\SKILL.md',
  skImported: '已导入 {name} → ~/.dsh/skills/', skFollow: '关注', skProvider: 'provider:', skWhenUse: '适用:',
  skImportNote: '导入会把文件复制到 ~/.dsh/skills/ 目录; 技能是否被会话加载取决于 DSH 技能文件系统的扫描配置。',

  // tools panel
  tlAll: '已注册工具 (DSH 全量)', tlEmpty: '当前没有可展示的工具。', tlHidden: '已隐藏', tlHide: '对模型隐藏',
  tlTest: '测试调用:', tlArgs: '入参 JSON', tlArgsPh: '{"key": "value"}', tlCall: '调用',
  tlPolicyNote: '仍受 DSH 工具策略/审批约束; 只读工具可直接调用。', tlSuccess: '调用成功', tlFailed: '调用失败: ',
  tlSchema: '查看入参 schema', tlNote: '这里展示 DSH 工具注册表中的全部工具(含被本工作台隐藏的); 隐藏工具仍可在此取消隐藏恢复。「测试调用」对被隐藏工具同样可用。',
  tlHiddenBadge: '⛔ 已隐藏', tlCount: '个 · 已隐藏 {n} 个', tlJsonErr: '入参不是合法 JSON', tlMissing: '工具 "{name}" 未注册',

  // prompt panel
  ppTemplates: '提示词模板', ppRecent: '🕘 最近使用', ppRecentHint: '最近 3 个', ppRecentTip: '点击一键切换为生效提示词(计入最近使用)。',
  ppRestore: '恢复内置模板', ppNew: '新建', ppEdit: '编辑模板:', ppBody: '正文', ppBodyPh: '支持 {var} 占位符, 如 {role} / {topic}',
  ppPreviewVars: '预览变量', ppPreviewVarsPh: 'var=value, 逗号分隔', ppPreview: '渲染效果预览:', ppEmpty: '(空)',
  ppActive: '● 生效中', ppSwitch: '切换生效', ppActivated: '已切换生效提示词 (下一个模型步骤生效)', ppRestored: '已恢复内置领域模板 (软件工程/代码审查/翻译/数据分析等)',
  ppNeedName: '请填写名称', ppSaved: '模板已保存', ppNewName: '新模板', ppPlaceholderNote: '占位符将在预览与注入时替换。',
}

const en: Dict = {
  navRag: 'RAG', navTools: 'Tools', navSkills: 'Skills', navWorkflow: 'Workflow', navPrompt: 'Prompt',
  navMcp: 'MCP', navRagHint: 'Retrieval', navToolsHint: 'Tool registry', navSkillsHint: 'SKILL.md', navWorkflowHint: 'Orchestration', navPromptHint: 'Prompts', navMcpHint: 'External services',
  loading: 'Loading…', waitingHost: 'Waiting for host data…', hostUnreachable: 'Cannot reach host service: ', retry: 'Retry', session: 'Session',

  ok: 'Save', cancel: 'Cancel', save: 'Save', delete: 'Delete', add: 'Add', edit: 'Edit', run: 'Run',
  name: 'Name', description: 'Description', test: 'Test', enable: 'Enable', upload: 'Upload', rebuild: 'Rebuild index',
  search: 'Search', path: 'Path', engine: 'Engine', close: 'Close',

  mech: '⚙️ Mechanisms', restoreAll: 'Restore defaults', restoreDomain: 'Restore this mechanism to DSH default',
  mechActive: ' (workbench config, click to pick/restore)', mechDefault: ' (DSH default, click to pick)',
  ragTitle: 'RAG · Retrieval', toolsTitle: 'Tools · Visibility', skillsTitle: 'Skills · Catalog', workflowTitle: 'Workflow · Execution',
  ragDefault: 'DSH default retrieval', ragDefaultDesc: 'No injection; DSH behavior unchanged',
  ragCustom: 'Custom retrieval', ragCustomDesc: 'Injects custom retrieval params (topK / similarity threshold, adjustable in the RAG panel)',
  ragKb: 'Workbench knowledge base', ragKbDesc: 'Pick a KB below; the model then retrieves from it (workbench_search + kb_id)',
  ragTarget: 'Retrieval target KB:', ragTargetDefault: 'Default corpus dir',
  toolsDefault: 'All tools visible', toolsDefaultDesc: 'Full DSH tool registry open to the model',
  toolsWorkbench: 'Filter by workbench config', toolsWorkbenchDesc: 'Tools hidden from the model are not callable (restrict active)',
  skillsDefault: 'DSH native skill catalog', skillsDefaultDesc: 'Skills decided by the DSH registry/presets',
  skillsWorkbench: 'Inject workbench skill list', skillsWorkbenchDesc: 'Model uses skills from the workbench list',
  wfDefault: 'DSH native workflow', wfDefaultDesc: 'No workflow steps injected',
  wfWorkbench: 'Follow the active workflow', wfWorkbenchDesc: 'Injects the active workflow name & steps; the model follows them strictly',
  wfActive: 'Active:',

  promptPicker: '🕘 Prompts · Recent', promptEmpty: 'No recently used prompts yet — pick a template in the Workbench "📝 Prompt" panel.',
  promptClear: 'Deactivate', promptActive: '● Active:', promptInjectedNote: 'This is what the model actually receives each step (the trajectory view does not show system prompts — that is DSH platform behavior).',
  promptTitle: 'Prompts', promptSwitch: 'Prompt: switch recent / deactivate', promptPick: 'Prompt: pick one of the recent prompts',

  kbSection: 'Knowledge bases (folders)', kbEmpty: 'No knowledge bases yet. Point a folder at a KB and the model can retrieve it with workbench_search.',
  kbAdd: 'Add knowledge base (point at a folder):', kbName: 'Name', kbPathPh: 'Absolute folder path, e.g. D:\\docs\\kb1',
  kbUploadHint: '"Upload document" supports .pdf / .txt / .md: parse → chunk → store into the KB and rebuild its index (auto-vectorized when a vector engine is configured).',
  kbSearchThis: 'Search this KB', kbUploaded: 'Uploaded "{name}" to KB "{kb}": parsed {chars} chars, split into {chunks} chunks; index rebuilt (vectorized when vector engine is on)',
  ragConfig: 'Retrieval config', ragDefaultDir: 'Default corpus dir', ragDefaultDirPh: 'Leave empty to use ~/.dsh/workbench/corpus',
  chunkSize: 'Chunk size', overlap: 'Overlap', topK: 'topK',
  engineBm25: 'BM25 keyword', engineVector: 'Vector (needs embeddings)', engineHybrid: 'Hybrid (RRF fusion)',
  embedSection: 'Embeddings endpoint (OpenAI-compatible /embeddings):', embedBaseUrl: 'Base URL', embedKey: 'API Key',
  embedModel: 'Model', embedKeyPh: 'sk-… (stored locally only)', embedBasePh: 'https://api.openai.com/v1', embedModelPh: 'text-embedding-3-small / bge-m3',
  saved: 'Config saved', rebuilt: 'Index rebuilt',
  ragSearchTest: 'Search test', ragQueryPh: 'Type a query…', noHits: 'No matches', colScore: 'Score', colFile: 'File', colSnippet: 'Snippet',
  ragIndexStatus: 'Default KB index:', chunksLabel: 'chunks', vectorsLabel: 'vectors', lastBuilt: 'built', neverBuilt: 'never built', buildMs: 'took',
  kbCount: 'KB(s)', ragEngineHint: 'BM25 is built-in & zero-dep; vector/hybrid need an embeddings endpoint (the key only goes to that endpoint). Corpus supports .md / .txt, scanned recursively.',
  kbMissing: 'KB needs a name and a folder path', kbAdded: 'KB added; index is built on first search', uploadOnly: 'Only .pdf / .txt / .md are supported', uploadFailed: 'Upload failed',

  mcpServers: 'MCP servers', mcpEmpty: 'No MCP servers configured yet — add one below.', mcpAdd: 'Add server',
  mcpTransport: 'Transport', mcpStdio: 'stdio (local command)', mcpHttp: 'http (remote streamable HTTP)',
  mcpCommand: 'Command', mcpArgs: 'Args', mcpArgsPh: 'one arg per line', mcpEnv: 'Env vars', mcpEnvPh: 'KEY=VALUE, one per line',
  mcpUrl: 'URL', mcpHeaders: 'Headers', mcpHeadersPh: 'Authorization=Bearer xxx, one per line',
  mcpNeedName: 'A name is required', mcpNeedUrl: 'HTTP servers need a url', mcpNeedCmd: 'stdio servers need a command', mcpSaved: 'Server saved',
  mcpConnected: 'Connected · tools:', mcpFailed: 'Connection failed:', mcpRunning: '● Running · registered {n} tools on ctx.tools (wb_mcp__ prefix)',
  mcpOffline: '● Offline', mcpDisabled: ' (disabled)', mcpPartial: 'Partial failure:', mcpNamePh: 'e.g. exa-search', mcpCmdPh: 'npx / node / uvx', mcpUrlPh: 'https://mcp.example.com/mcp',

  wfList: 'Workflows', wfEmpty: 'No workflows yet — click "New" or "Restore templates". Built-in templates are seeded on first boot.',
  wfRestore: 'Restore templates', wfNew: 'New', wfEdit: 'Edit:', wfGraphView: '🎨 Drag canvas', wfListView: '📋 List view',
  wfNodes: 'Nodes', wfInOrder: '— run in order:', wfGraphHint: '— add nodes from the left panel; drag nodes on the canvas to change order (edges update live):',
  wfNodeEmpty: 'No nodes yet.', wfNodeEmptyGraph: 'No nodes yet — add them from the left panel.',
  wfAddNode: 'Add node:', wfNodeName: 'Node name', wfActivate: 'Activate', wfActivated: '● Active', wfActivateTitle: 'Set as the workflow the model executes (effective when the workflow mechanism is on)',
  wfRun: 'Manual run (dry-run)', wfInputVars: 'Input variables', wfInputVarsPh: 'var=value, one per line; matches {var} placeholders in nodes',
  wfSteps: '{n} steps', wfStatusOk: 'ok', wfStatusSkip: 'skipped', wfStatusErr: 'error', wfDetail: 'Detail', wfSaved: 'Workflow saved', wfRestored: 'Built-in templates restored',
  wfNewName: 'New workflow', wfParamTextPh: 'Prompt body, supports {var} placeholders', wfParamTransformPh: 'transform: append text / prepend text / replace old->new',
  wfParamToolPh: 'Tool name, e.g. read_document', wfParamOutputPh: 'Output format, e.g. markdown',
  // V4: dual mode + real execution
  wfMode: 'Mode', wfModeNodes: 'Node mode', wfModeScript: 'Script mode (DSH workflowEngine)',
  wfNodesHint: 'Nodes run in order; tool nodes really call tools, skill nodes load the skill body.',
  wfScriptHint: 'JS orchestration script, subagent fan-out — same as the model-facing workflow tool.',
  wfScript: 'Orchestration script (JS)', wfScriptPh: 'top-level await; end with return <json>; hooks: agent() / pipeline() / parallel() / phase() / log() / args',
  wfMetaName: 'Script name (kebab-case)', wfMetaDesc: 'Script description', wfMetaPhases: 'Phases (comma separated)', wfMetaPhasesPh: 'e.g. research, implement, verify',
  wfScriptNote: 'Runs through the DSH workflowEngine on a worker thread, spawning subagents under the current session; returns when the whole script settles.',
  wfRunScript: 'Script run', wfRunScriptBtn: 'Run script', wfRunScriptNote: 'Returns when the whole script finishes (agentsStarted + result JSON).',
  wfRealRun: 'Real run', wfRunNote: 'tool nodes really call tools (as the current session agent), skill nodes load the skill body; save before running.',
  wfAgents: 'Subagents', wfStopReason: 'Stop reason', wfStatusRun: 'running…',
  wfSelectTool: 'Pick a tool…', wfSelectSkill: 'Pick a skill…', wfArgsJson: 'Args JSON (optional), e.g. {"path": "..."}',
  wfParamSkillPh: 'Skill name (body loaded from the skill list at runtime)',

  skInstalled: 'Installed skills', skEmpty: 'No skills to show in this session.', skImport: 'Import a local SKILL.md',
  skPath: 'File path', skImportBtn: 'Import', skPathPh: 'e.g. C:\\path\\to\\SKILL.md',
  skImported: 'Imported {name} → ~/.dsh/skills/', skFollow: 'Follow', skProvider: 'provider:', skWhenUse: 'When to use:',
  skImportNote: 'Import copies the file into ~/.dsh/skills/; whether a session loads it depends on DSH\'s skill-filesystem scan config.',

  tlAll: 'Registered tools (all DSH)', tlEmpty: 'No tools to show.', tlHidden: 'hidden', tlHide: 'Hide from model',
  tlTest: 'Test call:', tlArgs: 'Args (JSON)', tlArgsPh: '{"key": "value"}', tlCall: 'Call',
  tlPolicyNote: 'Still subject to DSH tool policy/approval; read-only tools can be called directly.', tlSuccess: 'Call succeeded', tlFailed: 'Call failed: ',
  tlSchema: 'View args schema', tlNote: 'All tools from the DSH registry (including ones hidden by this workbench); hidden tools can be restored here. "Test call" works on hidden tools too.',
  tlHiddenBadge: '⛔ hidden', tlCount: 'total · {n} hidden', tlJsonErr: 'Args are not valid JSON', tlMissing: 'Tool "{name}" is not registered',

  ppTemplates: 'Prompt templates', ppRecent: '🕘 Recent', ppRecentHint: 'latest 3', ppRecentTip: 'Click to activate it (counts toward recent).',
  ppRestore: 'Restore templates', ppNew: 'New', ppEdit: 'Edit template:', ppBody: 'Body', ppBodyPh: 'Supports {var} placeholders, e.g. {role} / {topic}',
  ppPreviewVars: 'Preview vars', ppPreviewVarsPh: 'var=value, comma separated', ppPreview: 'Rendered preview:', ppEmpty: '(empty)',
  ppActive: '● active', ppSwitch: 'Activate', ppActivated: 'Active prompt switched (effective next model step)', ppRestored: 'Built-in domain templates restored (software eng / code review / translation / data analysis…)',
  ppNeedName: 'A name is required', ppSaved: 'Template saved', ppNewName: 'New template', ppPlaceholderNote: 'Placeholders are substituted in preview and on injection.',
}

let lang: Lang = 'zh'
const listeners = new Set<() => void>()

export function setLang(next: Lang): void {
  if (next === lang) return
  lang = next
  for (const fn of listeners) fn()
}

export function getLang(): Lang {
  return lang
}

/** Translate a key; unknown keys fall back to Chinese, then to the key itself. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const dict = lang === 'zh' ? zh : en
  let text = dict[key] ?? zh[key] ?? key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v))
  }
  return text
}

/** Re-render the calling component whenever the workbench language changes. */
export function useLocale(): Lang {
  const [, force] = React.useReducer((x: number) => x + 1, 0)
  React.useEffect(() => {
    listeners.add(force)
    return () => {
      listeners.delete(force)
    }
  }, [])
  return lang
}

/** Minimal face of the client locale service we consume. */
export interface LocaleServiceLike {
  getLocale(): { active: string }
  subscribe(fn: () => void): () => void
}

/** Sync the workbench language with the DSH web UI locale. */
export function syncWithDshLocale(locale: LocaleServiceLike | undefined): (() => void) | undefined {
  if (!locale) return undefined
  const apply = () => {
    try {
      setLang(locale.getLocale().active.toLowerCase().startsWith('zh') ? 'zh' : 'en')
    } catch {
      // ignore
    }
  }
  apply()
  return locale.subscribe(apply)
}
