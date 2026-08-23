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

| 能力 | V1 | V2(已实现) | V3(预留) |
|---|---|---|---|
| RAG | BM25 关键词检索 | 向量引擎(`engine: 'vector'`)与混合检索(`engine: 'hybrid'`,RRF 融合);OpenAI 兼容嵌入端点 | 本地嵌入(transformers.js)、重排模型 |
| 工作流 | 表单式节点 + 干运行 | 拖拽画布(@xyflow/react,拖拽排序 + 自动连线) | 分支/条件边 + LLM 运行时执行 |
| MCP | 配置 CRUD + 连接测试 | 启用即自动连接并把工具注册到 `ctx.tools`(`wb_mcp__` 前缀,effect-scoped 卸载) | 重连策略、工具调用审批联动 |
| 工具开关 | 本地关注偏好 | `ctx.tools.restrict({ deny })` 运行时对模型隐藏工具 | 会话级范围限制 |
| 技能开关 | 本地关注偏好 | 维持现状(无官方 unregister API) | 真实挂载/卸载 |

注意: 客户端 bundle 因内置 @xyflow/react 增大至约 351KB(88KB gzip);图编辑器按需由本插件打包,不额外请求外部资源。
