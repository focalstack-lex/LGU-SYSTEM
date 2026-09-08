// Static wiring checks for the student load-verification section.
// Run: node scripts/smoke-test-enrollment-ui.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'client', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'client', 'js', 'app.js'), 'utf8');
const mod = fs.readFileSync(path.join(root, 'client', 'js', 'enrollment.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('index.html has enrollment section', html.includes('id="view-enrollment"'));
check('index.html has enrollment nav item', html.includes('data-view="enrollment"'));
check('index.html loads enrollment.js', html.includes('js/enrollment.js'));
check('module exposes load()', /return\s*\{\s*load\s*\}/.test(mod));
check('Grizz hook exposed', /addFromGrizz/.test(mod));
check('sends grizz origin with reason', /origin: 'grizz'|grizz_reason/.test(mod));
check('app.js dispatches enrollment view', /view === 'enrollment'/.test(app));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll enrollment UI wiring checks passed');
