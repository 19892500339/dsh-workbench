# dsh-workbench 报错与修改日志

> 本文件记录两次导致 DeepSeek Harness 启动崩溃的报错及修复。**请 DeepSeek Harness 在后续生成/修改本插件代码时，务必遵守文末规则，不要再犯同类错误。**

---

## 一、报错 ①：变量名非法（已修复）

**现象**：`dsh web` 启动崩溃，插件树加载失败。

**报错原文**：
```
Error: dsh: plugin tree failed to load: failed to apply loader entry workbench (dsh-workbench):
invalid prompt variable name "workbench.activePrompt" (must match /^[a-z][a-z0-9_]*$/)
```

**根因**：`ctx.systemPrompt.variable(name)` 的变量名必须匹配 `/^[a-z][a-z0-9_]*$/`。`workbench.activePrompt` 含点号 `.` 和大写 `P`，非法。

**修复**：`workbench.activePrompt` → `workbench_active_prompt`（含 README/注释同步）。

---

## 二、报错 ②：客户端入口未声明 locale 服务依赖（已修复）

**现象**：变量名修复后再次启动，仍然 `Failed to load plugins`。

**报错原文**：
```
Error: dsh: plugin tree failed to load: failed to apply loader entry 576c19f8 (dsh-workbench):
cannot get property "locale" without inject
```

**根因**：`src/client/index.tsx` 第 28 行访问了 `ctx.locale`，但第 13 行的 `inject` 数组只声明了 `['slots']`，没声明 `'locale'`。Cordis loader 要求：访问的任何 `ctx.*` 服务都必须在 `inject` 数组里声明，否则抛此异常。

**修复**：
```diff
- export const inject = ['slots'] as const
+ export const inject = ['slots', 'locale'] as const
```

---

## 三、给 DeepSeek Harness 的规则（务必遵守）

### 规则 1：变量名（systemPrompt.variable）
1. `systemPrompt.variable(name)` 的 `name` 必须匹配 `/^[a-z][a-z0-9_]*$/`：
   - 只能小写字母、数字、下划线 `_`；
   - 禁止点号 `.`、大写字母、连字符 `-`、空格；
   - 必须以小写字母开头。
2. 命名统一用 **snake_case**（如 `workbench_active_prompt`），不要用 camelCase 或点号命名空间。
3. `systemPrompt.section(name)` 允许冒号（如 `workbench:search`），与 `variable` 规则不同，注意区分。

### 规则 2：inject 数组必须覆盖所有 ctx.* 访问（重要）
1. 插件入口（host `apply`、client `apply`）里 **访问过的每一个 `ctx.<service>` 服务**，都必须出现在 `export const inject = [...]` 数组里。
2. 当前 dsh-workbench 已声明：`['tools', 'webServer', 'settings', 'systemPrompt', 'skills']`（host）和 `['slots', 'locale']`（client）。
3. 凡是新增 `ctx.xxx` 调用，第一时间把 `'xxx'` 加进 `inject`。
4. 报错 `cannot get property "X" without inject` 就是这条规则没遵守的自检信号。

### 规则 3：生成代码后自检
每写完一段 `apply(ctx)` 代码，先做一次正则自检：
- 所有 `systemPrompt.variable(name)`：`name` 匹配 `/^[a-z][a-z0-9_]*$/`？
- 所有 `ctx.<x>` 访问：`<x>` 在 `inject` 数组里？
再继续。

---

## 四、排障命令备忘

```sh
# 看配置树是否正确加载（不执行 apply）
dsh --profile web --dump-config

# 真正启动看运行时 apply 报错（注意 dsh web 不接受 --profile 参数）
dsh web
```