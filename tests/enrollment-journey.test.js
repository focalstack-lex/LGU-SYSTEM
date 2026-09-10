// =============================================
// tests/enrollment-journey.test.js
// Run with: node tests/enrollment-journey.test.js
// =============================================
const assert = require('assert');
const EJ = require('../client/js/enrollment-journey.js');

const base = () => ({
  id: 's1', status: 'draft', semester: 1, school_year: '2026-2027', encoded_at: null,
  enrollment_submission_items: [
    { id: 'i1', subject_id: 'x', item_state: 'submitted', subjects: { code: 'CS201', title: 'Data Structures', units: 3 } },
    { id: 'i2', subject_id: 'y', item_state: 'removed_by_head', subjects: { code: 'MATH5', title: 'Calculus 3', units: 3 } }
  ]
});

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('draft maps to build step, current', () => {
  const s = EJ.stepOf(base());
  assert.strictEqual(s.stepKey, 'build');
  assert.strictEqual(s.stepIndex, 0);
  assert.strictEqual(s.state, 'current');
});
t('submitted maps to with-head', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'submitted' }));
  assert.strictEqual(s.stepKey, 'with-head');
  assert.strictEqual(s.stepIndex, 1);
});
t('under_review maps to with-head', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'under_review' }));
  assert.strictEqual(s.stepKey, 'with-head');
});
t('approved without encoded_at maps to verified', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'approved' }));
  assert.strictEqual(s.stepKey, 'verified');
  assert.strictEqual(s.stepIndex, 2);
});
t('approved with encoded_at maps to encoded', () => {
  const s = Object.assign(base(), { status: 'approved', encoded_at: '2026-09-12T01:00:00Z' });
  const st = EJ.stepOf(s);
  assert.strictEqual(st.stepKey, 'encoded');
  assert.strictEqual(st.stepIndex, 3);
});
t('legacy returned is defensive', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'returned' }));
  assert.strictEqual(s.state, 'defensive');
  assert.strictEqual(s.legacyStatus, 'returned');
});
t('legacy rejected is defensive', () => {
  const s = EJ.stepOf(Object.assign(base(), { status: 'rejected' }));
  assert.strictEqual(s.state, 'defensive');
});
t('canEdit true only for draft', () => {
  assert.ok(EJ.canEdit(base()));
  assert.ok(!EJ.canEdit(Object.assign(base(), { status: 'submitted' })));
  assert.ok(!EJ.canEdit(Object.assign(base(), { status: 'under_review' })));
  assert.ok(!EJ.canEdit(Object.assign(base(), { status: 'approved' })));
  assert.ok(!EJ.canEdit(null));
});
t('activeItems excludes removed_by_head', () => {
  assert.strictEqual(EJ.activeItems(base()).length, 1);
});
t('draft with items yields submit action', () => {
  assert.strictEqual(EJ.actionFor(base()).kind, 'submit');
});
t('empty draft yields hint, no action', () => {
  const s = base();
  s.enrollment_submission_items = [];
  assert.strictEqual(EJ.actionFor(s).kind, 'none');
  assert.ok(/at least one subject/.test(EJ.actionFor(s).hint));
});
t('waiting states yield no action + waiting hint', () => {
  const sub = Object.assign(base(), { status: 'submitted' });
  const a = EJ.actionFor(sub);
  assert.strictEqual(a.kind, 'none');
  assert.ok(/notified/.test(a.hint));
});
t('approved waiting on SA yields no action + email hint', () => {
  const s = Object.assign(base(), { status: 'approved' });
  const a = EJ.actionFor(s);
  assert.strictEqual(a.kind, 'none');
  assert.ok(/emailed/.test(a.hint));
});
t('encoded yields no action and empty hint', () => {
  const s = Object.assign(base(), { status: 'approved', encoded_at: '2026-09-12T01:00:00Z' });
  assert.strictEqual(EJ.actionFor(s).kind, 'none');
});
t('toneFor maps approved/waiting/legacy', () => {
  assert.strictEqual(EJ.toneFor(base()), 'neutral');
  assert.strictEqual(EJ.toneFor(Object.assign(base(), { status: 'submitted' })), 'warning');
  assert.strictEqual(EJ.toneFor(Object.assign(base(), { status: 'approved' })), 'success');
  assert.strictEqual(EJ.toneFor(Object.assign(base(), { status: 'approved', encoded_at: 'x' })), 'success');
  assert.strictEqual(EJ.toneFor(Object.assign(base(), { status: 'returned' })), 'danger');
  assert.strictEqual(EJ.toneFor(null), 'neutral');
});

t('filterAvailable excludes passed and enrolled subjects', () => {
  const subjects = [
    { id: '1', code: 'CpE 111' },
    { id: '2', code: 'cpe 112  ' }, // enrolled, different case/spacing
    { id: '3', code: 'EMath 111' },
    { id: '4', code: 'NSTP 1' },
  ];
  const passed = new Set(['CPE 111']);
  const enrolled = new Set(['CPE 112']);
  const out = EJ.filterAvailable(subjects, passed, enrolled).map(s => s.id);
  assert.deepStrictEqual(out, ['3', '4']);
});

t('filterAvailable tolerates missing codes and empty input', () => {
  assert.strictEqual(EJ.filterAvailable([{ id: 'x', code: null }], new Set(), new Set()).length, 0);
  assert.strictEqual(EJ.filterAvailable(null, null, null).length, 0);
});

console.log(`\n${passed} enrollment-journey assertions passed.`);
