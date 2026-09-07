// TDD smoke test for server/lib/enrollment.js. Run: node scripts/smoke-test-enrollment-lib.js
let failed = 0;
// check(label, actual, expected=true) — the plan's helper ignored `expected`,
// which made the negative assertions fail even against a correct lib.
const check = (label, ok, expected = true) => { const pass = ok === expected; console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`); if (!pass) failed++; };

const lib = require('../server/lib/enrollment');

// transitions
check('draft -> submitted legal', lib.canTransition('draft', 'submitted'), true);
check('submitted -> under_review legal', lib.canTransition('submitted', 'under_review'), true);
check('submitted -> approved legal', lib.canTransition('submitted', 'approved'), true);
check('submitted -> returned legal', lib.canTransition('submitted', 'returned'), true);
check('submitted -> rejected legal', lib.canTransition('submitted', 'rejected'), true);
check('under_review -> approved legal', lib.canTransition('under_review', 'approved'), true);
check('under_review -> returned legal', lib.canTransition('under_review', 'returned'), true);
check('under_review -> rejected legal', lib.canTransition('under_review', 'rejected'), true);
check('returned -> submitted legal', lib.canTransition('returned', 'submitted'), true);
check('approved -> approved legal (idempotent no-op)', lib.canTransition('approved', 'approved'), true);
check('approved -> submitted illegal', lib.canTransition('approved', 'submitted'), false);
check('rejected -> approved illegal', lib.canTransition('rejected', 'approved'), false);
check('draft -> approved illegal', lib.canTransition('draft', 'approved'), false);

// editability
check('student edits draft', lib.canStudentEdit('draft'), true);
check('student edits returned', lib.canStudentEdit('returned'), true);
check('student cannot edit submitted', lib.canStudentEdit('submitted'), false);
check('student cannot edit approved', lib.canStudentEdit('approved'), false);

// head actionability
check('head acts on submitted', lib.canHeadAct('submitted'), true);
check('head acts on under_review', lib.canHeadAct('under_review'), true);
check('head cannot act on draft', lib.canHeadAct('draft'), false);
check('head cannot act on approved', lib.canHeadAct('approved'), false);

check('terminal statuses are approved/rejected',
  JSON.stringify(lib.TERMINAL_STATUSES), JSON.stringify(['approved', 'rejected']));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll enrollment lib tests passed');
