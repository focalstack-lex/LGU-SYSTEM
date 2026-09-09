// =============================================
// tests/grizz-recommend.test.js
// Run with: node tests/grizz-recommend.test.js
// =============================================
const assert = require('assert');
const GR = require('../client/js/grizz-recommend.js');

// Subject: [id, code, units, year_level, semester, extra]
const sb = (id, code, u, yl, sem, extra = {}) =>
  Object.assign({ id, code, title: code + ' Title', units: u, year_level: yl, semester: sem, prerequisites: '' }, extra);

// Standing record: passed subjects MUST carry units + subject year to bank them.
const rec = (code, status, { sy = '2026-2027', sem = 1, units, year } = {}) => ({
  school_year: sy, semester: sem, status,
  subjects: Object.assign({ code }, (units != null ? { units } : {}), (year != null ? { year_level: year } : {})),
});

const base = (subjects, extra = {}) => Object.assign({ subjects, prereqRows: [], myUnits: [], profileYear: 1 }, extra);

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

const codes = r => r.recommended.map(c => c.subject.code);

// ---- Standing derivation (units-based, registrar method) ----

t('standing is Year 2 once the full Year-1 curriculum is banked', () => {
  // Year 1 = 12 units (4 x 3u), Year 2 = 3 units -> boundaries 12 / 15
  const subjects = [
    sb('a', 'Y1A', 3, 1, 1), sb('b', 'Y1B', 3, 1, 1),
    sb('c', 'Y1C', 3, 1, 2), sb('d', 'Y1D', 3, 1, 2),
    sb('e', 'Y2E', 3, 2, 1),
  ];
  const myUnits = ['Y1A', 'Y1B', 'Y1C', 'Y1D'].map((code, i) =>
    rec(code, 'passed', { sy: '2025-2026', sem: i < 2 ? 1 : 2, units: 3, year: 1 }));
  const r = GR.buildRecommendations(base(subjects, { myUnits }));
  assert.strictEqual(r.standing.yearLevel, 2);
  assert.strictEqual(r.standing.basis, 'records');
  assert.strictEqual(r.standing.completedUnits, 12);
  assert.deepStrictEqual(codes(r), ['Y2E']);
});

t('a stray enrolled Year-4 subject does NOT promote standing (irregular transcript)', () => {
  // Year 1 = 12u, Year 2 = 6u (two 3u), Year 4 row = 3u.
  const subjects = [
    sb('a', 'Y1A', 3, 1, 1), sb('b', 'Y1B', 3, 1, 1),
    sb('c', 'Y1C', 3, 1, 2), sb('d', 'Y1D', 3, 1, 2),
    sb('e', 'Y2E', 3, 2, 1), sb('f', 'Y2F', 3, 2, 2),
    sb('g', 'Y4G', 3, 4, 1), // currently enrolled GE far ahead
    sb('h', 'Y4H', 3, 4, 2),
  ];
  const myUnits = [
    rec('Y1A', 'passed', { sy: '2024-2025', sem: 1, units: 3, year: 1 }),
    rec('Y1B', 'passed', { sy: '2024-2025', sem: 1, units: 3, year: 1 }),
    rec('Y1C', 'passed', { sy: '2024-2025', sem: 2, units: 3, year: 1 }),
    rec('Y1D', 'passed', { sy: '2024-2025', sem: 2, units: 3, year: 1 }),
    rec('Y4G', 'enrolled', { sy: '2026-2027', sem: 1, year: 4 }),
  ];
  const r = GR.buildRecommendations(base(subjects, { myUnits }));
  assert.strictEqual(r.standing.yearLevel, 2, 'units-based standing must stay at Year 2');
  const list = codes(r);
  assert.ok(!list.includes('Y4G'), 'currently enrolled subject is never suggested');
  assert.ok(list.includes('Y2E'), 'earliest open work is recommended');
  assert.ok(list.includes('Y2F'));
  assert.ok(list.indexOf('Y2E') < list.indexOf('Y4H'), 'Year-2 open work sorts before Year-4');
});

t('oldest unfinished work is recommended first, not the nominal next semester', () => {
  const subjects = [
    sb('f', 'Y1F', 3, 1, 2),          // owed Year-1 Sem-2 subject (never taken)
    sb('g', 'Y1G', 4, 1, 2),          // owed Year-1 Sem-2 subject
    sb('e', 'Y2E', 3, 2, 1),          // not taken
    sb('k', 'Y4K', 3, 4, 2),          // nominal "next semester" row
  ];
  const r = GR.buildRecommendations(base(subjects, { profileYear: 4 }));
  const list = codes(r);
  assert.ok(list.indexOf('Y1F') < list.indexOf('Y2E'), 'Year-1 gaps come first');
  assert.ok(list.indexOf('Y2E') < list.indexOf('Y4K'), 'then Year-2, then the far-future row');
});

t('enrolled subjects are excluded but satisfy prerequisites of open courses', () => {
  const subjects = [
    sb('e1', 'ENGR0', 3, 2, 1),
    sb('e2', 'ENGR3', 3, 2, 2, { prerequisites: 'ENGR0' }),
  ];
  const myUnits = [rec('ENGR0', 'enrolled', { sy: '2026-2027', sem: 1, year: 2 })];
  const r = GR.buildRecommendations(base(subjects, { myUnits }));
  const list = codes(r);
  assert.ok(list.includes('ENGR3'), 'prereq satisfied by current enrolment');
  assert.ok(!list.includes('ENGR0'));
  assert.strictEqual(r.blocked.length, 0);
});

