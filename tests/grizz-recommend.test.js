// =============================================
// tests/grizz-recommend.test.js
// Run with: node tests/grizz-recommend.test.js
// =============================================
const assert = require('assert');
const GR = require('../client/js/grizz-recommend.js');

const subj = (id, code, units, year_level, semester, extra = {}) =>
  Object.assign({ id, code, title: code + ' Title', units, year_level, semester, prerequisites: '' }, extra);

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

const baseOpts = (subjects, extra = {}) => Object.assign({
  subjects,
  prereqRows: [],
  myUnits: [],
  profileYear: 2,
  now: '2026-07-15T00:00:00Z', // mid-SY Semester 1 planning window
}, extra);

t('resolveTarget: no history, no active term -> Sem 1 of active SY at profile year', () => {
  const tgt = GR.resolveTarget({ profileYear: 2, myUnits: [], now: '2026-07-15T00:00:00Z' });
  assert.strictEqual(tgt.schoolYear, '2026-2027');
  assert.strictEqual(tgt.semester, 1);
  assert.strictEqual(tgt.yearLevel, 2);
});

t('resolveTarget: finishing Sem 2 promotes into next year Sem 1', () => {
  const units = [
    { school_year: '2025-2026', semester: 2, status: 'passed',
      subjects: { code: 'MATH1', year_level: 1 } },
  ];
  const tgt = GR.resolveTarget({ profileYear: 1, myUnits: units, now: '2026-05-01T00:00:00Z' });
  assert.strictEqual(tgt.schoolYear, '2026-2027');
  assert.strictEqual(tgt.semester, 1);
  assert.strictEqual(tgt.yearLevel, 2); // promoted
});

t('resolveTarget: activeTerm wins and pins the semester', () => {
  const tgt = GR.resolveTarget({ profileYear: 2, myUnits: [], activeTerm: { schoolYear: '2026-2027', semester: 2 } });
  assert.strictEqual(tgt.semester, 2);
  assert.strictEqual(tgt.yearLevel, 2);
});

// GAP 1 regression: the old `||` cap let 5x6-unit subjects reach 30 units.
t('cap: never exceeds 24 units (5 six-unit subjects -> 4 chosen)', () => {
  const subjects = [1, 2, 3, 4, 5].map(n => subj('s' + n, 'SUB' + n, 6, 2, 1));
  const r = GR.buildRecommendations(baseOpts(subjects));
  assert.strictEqual(r.recommended.length, 4);
  assert.ok(r.totalUnits <= 24);
  assert.strictEqual(r.remainder.length, 1);
});

// GAP 1 regression: the old `||` cap let 6 four-unit subjects in (24 units, 6 subjects).
t('cap: never exceeds 5 subjects (6 four-unit subjects -> 5 chosen)', () => {
  const subjects = [1, 2, 3, 4, 5, 6].map(n => subj('s' + n, 'SUB' + n, 4, 2, 1));
  const r = GR.buildRecommendations(baseOpts(subjects));
  assert.strictEqual(r.recommended.length, 5);
  assert.strictEqual(r.remainder.length, 1);
});

// GAP 2 regression: recommendations must be scoped to the target term + backlog.
t('term scope: recommends only target year/sem plus lower-year backlog', () => {
  const subjects = [
    subj('a1', 'Y1A', 3, 1, 1),   // lower-year backlog (never passed)
    subj('a2', 'Y1B', 3, 1, 2),   // lower-year backlog
    subj('b1', 'Y2S1A', 3, 2, 1), // primary
    subj('b2', 'Y2S1B', 3, 2, 1), // primary
    subj('b3', 'Y2S2A', 3, 2, 2), // wrong semester of same year -> out of scope
    subj('c1', 'Y3A', 3, 3, 1),   // future year -> out of scope
  ];
  const r = GR.buildRecommendations(baseOpts(subjects));
  const codes = r.recommended.map(c => c.subject.code);
  assert.ok(codes.includes('Y2S1A'));
  assert.ok(codes.includes('Y2S1B'));
  assert.ok(codes.includes('Y1A'));      // backlog included
  assert.ok(codes.includes('Y1B'));      // backlog included (fills spare units)
  assert.ok(!codes.includes('Y2S2A'));   // wrong semester excluded
  assert.ok(!codes.includes('Y3A'));     // future year excluded
  assert.ok(!r.blocked.some(b => b.subject.code === 'Y2S2A'));
});

