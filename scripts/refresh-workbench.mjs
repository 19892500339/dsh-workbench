#!/usr/bin/env node
/**
 * 一次性刷新 .workbench 代码索引(行号与当前代码同步,继承已有注释)。
 *
 * 适合挂在 git hook、npm build 或编辑器保存钩子上,不想常驻 watch 时用:
 *
 *   # 手动跑
 *   node scripts/refresh-workbench.mjs <代码目录>
 *
 *   # 挂在 git post-commit hook(.git/hooks/post-commit)
 *   #!/bin/sh
 *   node /绝对路径/dsh-workbench/scripts/refresh-workbench.mjs "$(git rev-parse --show-toplevel)"
 *
 *   # 挂在 npm script
 *   "build": "tsc && node dsh-workbench/scripts/refresh-workbench.mjs ."
 *
 * 需要 Node >= 23.6(直接执行 TS 源码)。
 */
import { resolve } from 'node:path'
import { refreshIndex } from '../src/codeindex.ts'

const dir = process.argv[2]
if (!dir) {
  console.error('用法: node scripts/refresh-workbench.mjs <代码目录>')
  process.exit(1)
}
const root = resolve(dir)
const res = await refreshIndex(root, { note: '手动刷新(行号同步)' })
console.log(
  `[workbench] ${root}: ${res.total_blocks} 块, 继承注释 ${res.annotated}, 写入 ${res.written.length} 个索引`,
)
if (res.warnings.length) console.warn('[workbench] 警告:', res.warnings)
