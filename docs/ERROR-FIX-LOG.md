# dsh-workbench 报错与修改日志

> 本文件记录一次导致 DeepSeek Harness 启动崩溃的报错及修复。**请 DeepSeek Harness 在后续生成/修改本插件代码时，务必遵守文末规则，不要再犯同类错误。**

---

## 一、报错现象

挂载 `dsh-workbench` 插件后，`dsh web` 启动即崩溃，插件树加载失败。

## 二、报错原文

```
Error: dsh: plugin tree failed to load: failed to apply loader entry workbench (dsh-workbench):
invalid prompt variable name "workbench.activePrompt" (must match /^[a-z][a-z0-9_]*$/)
```

## 三、根因

`ctx.systemPrompt.variable(name)` 的变量名有严格校验，必须匹配正则 `/^[a-z][a-z0-9_]*$/`。

而代码里写的是 `workbench.activePrompt`，包含了：

- 点号 `.`（非法）
- 大写字母 `P`（非法）

插件在 `apply` 阶段抛错 → 整个插件树加载失败 → DSH 启动崩溃。

## 四、修改内容

| 文件 | 修改 |
|---|---|
| `src/index.ts` | `'workbench.activePrompt'` → `'workbench_active_prompt'` |
| `src/index.ts`（注释） | 同步变量名 |
| `src/client/modules/PromptPanel.tsx`（注释） | 同步变量名 |
| `README.md` / `README.zh.md` | 同步变量名 |

修改后重新 `npm run build`，`dsh web` 恢复正常。

---

## 五、给 DeepSeek Harness 的规则（务必遵守）

1. **`systemPrompt.variable(name)` 的 name 必须匹配 `/^[a-z][a-z0-9_]*$/`**：
   - 只能使用小写字母、数字、下划线 `_`；
   - 禁止使用点号 `.`、大写字母、连字符 `-`、空格；
   - 必须以小写字母开头。

2. **变量命名统一用 snake_case**（小写下划线），例如 `workbench_active_prompt`，不要用 camelCase 或点号命名空间。

3. **`systemPrompt.section(name)` 的 name 允许冒号**，例如 `workbench:search` 是合法的，与 `variable` 规则不同，注意区分。

4. 生成任何 `systemPrompt.variable(...)` 调用后，先自查变量名是否满足第 1 条正则，再继续。
