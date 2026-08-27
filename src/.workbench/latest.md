# 📇 代码索引 · E:\dsh_work\dsh-workbench\src · 2026-08-27_195218

> 由 dsh-workbench `workbench_code_index` 生成 · 每块记录「文件 + 起始行/结束行」· 检索直达请用 `workbench_code_locate` · 本目录最新索引始终在 `latest.md`

## 🔄 本次变更
- 新增: 0 · 更新: 19 · 移除: 0 · 当前块总数: 194
- 说明: 强化代码索引强制约定: workbench:code-index 系统提示改为「改码前必须 locate 定位 + 禁止整文件 read(仅 locate 无命中才降级) + workbench_code_find 兜底 + 改码后必须 index 更新」

## 📄 文件清单
| 文件 | 块数 | 行数 |
|---|---|---|
| `api.ts` | 19 | 300 |
| `codeindex.ts` | 47 | 1128 |
| `config.ts` | 4 | 188 |
| `documents.ts` | 2 | 28 |
| `embedding.ts` | 11 | 128 |
| `index.ts` | 61 | 1247 |
| `mcp.ts` | 9 | 229 |
| `prompts.ts` | 2 | 153 |
| `publish.ts` | 18 | 290 |
| `search.ts` | 12 | 238 |
| `workflow.ts` | 9 | 259 |

## 🧩 功能块
### `api.ts`
#### 🧬 类型 `SettingsView` · L23-L26
- 签名: `export interface SettingsView {`

#### 🧬 类型 `WorkbenchRuntime` · L29-L76
- 签名: `export interface WorkbenchRuntime {`

#### ⚙️ 方法 `uploadDocument` · L38-L44
- 签名: `uploadDocument(input: { kbId?: string; fileName: string; contentBase64: string }): Promise`

#### ⚙️ 方法 `cancelScript` · L58-L58
- 签名: `cancelScript(runId: string): Promise<{ cancelled: boolean }>`

#### ⚙️ 方法 `testTool` · L67-L67
- 签名: `testTool(name: string, args: unknown): Promise<{ ok: boolean; value?: unknown; error?: str`

#### ⚙️ 方法 `importSkill` · L68-L68
- 签名: `importSkill(path: string): Promise<{ ok: boolean; name?: string; error?: string }>`

#### 🏷️ 类 `WorkbenchApiError` · L79-L87
- 签名: `export class WorkbenchApiError extends Error {`

#### ⚙️ 方法 `constructor` · L82-L86
- 签名: `constructor(code: string, message: string, status = 400) {`

#### 🔧 函数 `isRecord` · L89-L91
- 签名: `function isRecord(value: unknown): value is Record<string, unknown> {`

#### 🔧 函数 `str` · L94-L97
- 签名: `function str(value: unknown, field: string): string {`

#### 🔧 函数 `num` · L99-L102
- 签名: `function num(value: unknown, field: string): number {`

#### 🔧 函数 `bool` · L104-L107
- 签名: `function bool(value: unknown, field: string): boolean {`

#### 🔧 函数 `dispatch` · L110-L215
- 签名: `export async function dispatch(runtime: WorkbenchRuntime, method: string, payload: unknown`

#### 🔧 函数 `sameOriginFence` · L218-L227
- 签名: `export function sameOriginFence(req: IncomingMessage): boolean {`

#### 🔧 函数 `readJsonBody` · L230-L245
- 签名: `export async function readJsonBody(req: IncomingMessage, limit = 1 << 20): Promise<unknown`

#### 🔧 函数 `writeJson` · L247-L251
- 签名: `export function writeJson(res: ServerResponse, status: number, body: unknown): void {`

#### 🔧 函数 `writeOk` · L253-L255
- 签名: `export function writeOk(res: ServerResponse, value: unknown): void {`

#### 🔧 函数 `writeError` · L257-L260
- 签名: `export function writeError(res: ServerResponse, error: unknown): void {`

#### 🔧 函数 `registerApiRoutes` · L266-L299
- 签名: `export function registerApiRoutes(`

### `codeindex.ts`
#### 🔧 函数 `tokenize` · L31-L43
- 签名: `function tokenize(text: string): string[] {`

