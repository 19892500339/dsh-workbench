/**
 * Unit tests for the V6 publish pipeline (node --test).
 *
 * Covers the pure filesystem/git logic: deterministic tree hashing, install /
 * refresh / backup semantics of ensurePresetInstalled, and owner-worktree
 * detection against the real plugin repository.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hashTree,
  ensurePresetInstalled,
  packageRoot,
  isOwnerWorktree,
  bundleDir,
} from '../src/publish.ts'

test('hashTree is deterministic and content-sensitive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-hash-'))
  try {
    await writeFile(join(dir, 'a.txt'), 'hello', 'utf8')
    await mkdir(join(dir, 'sub'))
    await writeFile(join(dir, 'sub', 'b.txt'), 'world', 'utf8')
    const first = await hashTree(dir)
    const second = await hashTree(dir)
    assert.equal(first, second)
    await writeFile(join(dir, 'a.txt'), 'hello!', 'utf8')
    const changed = await hashTree(dir)
    assert.notEqual(first, changed)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ensurePresetInstalled installs the bundled workbench preset into a fresh home', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-workbench-home-'))
  try {
    const result = await ensurePresetInstalled('workbench', home)
    assert.equal(result.action, 'installed')
    const presetDir = join(home, '.agent-presets', 'workbench')
    assert.equal(result.presetDir, presetDir)
    // The three bundled files must all be present.
    const agent = await readFile(join(presetDir, 'agent.cordis.yml'), 'utf8')
    const meta = await readFile(join(presetDir, 'preset.yml'), 'utf8')
    const plugin = await readFile(join(presetDir, 'plugins', 'workbench-code-find.mjs'), 'utf8')
    assert.ok(agent.includes('tool-workbench-code-find'))
    assert.ok(meta.includes('x-managed-by: dsh-workbench'))
    assert.ok(plugin.length > 100)
    // Second run: no change.
    const again = await ensurePresetInstalled('workbench', home)
    assert.equal(again.action, 'up-to-date')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('ensurePresetInstalled backs up and refreshes when the installed copy diverged', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-workbench-home-'))
  try {
    await ensurePresetInstalled('workbench', home)
    const presetDir = join(home, '.agent-presets', 'workbench')
    // Simulate a user edit to the installed copy.
    await writeFile(join(presetDir, 'agent.cordis.yml'), '# user edit\n', 'utf8')
    const result = await ensurePresetInstalled('workbench', home)
    assert.equal(result.action, 'refreshed')
    const fresh = await readFile(join(presetDir, 'agent.cordis.yml'), 'utf8')
    assert.ok(!fresh.startsWith('# user edit'))
    // The user edit is preserved under a timestamped backup.
    const entries = await import('node:fs/promises').then((fs) => fs.readdir(join(home, '.agent-presets')))
    const backup = entries.find((e) => e.startsWith('workbench.bak-'))
    assert.ok(backup, 'expected a timestamped backup directory')
    const backupAgent = await readFile(join(home, '.agent-presets', backup!, 'agent.cordis.yml'), 'utf8')
    assert.equal(backupAgent, '# user edit\n')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('isOwnerWorktree detects the real plugin repository', async () => {
  // The test runs from the plugin repo itself; packageRoot() resolves there.
  const root = packageRoot()
  assert.ok(root.endsWith('dsh-workbench'))
  assert.ok(await isOwnerWorktree(root, 'https://github.com/19892500339/dsh-workbench.git'))
  assert.ok(await isOwnerWorktree(root, 'git+https://github.com/19892500339/dsh-workbench'))
  assert.ok(!(await isOwnerWorktree(root, 'https://github.com/someone/else.git')))
})

test('bundleDir points at the bundled preset directory', () => {
  const dir = bundleDir('workbench')
  assert.ok(dir.endsWith(join('presets', 'workbench')))
})
