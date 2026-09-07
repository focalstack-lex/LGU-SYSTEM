// Smoke test for server/lib/curriculum.js pure validators.
// Run: node scripts/smoke-test-curriculum-lib.js
const { validateComponentSplit, validatePrereqRow, PREREQ_KINDS } = require('../server/lib/curriculum');

let failed = 0;
function check(label, got, ok) {
  if (got === ok) console.log(`PASS ${label}`);
  else { failed++; console.log(`FAIL ${label}`); }
}

// validateComponentSplit
check('split 3+1=4 passes', validateComponentSplit(4, 3, 1).ok, true);
check('split 4+0=4 passes', validateComponentSplit(4, 4, 0).ok, true);
check('split 2+1!=4 rejected', validateComponentSplit(4, 2, 1).ok, false);
check('split negative rejected', validateComponentSplit(4, -1, 5).ok, false);
check('split non-integer rejected', validateComponentSplit(4, 1.5, 2.5).ok, false);
check('split string numbers coerced', validateComponentSplit('4', '3', '1').ok, true);
check('split error message mentions total', /total units/.test(validateComponentSplit(4, 2, 1).error), true);

// validatePrereqRow
check('prereq with subject passes', validatePrereqRow({ kind: 'prerequisite', depends_on_subject_id: 'x' }).ok, true);
check('prereq without subject rejected', validatePrereqRow({ kind: 'prerequisite' }).ok, false);
check('coreq with subject passes', validatePrereqRow({ kind: 'corequisite', depends_on_subject_id: 'x' }).ok, true);
check('coreq without subject rejected', validatePrereqRow({ kind: 'corequisite', detail: 'y' }).ok, false);
check('prereq with detail rejected', validatePrereqRow({ kind: 'prerequisite', depends_on_subject_id: 'x', detail: 'y' }).ok, false);
check('year_standing with detail passes', validatePrereqRow({ kind: 'year_standing', detail: '2nd Yr Standing' }).ok, true);
check('year_standing without detail rejected', validatePrereqRow({ kind: 'year_standing' }).ok, false);
check('special with detail passes', validatePrereqRow({ kind: 'special', detail: '*240 hours' }).ok, true);
check('special with subject rejected', validatePrereqRow({ kind: 'special', depends_on_subject_id: 'x', detail: 'y' }).ok, false);
check('unknown kind rejected', validatePrereqRow({ kind: 'banana', detail: 'y' }).ok, false);
check('kinds list intact', JSON.stringify(PREREQ_KINDS), JSON.stringify(['prerequisite', 'corequisite', 'year_standing', 'special']));

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll curriculum lib tests passed');