#### 🧬 类型 `BlockKind` · L46-L64
- 签名: `export type BlockKind = 'function' | 'method' | 'class' | 'component' | 'const' | 'type' |`

#### 🧬 类型 `CodeBlock` · L49-L64
- 签名: `export interface CodeBlock {`

#### 🧬 类型 `IndexedFile` · L67-L71
- 签名: `export interface IndexedFile {`

#### 🧬 类型 `ScanResult` · L73-L81
- 签名: `export interface ScanResult {`

#### 🧬 类型 `LocateHit` · L83-L91
- 签名: `export interface LocateHit {`

#### 🧬 类型 `CommitResult` · L93-L100
- 签名: `export interface CommitResult {`

#### 🔧 函数 `listCodeFiles` · L146-L166
- 签名: `async function listCodeFiles(root: string): Promise<string[]> {`

#### 🔧 函数 `walk` · L148-L163
- 签名: `async function walk(dir: string, depth: number): Promise<void> {`

#### 🔧 函数 `iterateCodeChars` · L189-L305
- 签名: `function iterateCodeChars(`

#### 🔧 函数 `firstOpenBraceLine` · L319-L340
- 签名: `function firstOpenBraceLine(lines: string[], fromLine: number): { line: number; col: numbe`

#### 🔧 函数 `findBlockEnd` · L349-L365
- 签名: `function findBlockEnd(lines: string[], openLine: number, startCol = 0): number {`

#### 🔧 函数 `detectJsTs` · L376-L394
- 签名: `function detectJsTs(t: string, indent: number): { name: string; kind: BlockKind } | null {`

#### 🔧 函数 `detectPy` · L396-L402
- 签名: `function detectPy(t: string, indent: number): { name: string; kind: BlockKind } | null {`

#### 🔧 函数 `detectGo` · L404-L412
- 签名: `function detectGo(t: string): { name: string; kind: BlockKind } | null {`

#### 🔧 函数 `detectRs` · L416-L425
- 签名: `function detectRs(t: string, indent: number): { name: string; kind: BlockKind } | null {`

#### 🔧 函数 `detectJavaCs` · L430-L438
- 签名: `function detectJavaCs(t: string): { name: string; kind: BlockKind } | null {`

#### 🔧 函数 `detectSh` · L440-L446
- 签名: `function detectSh(t: string): { name: string; kind: BlockKind } | null {`

#### 🔧 函数 `detectGeneric` · L459-L481
- 签名: `function detectGeneric(t: string, indent: number): { name: string; kind: BlockKind } | nul`

#### 🔧 函数 `detectEndStyle` · L487-L495
- 签名: `function detectEndStyle(t: string, indent: number): { name: string; kind: BlockKind } | nu`

#### 🔧 函数 `pythonBodyEnd` · L500-L510
- 签名: `function pythonBodyEnd(lines: string[], declIdx: number, declIndent: number): number {`

#### 🔧 函数 `declEndHeuristic` · L513-L523
- 签名: `function declEndHeuristic(lines: string[], declIdx: number, declIndent: number): number {`

#### 🧬 类型 `DeclShape` · L525-L531
- 签名: `interface DeclShape {`

#### 🔧 函数 `detectDeclaration` · L533-L558
- 签名: `function detectDeclaration(`

#### 🔧 函数 `collectDoc` · L560-L585
- 签名: `function collectDoc(lines: string[], declIdx: number, family: string): string {`

#### 🔧 函数 `buildPreview` · L587-L594
- 签名: `function buildPreview(lines: string[], from: number, to: number): string {`

#### 🧬 类型 `ParsedBlock` · L596-L604
- 签名: `interface ParsedBlock {`

#### 🔧 函数 `extFamily` · L606-L617
- 签名: `function extFamily(ext: string): string {`

#### 🔧 函数 `scanFileText` · L619-L663
- 签名: `function scanFileText(relPath: string, text: string): ParsedBlock[] {`

#### 🔧 函数 `scanDirectory` · L667-L711
- 签名: `export async function scanDirectory(root: string, opts?: { maxBlocks?: number }): Promise<`

#### 🧬 类型 `RenderOptions` · L715-L722
- 签名: `export interface RenderOptions {`

#### 🔧 函数 `renderIndexMd` · L724-L759
- 签名: `export function renderIndexMd(opts: RenderOptions): string {`

