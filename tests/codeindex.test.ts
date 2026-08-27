/**
 * Unit tests for the .workbench code index (node --test).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  scanDirectory,
  commitIndex,
  refreshIndex,
  codeDirSignature,
  locateInIndexes,
  parseIndexMd,
  renderIndexMd,
  timestampName,
} from '../src/codeindex.ts'
import { listCorpusFiles } from '../src/search.ts'

async function makeFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-codeindex-test-'))
  await writeFile(
    join(dir, 'index.js'),
    [
      '// App entry',
      "import { greet } from './util.js'",
      '',
      'export function main() {',
      "  const msg = greet('world')",
      '  return msg',
      '}',
      '',
      'const App = () => {',
      '  return <div>hello</div>',
      '}',
      '',
      'class Store {',
      '  constructor() {',
      '    this.x = 1',
      '  }',
      '',
      '  get() {',
      '    return this.x',
      '  }',
      '}',
      '',
    ].join('\n'),
    'utf8',
  )
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(
    join(dir, 'src', 'util.py'),
    [
      '# helper',
      'def greet(name):',
      '    return f"hello {name}"',
      '',
      '',
      'class Runner:',
      '    def run(self):',
      '        return 1',
      '',
    ].join('\n'),
    'utf8',
  )
  return dir
}

test('scanDirectory extracts blocks with line ranges', async () => {
  const dir = await makeFixture()
  try {
    const res = await scanDirectory(dir)
    assert.equal(res.files.length, 2)
    assert.deepEqual(res.indexDirs.sort(), ['.', 'src'])

    const main = res.blocks.find((b) => b.name === 'main')
    assert.ok(main)
    assert.equal(main.kind, 'function')
    assert.equal(main.startLine, 4)
    assert.equal(main.endLine, 7)

    const app = res.blocks.find((b) => b.name === 'App')
    assert.ok(app)
    assert.equal(app.kind, 'component')

    const store = res.blocks.find((b) => b.name === 'Store')
    assert.ok(store)
    assert.equal(store.kind, 'class')
    assert.equal(store.startLine, 13)
    assert.equal(store.endLine, 21)

    const ctor = res.blocks.find((b) => b.name === 'constructor')
    assert.ok(ctor)
    assert.equal(ctor.kind, 'method')
    assert.equal(ctor.endLine, 16)

    const greet = res.blocks.find((b) => b.name === 'greet')
    assert.ok(greet)
    assert.equal(greet.kind, 'function')
    assert.equal(greet.startLine, 2)
    assert.equal(greet.endLine, 3)

    const runner = res.blocks.find((b) => b.name === 'Runner')
    assert.ok(runner)
    assert.equal(runner.kind, 'class')

    const run = res.blocks.find((b) => b.name === 'run')
    assert.ok(run)
    assert.equal(run.kind, 'method')
    assert.equal(run.startLine, 7)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('commitIndex writes per-directory .workbench with latest.md + history', async () => {
  const dir = await makeFixture()
  try {
    const res = await commitIndex(dir, [
      { path: 'index.js', name: 'main', startLine: 4, summary: '应用入口: 组装问候语并返回' },
      { path: 'index.js', name: 'App', startLine: 9, summary: 'App 根组件' },
      { path: 'src/util.py', name: 'greet', startLine: 2, summary: '生成问候语' },
    ])
    assert.equal(res.written.length, 2)
    assert.equal(res.annotated, 3)
    assert.equal(res.warnings.length, 0)

    // Root index contains only root files; src index contains only src files.
    const rootLatest = await readFile(join(dir, '.workbench', 'latest.md'), 'utf8')
    const srcLatest = await readFile(join(dir, 'src', '.workbench', 'latest.md'), 'utf8')
    assert.ok(rootLatest.includes('main'))
    assert.ok(!rootLatest.includes('greet'))
    assert.ok(srcLatest.includes('greet'))
    assert.ok(srcLatest.includes('Runner'))

    // Snapshot files exist and equal latest (first run).
    const snapshot = res.written[0]!
    assert.ok(snapshot.endsWith('.md'))
    const snapshotText = await readFile(snapshot, 'utf8')
    assert.equal(snapshotText, rootLatest)

    // Parse roundtrip keeps the annotation.
    const blocks = parseIndexMd(rootLatest)
    const main = blocks.find((b) => b.name === 'main')
    assert.ok(main)
    assert.equal(main.startLine, 4)
    assert.equal(main.endLine, 7)
    assert.equal(main.summary, '应用入口: 组装问候语并返回')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('locateInIndexes finds blocks across nested .workbench indexes', async () => {
  const dir = await makeFixture()
  try {
    await commitIndex(dir, [
      { path: 'index.js', name: 'main', startLine: 4, summary: '应用入口: 组装问候语并返回' },
      { path: 'index.js', name: 'App', startLine: 9, summary: 'App 根组件' },
      { path: 'src/util.py', name: 'greet', startLine: 2, summary: '生成问候语' },
    ])
    const groups = await locateInIndexes(dir, '问候语', 5)
    assert.ok(groups.length >= 2)
    const all = groups.flatMap((g) => g.hits)
    const main = all.find((h) => h.name === 'main')
    assert.ok(main)
    assert.equal(main.startLine, 4)
    assert.equal(main.endLine, 7)
    const greet = all.find((h) => h.name === 'greet')
    assert.ok(greet)
    assert.equal(greet.file, 'util.py')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('listCorpusFiles optionally includes .workbench/latest.md only', async () => {
  const dir = await makeFixture()
  try {
    await commitIndex(dir, [{ path: 'index.js', name: 'main', startLine: 4, summary: 'x' }])
    const plain = await listCorpusFiles(dir)
    assert.equal(plain.length, 0) // no .md/.txt outside .workbench
    const withWb = await listCorpusFiles(dir, { includeWorkbenchLatest: true })
    assert.equal(withWb.length, 2) // root + src latest.md
    assert.ok(withWb.every((f) => f.endsWith(join('.workbench', 'latest.md'))))
    // timestamped history snapshots are NOT indexed
    const history = withWb.filter((f) => !f.endsWith('latest.md'))
    assert.equal(history.length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('timestampName produces sortable snapshot names', () => {
  const a = timestampName(new Date(2025, 0, 2, 3, 4, 5))
  assert.equal(a, '2025-01-02_030405')
  assert.ok(a < timestampName(new Date(2025, 0, 2, 3, 4, 6)))
})

test('scanDirectory handles tricky signatures (type literals, regexes, defaults, JSX)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-codeindex-tricky-'))
  try {
    await writeFile(
      join(dir, 'tricky.ts'),
      [
        'export function withTypeLiteral(t: string): { name: string; kind: BlockKind } | null {',
        "  return { name: t, kind: 'function' }",
        '}',
        '',
        'export function withDefaults(a = \'{}\', b: { x: number } = { x: 1 }): void {',
        '  return',
        '}',
        '',
        'export function withRegex(text: string): boolean {',
        '  const m = text.match(/^### `(.+)`$/)',
        '  return m !== null',
        '}',
        '',
        'const Widget = () => {',
        '  return <div>hello</div>',
        '}',
        '',
        'export function wrappedSignature(',
        '  a: string,',
        '  b: { x: number },',
        '): boolean {',
        '  return a.length > 0',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
    const res = await scanDirectory(dir)
    const byName = new Map(res.blocks.map((b) => [b.name, b]))

    // Return-type object literal must not truncate the block to its own line.
    const literal = byName.get('withTypeLiteral')
    assert.ok(literal)
    assert.equal(literal.startLine, 1)
    assert.equal(literal.endLine, 3)

    // Default values with braces must not truncate the block.
    const defaults = byName.get('withDefaults')
    assert.ok(defaults)
    assert.equal(defaults.endLine - defaults.startLine + 1, 3)

    // Regex literals containing backticks must not swallow the block end.
    const regex = byName.get('withRegex')
    assert.ok(regex)
    assert.equal(regex.endLine - regex.startLine + 1, 4)

    // JSX arrow constant with a closing tag must be a component.
    const widget = byName.get('Widget')
    assert.ok(widget)
    assert.equal(widget.kind, 'component')
    assert.equal(widget.endLine - widget.startLine + 1, 3)

    // Multi-line wrapped signature: body brace sits beyond the decl line.
    const wrapped = byName.get('wrappedSignature')
    assert.ok(wrapped)
    assert.equal(wrapped.startLine, 18)
    assert.equal(wrapped.endLine, 23)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refreshIndex refreshes line numbers and inherits annotations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-codeindex-refresh-'))
  try {
    await writeFile(
      join(dir, 'a.ts'),
      [
        'export function foo() {',
        '  return 1',
        '}',
        '',
        'export function bar() {',
        '  return 2',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
    await commitIndex(dir, [
      { path: 'a.ts', name: 'foo', startLine: 1, summary: '返回 1' },
      { path: 'a.ts', name: 'bar', startLine: 5, summary: '返回 2' },
    ])

    // Insert two lines at the top: foo shifts 1→3, bar 5→7.
    await writeFile(
      join(dir, 'a.ts'),
      [
        '// header',
        '',
        'export function foo() {',
        '  return 1',
        '}',
        '',
        'export function bar() {',
        '  return 2',
        '}',
        '',
      ].join('\n'),
      'utf8',
    )
    const res = await refreshIndex(dir)
    assert.equal(res.annotated, 2)

    const blocks = parseIndexMd(await readFile(join(dir, '.workbench', 'latest.md'), 'utf8'))
    const foo = blocks.find((b) => b.name === 'foo')
    assert.ok(foo)
    assert.equal(foo.startLine, 3) // line number refreshed
    assert.equal(foo.summary, '返回 1') // annotation inherited
    const bar = blocks.find((b) => b.name === 'bar')
    assert.ok(bar)
    assert.equal(bar.startLine, 7)
    assert.equal(bar.summary, '返回 2')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('refreshIndex inherits annotations for files in subdirectories', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-codeindex-refresh-sub-'))
  try {
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'demo.ts'), 'export function foo() {\n  return 1\n}\n', 'utf8')
    await commitIndex(dir, [{ path: 'src/demo.ts', name: 'foo', startLine: 1, summary: '返回 1' }])

    // Shift foo down by one line.
    await writeFile(join(dir, 'src', 'demo.ts'), '// header\nexport function foo() {\n  return 1\n}\n', 'utf8')
    const res = await refreshIndex(dir)
    assert.equal(res.annotated, 1)

    // The index lives under src/.workbench and the stored path is the basename.
    const blocks = parseIndexMd(await readFile(join(dir, 'src', '.workbench', 'latest.md'), 'utf8'))
    const foo = blocks.find((b) => b.name === 'foo')
    assert.ok(foo)
    assert.equal(foo.startLine, 2)
    assert.equal(foo.summary, '返回 1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('codeDirSignature detects file changes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-codeindex-sig-'))
  try {
    await writeFile(join(dir, 'a.ts'), 'export const a = 1\n', 'utf8')
    const s1 = await codeDirSignature(dir)
    await writeFile(join(dir, 'a.ts'), 'export const a = 1\nexport const b = 2\n', 'utf8')
    const s2 = await codeDirSignature(dir)
    assert.notEqual(s1, s2)
    assert.equal(await codeDirSignature(dir), s2) // stable while unchanged
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('scanDirectory covers the language matrix (front-end + back-end)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-codeindex-langs-'))
  const files: Array<[string, string]> = [
    ['a.js', 'export function hello() {\n  return 1\n}\n'],
    ['b.py', 'def greet():\n    return 1\n'],
    ['c.go', 'package x\nfunc Run() int {\n  return 1\n}\n'],
    ['d.rs', 'pub fn main() {\n  println!("x");\n}\n'],
    ['e.java', 'public class Foo {\n  public int bar() {\n    return 1;\n  }\n}\n'],
    ['f.cs', 'public class Foo {\n  public int Bar() {\n    return 1;\n  }\n}\n'],
    ['g.c', 'int add(int a, int b) {\n  return a + b;\n}\n'],
    ['h.cpp', 'int mul(int a, int b) {\n  return a * b;\n}\n'],
    ['i.php', 'function greet($name) {\n  return "hi " . $name;\n}\n'],
    ['j.rb', 'def greet(name)\n  "hi " + name\nend\n'],
    ['k.kt', 'fun greet(name: String): String {\n  return "hi"\n}\n'],
    ['l.swift', 'func greet(name: String) -> String {\n  return "hi"\n}\n'],
    ['m.dart', 'void main() {\n  print("x");\n}\n'],
    ['n.lua', 'function greet()\n  return 1\nend\n'],
    ['o.sh', 'greet() {\n  echo hi\n}\n'],
    ['p.mm', '#import <Foundation/Foundation.h>\nint main(void) { return 0; }\n'],
    ['q.vue', '<template>\n  <div>hi</div>\n</template>\n\n<script lang="ts">\nimport { ref } from "vue"\nexport function useGreet() {\n  return ref("hi")\n}\n</script>\n'],
  ]
  try {
    for (const [name, content] of files) await writeFile(join(dir, name), content)
    const res = await scanDirectory(dir)
    assert.equal(res.files.length, files.length) // every file is indexed

    const expect: Array<[string, string, number]> = [
      // file, expected block name, expected 1-based start line
      ['a.js', 'hello', 1],
      ['b.py', 'greet', 1],
      ['c.go', 'Run', 2],
      ['d.rs', 'main', 1],
      ['e.java', 'bar', 2],
      ['f.cs', 'Bar', 2],
      ['g.c', 'add', 1],
      ['h.cpp', 'mul', 1],
      ['i.php', 'greet', 1],
      ['j.rb', 'greet', 1],
      ['k.kt', 'greet', 1],
      ['l.swift', 'greet', 1],
      ['m.dart', 'main', 1],
      ['n.lua', 'greet', 1],
      ['o.sh', 'greet', 1],
      ['p.mm', 'main', 2],
      ['q.vue', 'useGreet', 7], // line offset back into the original file
    ]
    for (const [file, name, line] of expect) {
      const block = res.blocks.find((b) => b.path === file && b.name === name)
      assert.ok(block, `${file} 应检测到 ${name}`)
      assert.equal(block.startLine, line, `${file} ${name} 起始行`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('renderIndexMd is compact and parseable', () => {
  const md = renderIndexMd({
    root: '/proj',
    files: [{ path: 'a.ts', lines: 10, blocks: 1 }],
    blocks: [
      { path: 'a.ts', name: 'foo', kind: 'function', startLine: 1, endLine: 5, signature: 'function foo() {', doc: '', preview: '', summary: '干一件事' },
    ],
    timestamp: '2025-01-02_030405',
    changed: { added: 1, updated: 0, removed: 0, total: 1 },
  })
  assert.ok(md.includes('### `a.ts`'))
  assert.ok(md.includes('#### 🔧 函数 `foo` · L1-L5'))
  assert.ok(md.includes('- 功能: 干一件事'))
  const parsed = parseIndexMd(md)
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]!.name, 'foo')
  assert.equal(parsed[0]!.summary, '干一件事')
})