// ---- Load caps ----

t('cap: never exceeds 24 units (five 6-unit subjects -> four chosen)', () => {
  const subjects = [1, 2, 3, 4, 5].map(n => sb('s' + n, 'SUB' + n, 6, 1, 1));
  const r = GR.buildRecommendations(base(subjects));
  assert.strictEqual(r.recommended.length, 4);
  assert.ok(r.totalUnits <= 24);
  assert.strictEqual(r.remainder.length, 1);
});

t('cap: never exceeds 5 subjects (six 4-unit subjects -> five chosen)', () => {
  const subjects = [1, 2, 3, 4, 5, 6].map(n => sb('s' + n, 'SUB' + n, 4, 1, 1));
  const r = GR.buildRecommendations(base(subjects));
  assert.strictEqual(r.recommended.length, 5);
  assert.strictEqual(r.remainder.length, 1);
});

// ---- Prerequisite phrasing ----

t('free-text "Year Standing" is eligibility-only and never blocks', () => {
  const subjects = [sb('s1', 'ENGG101', 3, 1, 1, { prerequisites: '3rd Year Standing' })];
  const r = GR.buildRecommendations(base(subjects));
  assert.ok(codes(r).includes('ENGG101'));
  assert.strictEqual(r.blocked.length, 0);
});

t('code prerequisites gate: subject stays locked until the code is banked', () => {
  const subjects = [
    sb('m1', 'MATH201', 3, 2, 1),
    sb('dep', 'MATH5', 3, 1, 1),
  ];
  const rows = [{ subject_id: 'm1', kind: 'prerequisite', detail: null, depends_code: 'MATH5' }];
  const blocked = GR.buildRecommendations(base(subjects, { prereqRows: rows }));
  assert.ok(blocked.blocked.some(b => b.subject.code === 'MATH201' && /MATH5/.test(b.reason)));
  const cleared = GR.buildRecommendations(base(subjects, {
    prereqRows: rows,
    myUnits: [rec('MATH5', 'passed', { sy: '2024-2025', sem: 1, units: 3, year: 1 })],
  }));
  assert.ok(codes(cleared).includes('MATH201'));
});

t('"Depends:" phrasing is a prerequisite, not satisfied by co-planning', () => {
  const subjects = [
    sb('a', 'MATH5', 3, 1, 1),
    sb('b', 'PHYS201', 3, 2, 1, { prerequisites: 'Depends: MATH5' }),
  ];
  const blocked = GR.buildRecommendations(base(subjects));
  assert.ok(blocked.blocked.some(b => b.subject.code === 'PHYS201' && /MATH5/.test(b.reason)));
  const cleared = GR.buildRecommendations(base(subjects, {
    myUnits: [rec('MATH5', 'passed', { sy: '2024-2025', sem: 1, units: 3, year: 1 })],
  }));
  assert.ok(codes(cleared).includes('PHYS201'));
});

t('corequisites travel together when both are open in the load', () => {
  const subjects = [
    sb('a', 'CpE 223', 3, 3, 1),
    sb('b', 'CpE 318', 2, 3, 1, { prerequisites: 'Co-req CpE 223' }),
  ];
  const r = GR.buildRecommendations(base(subjects));
  const list = codes(r);
  assert.ok(list.includes('CpE 223'));
  assert.ok(list.includes('CpE 318'));
  assert.strictEqual(r.blocked.length, 0);
});

t('multi-code list gates on every listed code', () => {
  const subjects = [
    sb('a', 'CE222', 3, 2, 1),
    sb('c', 'CE323', 3, 3, 1, { prerequisites: 'CE 221; CE 222' }),
  ];
  const myUnits = [rec('CE221', 'passed', { sy: '2025-2026', sem: 1, units: 3, year: 2 })];
  const r = GR.buildRecommendations(base(subjects, { myUnits }));
  assert.ok(r.blocked.some(b => b.subject.code === 'CE323' && /CE 222/.test(b.reason)));
});

// ---- Retakes ----

t('owed retakes sort ahead of fresh courses within the same slot and are flagged', () => {
  const subjects = [
    sb('r1', 'CALC1', 3, 1, 1),
    sb('p1', 'ENGG2', 3, 1, 1),
  ];
  const myUnits = [rec('CALC1', 'failed', { sy: '2024-2025', sem: 1, year: 1 })];
  const r = GR.buildRecommendations(base(subjects, { myUnits }));
  const calc = r.recommended.find(c => c.subject.code === 'CALC1');
  assert.ok(calc, 'CALC1 should be recommended as a retake');
  assert.strictEqual(calc.kind, 'retake');
  assert.strictEqual(calc.retake, true);
  assert.strictEqual(r.recommended[0].subject.code, 'CALC1');
  assert.strictEqual(r.counts.retake, 1);
});

t('failed lower-year subject is prioritized over a fresh on-track course', () => {
  const subjects = [
    sb('r1', 'CALC1', 3, 1, 2),   // failed Year-1 Sem-2 course
    sb('p1', 'MAIN3', 3, 2, 1),   // on-track Year-2 course
  ];
  const myUnits = [rec('CALC1', 'failed', { sy: '2025-2026', sem: 2, year: 1 })];
  const r = GR.buildRecommendations(base(subjects, { myUnits }));
  const list = codes(r);
  assert.strictEqual(list[0], 'CALC1');
  assert.ok(list.includes('MAIN3'));
});

console.log(`\n${passed} grizz-recommend assertions passed.`);