#### 🔧 函数 `parseIndexMd` · L761-L810
- 签名: `export function parseIndexMd(text: string): CodeBlock[] {`

#### 🔧 函数 `timestampName` · L814-L817
- 签名: `export function timestampName(d = new Date()): string {`

#### 🔧 函数 `blockKey` · L821-L823
- 签名: `function blockKey(b: Pick<CodeBlock, 'path' | 'name' | 'startLine'>): string {`

#### 🔧 函数 `diffBlocks` · L825-L838
- 签名: `function diffBlocks(prev: CodeBlock[], cur: CodeBlock[]): { added: number; updated: number`

#### 🔧 函数 `uniqueSnapshotName` · L840-L848
- 签名: `async function uniqueSnapshotName(wbDir: string, timestamp: string): Promise<string> {`

#### 🔧 函数 `commitIndex` · L854-L914
- 签名: `export async function commitIndex(`

#### 🔧 函数 `codeDirSignature` · L922-L931
- 签名: `export async function codeDirSignature(root: string): Promise<string> {`

#### 🔧 函数 `recentSnapshotWithin` · L934-L942
- 签名: `async function recentSnapshotWithin(wbDir: string, now: number, withinMs: number): Promise`

#### 🔧 函数 `inheritAnnotations` · L952-L983
- 签名: `function inheritAnnotations(oldBlocks: CodeBlock[], newBlocks: CodeBlock[]): number {`

#### 🧬 类型 `RefreshOptions` · L985-L991
- 签名: `export interface RefreshOptions {`

#### 🔧 函数 `refreshIndex` · L999-L1045
- 签名: `export async function refreshIndex(root: string, opts: RefreshOptions = {}): Promise<Commi`

#### 🔧 函数 `readIndexFile` · L1049-L1052
- 签名: `export async function readIndexFile(file: string): Promise<CodeBlock[]> {`

#### 🔧 函数 `collectWorkbenchIndexes` · L1058-L1060
- 签名: `export async function collectWorkbenchIndexes(`

#### 🔧 函数 `walk` · L1064-L1078
- 签名: `async function walk(d: string, depth: number): Promise<void> {`

#### 🔧 函数 `locateInIndexes` · L1088-L1092
- 签名: `export async function locateInIndexes(`

### `config.ts`
#### 🔧 函数 `defaultState` · L147-L179
- 签名: `export function defaultState(): WorkbenchState {`

#### 🧬 类型 `SettingsFace` · L182-L187
- 签名: `export interface SettingsFace {`

#### ⚙️ 方法 `view` · L184-L184
- 签名: `view(): { value: WorkbenchState; revision: number }`

#### ⚙️ 方法 `update` · L186-L186
- 签名: `update(patch: object, expectedRevision?: number): Promise<{ value: WorkbenchState; revisio`

### `documents.ts`
#### 🧬 类型 `PdfParseFn` · L16-L16
- 签名: `type PdfParseFn = (buffer: Buffer) => Promise<{ text: string }>`

#### 🔧 函数 `extractDocumentText` · L18-L27
- 签名: `export async function extractDocumentText(fileName: string, buffer: Buffer): Promise<strin`

### `embedding.ts`
#### 🏷️ 类 `EmbeddingError` · L17-L22
- 签名: `export class EmbeddingError extends Error {`

#### ⚙️ 方法 `constructor` · L18-L21
- 签名: `constructor(message: string) {`

#### 🧬 类型 `VectorDoc` · L25-L30
- 签名: `export interface VectorDoc {`

#### 🧬 类型 `VectorIndex` · L33-L38
- 签名: `export interface VectorIndex {`

#### 🔧 函数 `isEmbeddingConfigured` · L40-L42
- 签名: `export function isEmbeddingConfigured(cfg: EmbeddingConfig): boolean {`

#### 🔧 函数 `embedTexts` · L45-L67
- 签名: `export async function embedTexts(texts: string[], cfg: EmbeddingConfig): Promise<number[][`

#### 🔧 函数 `normalizeInto` · L70-L122
- 签名: `export function normalizeInto(v: number[]): Float32Array {`

#### 🔧 函数 `buildVectorIndex` · L83-L91
- 签名: `export function buildVectorIndex(vectors: number[][], docs: VectorDoc[]): VectorIndex {`

