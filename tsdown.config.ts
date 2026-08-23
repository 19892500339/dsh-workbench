/**
 * tsdown build for dsh-workbench: two artifacts.
 *
 * 1) Host half  -> lib/index.js  (ESM, Node)
 *    Bundled from src/index.ts. @deepseek-ai peers, the MCP SDK and Node
 *    builtins stay external so the cordis loader resolves them from the
 *    profile's node_modules at runtime.
 *
 * 2) Client half -> lib/client.js (CJS closure factory for the browser)
 *    Bundled from src/client/index.tsx into the DSH web module-loader shape:
 *    window.__ModuleLoader__.load({ id: <package name>, factory: (require) => {
 *      ... return module.exports; } })
 *    The registered id MUST equal package.json `name` (client-modules compose
 *    keys on the package name). Platform modules (react, cordis, dsh client
 *    services) stay external and resolve through the loader's module table at
 *    runtime; everything else is inlined into the single script. A purity gate
 *    rejects Node builtins and non-external @deepseek-ai value imports, so
 *    cross-plugin collaboration must go through cordis services, never value
 *    imports (type-only imports are erased and never reach the gate).
 *
 * Type declarations ship from lib/types (tsc -p tsconfig.build.json), not
 * from tsdown.
 *
 * The module-loader wrapper format is a DSH platform requirement; the layout
 * follows the official client-bundle preset used by shipped plugins
 * (e.g. packages/client/ui-trajectory). All code here is original.
 */
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'

/** Browser Web Crypto shim for dependencies that resolve the Node builtin. */
const CRYPTO_SHIM = fileURLToPath(new URL('./src/client/shims/crypto.ts', import.meta.url))

/**
 * @logicflow/core publishes a CJS main (lib/index.js) whose default export is
 * the LogicFlow class, but the client bundle is CJS too, so rolldown's
 * node-mode interop binds `import_lib.default` to the whole module.exports
 * object — `new LogicFlow(...)` then fails with "not a constructor". Alias the
 * package to its ESM entry so the default import binds the class directly.
 */
const LOGICFLOW_ESM = fileURLToPath(new URL('./node_modules/@logicflow/core/es/index.js', import.meta.url))

/**
 * uuid@9 ships node and browser builds but no `exports` map, so bundlers pick
 * the node entry: its `native.js` destructures `crypto.randomUUID`, which
 * loses `this` and throws "Illegal invocation" in the browser. Point the
 * specifier at the pure ESM browser build (Web Crypto getRandomValues).
 */
const UUID_BROWSER = fileURLToPath(new URL('./node_modules/uuid/dist/esm-browser/index.js', import.meta.url))

/** Node builtins must never survive into the browser module-loader factory. */
const NODE_BUILTINS = new Set([
  ...builtinModules,
  ...builtinModules.map((id) => `node:${id}`),
])

/** Module specifiers the web shell shares into the frozen module table. */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  'cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** The registered client bundle id (must equal package.json `name`). */
const PLUGIN_ID = 'dsh-workbench'

/** Client purity gate: forbid Node builtins and non-external @deepseek-ai value imports. */
function purityGatePlugin(): NonNullable<UserConfig['plugins']> {
  return {
    name: 'dsh-workbench-client-purity',
    resolveId(source: string) {
      // 'crypto' / 'node:crypto' are aliased to the browser Web Crypto shim
      // (uuid@9's node entry), so they are safe in the module table.
      if (source === 'crypto' || source === 'node:crypto') return null
      if (NODE_BUILTINS.has(source)) {
        throw new Error(
          `client bundle purity: Node builtin "${source}" cannot run in the browser module table — ` +
            'select the dependency browser export or add an explicit browser implementation',
        )
      }
      if (!source.startsWith('@deepseek-ai/')) return null
      if (CLIENT_EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a platform module and not inline-safe — ` +
          'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased)',
      )
    },
  }
}

/** Host bundle: everything external except our own source. */
const hostConfig: UserConfig = {
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: (id: string) =>
      id.startsWith('@deepseek-ai/') ||
      id === '@modelcontextprotocol/sdk' ||
      NODE_BUILTINS.has(id),
  },
}

/** Client bundle: module-loader closure factory for the browser. */
const clientConfig: UserConfig = {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (id: string) => !CLIENT_EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  inputOptions: {
    resolve: {
      conditionNames: ['browser', 'import', 'require', 'default'],
      // uuid@9's node entry imports the Node builtin; give the browser shim.
      alias: {
        crypto: CRYPTO_SHIM,
        'node:crypto': CRYPTO_SHIM,
        '@logicflow/core': LOGICFLOW_ESM,
        uuid: UUID_BROWSER,
      },
    },
  },
  plugins: [purityGatePlugin()],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

export default [hostConfig, clientConfig] satisfies UserConfig[]
