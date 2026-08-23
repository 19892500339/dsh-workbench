# dsh-workbench

> Visual orchestration workbench for agent capabilities · A hybrid plugin (client UI + server tool) for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Adds a **「工作台 / Workbench」tab** to the conversation view ring (beside Chat / Trajectory) and turns the six agent capabilities — **RAG · MCP · Workflow · Skills · Tools · Prompt** — into a visual, dynamically editable panel. It also registers a `workbench_search` retrieval tool, and provides **mechanism switches inside the composer** that temporarily replace DSH's own mechanisms with workbench content — with one-click restore.

The whole UI **follows DSH's interface language automatically (中文 / English)**.

---

## ✨ Feature overview

| Module | Visual operations | Backing mechanism |
|---|---|---|
| 📚 RAG | multi knowledge bases (folders) / upload documents (pdf·txt·md) / chunk params / engine (**bm25 \| vector \| hybrid**) / embeddings endpoint / per-KB rebuild & search | built-in BM25 + original vector engine (RRF fusion) + `workbench_search` tool (supports `kb_id`) |
| 🔌 MCP | server CRUD (`url` or `command`/`args`/`env`/`headers`) / enable toggle / connect test / **auto-registers `wb_mcp__*` tools on ctx.tools when enabled** | `@modelcontextprotocol/sdk` dynamic connect + `ctx.tools.register` (coexists with the official `mcp__*` bridge) |
| 🔄 Workflow | built-in templates / **LogicFlow drag canvas** (fullscreen, live reorder & re-chain) / form node editor / dry-run with step logs | deterministic dry-run executor; LLM runtime execution is a V3 follow-up |
| 🧩 Skills | list installed skills / import a local `SKILL.md` / follow toggles | `ctx.skills` registry + `~/.dsh/skills/` import |
| 🛠️ Tools | **all DSH tools** (incl. hidden ones) / test-call with JSON args / "hide from model" runtime toggle | `ctx.tools` registry + `ctx.tools.restrict({ deny })` — effective immediately |
| 📝 Prompt | 8 built-in domain templates / CRUD / `{{var}}` preview / switch active / 📝 picker inside the composer (recent-3 + cancel + injection preview) | host dynamic section `workbench:active-prompt` (empty when inactive, zero context cost) |

**Mechanism switches (inside the composer)**: 📚 RAG (default / custom / pick a KB) · 🛠️ Tools (all visible / filtered) · 🧩 Skills (native / workbench list) · 🔄 Workflow (native / follow active) — plus "restore defaults".

All configuration persists through the host `settings` service (default `~/.dsh/settings.yaml`), surviving restarts.

---

## 🚀 Install

```sh
# from npm (once published)
dsh plugin --profile web add dsh-workbench

# from GitHub
dsh plugin --profile web add git+https://github.com/19892500339/dsh-workbench.git

# local development
cd dsh-workbench && npm install && npm run build
dsh plugin --profile web add link:<absolute path to this repo>
```

Hard-refresh the browser (`Ctrl/Cmd + Shift + R`) afterwards — the **工作台 / Workbench** tab appears, and the composer tool row shows 📚🛠️🧩🔄📝 icons.

---

## 📚 Tutorial

### 0. The interface

- **Conversation tab bar**: `[Chat] [Trajectory] [Workbench]` — the Workbench tab hosts the six module panels (left nav).
- **Composer tool row**: `[📎] [🎤] [📚] [🛠️] [🧩] [🔄] [📝]` — the first four are **mechanism switches** (click for a picker), 📝 is the **prompt picker** (recent 3).

### 1. RAG knowledge bases

1. Open **Workbench → RAG**.
2. **Add a KB**: name + an absolute folder path → Add. `.md / .txt` files inside are scanned recursively.
3. **Upload documents**: click "Upload" on a KB row, pick `.pdf / .txt / .md` — parsed, chunked with your chunk params, stored into the KB, and the index is **rebuilt immediately**.
4. **Vector retrieval (optional)**: in "Retrieval config" switch the engine to `vector` or `hybrid`, fill an OpenAI-compatible `/embeddings` endpoint (OpenAI / DeepSeek / SiliconFlow / local gateway), save and "Rebuild index" — uploaded docs are then vectorized (**vector knowledge base**).
5. **Search test**: type a query, pick a KB, hit Search.
6. **Let the model use it**: click 📚 in the composer → "Workbench knowledge base" → pick a target KB (or the default corpus) → send a message; the model calls `workbench_search` with the matching `kb_id`.

> Model tool `workbench_search`: `query` (required), `top_k`, `kb_id` (target KB).

### 2. MCP servers

1. **Workbench → MCP → Add server**: name + transport (stdio local / http remote).
2. stdio: command (e.g. `npx`) + args + env; http: URL + headers.
3. Save, then **enable**: the host connects and **registers its tools on ctx.tools** (prefix `wb_mcp__`, coexisting with the official `mcp__` bridge); "Test" runs a one-off handshake.
4. Enabled tools appear in **Workbench → Tools** and are callable by the model.

### 3. Workflow orchestration (LogicFlow canvas)

1. **Workbench → Workflow**: built-in templates are seeded on first boot (resume writer / recruiter screen / plain QA); use "Restore templates" or "New".
2. Pick a workflow → "🎨 Drag canvas": add nodes from the left panel (`+ prompt / + transform / + tool / + output`); **drag nodes to reorder** (edges update live); the **⛶ Fullscreen** button lets you orchestrate on a big canvas.
3. "Manual run (dry-run)": fill input vars (`var=value`) → Run → step-by-step log.
4. Click **Activate** on a workflow, then click 🔄 in the composer → "Follow the active workflow" — the model follows it strictly from the next step.