#### 🔧 函数 `searchVectors` · L94-L105
- 签名: `export function searchVectors(index: VectorIndex, query: number[], topK: number): Array<{ `

#### 🔧 函数 `fuseRrf` · L108-L127
- 签名: `export function fuseRrf(bm25: SearchHit[], vector: SearchHit[], topK: number, k = 60): Sea`

#### 📦 常量 `rankOf` · L110-L123
- 签名: `const rankOf = (lists: SearchHit[]) => {`

### `index.ts`
#### 🔧 函数 `defaultCorpusDir` · L67-L69
- 签名: `function defaultCorpusDir(): string {`

#### 🔧 函数 `defaultSkillsDir` · L71-L73
- 签名: `function defaultSkillsDir(): string {`

#### 🧬 类型 `ToolsServiceLike` · L76-L82
- 签名: `interface ToolsServiceLike {`

#### 🧬 类型 `SettingsServiceLike` · L83-L87
- 签名: `interface SettingsServiceLike {`

#### ⚙️ 方法 `describe` · L85-L85
- 签名: `describe(options?: { redactSecrets?: boolean }): Array<{ ns: string; value?: unknown; revi`

#### 🧬 类型 `WebServerLike` · L88-L90
- 签名: `interface WebServerLike {`

#### 🧬 类型 `SkillsServiceLike` · L91-L94
- 签名: `interface SkillsServiceLike {`

#### 🧬 类型 `WorkflowEngineLike` · L97-L110
- 签名: `interface WorkflowEngineLike {`

#### 🧬 类型 `SystemPromptLike` · L111-L114
- 签名: `interface SystemPromptLike {`

#### 🧬 类型 `AgentLike` · L117-L120
- 签名: `interface AgentLike {`

#### 🧬 类型 `AgentsServiceLike` · L121-L123
- 签名: `interface AgentsServiceLike {`

#### 🧬 类型 `AgentPresetsServiceLike` · L124-L129
- 签名: `interface AgentPresetsServiceLike {`

#### 🧬 类型 `CtxLike` · L130-L142
- 签名: `interface CtxLike {`

#### 🔧 函数 `serviceFromAgent` · L157-L161
- 签名: `function serviceFromAgent<T>(agent: AgentLike | undefined, name: string, fallback: T): T {`

#### 🔧 函数 `isRecord` · L163-L165
- 签名: `function isRecord(value: unknown): value is Record<string, unknown> {`

#### 🔧 函数 `apply` · L167-L1234
- 签名: `export function apply(ctx: CtxLike, config: { corpusDir: string; skillsDir: string }): voi`

#### 🔧 函数 `restartIndexWatch` · L198-L236
- 签名: `function restartIndexWatch(): void {`

#### 📦 常量 `indexWatchDispose` · L231-L234
- 签名: `indexWatchDispose = () => {`

#### 🧬 类型 `OverrideDomain` · L239-L248
- 签名: `type OverrideDomain = 'rag' | 'tools' | 'skills' | 'workflow'`

#### 🔧 函数 `disposeOverride` · L242-L248
- 签名: `function disposeOverride(domain: OverrideDomain): void {`

#### 🔧 函数 `skillsNarrative` · L251-L257
- 签名: `async function skillsNarrative(): Promise<string> {`

#### 🔧 函数 `activeWorkflowNarrative` · L260-L265
- 签名: `function activeWorkflowNarrative(state: WorkbenchState): string {`

#### 🔧 函数 `syncOverrides` · L279-L346
- 签名: `async function syncOverrides(): Promise<void> {`

#### 🔧 函数 `applyToolRestrictions` · L350-L362
- 签名: `function applyToolRestrictions(): void {`

#### 🧬 类型 `RagEntry` · L365-L365
- 签名: `type RagEntry = { sig: string; index: CorpusIndex; vindex?: VectorIndex; info: RagIndexInf`

#### 🔧 函数 `corpusDirOf` · L372-L378
- 签名: `function corpusDirOf(state: WorkbenchState, kbId?: string): string {`

#### 🔧 函数 `rebuildRag` · L383-L431
- 签名: `async function rebuildRag(kbId?: string): Promise<RagIndexInfo> {`

