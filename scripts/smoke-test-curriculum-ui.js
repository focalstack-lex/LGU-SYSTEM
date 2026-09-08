// Static wiring checks for the Curriculum Manager.
// Run: node scripts/smoke-test-curriculum-ui.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const html = read('client/officer.html');
const app = read('client/js/officer/officer-app.js');
const mod = read('client/js/officer/curriculum.js');
const api = read('client/js/api.js');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('officer.html has curriculum section', html.includes('id="curriculum-section"'));
check('officer.html loads curriculum.js', html.includes('js/officer/curriculum.js'));
check('module exposes init', /return\s*\{\s*init\s*\}/.test(mod));
check('grid renders lec input', /data-lec=/.test(mod));
check('grid renders lab input', /data-lab=/.test(mod));
check('editor handles all four kinds', ['prerequisite', 'corequisite', 'year_standing', 'special'].every(k => mod.includes(`value="${k}"`)));
check('api client has curriculum group', /curriculum:\s*\{/.test(api));
check('api client hits PATCH subjects', /PATCH`,\s*`?\/api\/curriculum\/subjects\/\$\{id\}|'PATCH',\s*`\/api\/curriculum\/subjects/.test(api));
check('officer-app references CurriculumManager', app.includes('CurriculumManager'));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll curriculum UI wiring checks passed');
