// Builds client/vendor/icons-bundle.js from the icons the client actually uses,
// so every icon renders offline and a misspelled or nonexistent icon name is
// caught instead of silently rendering blank.
//
//   node scripts/generate-icon-bundle.mjs          fetch from api.iconify.design and write the bundle
//   node scripts/generate-icon-bundle.mjs --check  verify the bundle covers every used icon (no network)
//
// Replaces the hand-maintained list in scratch/generate_icon_bundle.js, whose
// list drifted: it bundled names Solar does not have and missed icons in use.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const BUNDLE = path.join(CLIENT, 'vendor', 'icons-bundle.js');
const PREFIXES = ['solar', 'line-md'];
const ICON_RE = new RegExp(`(${PREFIXES.join('|')}):([a-z0-9]+(?:-[a-z0-9]+)*)`, 'g');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor') walk(full, out);
    } else if (/\.(html|js)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// { 'solar:name': ['client/js/x.js:12', ...] }
function usedIcons() {
  const used = {};
  for (const file of walk(CLIENT)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(ICON_RE)) {
        const key = `${m[1]}:${m[2]}`;
        (used[key] ||= []).push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${i + 1}`);
      }
    });
  }
  return used;
}

function readBundle() {
  const src = fs.readFileSync(BUNDLE, 'utf8');
  const marker = 'const collections = ';
  const start = src.indexOf(marker) + marker.length;
  const end = src.indexOf('];', start) + 1;
  return JSON.parse(src.slice(start, end));
}

function check() {
  const used = usedIcons();
  const cols = Object.fromEntries(readBundle().map(c => [c.prefix, c]));
  const problems = [];
  for (const [key, locs] of Object.entries(used)) {
    const [prefix, name] = key.split(':');
    const col = cols[prefix];
    if (col && (name in col.icons || name in (col.aliases || {}))) continue;
    const why = col?.not_found?.includes(name) ? 'does not exist in the icon set' : 'missing from the bundle';
    problems.push(`${key} ${why} (${locs.slice(0, 3).join(', ')}${locs.length > 3 ? ', ...' : ''})`);
  }
  const total = Object.keys(used).length;
  if (problems.length) {
    console.error(`ICON BUNDLE STALE: ${problems.length} of ${total} used icons will not render offline or at all:`);
    problems.forEach(p => console.error('  ' + p));
    console.error('Fix the icon name, then run: node scripts/generate-icon-bundle.mjs');
    process.exit(1);
  }
  console.log(`ICON BUNDLE CURRENT: all ${total} used icons are bundled`);
}

async function generate() {
  const used = usedIcons();
  const byPrefix = {};
  for (const key of Object.keys(used).sort()) {
    const [prefix, name] = key.split(':');
    (byPrefix[prefix] ||= []).push(name);
  }
  const collections = [];
  const unknown = [];
  for (const [prefix, names] of Object.entries(byPrefix)) {
    const res = await fetch(`https://api.iconify.design/${prefix}.json?icons=${names.join(',')}`);
    if (!res.ok) throw new Error(`Iconify API ${prefix}: HTTP ${res.status}`);
    const json = await res.json();
    (json.not_found || []).forEach(n => unknown.push(`${prefix}:${n} (${used[`${prefix}:${n}`].join(', ')})`));
    collections.push(json);
  }
  if (unknown.length) {
    // Refuse to write a bundle that knowingly ships blank icons
    console.error('These icon names do not exist in their set; fix them in the source first:');
    unknown.forEach(u => console.error('  ' + u));
    process.exit(1);
  }
  const out = `(function() {
  function register() {
    const customEl = typeof customElements !== 'undefined' ? customElements.get('iconify-icon') : null;
    const addCol = (customEl && customEl.addCollection) ? customEl.addCollection.bind(customEl) : (typeof IconifyIcon !== 'undefined' && IconifyIcon.addCollection ? IconifyIcon.addCollection : null);
    const collections = ${JSON.stringify(collections, null, 2)};
    if (addCol) {
      collections.forEach(col => {
        try { addCol(col); } catch(e) {}
      });
    } else {
      window.__ICONIFY_PRELOAD__ = collections;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', register);
  }
  register();
})();`;
  fs.writeFileSync(BUNDLE, out, 'utf8');
  const count = collections.reduce((n, c) => n + Object.keys(c.icons).length + Object.keys(c.aliases || {}).length, 0);
  console.log(`Wrote client/vendor/icons-bundle.js (${count} icons across ${collections.length} sets)`);
}

if (process.argv.includes('--check')) check();
else await generate();
