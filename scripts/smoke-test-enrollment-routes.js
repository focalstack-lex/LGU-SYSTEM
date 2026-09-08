// Static wiring checks for the student enrollment routes.
// Run: node scripts/smoke-test-enrollment-routes.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const routeSrc = fs.readFileSync(path.join(root, 'server', 'routes', 'enrollment.js'), 'utf8');
const indexSrc = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('student-only guard present', /requireStudent/.test(routeSrc));
check('GET /submissions/my defined', /router\.get\('\/submissions\/my'/.test(routeSrc));
check('POST /submissions defined', /router\.post\('\/submissions'/.test(routeSrc));
check('POST /submissions/:id/items defined', /router\.post\('\/submissions\/:id\/items'/.test(routeSrc));
check('DELETE /submissions/:id/items/:itemId defined', /router\.delete\('\/submissions\/:id\/items\/:itemId'/.test(routeSrc));
check('POST /submissions/:id/submit defined', /router\.post\('\/submissions\/:id\/submit'/.test(routeSrc));
check('uses canStudentEdit', /canStudentEdit\(/.test(routeSrc));
check('uses canTransition on submit', /canTransition\(/.test(routeSrc));
check('rejects empty submissions on submit', /at least one subject|no subjects/i.test(routeSrc));
check('audits submission submit', /ENROLLMENT_SUBMIT/.test(routeSrc));
check('mounted in server/index.js', /app\.use\("\/api\/enrollment"/.test(indexSrc));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll enrollment route wiring checks passed');
