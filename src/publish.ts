/**
 * dsh-workbench V6 publish pipeline.
 *
 * When the plugin is downloaded/installed into a DSH (its host `apply()` runs,
 * e.g. `dsh plugin --profile web add dsh-workbench` or a fresh install), this
 * module:
 *
 *   1. **configures the preset** — copies the bundled `presets/<presetId>`
 *      agent preset into `$DSH_HOME/.agent-presets/<presetId>` so the roster
 *      picks it up (install when missing; when the bundled content changed the
 *      installed copy is preserved under a timestamped backup and refreshed);
 *   2. **verifies it** — `agentPresets.standingKeyFor(presetId)` performs the
 *      real mount validation (the same composition the roster mounts at
 *      session start, minus the agent);
 *   3. **uploads to GitHub** — after verification passes, the plugin workspace
 *      is committed and pushed to the configured repository as the updated
 *      version (overwrite). This step only runs from the OWNER's git worktree
 *      (the package directory is a git repo whose `origin` matches the
 *      configured repository) — downloader installs under node_modules never
 *      push anything.
 *
 * Every step is best-effort: failures are recorded into `publish.lastStatus`
 * and logged, never thrown, so the plugin tree still activates.
 */
import { homedir } from 'node:os'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, copyFile, readdir, readFile, rename, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { PublishSettings } from './shared/types.js'

/** Minimal face of the DSH agentPresets service this pipeline needs. */
export interface AgentPresetsFace {
  /** Mount-validate one preset id (rejects on composition errors). */
  standingKeyFor?(id?: string): Promise<unknown>
}

/** Everything the pipeline reads/writes. Supplied by src/index.ts. */
export interface PipelineContext {
  agentPresets: AgentPresetsFace
  /** $DSH_HOME — defaults to os.homedir()/.dsh. */
  dshHome?: string
  /** Current persisted publish settings. */
  getState(): PublishSettings
  /** Persist a pipeline status line (merged into publish.lastStatus/lastAt). */
  recordStatus(status: string): Promise<void>
}

/** Package root: `lib/` lives directly under it (lib/index.js -> ../). */
export function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

/** Absolute path of the bundled preset directory inside the package. */
export function bundleDir(presetId: string): string {
  return join(packageRoot(), 'presets', presetId)
}

/** Run one git command, capturing output; never throws. */
function git(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((res) => {
    const child = spawn('git', args, { cwd, windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d: Buffer) => {
      out += String(d)
    })
    child.stderr.on('data', (d: Buffer) => {
      err += String(d)
    })
    child.on('error', (e: Error) => res({ code: -1, out, err: String(e) }))
    child.on('close', (code) => res({ code: code ?? -1, out, err }))
  })
}

async function exists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false)
}

/** Recursive directory copy (preserves relative layout; no symlinks). */
export async function copyTree(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true })
  const entries = await readdir(from)
  for (const entry of entries) {
    const s = join(from, entry)
    const t = join(to, entry)
    const info = await stat(s)
    if (info.isDirectory()) await copyTree(s, t)
    else await copyFile(s, t)
  }
}

/** Deterministic sha256 over every file under `dir` (sorted relative paths). */
export async function hashTree(dir: string): Promise<string> {
  const hash = createHash('sha256')
  async function walk(d: string): Promise<void> {
    let entries: string[] = []
    try {
      entries = await readdir(d)
    } catch {
      return
    }
    entries.sort()
    for (const entry of entries) {
      const p = join(d, entry)
      const info = await stat(p).catch(() => null)
      if (info === null) continue
      if (info.isDirectory()) {
        await walk(p)
        continue
      }
      const buf = await readFile(p).catch(() => null)
      if (buf === null) continue
      hash.update(relative(dir, p))
      hash.update(buf)
    }
  }
  await walk(dir)
  return hash.digest('hex')
}

export interface InstallResult {
  action: 'installed' | 'refreshed' | 'up-to-date'
  presetDir: string
}

/**
 * Auto-configure the bundled preset into the local DSH:
 * - missing  -> install a copy of the bundle;
 * - changed  -> preserve the installed copy under `<presetId>.bak-<ts>` and
 *               refresh from the bundle (keeps any user edits recoverable);
 * - identical -> no-op.
 */
export async function ensurePresetInstalled(presetId: string, dshHome: string = homedir()): Promise<InstallResult> {
  const root = join(dshHome, '.agent-presets')
  const target = join(root, presetId)
  const bundle = bundleDir(presetId)
  await mkdir(root, { recursive: true })
  if (!(await exists(target))) {
    await copyTree(bundle, target)
    return { action: 'installed', presetDir: target }
  }
  const bundleHash = await hashTree(bundle)
  const installedHash = await hashTree(target)
  if (bundleHash === installedHash) return { action: 'up-to-date', presetDir: target }
  const backup = join(root, `${presetId}.bak-${Date.now()}`)
  await rename(target, backup)
  await copyTree(bundle, target)
  return { action: 'refreshed', presetDir: target }
}

export interface VerifyResult {
  ok: boolean
  presetId: string
  message: string
}

