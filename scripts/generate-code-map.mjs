#!/usr/bin/env node
// =============================================
// generate-code-map.mjs - Agent Navigation Map Generator
// =============================================
//
// Emits docs/CODE_MAP.md: a compact, regeneration-driven map of the codebase so an
// agent can locate a target file and line instead of sweeping the repository.
//
// Usage:
//   node scripts/generate-code-map.mjs            write docs/CODE_MAP.md
//   node scripts/generate-code-map.mjs --check    exit 1 if the committed map is stale
//   node scripts/generate-code-map.mjs --stdout   print without writing
//
// No dependencies. Deterministic: the fingerprint covers the body only, so the
// timestamp and commit in the header do not affect staleness detection.

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, dirname, basename, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'CODE_MAP.md');
const ANCHOR_MIN_LINES = 300;

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const STDOUT = args.has('--stdout');

// Directories that are build output, dependency trees, tool state, or duplicate checkouts.
// Excluding these is half the point: a duplicated tree doubles every search result.
const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.kilo', '.github', '.qodo', '.superpowers', '.zcode',
  'vendor', 'dist', 'build', 'scratch', 'logs', 'tmp', 'temp', 'coverage',
  '.playwright-mcp', 'gui-test-screenshots', 'reports', 'assets', 'Icons',
  'bg elements', 'presentation', 'electron-builder', 'node_modules2',
]);
const EXCLUDE_RE = /(^|[\\/])(dist[-_].*|dist-build.*|build-.*|\.next|cache)$/;
const KEEP_EXT = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.sql']);

// ---------- discovery ----------

function walk(dir, acc = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      if (EXCLUDE_RE.test(e.name)) continue;
      if (e.name.startsWith('.')) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      if (KEEP_EXT.has(extname(e.name).toLowerCase())) acc.push(full);
    }
  }
  return acc;
}

// ---------- extraction ----------

const BANNER = /^[ \t]*(?:\/\/|\/\*|\*|--|<!--)[ \t]*[=*]{5,}/;

function stripCommentPrefix(s) {
  return s
    .replace(/^[ \t]*\/\/[ \t]?/, '')
    .replace(/^[ \t]*\/\*[ \t]?/, '')
    .replace(/^[ \t]*\*[ \t]?/, '')
    .replace(/^[ \t]*--[ \t]?/, '')
    .replace(/^[ \t]*<!--[ \t]?/, '')
    .replace(/[ \t]*\*\/[ \t]*$/, '')
    .replace(/[ \t]*-->[ \t]*$/, '')
    .trim();
}

