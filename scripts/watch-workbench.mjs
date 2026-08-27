#!/usr/bin/env node
/**
 * 实时维护 .workbench 代码索引(行号自动同步)。
 *
 * 轮询代码目录的轻量签名(mtime+size),有变化就自动重建每个子目录的
 * .workbench/latest.md,并继承上一份索引里的功能注释(按 path+name 就近
 * 匹配),行号始终与当前代码一致。不需要模型参与,不需要记得 commit。
 *
 * 用法:
 *   node scripts/watch-workbench.mjs --dir <代码目录> [--interval 2000] [--snapshot 60000] [--verbose]
 *
 * 参数:
 *   --dir       必填,要监听维护索引的代码目录(绝对或相对路径)
 *   --interval  轮询间隔毫秒,默认 2000
 *   --snapshot  时间戳快照节流毫秒,默认 60000(1 分钟内只写一份快照,
 *               latest.md 始终实时更新);0 = 每次都写新快照
 *   --verbose   打印每次同步明细
 *
 * 需要 Node >= 23.6(直接执行 TS 源码)。
 */
import { resolve } from 'node:path'
import { codeDirSignature, refreshIndex } from '../src/codeindex.ts'

function arg(name, def) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : def
}
function flag(name) {
  return process.argv.includes(`--${name}`)
}

const dirArg = arg('dir', '')
if (!dirArg) {
  console.error('用法: node scripts/watch-workbench.mjs --dir <代码目录> [--interval 2000] [--snapshot 60000] [--verbose]')
  process.exit(1)
}
const root = resolve(dirArg)
const intervalMs = Math.max(500, Number(arg('interval', '2000')))
const snapshotMs = Math.max(0, Number(arg('snapshot', '60000')))
const verbose = flag('verbose')

let sig = ''
let busy = false
let dirty = false

async function sync(reason) {
  if (busy) {
    dirty = true
    return
  }
  busy = true
  try {
    const next = await codeDirSignature(root)
    if (next === sig) return
    sig = next
    const res = await refreshIndex(root, {
      note: `实时同步${reason ? `: ${reason}` : ''}`,
      snapshotThrottleMs: snapshotMs,
    })
    const added = res.dirs.reduce((a, d) => a + d.added, 0)
    const updated = res.dirs.reduce((a, d) => a + d.updated, 0)
    const removed = res.dirs.reduce((a, d) => a + d.removed, 0)
    console.log(
      `[workbench] ${new Date().toLocaleTimeString()} 同步 ${res.total_blocks} 块 (新增 ${added} / 更新 ${updated} / 移除 ${removed}), 继承注释 ${res.annotated}, 写入 ${res.written.length} 个索引`,
    )
    if (verbose && res.warnings.length) console.warn('[workbench] 警告:', res.warnings)
  } catch (error) {
    console.error(`[workbench] 同步失败: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    busy = false
    if (dirty) {
      dirty = false
      void sync('补跑')
    }
  }
}

console.log(`[workbench] 监听 ${root} (间隔 ${intervalMs}ms, 快照节流 ${snapshotMs}ms) — Ctrl+C 退出`)
await sync('启动')
setInterval(() => void sync('变化'), intervalMs)
