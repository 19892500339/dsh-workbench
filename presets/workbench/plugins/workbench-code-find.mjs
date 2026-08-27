// Workbench Code Find — 工作台结构化代码检索工具（自包含，无外部依赖）
//
// 实时扫描代码目录中的类/函数/方法/常量/变量/类型/HTML id/class/CSS 选择器，
// 支持 kind 与文件过滤、代码预览、自动从邻近注释提取说明；按文件版本号增量缓存。
// 与 cordis 预设一起随本预设目录旅行（agent.cordis.yml 中以相对路径引用本文件）。
export default {
  name: 'workbench-code-find',
  inject: ['tools'],
  apply(ctx) {
    const fs = ctx.get('fs');
    if (!fs) return;
    const sp = ctx.get('sandboxPolicy');
    const workspaceRoot = sp ? sp.workspaceRoot : undefined;

    const IGNORED_DIRS = new Set([
      'node_modules', '.git', '.svn', '.hg', '.workbench', '.dsh-uploads',
      'dist', 'build', 'out', 'coverage', '.cache', '__pycache__',
      '.venv', 'venv', 'target', '.idea', '.vscode', '.DS_Store', 'assets', 'fonts', 'images',
    ]);
    const CODE_EXTS = new Set([
      '.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx',
      '.py', '.go', '.java', '.c', '.cpp', '.cc', '.h', '.hpp', '.cs', '.php', '.rb',
      '.html', '.htm', '.css', '.scss', '.less', '.vue', '.svelte', '.sh',
    ]);
    const HTML_EXTS = new Set(['.html', '.htm', '.vue', '.svelte']);
    const CSS_EXTS = new Set(['.css', '.scss', '.less']);
    const METHOD_BLOCK_KEYWORDS = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'do', 'with',
      'function', 'return', 'else', 'try', 'finally', 'class', 'new', 'typeof', 'delete',
    ]);
    const KIND_PRIORITY = {
      class: 0, function: 1, method: 2, object: 3,
      constant: 4, variable: 5, type: 6,
      'html-id': 7, 'html-class': 8, css: 9,
    };

    function extOf(name) {
      const i = name.lastIndexOf('.');
      if (i < 0) return '';
      const lower = name.toLowerCase();
      if (lower.endsWith('.d.ts')) return '.d.ts';
      return lower.slice(i);
    }

    function tokenize(q) {
      const out = [];
      const re = /[A-Za-z0-9_$]+|[\u4e00-\u9fff]+/g;
      let m;
      while ((m = re.exec(q))) out.push(m[0].toLowerCase());
      return out;
    }

    function cleanComment(raw) {
      return raw
        .replace(/^\/\*\s*/, '')
        .replace(/^\/\//, '')
        .replace(/^\*\s*/, '')
        .replace(/\*\/\s*$/, '')
        .trim();
    }

    function isDecorative(raw) {
      const meaningful = cleanComment(raw).replace(/[=\-*\/\s]/g, '');
      return meaningful.length <= 2;
    }

    function leadingComment(lines, i) {
      const parts = [];
      for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
        const raw = (lines[j] || '').trim();
        if (raw === '') continue;
        const isComment = raw.indexOf('//') === 0 || raw.indexOf('*') === 0 || raw.indexOf('/*') === 0;
        if (!isComment) break;
        if (isDecorative(raw)) continue;
        parts.unshift(cleanComment(raw));
        if (raw.indexOf('/*') === 0) break;
      }
      return parts.join(' ');
    }

    function findBlockEnd(lines, start) {
      let depth = 0, inStr = null, inLine = false, inBlock = false;
      for (let i = start; i < lines.length; i++) {
        const line = lines[i];
        for (let c = 0; c < line.length; c++) {
          const ch = line[c], next = line[c + 1];
          if (inLine) break;
          if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; c++; } continue; }
          if (inStr) { if (ch === '\\') { c++; continue; } if (ch === inStr) inStr = null; continue; }
          if (ch === '/' && next === '/') { inLine = true; c++; continue; }
          if (ch === '/' && next === '*') { inBlock = true; c++; continue; }
          if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) return i; }
        }
        inLine = false;
      }
      return start;
    }

    function matchDeclaration(line, ext) {
      if (ext === '.py') {
        let m = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/);
        if (m) return { kind: 'method', name: m[1], hasBrace: false };
        m = line.match(/^class\s+([A-Za-z_]\w*)/);
        if (m) return { kind: 'class', name: m[1], hasBrace: false };
        return null;
      }
      if (ext === '.go') {
        let m = line.match(/^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)/);
        if (m) return { kind: 'function', name: m[1], hasBrace: true };
        m = line.match(/^type\s+([A-Za-z_]\w*)\s+(struct|interface)\b/);
        if (m) return { kind: m[2] === 'interface' ? 'type' : 'class', name: m[1], hasBrace: true };
        m = line.match(/^type\s+([A-Za-z_]\w*)\s*=/);
        if (m) return { kind: 'type', name: m[1], hasBrace: false };
        return null;
      }
      let m = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/);
      if (m) return { kind: 'class', name: m[1], hasBrace: true };
      m = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
      if (m) return { kind: 'function', name: m[1], hasBrace: true };
      m = line.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/);
      if (m) return { kind: 'type', name: m[1], hasBrace: true };
      m = line.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/);
      if (m) return { kind: 'type', name: m[1], hasBrace: false };
      m = line.match(/^(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/);
      if (m) return { kind: 'type', name: m[1], hasBrace: true };
      m = line.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/);
      if (m) {
        const name = m[1];
        if (/=>\s*\{/.test(line)) return { kind: 'function', name: name, hasBrace: true };
        if (/=\s*(?:async\s*)?\(/.test(line)) return { kind: 'function', name: name, hasBrace: false };
        if (/=\s*\{/.test(line)) return { kind: 'object', name: name, hasBrace: true };
        return { kind: line.indexOf('let') !== -1 ? 'variable' : 'constant', name: name, hasBrace: false };
      }
      m = line.match(/^\s+(?:async\s+)?(?:static\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{?\s*$/);
      if (m && !METHOD_BLOCK_KEYWORDS.has(m[1])) return { kind: 'method', name: m[1], hasBrace: true };
      return null;
    }

    function extractSymbols(text, rel, ext, previewN) {
      const lines = text.split('\n');
      const symbols = [];
      if (HTML_EXTS.has(ext)) {
        const idRe = /\bid="([^"]+)"/g, clsRe = /\bclass="([^"]+)"/g;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i], trimmed = line.trim();
          idRe.lastIndex = 0; clsRe.lastIndex = 0;
          let m;
          while ((m = idRe.exec(line))) symbols.push({ file: rel, line: i + 1, kind: 'html-id', name: m[1], signature: trimmed.slice(0, 80), summary: '', preview: trimmed.slice(0, 120), score: 0 });
          while ((m = clsRe.exec(line))) symbols.push({ file: rel, line: i + 1, kind: 'html-class', name: m[1], signature: trimmed.slice(0, 80), summary: '', preview: trimmed.slice(0, 120), score: 0 });
        }
        return symbols;
      }
      if (CSS_EXTS.has(ext)) {
        const selRe = /^\s*([.#]?[A-Za-z_][\w-]*(?:\s*,\s*[.#]?[A-Za-z_][\w-]*)*)\s*\{/;
        for (let i = 0; i < lines.length; i++) {
          const m = selRe.exec(lines[i]);
          if (m) symbols.push({ file: rel, line: i + 1, kind: 'css', name: m[1].trim(), signature: m[1].trim().slice(0, 80), summary: '', preview: lines[i].trim().slice(0, 120), score: 0 });
        }
        return symbols;
      }
      const stack = [];
      for (let i = 0; i < lines.length; i++) {
        while (stack.length && stack[stack.length - 1].end < i) stack.pop();
        const def = matchDeclaration(lines[i], ext);
        if (!def) continue;
        const inner = stack[stack.length - 1];
        if (inner) { if (!(inner.kind === 'class' && def.kind === 'method')) continue; }
        const endLine = def.hasBrace ? findBlockEnd(lines, i) : i;
        const block = lines.slice(i, Math.min(i + previewN, endLine + 1));
        symbols.push({
          file: rel, line: i + 1, kind: def.kind, name: def.name,
          signature: lines[i].trim().slice(0, 120),
          summary: leadingComment(lines, i),
          preview: block.join('\n').slice(0, 300),
          body: lines.slice(i, Math.min(i + 30, endLine + 1)).join('\n').slice(0, 600),
          score: 0,
        });
        if (def.hasBrace) stack.push({ end: endLine, kind: def.kind });
      }
      return symbols;
    }

    function scoreSymbol(s, tokens) {
      let score = 0;
      const name = s.name.toLowerCase();
      const sum = (s.summary || '').toLowerCase();
      const sig = (s.signature || '').toLowerCase();
      const body = ((s.body || s.preview || '') + '\n' + (s.summary || '')).toLowerCase();
      for (const t of tokens) {
        if (!t) continue;
        if (name === t) score += 20;
        else if (name.indexOf(t) !== -1) score += 12;
        if (sum.indexOf(t) !== -1) score += 6;
        if (sig.indexOf(t) !== -1) score += 4;
        if (body.indexOf(t) !== -1) score += 2;
      }
      return score;
    }

    function searchSymbols(symbols, args) {
      const q = (args.query != null ? String(args.query) : '').trim();
      const tokens = tokenize(q);
      let list = symbols;
      const kind = args.kind || 'any';
      if (kind !== 'any' && kind !== 'all') {
        list = list.filter((s) => (kind === 'html' ? s.kind.indexOf('html') === 0 : s.kind === kind));
      }
      const fileFilter = args.file ? String(args.file).toLowerCase() : '';
      if (fileFilter) list = list.filter((s) => s.file.toLowerCase().indexOf(fileFilter) !== -1);
      const topK = Math.max(1, Math.min(Number(args.top_k) || 10, 50));
      const strip = (arr) => arr.slice(0, topK).map(({ body, ...rest }) => rest);
      if (tokens.length === 0) {
        return strip(list.slice().sort((a, b) =>
          (KIND_PRIORITY[a.kind] != null ? KIND_PRIORITY[a.kind] : 20) - (KIND_PRIORITY[b.kind] != null ? KIND_PRIORITY[b.kind] : 20) || a.line - b.line));
      }
      return strip(list.map((s) => ({ ...s, score: scoreSymbol(s, tokens) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.line - b.line));
    }

    function formatResult(value) {
      const out = [];
      out.push('[workbench_code_find] query=' + JSON.stringify(value.query || '') + ' dir=' + value.dir + ' (扫描 ' + value.scanned_files + ' 个文件, 命中 ' + value.symbols.length + '/' + value.total + ' 个符号)');
      out.push('');
      for (const s of value.symbols) {
        out.push('[' + s.kind + '] ' + s.name + '  ' + s.file + ':' + s.line + '  (score ' + s.score + ')');
        if (s.signature) out.push('   签名: ' + s.signature);
        if (s.summary) out.push('   说明: ' + s.summary);
        if (s.preview) out.push('   预览:\n' + s.preview.split('\n').map((x) => '     ' + x).join('\n'));
        out.push('');
      }
      return out.join('\n');
    }

    const dirCaches = new Map();

    async function walk(fs, target, rel, seen, signal, depth, cache, previewN) {
      if (depth > 14) return;
      const entries = await fs.listDir(target, signal);
      for (const e of entries) {
        const name = e.name;
        const childRel = rel ? rel + '/' + name : name;
        if (e.type === 'directory') {
          if (IGNORED_DIRS.has(name)) continue;
          await walk(fs, e.target, childRel, seen, signal, depth + 1, cache, previewN);
        } else if (e.type === 'file') {
          const ext = extOf(name);
          if (!CODE_EXTS.has(ext)) continue;
          if (e.size != null && e.size > 2 * 1024 * 1024) continue;
          seen.add(childRel);
          const prev = cache.get(childRel);
          if (prev && e.version !== undefined && prev.version === e.version) continue;
          let text;
          try { text = await fs.readText(e.target, signal); } catch (err) { continue; }
          cache.set(childRel, { version: e.version, symbols: extractSymbols(text, childRel, ext, previewN) });
        }
      }
    }

    async function indexDir(fs, dir, signal, previewN) {
      const root = await fs.resolve(dir, { signal: signal });
      let cache = dirCaches.get(dir);
      if (!cache) { cache = new Map(); dirCaches.set(dir, cache); }
      const seen = new Set();
      await walk(fs, root, '', seen, signal, 0, cache, previewN);
      for (const k of Array.from(cache.keys())) {
        if (!seen.has(k)) cache.delete(k);
      }
      const all = [];
      for (const v of cache.values()) {
        for (const s of v.symbols) all.push(s);
      }
      return { symbols: all, scannedFiles: seen.size };
    }

    ctx.tools.register({
      name: 'workbench_code_find',
      description: '在代码目录中做结构化/符号级检索：实时扫描类/函数/方法/常量/变量/类型/HTML id与class/CSS选择器等符号，支持 kind 与文件路径过滤，返回文件+行号+签名+自动提取的说明+代码预览。不依赖手工维护的 .workbench 索引，按文件版本增量缓存（永不过期），可弥补 workbench_code_locate 对声明型文件与 HTML/CSS 的覆盖盲区。写代码前用本工具定位功能所在位置。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的符号名或功能描述（支持中文/英文，可用空格分隔多个关键词；留空则按类型列出符号）' },
          dir: { type: 'string', description: '要扫描的代码目录（绝对路径）；省略时使用当前工作区根目录' },
          kind: { type: 'string', enum: ['any', 'class', 'function', 'method', 'constant', 'variable', 'object', 'type', 'html', 'css', 'all'], description: '按符号类型过滤，默认 any' },
          file: { type: 'string', description: '按文件路径子串过滤，例如 js/entities 或 *.css' },
          top_k: { type: 'integer', description: '最多返回条数，默认 10，最大 50' },
          preview_lines: { type: 'integer', description: '每条结果附带的预览代码行数，默认 4，最大 10' },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            query: { type: 'string' },
            dir: { type: 'string' },
            scanned_files: { type: 'integer' },
            total: { type: 'integer' },
            symbols: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  file: { type: 'string' },
                  line: { type: 'integer' },
                  kind: { type: 'string' },
                  name: { type: 'string' },
                  signature: { type: 'string' },
                  summary: { type: 'string' },
                  preview: { type: 'string' },
                  score: { type: 'integer' },
                },
              },
            },
          },
        },
        render: (args, value) => [{ type: 'text', text: formatResult(value) }],
      },
      timeoutMs: 30000,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (!args || typeof args !== 'object') throw new Error('workbench_code_find: args must be an object');
        const signal = exec && exec.signal;
        const dir = (args.dir && String(args.dir).trim()) || workspaceRoot;
        if (!dir) throw new Error('未提供 dir 参数，且无法确定当前工作区根目录');
        const pn = Math.max(1, Math.min(Number(args.preview_lines) || 4, 10));
        const index = await indexDir(fs, dir, signal, pn);
        const matched = searchSymbols(index.symbols, args);
        return {
          query: args.query != null ? String(args.query) : '',
          dir: dir,
          scanned_files: index.scannedFiles,
          total: index.symbols.length,
          symbols: matched,
        };
      },
    });
  },
};
