// =============================================
// vite.config.mjs - Frontend build
//
// Source stays in this folder exactly as before; `vite build` writes a
// deployable copy to client/dist. Every page is a separate HTML entry whose
// <script type="module" src="js/entry/*.js"> pulls in the legacy scripts in
// their original order. Three things are deliberately NOT bundled:
//   - vendor/ (Supabase, Chart.js, Iconify, the icon bundle): still classic
//     <script> tags, copied as-is so the load order before the module stays
//     exactly what it was;
//   - js/init-theme.js: must run in <head> before paint to avoid a theme flash,
//     and a module would be deferred;
//   - manifest.json (marked vite-ignore in the pages): its scope, start_url and
//     icon paths are relative to its own URL, so it has to stay at the root.
// `base: './'` keeps every URL relative so the same output works on Vercel,
// behind Express and from file:// inside the Electron shell.
// =============================================
import { defineConfig } from 'vite';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(root, 'dist');

// Files served verbatim next to the built pages (see header for why).
const STATIC_COPIES = ['assets', 'vendor', 'manifest.json', 'robots.txt', 'js/init-theme.js'];

const PAGES = {
  index: 'index.html',
  officer: 'officer.html',
  faculty: 'faculty.html',
  'cv-builder': 'cv-builder.html',
  'cv-verify': 'cv-verify.html',
  feedback: 'feedback/index.html',
  'feedback-view': 'feedback/view/index.html',
};

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

// Copies the untouched static files into dist after the bundle is written.
function copyStaticFiles() {
  return {
    name: 'coe-copy-static',
    apply: 'build',
    closeBundle() {
      for (const rel of STATIC_COPIES) {
        const src = resolve(root, rel);
        if (!existsSync(src)) throw new Error(`[coe-copy-static] missing ${rel}`);
        cpSync(src, join(outDir, rel), { recursive: true });
      }
    },
  };
}

// Rewrites sw.js for the build: the APP_SHELL list names the hashed files that
// actually exist in dist, and CACHE_VERSION changes whenever any of them does,
// so an installed PWA drops the previous shell on the next activation. The
// fetch strategy in sw.js (network first, cache only when offline, never cache
// /api or Supabase) is left exactly as written.
function serviceWorkerShell() {
  return {
    name: 'coe-service-worker',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const shellFile = (rel) =>
        /\.(html|css|js)$/.test(rel)
        || rel === 'manifest.json'
        || rel.startsWith('assets/icons/')
        || rel.startsWith('assets/coe-logo');
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split('\\').join('/'))
        .filter((rel) => rel !== 'sw.js' && shellFile(rel))
        .sort();
      const hash = createHash('sha256');
      for (const rel of files) hash.update(rel).update(readFileSync(join(outDir, rel)));
      const version = `coe-pwa-${hash.digest('hex').slice(0, 12)}`;

      let sw = readFileSync(resolve(root, 'sw.js'), 'utf8');
      const listStart = sw.indexOf('const APP_SHELL = [');
      const listEnd = sw.indexOf('];', listStart);
      if (listStart < 0 || listEnd < 0 || !/const CACHE_VERSION = '[^']+';/.test(sw)) {
        throw new Error('[coe-service-worker] sw.js shape changed; update vite.config.mjs');
      }
      const list = ['./', ...files.map((f) => `./${f}`)].map((f) => `  '${f}',`).join('\n');
      sw = sw.slice(0, listStart) + `const APP_SHELL = [\n${list}\n` + sw.slice(listEnd);
      sw = sw.replace(/const CACHE_VERSION = '[^']+';/, `const CACHE_VERSION = '${version}';`);
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  root,
  base: './',
  publicDir: false,
  plugins: [copyStaticFiles(), serviceWorkerShell()],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: Object.fromEntries(Object.entries(PAGES).map(([name, file]) => [name, resolve(root, file)])),
    },
  },
  server: {
    port: 5173,
    // The Express API (npm start, port 3000) answers /api during development.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