t('excludes passed and currently-enrolled subjects', () => {
  const subjects = [
    subj('p1', 'PASSED1', 3, 2, 1),
    subj('e1', 'ENROLLED1', 3, 2, 1),
    subj('n1', 'NEWSUBJ', 3, 2, 1),
  ];
  const myUnits = [
    { school_year: '2025-2026', semester: 2, status: 'passed', subjects: { code: 'PASSED1' } },
    { school_year: '2026-2027', semester: 1, status: 'enrolled', subjects: { code: 'ENROLLED1' } },
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { myUnits }));
  const codes = r.recommended.map(c => c.subject.code);
  assert.deepStrictEqual(codes, ['NEWSUBJ']);
});

t('prereq-blocked subject is reported with a reason', () => {
  const subjects = [
    subj('m1', 'MATH201', 3, 2, 1),                    // needs CS301 (future, absent)
    subj('f1', 'CS301', 3, 3, 1),                      // future year, out of scope
  ];
  const rows = [
    { subject_id: 'm1', kind: 'prerequisite', detail: null, depends_code: 'CS301' },
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { prereqRows: rows }));
  assert.strictEqual(r.recommended.length, 0);
  assert.ok(r.blocked.some(b => b.subject.code === 'MATH201' && /CS301/.test(b.reason)));
});

t('corequisites travel together when both are in the upcoming load', () => {
  const subjects = [
    subj('c1', 'CS201', 3, 2, 1),
    subj('c2', 'LAB201', 2, 2, 1),
  ];
  const rows = [
    { subject_id: 'c2', kind: 'corequisite', detail: null, depends_code: 'CS201' },
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { prereqRows: rows }));
  const codes = r.recommended.map(c => c.subject.code).sort();
  assert.deepStrictEqual(codes, ['CS201', 'LAB201']);
});

t('failed backlog subjects are recommended and flagged as retakes', () => {
  const subjects = [
    subj('r1', 'CALC1', 3, 1, 1),
    subj('p1', 'ENGG2', 3, 2, 1),
  ];
  const myUnits = [
    { school_year: '2025-2026', semester: 1, status: 'failed', subjects: { code: 'CALC1' } },
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { myUnits }));
  const calc = r.recommended.find(c => c.subject.code === 'CALC1');
  assert.ok(calc, 'CALC1 should be recommended as backlog retake');
  assert.strictEqual(calc.kind, 'backlog');
  assert.strictEqual(calc.retake, true);
});

t('returned metadata includes primary/backlog counts', () => {
  const subjects = [
    subj('x1', 'BACK1', 3, 1, 1),
    subj('x2', 'MAIN1', 3, 2, 1),
  ];
  const r = GR.buildRecommendations(baseOpts(subjects));
  assert.strictEqual(r.counts.primary, 1);
  assert.strictEqual(r.counts.backlog, 1);
  assert.strictEqual(r.counts.blocked, 0);
});

// ---- Free-text prerequisite phrasing (standing / co-req / depends) ----

// Standing is an eligibility window, satisfied by term scoping — it must
// never block a course or appear under "blocked".
t('legacy: "3rd Year Standing" text is eligibility-only and never blocks', () => {
  const subjects = [
    subj('s1', 'ENGG101', 3, 2, 1, { prerequisites: '3rd Year Standing' }),
  ];
  const r = GR.buildRecommendations(baseOpts(subjects)); // profileYear 2, Sem 1
  assert.ok(r.recommended.some(c => c.subject.code === 'ENGG101'));
  assert.strictEqual(r.blocked.length, 0);
});

t('legacy: standing requirement clears once the student is in Year 3', () => {
  const subjects = [
    subj('s1', 'ENGG301', 3, 3, 1, { prerequisites: '3rd Year Standing' }),
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { profileYear: 3, now: '2026-07-15T00:00:00Z' }));
  assert.ok(r.recommended.some(c => c.subject.code === 'ENGG301'), 'Year-3 subject should be recommended at Year-3 target');
});

t('legacy: "4th Yr Standing" (abbrev) no longer gates eligibility', () => {
  const y3 = GR.buildRecommendations(baseOpts(
    [subj('s1', 'CAPSTONE', 3, 3, 1, { prerequisites: '4th Yr Standing' })],
    { profileYear: 3, now: '2026-07-15T00:00:00Z' }));
  assert.ok(y3.recommended.some(c => c.subject.code === 'CAPSTONE'));
  assert.strictEqual(y3.blocked.length, 0);
  const y4 = GR.buildRecommendations(baseOpts(
    [subj('s1', 'CAPSTONE', 3, 4, 1, { prerequisites: '4th Yr Standing' })],
    { profileYear: 4, now: '2026-07-15T00:00:00Z' }));
  assert.ok(y4.recommended.some(c => c.subject.code === 'CAPSTONE'));
});

