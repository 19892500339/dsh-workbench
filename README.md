# 🛠️ dsh-workbench

> **A visual control room for your agent** — RAG · MCP · Workflows · Skills · Tools · Prompts · Project Status, orchestrated in one tab, right inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-4d7cfe.svg)](https://github.com/deepseek-ai/deepseek-harness)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-339933.svg)](#-development)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)
[![中文](https://img.shields.io/badge/中文-README-red.svg)](README.zh.md)

</div>

DeepSeek Harness gives your model superpowers — but configuring them usually means digging through files, yaml and docs. **dsh-workbench** turns the six core agent capabilities **plus a project health dashboard** into a **visual, clickable control room**: a dedicated **Workbench tab** next to Chat / Trajectory, plus **mechanism switches inside the composer** that swap DSH's own behavior for your workbench configuration — with one-click restore.

It speaks your language (**zh / EN, auto-synced with DSH**) and wears DSH's own design tokens, so it **follows the host light / dark / system theme** and looks native from day one.

<div align="center">

**The Workbench tab** — every agent capability, one place:

![Workbench overview](docs/screenshots/workbench-overview.png)

*Module panels — every capability is clickable:*

![Workbench panel](docs/screenshots/workbench-panel.png)

</div>

---

## ✨ Why dsh-workbench?

| 😩 Without it | 🎉 With it |
|---|---|
| RAG tuning = editing settings yaml & rebuilding indexes by hand | Point, upload, chunk, engine, rebuild — all in panels |
| MCP servers = CLI incantations, tools invisible | Add a server, flip a switch, **tools auto-register** and appear in the model's toolset |
| Workflows = JSON editing blind | Drag nodes on a **LogicFlow canvas**, reorder by dragging, run dry-runs with step logs |
| Skills / tools / prompts = scattered configs | One tab to browse, import, toggle and activate everything |
| Model can't find the right file → burns tokens re-reading whole repos | **`.workbench` code index** — the model locates code by line, saving **up to 87% of tokens** |

All configuration persists through the host `settings` service (`~/.dsh/settings.yaml` by default) and survives restarts.

---

## 🧩 Feature matrix

| Module | What you can do | Backing mechanism |
|---|---|---|
| 📚 **RAG** | Multi knowledge bases (folders) · upload docs (pdf·txt·md, ≤20MB) · chunk params · engine (**bm25 \| vector \| hybrid**) · embeddings endpoint · per-KB rebuild & search | Built-in BM25 + original vector engine (RRF fusion) + `workbench_search` tool (supports `kb_id`) |
| 🔌 **MCP** | Server CRUD (`url` or `command`/`args`/`env`/`headers`) · enable toggle · connect test · **auto-registers `wb_mcp__*` tools** on `ctx.tools` | `@modelcontextprotocol/sdk` dynamic connect — coexists with the official `mcp__*` bridge |
| 🔄 **Workflow** | Built-in templates · **LogicFlow drag canvas** (fullscreen, live reorder & re-chaining) · inline node editor · dry-run with step logs · **script mode** (full `workflowEngine` orchestration) | Deterministic dry-run executor + host `workflowEngine` delegation (agent / pipeline / parallel) |
| 🧩 **Skills** | Browse installed skills · import a local `SKILL.md` into `~/.dsh/skills/` · follow toggles | `ctx.skills` registry |
| 🛠️ **Tools** | **Every DSH tool** (including hidden ones) · test-call with JSON args · "hide from model" runtime toggle | `ctx.tools` registry + `ctx.tools.restrict({ deny })` — takes effect immediately |
| 📝 **Prompt** | 8 built-in domain templates · CRUD · `{{var}}` placeholder preview · switch active · 📝 composer picker (recent 3 + cancel + **injection preview**) | Host dynamic section `workbench:active-prompt` — zero context cost when inactive |
| 📇 **Code index** | Per-directory `.workbench/` index (function blocks → file + start/end lines + comments) · timestamped snapshots + live `latest.md` | Model-driven host tools: `workbench_code_index` (scan/commit), `workbench_code_locate` — locate before reading, **no more whole-file scans** |
| 🩺 **Project status** | Health dashboard for the **current workspace**: six-dimension status cards (RAG / MCP / Skills / Tools / Workflows / Structure) · overall health score · **dependency graph & call graph** (clickable SVG) · framework tree with annotation coverage · **click any card/node → view the exact source lines** | `workbench_project_status` tool + `src/projectstatus.ts` static analysis (imports → dep edges, call refs → call edges, TODO/FIXME scan, annotation coverage) — report persisted to `.workbench/project-status.md` + `.json` |

### 🎛️ Mechanism switches (inside the composer)

Click an icon in the input tool row to **replace** DSH's built-in mechanism with your workbench configuration:

- 📚 **RAG** — default / custom / pick a knowledge base
- 🛠️ **Tools** — full visibility / filtered by hide-toggles
- 🧩 **Skills** — native / workbench list
- 🔄 **Workflow** — native / follow the active workflow

"Restore this mechanism" (or "Restore defaults") reverts to DSH instantly — and clears tool/skill hide config.

---

## 📇 Code index — the token-saving superpower

Models re-reading entire files to find one function is the biggest hidden token leak. dsh-workbench maintains a **`.workbench/` index per code directory** — compact Markdown mapping every function block to **file + start/end line + a functional comment**. The model:

1. **After writing code** → calls `workbench_code_index` (`scan` → annotate → `commit`) to rebuild the index;
2. **Before writing code** → calls `workbench_code_locate` to jump straight to the right lines, then reads only those lines.

Measured on this repo's real source (5 real coding tasks):

| Task | Read whole file | Locate + read by line | Saved |
|---|---|---|---|
| Tune `locate` scoring | 14,260 tok | 1,229 | **91%** |
| Tune BM25 `termScore` | 2,772 | 646 | 77% |
| Extend `commitIndex` | 14,260 | 1,587 | 89% |
| Fix `RagPanel` upload | 4,247 | 2,298 | 46% |
| New RAG rebuild param | 20,494 | 1,641 | 92% |
| **Total** | **56,033** | **7,401** | **87%** |

Reproduce anytime: `node scripts/token-compare.mjs --dir <code-dir>`.

Line numbers stay fresh automatically — either via the built-in watcher (`workbench.indexWatchDirs` in settings) or the standalone `scripts/watch-workbench.mjs` / `scripts/refresh-workbench.mjs` (git hooks, CI, npm scripts — your choice).

> **Recent fixes** (V7): `workbench_code_find` now recalls **nested** functions/classes/consts (declaration regexes are no longer top-level-only, and nested declarations are no longer skipped); `workbench_code_index commit` now **inherits the previous annotations** before merging the new ones, so a partial commit never drops existing comments.

---

## 🩺 Project status — see the whole project before you touch it

Like an ops engineer reading a call graph before changing a system, the **Project Status** tab gives the model (and you) a one-glance health report of the current workspace — so a change never lands blind:

- **Six-dimension status cards** — RAG / MCP / Skills / Tools / Workflows / Structure, each with a status line, a 🟢🟡🔴 health badge and a 0–100 score bar;
- **Overall health score** — fused from config-side signals (MCP connected? RAG index built? skills / tools / workflows present?) and code-side signals (annotation coverage, TODO/FIXME count, stale index, oversized files);
- **Dependency graph** — file → file import/require edges, drawn as a clickable SVG;
- **Call graph** — function → function call edges resolved to project symbols, clickable too;
- **Framework tree** — directory → file → blocks, with annotation coverage and TODO/FIXME counts;
- **Click anything → read the exact source lines** in the panel (line-numbered), or ask the model to open the same report via the `workbench_project_status` tool before editing code;
- **Persisted as text** — every scan rewrites `.workbench/project-status.md` (human/model readable) + `.workbench/project-status.json` (machine readable) under the project root.

The default target directory is the **current session's workspace** (`agent.session.header.cwd`), falling back to `workbench.indexWatchDirs` — so it analyses the project you are actually working in.

---

## 🚀 Quick start

```sh
# from npm (once published)
dsh plugin --profile web add dsh-workbench

# from GitHub
dsh plugin --profile web add git+https://github.com/19892500339/dsh-workbench.git

# local development
cd dsh-workbench && npm install && npm run build
dsh plugin --profile web add link:<absolute path to this repo>
```

Hard-refresh the browser (`Ctrl/Cmd + Shift + R`) → the **Workbench** tab appears, and the composer tool row shows 📚🛠️🧩🔄📝.

---

## 🖥️ First steps

**① Upload a doc & let the model search it**
`Workbench → RAG` → Add a KB (name + folder path) → Upload a `.pdf/.txt/.md` → (optional) switch engine to `vector`/`hybrid` + embeddings endpoint → Rebuild. Then click 📚 in the composer → "Workbench knowledge base" → pick a KB → ask your question. The model calls `workbench_search` with the right `kb_id`.

**② Wire up an MCP server in one minute**
`Workbench → MCP` → Add server (stdio command or http url) → Save → **Enable**. Its tools land on `ctx.tools` as `wb_mcp__*` and show up in `Workbench → Tools`, callable by the model.

**③ Orchestrate a workflow by dragging**
`Workbench → Workflow` → pick a template (or New) → **🎨 Drag canvas** → add `+ prompt / transform / tool / skill / output` nodes → **drag to reorder** (edges re-chain live) → run a dry-run with step logs → **Activate**, then click 🔄 in the composer → "Follow the active workflow".

**④ Activate a prompt template**
`Workbench → Prompt` → pick one of 8 domain templates (or write your own, `{{var}}` supported) → **Activate**. From the next model step the system prompt carries it — the 📝 composer picker shows the **exact injected text** to verify.

**⑤ Hide a tool from the model**
`Workbench → Tools` → toggle "hide" on any tool (works immediately via `ctx.tools.restrict`), untoggle to restore.

**⑥ See the whole project before editing**
`Workbench → 项目状态 (Project Status)` → it auto-targets the **current session's workspace** → read the six-dimension health cards, then open the **dependency graph / call graph** tabs and click a node to jump to the exact source lines. The same report is available to the model through the `workbench_project_status` tool — call it before modifying code.

---

## 🏗️ Development

```sh
npm install
npm run build   # tsc declarations + tsdown artifacts (lib/index.js host, lib/client.js client)
npm test        # engine / vector / prompt unit tests
npm run typecheck
```

The client artifact ships in the DSH web module-loader format (`window.__ModuleLoader__.load({ id: 'dsh-workbench', factory })`).

### 🌐 Internationalization & theming

- All UI strings live in `src/client/i18n.ts` (zh/en); the client subscribes to DSH's `locale` service — switch DSH's language, the workbench switches with it, no restart.
- The whole UI is built on **DSH design tokens** (`var(--dsw-alias-*)`): it follows the host `light` / `dark` / `system` theme and uses DSH's native icon set — zero visual drift.

---

## 🗂️ Repository layout

```
dsh-workbench/
├── package.json            # exports + dsh.bundle.patch + dsh.client dual entries
├── cordis.patch.yml        # host row insert (bundle patch)
├── tsconfig*.json / tsdown.config.ts
├── src/
│   ├── index.ts            # host entry: tools + mechanism switches + dynamic sections + RPC + settings
│   ├── config.ts           # settings namespace schema (schemastery)
│   ├── search.ts           # BM25 retrieval engine (zero dependencies)
│   ├── codeindex.ts        # .workbench index: scan → annotate → commit → locate
│   ├── projectstatus.ts    # project health analysis: dep/call graphs, TODO scan, report → .workbench
│   ├── embedding.ts        # vector engine (OpenAI-compatible endpoint + RRF fusion)
│   ├── mcp.ts              # MCP connect / test / auto-register tools
│   ├── documents.ts        # document parsing (pdf-parse / txt / md)
│   ├── workflow.ts         # workflow templates + dry-run runner
│   ├── prompts.ts          # built-in domain templates + injection escaping
│   ├── api.ts              # /workbench/api prefix route (same-origin + {ok,value})
│   ├── shared/types.ts     # shared JSON types (host ↔ browser)
│   └── client/             # React UI: tab + composer switches/picker + i18n + modules/
├── scripts/                # watch-workbench / refresh-workbench / token-compare
└── tests/                  # node --test (BM25 / vector / prompt escaping)
```

---

## 🧭 Ecosystem position

DSH has single-capability plugins (KB [dsh-kb-sieve](https://github.com/omdsh-dev/dsh-kb-sieve), MCP [dsh-exa-mcp](https://github.com/MicroHEROX/dsh-exa-mcp), skills [dsh-skill-manager](https://github.com/JimmyJin2006/dsh-skill-manager), …), but none gathers **all six capabilities + mechanism replacement + code indexing** into one conversation tab and composer — that is this plugin's niche. The similarly-named [deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin) is an IDE-style three-column workbench; the two are complementary.

---

## 🤝 Contributing

Ideas, bug reports and PRs are welcome. Before publishing to npm, make sure `package.json` `repository.url` points at your repo. Dev constraints: `systemPrompt.variable` names must match `/^[a-z][a-z0-9_]*$/`; `systemPrompt.section` allows colons — see [docs/ERROR-FIX-LOG.md](./docs/ERROR-FIX-LOG.md) and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## 🧾 License

Original implementation, **MIT**. No third-party code is pasted — references are credited in comments only. Runtime deps declared in `package.json`: `@modelcontextprotocol/sdk` (MIT), `@logicflow/core` (Apache-2.0), `pdf-parse` (MIT), `@deepseek-ai/*` (MIT).