#### 🔧 函数 `ensureRag` · L434-L447
- 签名: `async function ensureRag(kbId?: string): Promise<RagEntry | null> {`

#### 🔧 函数 `searchRag` · L449-L485
- 签名: `async function searchRag(query: string, topK?: number, kbId?: string): Promise<SearchHit[]`

#### 🔧 函数 `upsertKnowledgeBase` · L488-L499
- 签名: `async function upsertKnowledgeBase(kb: { id?: string; name: string; path: string }): Promi`

#### 🔧 函数 `removeKnowledgeBase` · L500-L504
- 签名: `async function removeKnowledgeBase(id: string): Promise<SettingsView> {`

#### 🔧 函数 `uploadDocument` · L512-L516
- 签名: `async function uploadDocument(input: {`

#### ⚙️ 方法 `execute` · L578-L580
- 签名: `async execute(args) {`

#### ⚙️ 方法 `execute` · L635-L673
- 签名: `async execute(args): Promise<Record<string, JsonValue>> {`
- 功能: workbench_code_index 工具执行体: scan 返回目录功能块结构(供模型注释), commit 合并功能注释写入 .workbench 索引
- 入参: action(dir/max_blocks 或 annotations/note)
- 返回: {action, root, files, blocks} 或 {action, ...commit 结果}
- 副作用: commit 时写 .workbench 快照与 latest.md
- 依赖: scanDirectory/commitIndex (codeindex.ts)

#### ⚙️ 方法 `execute` · L700-L712
- 签名: `async execute(args): Promise<Record<string, JsonValue>[]> {`
- 功能: workbench_code_locate 工具执行体: 在 .workbench 索引中按语义定位功能块, 返回文件+起始/结束行, 供模型按行精确读取
- 入参: query, dir, top_k
- 返回: 按目录分组的命中[{file, name, startLine, endLine, summary}] 或未找到索引提示
- 副作用: 无
- 依赖: locateInIndexes (codeindex.ts)

#### 🔧 函数 `listSkills` · L767-L775
- 签名: `async function listSkills(agentScope: unknown, svc: SkillsServiceLike): Promise<SkillView[`

#### 🔧 函数 `listTools` · L785-L815
- 签名: `function listTools(agentScope: unknown, svc: ToolsServiceLike): ToolView[] {`

#### 🔧 函数 `upsertServer` · L818-L825
- 签名: `async function upsertServer(server: McpServerConfig): Promise<SettingsView> {`

#### 🔧 函数 `removeServer` · L826-L830
- 签名: `async function removeServer(id: string): Promise<SettingsView> {`

#### 🔧 函数 `toggleServer` · L831-L838
- 签名: `async function toggleServer(id: string, enabled: boolean): Promise<SettingsView> {`

#### 🔧 函数 `upsertWorkflow` · L839-L844
- 签名: `async function upsertWorkflow(workflow: WorkflowDefinition): Promise<SettingsView> {`

#### 🔧 函数 `removeWorkflow` · L845-L848
- 签名: `async function removeWorkflow(id: string): Promise<SettingsView> {`

#### 🔧 函数 `runWorkflow` · L856-L896
- 签名: `async function runWorkflow(id: string, inputs: Record<string, string>, sessionId?: string)`

#### 🧬 类型 `ScriptRunEntry` · L902-L902
- 签名: `type ScriptRunEntry = { run: ReturnType<WorkflowEngineLike['start']>; progress: WorkflowPr`

#### 🔧 函数 `runScriptWorkflow` · L954-L1007
- 签名: `async function runScriptWorkflow(id: string, inputs: Record<string, string>, sessionId?: s`

#### 🔧 函数 `workflowProgress` · L1009-L1013
- 签名: `async function workflowProgress(runId: string): Promise<WorkflowProgress> {`

#### 🔧 函数 `cancelScript` · L1016-L1021
- 签名: `async function cancelScript(runId: string): Promise<{ cancelled: boolean }> {`

#### 🔧 函数 `activateWorkflow` · L1023-L1025
- 签名: `async function activateWorkflow(id: string): Promise<SettingsView> {`

#### 🔧 函数 `setOverride` · L1028-L1032
- 签名: `async function setOverride(domain: OverrideDomain, mode: 'default' | 'workbench'): Promise`