/** Mount-validate the preset through the real roster check. */
export async function verifyPreset(agentPresets: AgentPresetsFace, presetId: string): Promise<VerifyResult> {
  if (typeof agentPresets.standingKeyFor !== 'function') {
    return { ok: false, presetId, message: 'agentPresets.standingKeyFor 不可用（宿主未提供）' }
  }
  try {
    await agentPresets.standingKeyFor(presetId)
    return { ok: true, presetId, message: `预设 ${presetId} 挂载验证通过` }
  } catch (error) {
    return { ok: false, presetId, message: error instanceof Error ? error.message : String(error) }
  }
}

export interface PublishResult {
  pushed: boolean
  reason: string
  detail?: string
}

/** Normalize a git remote/repo URL for comparison (protocol/.git/git@ forms). */
function normalizeRemote(url: string): string {
  return url
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^git@([^:]+):/, '$1/')
    .toLowerCase()
}

/**
 * Is this process running from the OWNER's plugin worktree? True only when the
 * package directory is inside a git repo whose `origin` remote matches the
 * configured repository — i.e. the developer workspace, never a downloader's
 * node_modules copy.
 */
export async function isOwnerWorktree(cwd: string, repo: string): Promise<boolean> {
  const top = await git(['rev-parse', '--show-toplevel'], cwd)
  if (top.code !== 0 || top.out.trim().length === 0) return false
  const origin = await git(['remote', 'get-url', 'origin'], cwd)
  if (origin.code !== 0) return false
  const wanted = normalizeRemote(repo)
  const actual = normalizeRemote(origin.out)
  return actual === wanted || actual.includes(wanted) || wanted.includes(actual)
}

/**
 * Commit and push the plugin workspace to GitHub (overwrite as new version).
 * Skips clean worktrees and non-owner environments.
 */
export async function publishToGitHub(
  cwd: string,
  opts: { repo: string; branch: string; message: string },
): Promise<PublishResult> {
  if (!(await isOwnerWorktree(cwd, opts.repo))) {
    return { pushed: false, reason: 'not-owner-worktree' }
  }
  const status = await git(['status', '--porcelain'], cwd)
  if (status.code !== 0) return { pushed: false, reason: 'git-status-failed', detail: status.err }
  if (status.out.trim().length === 0) return { pushed: false, reason: 'clean' }
  const add = await git(['add', '-A'], cwd)
  if (add.code !== 0) return { pushed: false, reason: 'git-add-failed', detail: add.err }
  const commit = await git(['commit', '-m', opts.message], cwd)
  if (commit.code !== 0) return { pushed: false, reason: 'git-commit-failed', detail: commit.err }
  const push = await git(['push', 'origin', opts.branch], cwd)
  if (push.code !== 0) return { pushed: false, reason: 'git-push-failed', detail: push.err }
  return { pushed: true, reason: 'pushed', detail: push.out.trim() || push.err.trim() }
}

/**
 * Run the full pipeline: configure preset → verify → upload to GitHub.
 * Never throws; returns a status line that is also persisted.
 */
export async function runPublishPipeline(ctx: PipelineContext): Promise<string> {
  const settings = ctx.getState()
  const presetId = settings.presetId || 'workbench'
  const steps: string[] = []
  const fail = async (status: string): Promise<string> => {
    await ctx.recordStatus(status).catch(() => undefined)
    console.error(`[dsh-workbench] ${status}`)
    return status
  }
  try {
    if (!settings.enabled) {
      return fail('发布流水线已禁用 (publish.enabled=false)')
    }

    // 1) auto-configure the bundled preset into $DSH_HOME/.agent-presets
    const install = await ensurePresetInstalled(presetId, ctx.dshHome ?? homedir())
    const step1 = `[1/3] 预设配置: ${install.action} → ${install.presetDir}`
    steps.push(step1)
    console.log(`[dsh-workbench] ${step1}`)

    // 2) verify the preset actually mounts (standingKeyFor = roster mount check)
    const verify = await verifyPreset(ctx.agentPresets, presetId)
    const step2 = `[2/3] 验证: ${verify.message}`
    steps.push(step2)
    console.log(`[dsh-workbench] ${step2}`)
    if (!verify.ok) {
      return fail(`验证失败: ${verify.message}`)
    }

    // 3) upload the workspace to GitHub as the updated version
    if (!settings.autoPush) {
      const step3 = '[3/3] GitHub 上传: 已跳过 (publish.autoPush=false)'
      steps.push(step3)
      const status = steps.join('\n')
      await ctx.recordStatus(status).catch(() => undefined)
      return status
    }
    const publish = await publishToGitHub(packageRoot(), {
      repo: settings.repo,
      branch: settings.branch,
      message: `chore: dsh-workbench 预设自动同步 (${new Date().toISOString().slice(0, 10)})`,
    })
    const step3 = publish.pushed
      ? `[3/3] GitHub 上传: 已推送 ${settings.branch}${publish.detail ? ` — ${publish.detail}` : ''}`
      : `[3/3] GitHub 上传: 跳过 (${publish.reason}${publish.detail ? ` — ${publish.detail}` : ''})`
    steps.push(step3)
    console.log(`[dsh-workbench] ${step3}`)

    const status = steps.join('\n')
    await ctx.recordStatus(status).catch(() => undefined)
    return status
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`发布流水线异常: ${message}`)
  }
}
