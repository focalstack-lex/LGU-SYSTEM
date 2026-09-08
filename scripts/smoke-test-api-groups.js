// Static wiring checks for the enrollment/faculty Api groups.
// Run: node scripts/smoke-test-api-groups.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'client', 'js', 'api.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('enrollment group exists', /const enrollment = \{/.test(src));
check('faculty group exists', /const faculty = \{/.test(src));
check('enrollment.my hits /enrollment/submissions/my', /submissions\/my/.test(src));
check('faculty.approve hits approve endpoint', /submissions\/\$\{id\}\/approve/.test(src));
check('faculty.exportBlob fetches with auth header', /submissions\/\$\{id\}\/export/.test(src) && /Authorization/.test(src));
check('groups exported in return object', /enrollment,\s*faculty|faculty,\s*enrollment/.test(src));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll Api group checks passed');
