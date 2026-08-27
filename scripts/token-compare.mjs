#!/usr/bin/env node
/**
 * Token-economy benchmark: "with .workbench tools" vs "without".
 *
 * Uses the REAL dsh-workbench sources and the REAL .workbench index. For each
 * real programming task we compare:
 *   A (no tools):   read the whole target file(s) to find the code
 *   B (with tools): workbench_code_locate (query + hit JSON) + read only the
 *                   hit line range
 * Token counts are approximated as chars/3 (mixed CN/EN heuristic), the same
 * yardstick applied to both sides; a full LLM round also includes prompts and
 * completions, which are identical for both arms and therefore omitted.
 *
 * 用法: node scripts/token-compare.mjs [--dir <代码目录>]
 * 需要 Node >= 23.6。确保目标目录已生成 .workbench 索引(宿主 watch / 脚本均可)。
 */
import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { locateInIndexes, collectWorkbenchIndexes } from '../src/codeindex.ts'

function approxTokens(text) {
  return Math.max(1, Math.round(text.length / 3))
}

const root = resolve(process.argv.includes('--dir') ? process.argv[process.argv.indexOf('--dir') + 1] ?? '.' : '.')

// Real tasks on the dsh-workbench codebase. `files` = what a model without
// tools must read in full; `query` = what workbench_code_locate receives.
const tasks = [
  {
    name: '修改 workbench_code_locate 的定位打分逻辑',
    query: '定位 功能块 locateInIndexes',
    files: ['src/codeindex.ts'],
  },
  {
    name: '调整 BM25 关键词打分函数 termScore',
    query: 'BM25 打分 termScore',
    files: ['src/search.ts'],
  },
  {
    name: '给 commitIndex 增加跳过未注释块的功能',
    query: 'commitIndex 合并 注释',
    files: ['src/codeindex.ts'],
  },
  {
    name: '改客户端 RagPanel 的上传文档逻辑',
    query: '上传文档 uploadDocument RagPanel',
    files: ['src/client/modules/RagPanel.tsx'],
  },
  {
    name: '给 RAG 重建引擎加新参数',
    query: '重建 知识库 rebuildRag buildCorpusIndex',
    files: ['src/index.ts', 'src/search.ts'],
  },
]

async function fileText(rel) {
  return readFile(join(root, rel), 'utf8').catch(() => '')
}

console.log(`代码目录: ${root}\n`)
console.log('任务'.padEnd(46) + '| 方案A 读全文 | 方案B 工具 | 节省')
console.log('-'.repeat(110))

let sumA = 0
let sumB = 0
let sumLines = 0

for (const task of tasks) {
  // --- arm A: read whole files -----------------------------------------------
  const fullTexts = await Promise.all(task.files.map(fileText))
  const tokensA = fullTexts.reduce((a, t) => a + approxTokens(t), 0)
  const linesA = fullTexts.reduce((a, t) => a + t.split(/\r?\n/).length, 0)

  // --- arm B: locate + read hit ranges ----------------------------------------
  const groups = await locateInIndexes(root, task.query, 3)
  const hits = groups.flatMap((g) => g.hits)
  const locateJson = JSON.stringify(groups)
  const tokensLocate = approxTokens(locateJson) + approxTokens(task.query)

  let tokensRead = 0
  let linesRead = 0
  const seen = new Set()
  for (const h of hits) {
    const key = `${h.file}:${h.startLine}-${h.endLine}`
    if (seen.has(key)) continue
    seen.add(key)
    // file is relative to its index directory; resolve under that dir
    const hitGroup = groups.find((g) => g.hits.includes(h))
    const abs = join(hitGroup.indexDir, h.file)
    const text = await readFile(abs, 'utf8').catch(() => '')
    const lines = text.split(/\r?\n/)
    const slice = lines.slice(h.startLine - 1, h.endLine).join('\n')
    tokensRead += approxTokens(slice)
    linesRead += h.endLine - h.startLine + 1
  }
  const tokensB = tokensLocate + tokensRead

  sumA += tokensA
  sumB += tokensB
  sumLines += linesA
  const pct = tokensA > 0 ? Math.round((1 - tokensB / tokensA) * 100) : 0
  console.log(
    `${task.name.slice(0, 44).padEnd(44)} | ${String(tokensA).padStart(9)} (${linesA}行) | ${String(tokensB).padStart(8)} (读${linesRead}行) | -${pct}%`,
  )
}

console.log('-'.repeat(110))
console.log(
  `合计${' '.repeat(42)}| ${String(sumA).padStart(9)} | ${String(sumB).padStart(8)} | -${Math.round((1 - sumB / sumA) * 100)}%`,
)
console.log(`\n注: 方案A=读目标文件全文(不含工具时定位的必经成本); 方案B=locate 查询+命中JSON+按行读取; token≈字符数/3, 两臂同口径。`)
