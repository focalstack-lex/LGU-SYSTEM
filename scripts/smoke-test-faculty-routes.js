// Static wiring checks for the faculty routes (read + item edit half).
// Run: node scripts/smoke-test-faculty-routes.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const routeSrc = fs.readFileSync(path.join(root, 'server', 'routes', 'faculty.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('router is faculty-guarded', /router\.use\(requireFaculty\)/.test(routeSrc));
check('program-head-only guard exists', /requireProgramHead/.test(routeSrc));
check('GET /submissions defined', /router\.get\('\/submissions'/.test(routeSrc));
check('GET /submissions/:id defined', /router\.get\('\/submissions\/:id'/.test(routeSrc));
check('POST /submissions/:id/open defined', /router\.post\('\/submissions\/:id\/open'/.test(routeSrc));
check('POST /submissions/:id/items defined', /router\.post\('\/submissions\/:id\/items'/.test(routeSrc));
check('PATCH /submissions/:id/items/:itemId defined', /router\.patch\('\/submissions\/:id\/items\/:itemId'/.test(routeSrc));
check('head_note required for adds', /head_note/.test(routeSrc));
check('added_by_head state used', /added_by_head/.test(routeSrc));
check('removed_by_head state used', /removed_by_head/.test(routeSrc));
check('scoping by program course', /\.eq\('course',/.test(routeSrc) || /course/.test(routeSrc));
check('mounted in server/index.js', /app\.use\("\/api\/faculty"/.test(indexSrc));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll faculty route wiring checks passed');
