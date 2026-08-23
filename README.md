# dsh-workbench

> Visual orchestration workbench for agent capabilities · A hybrid plugin (client UI + server tool) for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)

Adds a **「工作台 / Workbench」tab** to the conversation view ring (beside Chat / Trajectory) and turns the six agent capabilities — **RAG · MCP · Workflow · Skills · Tools · Prompt** — into a visual, dynamically editable panel. It also registers a `workbench_search` retrieval tool for the model.

## Features

| Module | Visual operations | Backing mechanism |
|---|---|---|
| 📚 RAG | corpus dir / chunk size & overlap / rebuild index / search test | built-in BM25 engine (zero-dep, vector seam reserved) + `workbench_search` tool |
| 🔌 MCP | server CRUD (`url` or `command`/`args`/`env`/`headers`) / enable toggle / connect test & tool list | `@modelcontextprotocol/sdk` handshake; tool registration left to DSH's own MCP bridge |
| 🔄 Workflow | built-in templates (resume writer, recruiter screen …) / form-based node editor / dry-run with step logs | deterministic dry-run executor; LLM execution & graph editor are V2 |
| 🧩 Skills | list installed skills / import a local `SKILL.md` / follow toggles | `ctx.skills` registry + `~/.dsh/skills/` import |
| 🛠️ Tools | list registered tools & schemas / test-call with args / follow toggles | `ctx.tools` registry + guarded execution pipeline |
| 📝 Prompt | template CRUD / `{{var}}` preview / switch the active prompt | `systemPrompt.variable('workbench.activePrompt')`, effective next model step |

All configuration persists through the host `settings` service (default `~/.dsh/settings.yaml`), surviving restarts.

## Install

```sh
# from npm (once published)
dsh plugin --profile web add dsh-workbench

# from GitHub
dsh plugin --profile web add git+https://github.com/<your-org>/dsh-workbench.git

# local development
cd dsh-workbench && npm install && npm run build
dsh plugin --profile web add link:<absolute path to this repo>
```

Hard-refresh the browser (`Ctrl/Cmd + Shift + R`) afterwards — the **工作台** tab appears in the conversation tab bar.

> On first boot the plugin seeds three built-in workflow templates; you can delete them and restore with one click from the panel.

## Repository layout

```
dsh-workbench/
├── package.json            # exports + dsh.bundle.patch + dsh.client dual entries
├── cordis.patch.yml        # host row insert (bundle patch)
├── tsconfig*.json / tsdown.config.ts
├── src/
│   ├── index.ts            # host entry: tool + systemPrompt + RPC + settings
│   ├── config.ts           # settings namespace schema (schemastery)
│   ├── search.ts           # BM25 retrieval engine (zero dependencies)
│   ├── mcp.ts              # MCP connection test (@modelcontextprotocol/sdk)
│   ├── workflow.ts         # workflow templates + dry-run runner
│   ├── api.ts              # /workbench/api prefix route (same-origin + {ok,value})
│   ├── shared/types.ts     # shared JSON types (host ↔ browser)
│   └── client/
│       ├── index.tsx       # client entry: registers the conversation.view tab
│       ├── WorkbenchView.tsx
│       ├── api.ts / ui.tsx
│       └── modules/        # the six module panels
└── tests/                  # node --test unit tests (BM25 engine)
```

## Build

```sh
npm install
npm run build      # tsc declarations (lib/types) + tsdown artifacts (lib/index.js, lib/client.js)
npm test           # engine unit tests
```

The client artifact uses the DSH web module-loader format (`window.__ModuleLoader__.load({ id: 'dsh-workbench', factory })`), matching official and community plugins.

## Model tool

`workbench_search` — parameters: `query` (required), `top_k` (optional). Returns `{ score, file, chunkIndex, snippet }[]` ranked by BM25. Corpus defaults to `~/.dsh/workbench/corpus` (recursive `.md`/`.txt` scan, configurable in the panel).

## Client→Host RPC

`/workbench/api/<method>` prefix route (same-origin fenced, `{ok,value}` envelope): `state.get / state.update / rag.rebuild / rag.search / mcp.test|save|remove|toggle / workflow.save|remove|run|templates / tool.test / skill.import / prompt.save|remove|activate`.

## Ecosystem position

Surveyed via [awesome-dsh-plugins](https://github.com/oslook/awesome-dsh-plugins): the ecosystem has single-capability plugins (e.g. [dsh-kb-sieve](https://github.com/omdsh-dev/dsh-kb-sieve) for KB, [dsh-exa-mcp](https://github.com/MicroHEROX/dsh-exa-mcp) for MCP, [dsh-skill-manager](https://github.com/JimmyJin2006/dsh-skill-manager) for skills), but none collects all six capabilities into one conversation tab as a unified visual editor — that is this plugin's niche. The similarly-named [deepseek-harness-workbench-plugin](https://github.com/loadingvx/deepseek-harness-workbench-plugin) is an IDE-style three-column workbench (editor/terminal/git); the two are complementary, not conflicting.

## License & compliance

- This repository is an **original implementation**, licensed [MIT](./LICENSE).
- No third-party code is pasted. Open-source references (e.g. [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar), the official [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) ui-trajectory) were studied for interface contracts and build pipeline only; sources note the attribution.
- Runtime dependencies are declared in `package.json` only: `@modelcontextprotocol/sdk` (MIT), `@deepseek-ai/*` (official, MIT), `react`, etc.
- Before publishing to GitHub, update `repository.url` in `package.json` to your own repo.