// The convention in this repo: a banner line, then the title line, then a closing banner.
function purposeOf(lines, file) {
  const limit = Math.min(lines.length, 12);
  for (let i = 0; i < limit; i++) {
    if (BANNER.test(lines[i])) {
      const next = lines[i + 1] !== undefined ? stripCommentPrefix(lines[i + 1]) : '';
      if (next && !BANNER.test(lines[i + 1])) {
        const name = basename(file);
        const stripped = next.replace(new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[-:]\\s*'), '');
        return stripped;
      }
    }
  }
  return humanize(basename(file));
}

function humanize(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/^[0-9]+[-_]/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const JS_SYMBOL = /^[ \t]*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^[ \t]*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()|^[ \t]*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/;
const SQL_STMT = /^[ \t]*(?:create|alter|drop|grant|revoke|comment)\s+(?:or\s+replace\s+)?(table|policy|function|trigger|type|index|view|schema|role|extension)?\s*(?:if\s+(?:not\s+)?exists\s+)?([a-zA-Z0-9_."]*)/i;
const HTML_ID = /<[a-zA-Z][^>]*\sid="([A-Za-z0-9_-]+)"/;

function anchorsFor(file, lines) {
  const ext = extname(file).toLowerCase();
  const out = [];
  const seen = new Set();

  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    lines.forEach((line, i) => {
      const m = line.match(JS_SYMBOL);
      if (m) {
        const name = m[1] || m[2] || m[3];
        if (name && !seen.has(name)) { seen.add(name); out.push({ line: i + 1, label: name + '()' }); }
      }
    });
  } else if (ext === '.css') {
    lines.forEach((line, i) => {
      if (BANNER.test(line)) {
        const title = lines[i + 1] !== undefined ? stripCommentPrefix(lines[i + 1]) : '';
        if (title && !BANNER.test(lines[i + 1]) && !seen.has(title)) {
          seen.add(title);
          out.push({ line: i + 1, label: title });
        }
      }
    });
  } else if (ext === '.html') {
    lines.forEach((line, i) => {
      if (BANNER.test(line)) {
        const title = lines[i + 1] !== undefined ? stripCommentPrefix(lines[i + 1]) : '';
        if (title && !BANNER.test(lines[i + 1]) && !seen.has(title)) {
          seen.add(title);
          out.push({ line: i + 1, label: title });
        }
        return;
      }
      const idm = line.match(HTML_ID);
      if (idm && !seen.has('#' + idm[1])) { seen.add('#' + idm[1]); out.push({ line: i + 1, label: '#' + idm[1] }); }
    });
  } else if (ext === '.sql') {
    lines.forEach((line, i) => {
      const m = line.match(SQL_STMT);
      if (m) {
        const kind = (m[1] || 'stmt').toUpperCase();
        const target = (m[2] || '').replace(/"/g, '').replace(/\./g, '.');
        const label = target ? kind + ' ' + target : kind;
        if (!seen.has(label)) { seen.add(label); out.push({ line: i + 1, label }); }
      }
    });
  }
  return out;
}

// ---------- build ----------

function areaOf(rel) {
  // rel is normalized to forward slashes by the caller. A two-part path is
  // dir/file, so the area is the directory, never the filename.
  const parts = rel.split('/');
  if (parts.length === 1) return ['.', parts[0]];
  if (parts[0] === 'client' && parts[1] === 'js' && parts.length > 3) return ['client/js/' + parts[2], parts.slice(2).join('/')];
  if (parts.length >= 3) return [parts.slice(0, 2).join('/'), parts.slice(2).join('/')];
  return [parts[0], parts[1]];
}

function build() {
  const files = walk(ROOT).sort();
  const records = [];

  for (const file of files) {
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    const rel = relative(ROOT, file).split(sep).join('/');
    records.push({
      rel,
      lines: lines.length,
      bytes: statSync(file).size,
      purpose: purposeOf(lines, file),
      anchors: anchorsFor(file, lines),
    });
  }

  const groups = new Map();
  for (const r of records) {
    const [area] = areaOf(r.rel);
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(r);
  }
  const areas = [...groups.keys()].sort();

  const L = [];
  L.push('# Code Map (Agent Navigation)');
  L.push('');
  L.push('Generated by `scripts/generate-code-map.mjs`. **Do not edit by hand.**');
  L.push('Regenerate with `npm run map:code`. Verify freshness with `npm run map:code:check`.');
  L.push('');
  L.push('**How to use this file.** Find the area, then the file, then read only that window of the');
  L.push('source (offset and limit). Do not read a whole large file. If this map and the code');
  L.push('disagree, the code wins and the map is regenerated.');
  L.push('');

  const totalLines = records.reduce((a, r) => a + r.lines, 0);
  L.push('## Summary');
  L.push('');
  L.push(`- Files indexed: ${records.length}`);
  L.push(`- Total lines indexed: ${totalLines.toLocaleString('en-US')}`);
  L.push(`- Anchor index emitted for files over ${ANCHOR_MIN_LINES} lines: ${records.filter((r) => r.lines > ANCHOR_MIN_LINES).length}`);
  L.push('');
  L.push('### Areas');
  L.push('');
  L.push('| Area | Files | Lines |');
  L.push('|---|---:|---:|');
  for (const area of areas) {
    const rs = groups.get(area);
    L.push(`| \`${area}\` | ${rs.length} | ${rs.reduce((a, r) => a + r.lines, 0).toLocaleString('en-US')} |`);
  }
  L.push('');

  for (const area of areas) {
    const rs = groups.get(area).sort((a, b) => b.lines - a.lines);
    L.push(`## ${area}`);
    L.push('');
    L.push('| File | Lines | Purpose |');
    L.push('|---|---:|---|');
    for (const r of rs) {
      const display = area !== '.' && r.rel.startsWith(area + '/') ? r.rel.slice(area.length + 1) : r.rel;
      L.push(`| \`${display}\` | ${r.lines} | ${r.purpose} |`);
    }
    L.push('');
  }

  L.push('## Anchor Index');
  L.push('');
  L.push(`Files over ${ANCHOR_MIN_LINES} lines. Each entry is a line number to jump to, so a target`);
  L.push('resolves to a window instead of a full read.');
  L.push('');
  for (const r of records.filter((x) => x.lines > ANCHOR_MIN_LINES).sort((a, b) => b.lines - a.lines)) {
    if (!r.anchors.length) continue;
    L.push(`### \`${r.rel}\` (${r.lines} lines)`);
    L.push('');
    const cols = 3;
    for (let i = 0; i < r.anchors.length; i += cols) {
      const cells = r.anchors.slice(i, i + cols).map((a) => `${a.line}: \`${a.label}\``);
      L.push('- ' + cells.join(' | '));
    }
    L.push('');
  }

  L.push('## Entry Points');
  L.push('');
  L.push('- Server: `server/index.js` (Express app, middleware order, route mounting).');
  L.push('- Client: `client/index.html` (portal shell and script load order).');
  L.push('- Client router: `client/js/app.js`. API helper: `client/js/api.js`.');
  L.push('- Schema and migrations: `supabase/migrations/` (numbered, forward only).');
  L.push('- Desktop client: `electron/`.');
  L.push('');

  const body = L.join('\n');
  const fp = createHash('sha256').update(body).digest('hex').slice(0, 16);

  let commit = 'unknown';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a repo */ }

  const header = [
    '<!-- code-map',
    `generated: ${new Date().toISOString()}`,
    `commit: ${commit}`,
    `fingerprint: ${fp}`,
    '-->',
    '',
  ].join('\n');

  return { header, body, fp };
}

// ---------- main ----------

const { header, body, fp } = build();
const content = header + body;

if (STDOUT) {
  process.stdout.write(content);
  process.exit(0);
}

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error('CODE MAP STALE: docs/CODE_MAP.md is missing. Run: npm run map:code');
    process.exit(1);
  }
  const existing = readFileSync(OUT, 'utf8');
  // Compare the body only, ignoring the volatile header (timestamp and commit).
  // Comparing content rather than just the fingerprint also catches hand edits,
  // which the "do not edit by hand" rule forbids.
  const existingBody = existing.replace(/^<!-- code-map[\s\S]*?-->\r?\n/, '');
  if (existingBody !== body) {
    const m = existing.match(/fingerprint: ([0-9a-f]+)/);
    console.error(
      `CODE MAP STALE: committed map does not match the source. ` +
      `committed fingerprint ${m ? m[1] : 'missing'}, current ${fp}. Run: npm run map:code`
    );
    process.exit(1);
  }
  console.log(`CODE MAP CURRENT: fingerprint ${fp}`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, content, 'utf8');
console.log(`Wrote ${relative(ROOT, OUT)} (${body.split('\n').length} lines, fingerprint ${fp})`);