t('legacy: "*240 hours / 4th Yr Standing" is descriptive and never blocks', () => {
  const hoursPrereq = '*240 hours / 4th Yr Standing';
  const y3 = GR.buildRecommendations(baseOpts(
    [subj('s1', 'OJT', 6, 3, 1, { prerequisites: hoursPrereq })],
    { profileYear: 3, now: '2026-07-15T00:00:00Z' }));
  assert.ok(y3.recommended.some(c => c.subject.code === 'OJT'));
  const y4 = GR.buildRecommendations(baseOpts(
    [subj('s1', 'OJT', 6, 4, 1, { prerequisites: hoursPrereq })],
    { profileYear: 4, now: '2026-07-15T00:00:00Z' }));
  assert.ok(y4.recommended.some(c => c.subject.code === 'OJT'));
  assert.strictEqual(y3.blocked.length + y4.blocked.length, 0);
});

t('legacy: "Co-req CpE 223" corequisite travels with a co-planned subject', () => {
  const subjects = [
    subj('a', 'CpE 223', 3, 3, 1),
    subj('b', 'CpE 318', 2, 3, 1, { prerequisites: 'Co-req CpE 223' }),
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { profileYear: 3, now: '2026-07-15T00:00:00Z' }));
  const codes = r.recommended.map(c => c.subject.code);
  assert.ok(codes.includes('CpE 223'));
  assert.ok(codes.includes('CpE 318'));
});

t('legacy: "Co: ECE 211" and "co-requisite:" forms parse the same way', () => {
  const mk = (id, code, req) => subj(id, code, 3, 2, 1, { prerequisites: req });
  const subjects = [
    mk('a', 'ECE 211', null),
    mk('b', 'ECE 212', 'Co: ECE 211'),
    mk('c', 'EMath 121', null),
    mk('d', 'EMath 122', 'co-requisite: EMath 121'),
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { profileYear: 2, now: '2026-07-15T00:00:00Z' }));
  const codes = r.recommended.map(c => c.subject.code);
  assert.ok(codes.includes('ECE 212'));
  assert.ok(codes.includes('EMath 122'));
});

t('legacy: "Depends:" phrasing is a prerequisite, not satisfied by co-planning', () => {
  const subjects = [
    subj('a', 'MATH5', 3, 2, 1),                                     // planned same term, NOT passed
    subj('b', 'PHYS201', 3, 2, 1, { prerequisites: 'Depends: MATH5' }),
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { profileYear: 2, now: '2026-07-15T00:00:00Z' }));
  assert.ok(r.blocked.some(b => b.subject.code === 'PHYS201' && /MATH5/.test(b.reason)));
  // Once MATH5 is passed, PHYS201 becomes eligible.
  const myUnits = [
    { school_year: '2025-2026', semester: 2, status: 'passed', subjects: { code: 'MATH5' } },
  ];
  const r2 = GR.buildRecommendations(baseOpts(subjects, { profileYear: 2, myUnits, now: '2026-07-15T00:00:00Z' }));
  assert.ok(r2.recommended.some(c => c.subject.code === 'PHYS201'));
});

t('legacy: multi-code list gates on every code', () => {
  const subjects = [
    subj('b', 'CE222', 3, 2, 1),
    subj('c', 'CE323', 3, 3, 1, { prerequisites: 'CE 221; CE 222' }),
  ];
  // CE221 passed, CE222 still owed -> still blocked.
  const myUnits = [
    { school_year: '2025-2026', semester: 1, status: 'passed', subjects: { code: 'CE221' } },
  ];
  const r = GR.buildRecommendations(baseOpts(subjects, { profileYear: 3, myUnits, now: '2026-07-15T00:00:00Z' }));
  assert.ok(r.blocked.some(b => b.subject.code === 'CE323' && /CE 222/.test(b.reason)));
});

t('structured: "Year Standing" detail rows are eligibility-only and never block', () => {
  const rows = [
    { subject_id: 's1', kind: 'prerequisite', detail: '4th Year Standing', depends_code: null },
  ];
  const r3 = GR.buildRecommendations(baseOpts(
    [subj('s1', 'ECE410', 3, 3, 1)], { profileYear: 3, prereqRows: rows, now: '2026-07-15T00:00:00Z' }));
  assert.ok(r3.recommended.some(c => c.subject.code === 'ECE410'));
  assert.strictEqual(r3.blocked.length, 0);
  const r4 = GR.buildRecommendations(baseOpts(
    [subj('s1', 'ECE410', 3, 4, 1)], { profileYear: 4, prereqRows: rows, now: '2026-07-15T00:00:00Z' }));
  assert.ok(r4.recommended.some(c => c.subject.code === 'ECE410'));
});

console.log(`\n${passed} grizz-recommend assertions passed.`);
