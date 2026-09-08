// Static wiring checks: checklists returns structured prereqs with graceful
// degradation, and /my joins the lec/lab columns.
// Run: node scripts/smoke-test-units-api-enrichment.js
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.resolve(__dirname, '..', 'server', 'routes', 'units.js'), 'utf8');

let failed = 0;
function check(label, ok) {
  if (ok) console.log(`PASS ${label}`);
  else { failed++; console.log(`FAIL ${label}`); }
}

const checklistBlock = src.slice(src.indexOf("router.get('/checklists'"), src.indexOf("router.get('/my'"));

check('checklists fetches subject_prerequisites', /from\('subject_prerequisites'\)/.test(checklistBlock));
check('checklists selects depends_on_subject_id code', /depends_on_subject_id\(code\)/.test(checklistBlock));
check('checklists response includes prerequisites key', /prerequisites:/.test(checklistBlock));
check('missing prereq table degrades to empty array', /\[\]/.test(checklistBlock.split('isMissingRelation')[1] || checklistBlock));
check('/my join includes lec_units', /lec_units/.test(src.slice(src.indexOf("router.get('/my'"), src.indexOf("router.get('/standing'"))));
check('/my join includes lab_units', /lab_units/.test(src.slice(src.indexOf("router.get('/my'"), src.indexOf("router.get('/standing'"))));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll units API enrichment checks passed');