#### 🔧 函数 `resetAllOverrides` · L1033-L1040
- 签名: `async function resetAllOverrides(): Promise<SettingsView> {`

#### 🔧 函数 `upsertPrompt` · L1041-L1046
- 签名: `async function upsertPrompt(prompt: PromptTemplate): Promise<SettingsView> {`

#### 🔧 函数 `removePrompt` · L1047-L1050
- 签名: `async function removePrompt(id: string): Promise<SettingsView> {`

#### 🔧 函数 `activatePrompt` · L1051-L1056
- 签名: `async function activatePrompt(id: string): Promise<SettingsView> {`

#### 🔧 函数 `deactivatePrompt` · L1057-L1059
- 签名: `async function deactivatePrompt(): Promise<SettingsView> {`

#### 🔧 函数 `testTool` · L1061-L1075
- 签名: `async function testTool(name: string, args: unknown): Promise<{ ok: boolean; value?: unkno`

#### 🔧 函数 `importSkill` · L1077-L1088
- 签名: `async function importSkill(path: string): Promise<{ ok: boolean; name?: string; error?: st`

#### 🔧 函数 `testServer` · L1090-L1095
- 签名: `async function testServer(serverId: string): Promise<McpTestResult> {`

#### 🔧 函数 `disposeConnection` · L1100-L1106
- 签名: `function disposeConnection(id: string): void {`

#### 🔧 函数 `syncServerConnection` · L1109-L1128
- 签名: `async function syncServerConnection(server: McpServerConfig): Promise<void> {`

#### ⚙️ 方法 `state` · L1139-L1156
- 签名: `async state(sessionId?: string): Promise<StateSnapshot> {`

#### 🔧 函数 `projectResult` · L1237-L1246
- 签名: `function projectResult(result: unknown): unknown {`

### `mcp.ts`
#### 🔧 函数 `testMcpServer` · L24-L67
- 签名: `export async function testMcpServer(server: McpServerConfig): Promise<McpTestResult> {`

#### 🔧 函数 `makeServerId` · L70-L77
- 签名: `export function makeServerId(name: string): string {`

#### 🧬 类型 `ToolRegistryLike` · L80-L82
- 签名: `export interface ToolRegistryLike {`

#### 🧬 类型 `ConnectMcpResult` · L85-L90
- 签名: `export interface ConnectMcpResult {`

#### 🔧 函数 `mcpToolName` · L93-L96
- 签名: `export function mcpToolName(serverId: string, rawName: string): string {`

#### 🔧 函数 `connectMcpServer` · L102-L105
- 签名: `export async function connectMcpServer(`

#### ⚙️ 方法 `execute` · L145-L148
- 签名: `async execute(args) {`

#### 🔧 函数 `toParameterSpec` · L187-L213
- 签名: `function toParameterSpec(inputSchema: unknown): ParameterSchemaSpec {`

#### 🔧 函数 `extractMcpContent` · L216-L228
- 签名: `function extractMcpContent(call: unknown): string {`

### `prompts.ts`
#### 🔧 函数 `safePromptText` · L21-L23
- 签名: `export function safePromptText(content: string): string {`

#### 🔧 函数 `builtinPromptTemplates` · L25-L152
- 签名: `export function builtinPromptTemplates(): PromptTemplate[] {`

### `publish.ts`
#### 🧬 类型 `AgentPresetsFace` · L34-L37
- 签名: `export interface AgentPresetsFace {`

#### 🧬 类型 `PipelineContext` · L40-L48
- 签名: `export interface PipelineContext {`

#### 🔧 函数 `packageRoot` · L51-L53
- 签名: `export function packageRoot(): string {`

#### 🔧 函数 `bundleDir` · L56-L58
- 签名: `export function bundleDir(presetId: string): string {`

#### 🔧 函数 `git` · L61-L75
- 签名: `function git(args: string[], cwd: string): Promise<{ code: number; out: string; err: strin`

#### 🔧 函数 `exists` · L77-L81
- 签名: `async function exists(p: string): Promise<boolean> {`

#### 🔧 函数 `copyTree` · L84-L94
- 签名: `export async function copyTree(from: string, to: string): Promise<void> {`

