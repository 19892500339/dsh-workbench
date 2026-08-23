# dsh-workbench

> 智能体能力可视化编排工作台 · DeepSeek Harness 混合型插件(客户端 UI + 服务端工具)

在对话标签栏的 **Chat / Trajectory** 之后新增一个「**工作台**」页签,把智能体的六大能力——**RAG / MCP / 工作流 / 技能 / 工具 / Prompt**——做成可视化、可动态增删改的编排面板;并注册 `workbench_search` 知识检索工具供模型调用。

## ✨ 功能总览

| 模块 | 可视化操作 | 对应 DSH 机制 |
|---|---|---|
| 📚 RAG | 语料目录 / 分块参数 / 引擎选择(**bm25 \| vector \| hybrid**)/ 嵌入端点配置(OpenAI 兼容)/ 重建索引 / 检索测试 | 内置 BM25 + 原创向量引擎(RRF 混合)+ `workbench_search` 工具 |
| 🔌 MCP | 增删 MCP server(`url` 或 `command`/`args`/`env`/`headers`)/ 启用禁用 / 连接测试 / **启用即自动注册 `wb_mcp__*` 工具到 ctx.tools** | `@modelcontextprotocol/sdk` 动态连接 + `ctx.tools.register`(与官方 `mcp__*` 桥共存) |
| 🔄 工作流 | 内置模板(简历撰写、招聘筛选…)/ **@xyflow/react 拖拽画布排序连线** / 表单式节点编辑 / 手动干运行 + 逐步日志 | 确定性 dry-run 执行器;LLM 运行时执行留待 V3 |
| 🧩 技能 | 查看已安装技能(触发条件、描述)/ 从本地 `SKILL.md` 导入 / 关注开关 | `ctx.skills` 注册表展示 + `~/.dsh/skills/` 导入 |
| 🛠️ 工具 | 查看已注册工具与入参 schema / 传参测试调用 / **「对模型隐藏」运行时开关** | `ctx.tools` 注册表 + `ctx.tools.restrict({ deny })` 立即影响模型可见性 |
| 📝 Prompt | 模板 CRUD / `{{变量}}` 占位符预览 / 切换生效提示词 | `systemPrompt.variable('workbench_active_prompt')`,下一模型步骤生效 |

所有配置持久化到宿主 `settings` 服务(默认落盘 `~/.dsh/settings.yaml`),重启不丢。

> **V2 亮点**: 工作流拖拽画布、RAG 向量/混合检索(自配 OpenAI 兼容嵌入端点)、MCP 服务器启用即把工具注册进 `ctx.tools`、工具面板可实时对模型隐藏工具。

## 🚀 安装

```sh
# 方式一: 从 npm 安装(发布后)
dsh plugin --profile web add dsh-workbench

# 方式二: 从 GitHub 安装
dsh plugin --profile web add git+https://github.com/19892500339/dsh-workbench.git

# 方式三: 本地开发
cd dsh-workbench && npm install && npm run build
dsh plugin --profile web add link:<本仓库绝对路径>
```

装完后**硬刷新浏览器**(`Ctrl/Cmd + Shift + R`),标签栏即可看到「工作台」。

> 首次启动会自动写入三套内置工作流模板(简历撰写 / 招聘筛选 / 通用问答),可在面板中删除后一键恢复。

## 🗂️ 仓库结构

```
dsh-workbench/
├── package.json            # exports + dsh.bundle.patch + dsh.client 双入口声明
├── cordis.patch.yml        # 宿主行插入(bundle patch)
├── tsconfig*.json / tsdown.config.ts
├── src/
│   ├── index.ts            # 宿主入口: 工具 + systemPrompt + RPC + settings
│   ├── config.ts           # settings 命名空间 schema(schemastery)
│   ├── search.ts           # BM25 轻量检索引擎(零依赖)
│   ├── mcp.ts              # MCP server 连接测试(@modelcontextprotocol/sdk)
│   ├── workflow.ts         # 工作流模板 + 干运行执行器
│   ├── api.ts              # /workbench/api 前缀路由(同源校验 + {ok,value} 信封)
│   ├── shared/types.ts     # 双端共享 JSON 类型
│   └── client/
│       ├── index.tsx       # 客户端入口: 注入 conversation.view 页签
│       ├── WorkbenchView.tsx
│       ├── api.ts / ui.tsx
│       └── modules/        # 六大模块面板
└── tests/                  # node --test 单测(BM25 引擎)
```

## 🏗️ 构建

```sh
npm install
npm run build      # tsc 类型声明(lib/types) + tsdown 双产物(lib/index.js + lib/client.js)
npm test           # 引擎单测
```

客户端产物为 DSH web module-loader 格式(`window.__ModuleLoader__.load({ id: 'dsh-workbench', factory })`),与官方/社区插件一致。

## 🔌 服务端工具

`workbench_search`(模型可调用):

```jsonc
{
  "query": "检索关键词或问题",   // 必填
  "top_k": 5                     // 可选, 默认取工作台配置
}
```

返回按 BM25 相关性排序的 `{ score, file, chunkIndex, snippet }` 数组。语料默认目录 `~/.dsh/workbench/corpus`(递归扫描 `.md` / `.txt`),可在面板中修改。

## 📡 Client→Host RPC

面板通过 `/workbench/api/<method>` 前缀路由与宿主通信(同源校验,`{ok,value}` 信封),方法包括:`state.get / state.update / rag.rebuild / rag.search / mcp.test|save|remove|toggle / workflow.save|remove|run|templates / tool.test / skill.import / prompt.save|remove|activate`。

## 🧭 与生态的关系(为什么值得存在)

调研自 [awesome-dsh-plugins](https://github.com/oslook/awesome-dsh-plugins) 等清单,DSH 生态已有各能力的单点实现(如知识库 [dsh-kb-sieve](https://github.com/omdsh-dev/dsh-kb-sieve)、MCP 桥接 [dsh-exa-mcp](https://github.com/MicroHEROX/dsh-exa-mcp)、技能管理 [dsh-skill-manager](https://github.com/JimmyJin2006/dsh-skill-manager) 等),但**没有把六大能力收进一个对话页签做统一可视化编排**的产品——这正是本插件的位置。同名项目 [deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin) 是 IDE 风格三栏工作台(编辑器/终端/Git),定位互补,不冲突。

## 🧾 许可与合规

- 本仓库代码为**原创实现**,采用 [MIT](./LICENSE) 许可。
- 不粘贴任何第三方项目代码;参照开源项目(如 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)、官方 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 及其 ui-trajectory)仅学习接口契约与构建管线,并在源码注释中注明出处。
- 运行时依赖仅在 `package.json` 声明:`@modelcontextprotocol/sdk`(MIT)、`@deepseek-ai/*`(官方包,MIT)、`react` 等。
- 上架 GitHub 前请将 `package.json` 的 `repository.url` 改为你自己的仓库地址。

## 🚨 开发注意事项(务必遵守)

- `systemPrompt.variable(name)` 的变量名必须匹配 `/^[a-z][a-z0-9_]*$/`(小写 snake_case,禁止点号/大写/连字符);`systemPrompt.section(name)` 允许冒号,两者规则不同。
- 历史报错与完整规则见 [docs/ERROR-FIX-LOG.md](./docs/ERROR-FIX-LOG.md)。
