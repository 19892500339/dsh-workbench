# dsh-workbench 架构

```
┌──────────────────────────── 浏览器 (Web) ────────────────────────────┐
│  对话标签栏: [ Chat ] [ Trajectory ] [ 工作台 ← conversation.view ]   │
│                                 │                                    │
│                        WorkbenchView (六大模块导航)                   │
│        RAG · MCP · 工作流 · 技能 · 工具 · Prompt 可视化面板           │
│                                 │                                    │
│               fetch POST /workbench/api/<method>                     │
│               {ok, value} 信封 · 同源校验                            │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │ (webServer 前缀路由)
┌─────────────────────────────────┴────────────────────────────────────┐
│  Node 宿主 (cordis plugin row: workbench)                            │
│                                                                      │
│  ┌───────────┐  ┌──────────┐  ┌─────────────┐  ┌──────────────────┐ │
│  │ api.ts    │  │ search.ts│  │ mcp.ts      │  │ workflow.ts      │ │
│  │ RPC 分发  │  │ BM25     │  │ SDK 握手测试 │  │ 模板 + 干运行     │ │
│  └─────┬─────┘  └────┬─────┘  └──────┬──────┘  └────────┬─────────┘ │
│        │             │               │                   │          │
│        └─────────────┴───────┬───────┴───────────────────┘          │
│                    WorkbenchRuntime (状态变更入口)                   │
│                              │                                      │
│              ┌───────────────┼────────────────┐                     │
│              ▼               ▼                ▼                     │
│      ctx.settings      ctx.tools      ctx.systemPrompt             │
│      (持久化 yaml)     (workbench_search)  (activePrompt 注入)      │
│      ctx.skills (展示)   ctx.webServer (路由)                       │
└─────────────────────────────────────────────────────────────────────┘
```

## 双入口打包

- `src/index.ts` → `lib/index.js`(ESM, Node,`dsh.bundle.patch` 挂载为 cordis 行)
- `src/client/index.tsx` → `lib/client.js`(`window.__ModuleLoader__.load({ id: 'dsh-workbench', factory })`,浏览器 module-loader 格式)

## 持久化模型

所有用户配置收敛在 `settings` 服务的一个命名空间 `workbench`(schemastery schema 校验):
`rag` / `mcpServers` / `workflows` / `prompts` + `activePromptId` / `toolToggles` / `skillToggles`。
读写带 `revision` 守卫,避免并发覆盖。

## V1 / V2 边界

| 能力 | V1(本版本) | V2(预留) |
|---|---|---|
| RAG | BM25 关键词检索 | 向量引擎(`engine: 'vector'` 接口已预留) |
| 工作流 | 表单式节点 + 干运行 | 拖拽图(@xyflow/react)+ LLM 运行时执行 |
| MCP | 配置 CRUD + 连接测试 | 自动注册工具到 `ctx.tools`(交给官方 dsh-mcp-client) |
| 技能/工具开关 | 工作台本地关注偏好 | 运行时真实挂载/卸载 |