### 4. Skills

- **Workbench → Skills**: browse installed skills (name/description/when-to-use).
- **Import**: a local `SKILL.md` path → copies it into `~/.dsh/skills/`.
- Composer 🧩 → "Inject workbench skill list": the model uses the workbench list.

### 5. Tools

- **Workbench → Tools**: **all DSH tools** (built-in + `wb_mcp__*` + other plugins), with total/hidden counts.
- **Test call**: click a tool name → JSON args → Call (still subject to DSH policy/approval).
- **Hide from model**: toggling hides the tool from the model's visible set (effective when the Tools mechanism is in workbench mode); untoggle restores it.

### 6. Prompt templates

1. **Workbench → Prompt**: 8 built-in domain templates (software eng / code review / translation / data analysis / PM / learning / marketing / general); create/edit/delete, `{{var}}` placeholders preview.
2. **Activate**: click "Activate" (or pick a recent one in the 📝 picker) — from the next model step, the system prompt includes:
   ```
   【生效提示词: name】(以下为当前必须严格遵守的指令…)
   template body ({{var}} escaped to {var})
   ```
3. **Deactivate**: "Deactivate" in the 📝 picker.
4. **Verify**: the 📝 picker shows the exact injected text ("current active"). Note: DSH's **trajectory view does not render system prompts** (platform behavior) — trust the picker preview and model behavior.

### 7. Mechanism switches (replace / restore)

- Each mechanism defaults to **DSH's original behavior** (no injection).
- Click a composer icon → pick "workbench" to **replace** it: the host injects a mechanism section via `systemPrompt.section`, which the model reads every step.
- "Restore this mechanism" (or "Restore defaults") fully reverts to DSH (and clears tool/skill hide config).

### 8. FAQ

- **Activated a prompt but nothing changed?** Injection happens at the **next model step** — send a new message; confirm the 📝 picker shows "active".
- **No prompt trace in the trajectory?** DSH does not write system prompts into trajectory events — expected; use the 📝 preview.
- **Language?** Follows DSH's zh/en automatically; no setting needed.
- **Large uploads?** Single file ≤ 20MB.

---

## 🗂️ Repository layout

```
dsh-workbench/
├── package.json            # exports + dsh.bundle.patch + dsh.client dual entries
├── cordis.patch.yml        # host row insert (bundle patch)
├── tsconfig*.json / tsdown.config.ts
├── src/
│   ├── index.ts            # host entry: tool + mechanism switches + dynamic sections + RPC + settings
│   ├── config.ts           # settings namespace schema (schemastery)
│   ├── search.ts           # BM25 retrieval engine (zero dependencies)
│   ├── embedding.ts        # vector engine (OpenAI-compatible endpoint + RRF fusion)
│   ├── mcp.ts              # MCP connect / test / auto-register tools
│   ├── documents.ts        # document parsing (pdf-parse / txt / md)
│   ├── workflow.ts         # workflow templates + dry-run runner
│   ├── prompts.ts          # built-in domain templates + injection escaping
│   ├── api.ts              # /workbench/api prefix route (same-origin + {ok,value})
│   ├── shared/types.ts     # shared JSON types (host ↔ browser)
│   └── client/
│       ├── index.tsx       # client entry: tab + composer switches/picker + i18n
│       ├── i18n.ts         # zh/en dictionaries, follows the DSH locale
│       ├── WorkbenchView.tsx / WorkflowGraph.tsx (LogicFlow) / PromptQuickBar / MechanismBar
│       ├── api.ts / ui.tsx / ErrorBoundary.tsx
│       └── modules/        # the six module panels
└── tests/                  # node --test (BM25 / vector / prompt escaping)
```

## 🏗️ Build

```sh
npm install
npm run build      # tsc declarations + tsdown artifacts (lib/index.js host, lib/client.js client)
npm test           # engine / vector / prompt unit tests
```

The client artifact uses the DSH web module-loader format (`window.__ModuleLoader__.load({ id: 'dsh-workbench', factory })`).

## 🌐 Internationalization

- All UI strings live in `src/client/i18n.ts` (zh/en dictionaries).
- The client entry subscribes to DSH's `locale` service — switching the DSH UI language (Settings → Language) switches the workbench instantly, no restart.

## 🧭 Ecosystem position

DSH has single-capability plugins (KB [dsh-kb-sieve](https://github.com/omdsh-dev/dsh-kb-sieve), MCP [dsh-exa-mcp](https://github.com/MicroHEROX/dsh-exa-mcp), skills [dsh-skill-manager](https://github.com/JimmyJin2006/dsh-skill-manager), …), but none collects the six capabilities **plus mechanism replacement** into one conversation tab and composer — that is this plugin's niche. The similarly-named [deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin) is an IDE-style three-column workbench; the two are complementary.

## 🧾 License & compliance

- Original implementation, MIT. No third-party code is pasted; references are credited in comments only.
- Runtime dependencies are declared in `package.json` only: `@modelcontextprotocol/sdk` (MIT), `@logicflow/core` (Apache-2.0), `pdf-parse` (MIT), `@deepseek-ai/*` (MIT), etc.
- Before publishing, ensure `package.json` `repository.url` points at your repo.
- Dev rules: `systemPrompt.variable` names must match `/^[a-z][a-z0-9_]*$/`; `systemPrompt.section` allows colons — see [docs/ERROR-FIX-LOG.md](./docs/ERROR-FIX-LOG.md).
