# dsh-workbench

<div align="left">

**🌐 语言 / Language:** [中文](README.zh.md) · [English](README.md)

[![中文](https://img.shields.io/badge/Language-中文-red.svg)](README.zh.md) [![English](https://img.shields.io/badge/Language-English-blue.svg)](README.md)

</div>

> 智能体能力可视化编排工作台 · DeepSeek Harness 混合型插件(客户端 UI + 服务端工具)

在对话标签栏的 **Chat / Trajectory** 之后新增一个「**工作台 / Workbench**」页签,把智能体的六大能力——**RAG / MCP / 工作流 / 技能 / 工具 / Prompt**——做成可视化、可动态增删改的编排面板;并在对话输入框内提供「**机制开关**」,可随时用工作台配置**暂时替换** DSH 的对应机制,一键还原。

插件界面**跟随 DSH 的界面语言自动切换**(中文 / English)。

---

## ✨ 功能总览

| 模块 | 可视化操作 | 对应 DSH 机制 |
|---|---|---|
| 📚 RAG | 多知识库(文件夹)/ 上传文档(pdf·txt·md)/ 分块参数 / 引擎(**bm25 \| vector \| hybrid**)/ 嵌入端点 / 按库重建与检索 | 内置 BM25 + 原创向量引擎(RRF 混合)+ `workbench_search` 工具(支持 `kb_id`) |
| 🔌 MCP | 增删 MCP server(`url` 或 `command`/`args`/`env`/`headers`)/ 启用禁用 / 连接测试 / 启用即自动注册 `wb_mcp__*` 工具到 ctx.tools | `@modelcontextprotocol/sdk` 动态连接 + `ctx.tools.register`(与官方 `mcp__*` 桥共存) |
| 🔄 工作流 | 内置模板 / **LogicFlow 拖拽画布**(全屏、实时重排连线)/ 表单式节点编辑 / 手动干运行 + 逐步日志 | 确定性 dry-run 执行器;LLM 运行时执行留待 V3 |
| 🧩 技能 | 查看已安装技能 / 从本地 `SKILL.md` 导入 / 关注开关 | `ctx.skills` 注册表展示 + `~/.dsh/skills/` 导入 |
| 🛠️ 工具 | **显示 DSH 全量工具**(含已隐藏)/ 传参测试调用 / 「对模型隐藏」运行时开关 | `ctx.tools` 注册表 + `ctx.tools.restrict({ deny })` 即时影响模型可见性 |
| 📝 Prompt | 内置 8 套领域模板 / 模板 CRUD / `{{变量}}` 预览 / 切换生效 / 输入框 📝 弹层(最近 3 个 + 取消 + 注入预览) | 宿主动态 section `workbench:active-prompt` 注入(未激活不占上下文) |
| 📇 代码索引 | **每个代码目录维护 `.workbench/` 索引**(功能块 → 文件 + 起始/结束行 + 功能注释),时间戳快照 + `latest.md` 指针;`workbench_code_index` 扫描/提交注释,`workbench_code_locate` 直达代码行 | 宿主工具(模型驱动): 改码后自动建索引,写码前先定位再按行读取,**避免整文件重复扫描,大幅省 token** |

**机制开关(输入框内)**:📚 RAG(默认/自定义/指定知识库)· 🛠️ 工具(默认全量/按隐藏过滤)· 🧩 技能(原生/注入清单)· 🔄 工作流(原生/按激活执行),以及「一键还原默认」。

所有配置持久化到宿主 `settings` 服务(默认落盘 `~/.dsh/settings.yaml`),重启不丢。

---

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

装完后**硬刷新浏览器**(`Ctrl/Cmd + Shift + R`),标签栏出现「工作台」,输入框工具行出现 📚🛠️🧩🔄📝 图标。

---

## 📚 教程

### 0. 认识界面

- **对话标签栏**:`[Chat] [Trajectory] [工作台]`——点「工作台」进入六大模块面板(左侧导航)。
- **输入框工具行**:`[📎] [🎤] [📚] [🛠️] [🧩] [🔄] [📝]`——前四个是**机制开关**(点击弹出选择面板),📝 是**提示词弹层**(最近使用 3 个)。
- **输入框下方**:工作台最近使用的提示词相关提示。

### 1. RAG 知识库(检索)

1. 打开「工作台 → RAG」。
2. **添加知识库**:填名称 + 一个文件夹绝对路径,点「添加」;该文件夹里的 `.md / .txt` 会被递归扫描。
3. **上传文档**:知识库行点「上传文档」,选择 `.pdf / .txt / .md`——自动解析、按分块参数切割、写入该知识库并**立即重建索引**。
4. **向量检索(可选)**:在「检索配置」把引擎切到 `vector` 或 `hybrid`,填嵌入端点(任意 OpenAI 兼容 `/embeddings`,如 OpenAI / DeepSeek / SiliconFlow),保存并「重建索引」——上传的文档会被向量化,成为**向量知识库**。
5. **检索测试**:输入关键词/问题,选知识库,点「检索」看命中。
6. **让模型用它**:输入框点 📚 → 选「工作台知识库」→ 勾选目标库(或「默认语料目录」)→ 发消息,模型会调用 `workbench_search` 并带上 `kb_id` 检索该库。

> 模型工具 `workbench_search` 参数:`query`(必填)、`top_k`、`kb_id`(指定知识库)。

### 2. MCP 外部服务

1. 「工作台 → MCP」→「添加服务器」:填名称,选传输方式(stdio 本地命令 / http 远程)。
2. stdio:填命令(如 `npx`)+ 参数 + 环境变量;http:填 URL + Headers。
3. 保存后「启用」:宿主自动连接并**把工具注册进 ctx.tools**(前缀 `wb_mcp__`,与官方 `mcp__` 桥共存);「测试」可单独做握手。
4. 启用后,工具会出现在「工作台 → 工具」列表里,模型可直接调用。

### 3. 工作流编排(LogicFlow 画布)

1. 「工作台 → 工作流」:首次启动已内置模板(简历撰写/招聘筛选/通用问答),也可「恢复内置模板」或「新建」。
2. 选中一条工作流 →「🎨 拖拽画布」:左侧面板点「+ 提示词 / + 文本变换 / + 工具 / + 输出」添加节点;画布内**拖拽节点改变执行顺序**,连线自动更新;**⛶ 全屏**按钮可全屏编排。
3. 「手动运行 (干运行)」:填输入变量(`var=value`)→ 运行,查看逐步日志。
4. 点某条工作流的「**激活**」,再在输入框点 🔄 →「按激活工作流执行」,模型下一个步骤起严格按该工作流执行。

### 4. 技能

- 「工作台 → 技能」:查看当前已安装技能(名称/描述/触发条件)。
- **导入**:填本地 `SKILL.md` 路径 → 导入到 `~/.dsh/skills/`。
- 输入框 🧩 →「注入工作台技能清单」:模型按工作台清单使用技能。

### 5. 工具

- 「工作台 → 工具」:**DSH 全量工具**(内置 + `wb_mcp__*` + 其它插件),显示总数与已隐藏数。
- **测试调用**:点工具名 → 填 JSON 入参 → 调用,查看返回(仍受 DSH 工具策略/审批约束)。
- **对模型隐藏**:勾选后该工具从模型可见集移除(需「工具」机制开关为工作台模式),取消勾选恢复。

### 6. Prompt 提示词

1. 「工作台 → Prompt」:内置 8 套领域模板(软件工程/代码审查/翻译/数据分析/产品/学习/营销/通用);可新建/编辑/删除,`{{var}}` 占位符可预览替换。
2. **切换生效**:点「切换生效」(或输入框 📝 弹层选最近使用)→ 下一个模型步骤起,模型系统提示词注入:
   ```
   【生效提示词: 名称】(以下为当前必须严格遵守的指令…)
   模板正文({{var}} 已转义为 {var})
   ```
3. **取消生效**:📝 弹层点「取消生效」。
4. **验证生效**:📝 弹层打开即显示「当前生效」注入预览(与模型实际收到的一致)。注意:DSH **轨迹视图不显示系统提示词**(平台机制),请以弹层预览与模型行为为准。

### 7. 机制开关(替换 / 还原)

- 每个机制默认 = **DSH 原有行为**(不注入)。
- 点击输入框图标弹出选择面板,选「工作台」即**替换**:宿主用 `systemPrompt.section` 注入机制说明,模型每一步都能读到。
- 面板内「还原该机制为 DSH 默认」或顶部「一键还原默认」可完全恢复(同时清空工具/技能隐藏配置)。

### 8. FAQ

- **提示词选了但模型没反应?** 注入发生在**下一个模型步骤**,请先发一条新消息;并确认 📝 弹层显示「当前生效」。
- **轨迹里看不到提示词?** DSH 平台不把系统提示词写入轨迹事件,属正常;以 📝 弹层预览为准。
- **界面语言?** 跟随 DSH 的 zh/en 自动切换,无需设置。
- **上传大文件?** 单文件 ≤20MB。

### 9. 代码索引(.workbench)——让模型直达代码,省 token

> 每个代码目录维护自己的 `.workbench/` 文件夹,里面是按时间戳命名的索引快照 + 永远最新的 `latest.md`。功能块记录「文件 + 起始行/结束行 + 功能注释」,模型写代码时**检索索引直达代码行**,不用整文件重复扫描。

**工作方式**(宿主自动注入提示词,无需手动开关):

1. **改码后建索引**:模型生成/修改代码后,自动调用 `workbench_code_index`:
   - `action=scan` 扫描目录,返回每个功能块(函数/方法/类/组件/常量/类型)的**名称、类型、起始行、结束行、签名**,无需读整文件;
   - 模型(刚写完代码最懂)为每个功能块补一句**功能注释**;
   - `action=commit` 把注释合并写入 `.workbench/<时间戳>.md` 快照,并更新 `latest.md`。目录下**每个含代码的子目录各有自己的 `.workbench`**。
2. **写码前定位**:需要找已有函数/组件时,调用 `workbench_code_locate(query, dir)`,返回「文件 + 起始/结束行 + 功能描述」,再按行精确读取。
3. **RAG 联动**:把项目目录配置为知识库后,`workbench_search` 会自动纳入各 `.workbench/latest.md`(历史快照不入索引,避免膨胀),检索命中同样可直达。

**索引 md 格式**(紧凑,一行一块):

```markdown
# 📇 代码索引 · <目录> · 2026-08-26_231843
## 🔄 本次变更        # 新增/更新/移除块数,来自与上一份 latest.md 的对比
## 📄 文件清单        # 文件 | 块数 | 行数
## 🧩 功能块
### `api.ts`
#### 🔧 函数 `registerApiRoutes` · L257-L290
- 签名: `export function registerApiRoutes(`
- 功能: 注册 /workbench/api RPC 路由
```

> 说明: 分类由**当前对话的模型**完成(零外部 API 依赖);索引是生成物,建议在项目 `.gitignore` 中加入 `.workbench/`。**语言支持**(启发式解析,无 tree-sitter 依赖,行范围仅供定位):
>
> - **精确解析**: JS/TS/JSX/TSX、Python、Go、Rust、Java、C#、Shell、Kotlin、Swift、PHP、C/C++(含模板函数与 ObjC `.m/.mm` 方法)、Dart
> - **常规支持**: Ruby / Lua(`def…end` 缩进式)、Scala、Groovy、Perl(`sub`)、Vue / Svelte(提取 `<script>` 块,行号对齐原文件)
> - **不在白名单的文件完全跳过**(如 HTML/CSS/JSON/YAML、SQL、R、Haskell 等,不产生索引记录)

### 10. 实时更新行号(脚本)——索引自动跟随代码,无需模型记得 commit

行号式索引的短板是**过期**:代码一改,索引里的行号就漂移。核心是 `refreshIndex`——**不经过模型**,自动重扫目录、按「文件名+函数名」就近继承上一份索引里的功能注释、行号用最新的。两种驱动方式:

**① 插件内置 watch(推荐,零脚本)**:在 settings 里配置 `indexWatchDirs`,宿主启动后自动轮询维护这些目录的索引,行号永远最新:

```yaml
# ~/.dsh/settings.yaml
workbench:
  indexWatchDirs:
    - E:\dsh_work\dsh-workbench
    - E:\dsh_work\my-project
```

**② 独立脚本**(适合不想开宿主 watch 或挂 CI 的场景):

```sh
# 实时守护(后台常驻)
node dsh-workbench/scripts/watch-workbench.mjs --dir <你的代码目录> [--interval 2000] [--snapshot 60000]
# 一次性刷新(适合挂 git hook / npm build)
node dsh-workbench/scripts/refresh-workbench.mjs <你的代码目录>
```

**挂在 git post-commit hook**(`.git/hooks/post-commit`):

```sh
#!/bin/sh
node /绝对路径/dsh-workbench/scripts/refresh-workbench.mjs "$(git rev-parse --show-toplevel)"
```

**挂在 npm script**:

```json
{ "build": "tsc && node dsh-workbench/scripts/refresh-workbench.mjs ." }
```

参数说明:

| 参数 | 含义 |
|---|---|
| `--dir` | 要监听维护索引的代码目录(必填) |
| `--interval` | 轮询间隔毫秒,默认 2000 |
| `--snapshot` | 快照节流毫秒,默认 60000(1 分钟内只写一份历史快照,`latest.md` 始终实时;0 = 每次都写) |
| `--verbose` | 打印每次同步明细 |

需要 Node ≥ 23.6(脚本直接执行 TS 源码,零构建依赖)。实时场景下注释可能短暂落后(等模型下次 commit 补齐),但**行号永远是最新的**。

### 11. Token 节省对照(实测)

用本仓库真实源码 + 真实索引跑了 5 个真实编程任务,对比「不用工具读全文」vs「用 `workbench_code_locate` 定位后按行读」(token ≈ 字符数/3,两臂同口径):

| 任务 | 不用工具(读全文) | 用工具(locate+按行) | 节省 |
|---|---|---|---|
| 修改 locate 的定位打分逻辑 | 14,260 | 1,229 | **91%** |
| 调整 BM25 打分 termScore | 2,772 | 646 | 77% |
| 给 commitIndex 加功能 | 14,260 | 1,587 | 89% |
| 改客户端 RagPanel 上传逻辑 | 4,247 | 2,298 | 46% |
| 给 RAG 重建加新参数 | 20,494 | 1,641 | 92% |
| **合计** | **56,033** | **7,401** | **87%** |

可随时复现:`node scripts/token-compare.mjs --dir <代码目录>`。

---

## 🗂️ 仓库结构

```
dsh-workbench/
├── package.json            # exports + dsh.bundle.patch + dsh.client 双入口声明
├── cordis.patch.yml        # 宿主行插入(bundle patch)
├── tsconfig*.json / tsdown.config.ts
├── src/
│   ├── index.ts            # 宿主入口: 工具 + 机制替换 + 动态 section + RPC + settings
│   ├── config.ts           # settings 命名空间 schema(schemastery)
│   ├── search.ts           # BM25 检索引擎(零依赖; 可选纳入 .workbench/latest.md)
│   ├── codeindex.ts        # 📇 代码索引: 结构扫描(函数/类/组件行范围) + md 渲染 + locate 定位
│   ├── embedding.ts        # 向量引擎(OpenAI 兼容端点 + RRF 融合)
│   ├── mcp.ts              # MCP 连接/测试/自动注册工具
│   ├── documents.ts        # 文档解析(pdf-parse / txt / md)
│   ├── workflow.ts         # 工作流模板 + 干运行执行器
│   ├── prompts.ts          # 内置领域模板 + 注入转义
│   ├── api.ts              # /workbench/api 前缀路由(同源校验 + {ok,value} 信封)
│   ├── shared/types.ts     # 双端共享 JSON 类型
│   └── client/
│       ├── index.tsx       # 客户端入口: 页签 + 输入框机制条/提示词弹层 + i18n
│       ├── i18n.ts         # 中英双语字典, 跟随 DSH 语言
│       ├── WorkbenchView.tsx / WorkflowGraph.tsx(LogicFlow)/ PromptQuickBar / MechanismBar
│       ├── api.ts / ui.tsx / ErrorBoundary.tsx
│       └── modules/        # 六大模块面板
└── tests/                  # node --test 单测(BM25/向量/提示词转义)
```

## 🏗️ 开发构建

```sh
npm install
npm run build      # tsc 类型声明 + tsdown 双产物(lib/index.js 宿主 + lib/client.js 客户端)
npm test           # 引擎/向量/提示词单测
```

客户端产物为 DSH web module-loader 格式(`window.__ModuleLoader__.load({ id: 'dsh-workbench', factory })`)。

## 🌐 国际化

- 全部界面文案走 `src/client/i18n.ts` 双语字典(zh/en)。
- 客户端入口订阅 DSH 的 `locale` 服务,DSH 切换语言(如 设置 → 语言)时,工作台同步切换,无需重启。

## 🧭 与生态的关系

DSH 生态已有各能力的单点插件(知识库 [dsh-kb-sieve](https://github.com/omdsh-dev/dsh-kb-sieve)、MCP [dsh-exa-mcp](https://github.com/MicroHEROX/dsh-exa-mcp)、技能 [dsh-skill-manager](https://github.com/JimmyJin2006/dsh-skill-manager) 等),但**没有把六大能力 + 机制替换收进一个对话页签与输入框**的产品——这正是本插件的位置。同名 [deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin) 是 IDE 风格三栏工作台,定位互补。

## 🧾 许可与合规

- 原创实现,MIT 许可;不粘贴第三方代码,参照项目仅在注释致谢。
- 运行时依赖仅在 package.json 声明:`@modelcontextprotocol/sdk`(MIT)、`@logicflow/core`(Apache-2.0)、`pdf-parse`(MIT)、`@deepseek-ai/*`(MIT)等。
- 上架 GitHub 前请确认 `package.json` 的 `repository.url` 指向你自己的仓库。
- 开发注意事项:`systemPrompt.variable` 名称须匹配 `/^[a-z][a-z0-9_]*$/`;`systemPrompt.section` 允许冒号;详情见 [docs/ERROR-FIX-LOG.md](./docs/ERROR-FIX-LOG.md)。
