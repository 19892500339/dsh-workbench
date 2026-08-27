# 📇 代码索引 · E:\dsh_work\dsh-workbench\src\shared · 2026-08-27_184029

> 由 dsh-workbench `workbench_code_index` 生成 · 每块记录「文件 + 起始行/结束行」· 检索直达请用 `workbench_code_locate` · 本目录最新索引始终在 `latest.md`

## 🔄 本次变更
- 新增: 23 · 更新: 0 · 移除: 22 · 当前块总数: 23
- 说明: V6: 新增 src/publish.ts 预设自动配置+挂载验证+GitHub 发布流水线; shared/types.ts 新增 PublishSettings 类型与 WorkbenchState.publish 字段; config.ts 新增 publish 设置段; index.ts apply() 接入 runPublishPipeline

## 📄 文件清单
| 文件 | 块数 | 行数 |
|---|---|---|
| `types.ts` | 23 | 269 |

## 🧩 功能块
### `types.ts`
#### 🧬 类型 `McpServerConfig` · L8-L27
- 签名: `export interface McpServerConfig {`

#### 🧬 类型 `McpTestResult` · L30-L38
- 签名: `export interface McpTestResult {`

#### 🧬 类型 `WorkflowNode` · L41-L49
- 签名: `export interface WorkflowNode {`

#### 🧬 类型 `WorkflowScriptMeta` · L52-L57
- 签名: `export interface WorkflowScriptMeta {`

#### 🧬 类型 `WorkflowDefinition` · L60-L71
- 签名: `export interface WorkflowDefinition {`

#### 🧬 类型 `WorkflowStepLog` · L74-L82
- 签名: `export interface WorkflowStepLog {`

#### 🧬 类型 `WorkflowScriptResult` · L85-L91
- 签名: `export interface WorkflowScriptResult {`

#### 🧬 类型 `WorkflowProgressEntry` · L94-L106
- 签名: `export interface WorkflowProgressEntry {`

#### 🧬 类型 `WorkflowProgress` · L109-L116
- 签名: `export interface WorkflowProgress {`

#### 🧬 类型 `PromptTemplate` · L119-L126
- 签名: `export interface PromptTemplate {`

#### 🧬 类型 `KnowledgeBase` · L129-L134
- 签名: `export interface KnowledgeBase {`

#### 🧬 类型 `ToolView` · L137-L144
- 签名: `export interface ToolView {`

#### 🧬 类型 `SkillView` · L147-L152
- 签名: `export interface SkillView {`

#### 🧬 类型 `RagIndexInfo` · L155-L166
- 签名: `export interface RagIndexInfo {`

#### 🧬 类型 `SearchHit` · L169-L175
- 签名: `export interface SearchHit {`

#### 🧬 类型 `EmbeddingConfig` · L178-L183
- 签名: `export interface EmbeddingConfig {`

#### 🧬 类型 `OverrideMode` · L186-L196
- 签名: `export type OverrideMode = 'default' | 'workbench'`

#### 🧬 类型 `RagOverrideMode` · L188-L196
- 签名: `export type RagOverrideMode = 'default' | 'workbench' | 'custom'`

#### 🧬 类型 `MechanismOverrides` · L191-L196
- 签名: `export interface MechanismOverrides {`

#### 🧬 类型 `PublishSettings` · L199-L214
- 签名: `export interface PublishSettings {`
- 功能: V6 发布流水线持久化设置: 开关/预设id/仓库/分支/自动推送/上次状态
- 入参: 无
- 返回: 接口类型
- 副作用: 无
- 依赖: 无

#### 🧬 类型 `WorkbenchState` · L217-L249
- 签名: `export interface WorkbenchState {`
- 功能: 完整持久化工作台状态(新增 publish 字段)
- 入参: 无
- 返回: 接口类型
- 副作用: 无
- 依赖: PublishSettings 等

#### 🧬 类型 `McpConnectionStatus` · L252-L257
- 签名: `export interface McpConnectionStatus {`

#### 🧬 类型 `StateSnapshot` · L260-L268
- 签名: `export interface StateSnapshot {`