#### 🔧 函数 `hashTree` · L97-L123
- 签名: `export async function hashTree(dir: string): Promise<string> {`

#### 🔧 函数 `walk` · L99-L120
- 签名: `async function walk(d: string): Promise<void> {`

#### 🧬 类型 `InstallResult` · L125-L128
- 签名: `export interface InstallResult {`

#### 🔧 函数 `ensurePresetInstalled` · L137-L153
- 签名: `export async function ensurePresetInstalled(presetId: string, dshHome: string = homedir())`

#### 🧬 类型 `VerifyResult` · L155-L159
- 签名: `export interface VerifyResult {`

#### 🔧 函数 `verifyPreset` · L162-L172
- 签名: `export async function verifyPreset(agentPresets: AgentPresetsFace, presetId: string): Prom`

#### 🧬 类型 `PublishResult` · L174-L178
- 签名: `export interface PublishResult {`

#### 🔧 函数 `normalizeRemote` · L181-L189
- 签名: `function normalizeRemote(url: string): string {`

#### 🔧 函数 `isOwnerWorktree` · L197-L205
- 签名: `export async function isOwnerWorktree(cwd: string, repo: string): Promise<boolean> {`

#### 🔧 函数 `publishToGitHub` · L211-L228
- 签名: `export async function publishToGitHub(`

#### 🔧 函数 `runPublishPipeline` · L234-L289
- 签名: `export async function runPublishPipeline(ctx: PipelineContext): Promise<string> {`

### `search.ts`
#### 🧬 类型 `IndexedDoc` · L25-L31
- 签名: `export interface IndexedDoc {`

#### 🧬 类型 `CorpusIndex` · L34-L42
- 签名: `export interface CorpusIndex {`

#### 🧬 类型 `RetrievalEngine` · L45-L49
- 签名: `export interface RetrievalEngine {`

#### 🔧 函数 `tokenize` · L54-L68
- 签名: `export function tokenize(text: string): string[] {`

#### 🔧 函数 `chunkText` · L71-L78
- 签名: `export function chunkText(text: string, size: number, overlap: number): string[] {`

#### 🔧 函数 `listCorpusFiles` · L88-L113
- 签名: `export async function listCorpusFiles(`

#### 🔧 函数 `walk` · L94-L110
- 签名: `async function walk(dir: string, inWorkbench: boolean): Promise<void> {`

#### 🔧 函数 `buildCorpusIndex` · L116-L158
- 签名: `export async function buildCorpusIndex(`

#### 🔧 函数 `termScore` · L161-L175
- 签名: `function termScore(`

#### 🔧 函数 `makeSnippet` · L178-L191
- 签名: `function makeSnippet(text: string, queryTerms: Set<string>, radius = 70): string {`

#### 🔧 函数 `searchIndex` · L194-L219
- 签名: `export function searchIndex(index: CorpusIndex, query: string, topK: number): SearchHit[] `

#### 🔧 函数 `corpusSignature` · L222-L230
- 签名: `export async function corpusSignature(corpusDir: string, opts?: { includeWorkbenchLatest?:`

### `workflow.ts`
#### 🔧 函数 `builtinTemplates` · L21-L90
- 签名: `export function builtinTemplates(): WorkflowDefinition[] {`

#### 🔧 函数 `node` · L92-L94
- 签名: `function node(id: string, kind: WorkflowNode['kind'], label: string, params: Record<string`

#### 🧬 类型 `ToolResolver` · L97-L99
- 签名: `export interface ToolResolver {`

#### ⚙️ 方法 `resolve` · L98-L98
- 签名: `resolve(name: string): { name: string; description: string } | null`

#### 🧬 类型 `WorkflowExecEnv` · L102-L108
- 签名: `export interface WorkflowExecEnv {`

#### 🔧 函数 `clip` · L113-L116
- 签名: `function clip(text: string, max = MAX_DETAIL): string {`

#### 🔧 函数 `executeWorkflow` · L122-L239
- 签名: `export async function executeWorkflow(`

#### 🔧 函数 `dryRunWorkflow` · L245-L253
- 签名: `export function dryRunWorkflow(`

#### 🔧 函数 `substitute` · L256-L258
- 签名: `export function substitute(template: string, inputs: Record<string, string>): string {`
