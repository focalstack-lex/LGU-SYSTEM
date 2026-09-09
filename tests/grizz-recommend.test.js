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

console.log(`\n${passed} grizz-recommend assertions passed.`);
