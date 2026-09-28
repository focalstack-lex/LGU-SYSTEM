// =============================================
// tests/enrollment-eligibility.test.js
// Run with: node tests/enrollment-eligibility.test.js
// Pure eligibility rules used by the student enrollment screen.
// =============================================
const assert = require('assert');
const EJ = require('../client/js/enrollment-journey.js');

const S = (id, code, year, sem, units = 3) => ({ id, code, year_level: year, semester: sem, units, program: 'BSCoE' });
const subjects = [
  S('s111', 'CPE 111', 1, 1), S('s122', 'CPE 122', 1, 2),
  S('s211', 'CPE 211', 2, 1), S('s222', 'CPE 222', 2, 2),
  S('s311', 'CPE 311', 3, 1), S('s312', 'CPE 312', 3, 1), S('s321', 'CPE 321', 3, 2),
  S('s411', 'CPE 411', 4, 1),
];
// Newest record first, as the API returns them
const records = [
  { status: 'enrolled', subjects: { id: 's311', code: 'CPE 311' } },
  { status: 'passed',   subjects: { id: 's211', code: 'CPE 211' } },
  { status: 'failed',   subjects: { id: 's122', code: 'CPE 122' } },
  { status: 'passed',   subjects: { id: 's111', code: 'CPE 111' } },
  { status: 'failed',   subjects: { id: 's111', code: 'CPE 111' } }, // older failed attempt, later passed
];

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('failedCodes uses the newest record per subject', () => {
  const failed = EJ.failedCodes(records);
  assert.ok(failed.has('CPE 122'));
  assert.ok(!failed.has('CPE 111'), 'a subject passed after a fail is not a retake');
});

t('eligibleSubjects excludes passed and enrolled subjects', () => {
  const codes = EJ.eligibleSubjects(subjects, records, 3).map(s => s.code);
  assert.ok(!codes.includes('CPE 211'));
  assert.ok(!codes.includes('CPE 311'));
  assert.ok(!codes.includes('CPE 111'));
});

t('eligibleSubjects keeps the one-year window for untaken subjects', () => {
  const codes = EJ.eligibleSubjects(subjects, records, 3).map(s => s.code);
  assert.ok(codes.includes('CPE 222'), 'year 2 stays visible to a year 3 student');
  assert.ok(codes.includes('CPE 312'));
  assert.ok(codes.includes('CPE 321'));
  assert.ok(codes.includes('CPE 411'), 'higher years stay visible; prerequisites gate them, not the window');
  const yearTwo = EJ.eligibleSubjects(subjects, [], 3).map(s => s.code);
  assert.ok(!yearTwo.includes('CPE 111'), 'an untaken subject two years below is outside the window');
});

t('eligibleSubjects includes a failed subject from any year, flagged as a retake', () => {
  const list = EJ.eligibleSubjects(subjects, records, 3);
  const retake = list.find(s => s.code === 'CPE 122');
  assert.ok(retake, 'failed year-1 subject is offered to a year-3 student');
  assert.strictEqual(retake.retake, true);
  assert.strictEqual(list.find(s => s.code === 'CPE 312').retake, false);
});

t('eligibleSubjects with no year level applies no window', () => {
  const codes = EJ.eligibleSubjects(subjects, records, 0).map(s => s.code);
  assert.ok(codes.includes('CPE 411'));
});

t('semesterMismatch names the subject and the term', () => {
  const msg = EJ.semesterMismatch(S('s321', 'CPE 321', 3, 2), { semester: 1 });
  assert.strictEqual(msg, 'CPE 321 is a Semester 2 subject; this load is for Semester 1.');
  assert.strictEqual(EJ.semesterMismatch(S('s312', 'CPE 312', 3, 1), { semester: 1 }), null);
  assert.strictEqual(EJ.semesterMismatch(S('s312', 'CPE 312', 3, 1), null), null, 'no term, no check');
});

t('unmetPrerequisites reads structured rows and skips what is passed', () => {
  const rows = [
    { subject_id: 's312', depends_on_subject_id: { code: 'CPE 211' }, kind: 'prerequisite' },
    { subject_id: 's312', depends_on_subject_id: { code: 'CPE 222' }, kind: 'prerequisite' },
    { subject_id: 's312', depends_on_subject_id: { code: 'CPE 311' }, kind: 'corequisite' },
  ];
  const passedCodes = new Set(['CPE 211']);
  assert.deepStrictEqual(EJ.unmetPrerequisites(subjects[5], rows, passedCodes), ['CPE 222']);
  assert.deepStrictEqual(EJ.unmetPrerequisites(subjects[4], rows, passedCodes), []);
});

t('unmetPrerequisites falls back to the legacy text field', () => {
  const s = Object.assign({}, subjects[6], { prerequisites: 'CPE 211, CPE 222' });
  assert.deepStrictEqual(EJ.unmetPrerequisites(s, [], new Set(['CPE 222'])), ['CPE 211']);
});

t('loadUnits sums active items and reports the cap', () => {
  const sub = { status: 'draft', enrollment_submission_items: [
    { item_state: 'proposed', subjects: { units: 3 } },
    { item_state: 'proposed', subjects: { units: 4 } },
    { item_state: 'removed_by_head', subjects: { units: 5 } },
  ] };
  assert.deepStrictEqual(EJ.loadUnits(sub, 24), { total: 7, cap: 24, over: false });
  assert.deepStrictEqual(EJ.loadUnits(sub, 6), { total: 7, cap: 6, over: true });
  assert.deepStrictEqual(EJ.loadUnits(sub, null), { total: 7, cap: null, over: false });
});

console.log(`\n${passed} passed`);
