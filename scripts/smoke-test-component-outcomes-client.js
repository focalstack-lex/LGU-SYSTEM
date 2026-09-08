// Smoke test for the client-side component-level outcomes feature (spec
// addendum 2026-09-08). Extracts the pure earned-units and derived-status
// helpers from client/js/units.js via the same vm pattern as
// smoke-test-units-fields.js, then statically wires-checks that the modal
// carries the Laboratory fields, saves the four component fields, and that
// Grizz gates prerequisites on full passes and builds partialPasses.
// Run: node scripts/smoke-test-component-outcomes-client.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const unitsSource = fs.readFileSync(path.join(root, 'client', 'js', 'units.js'), 'utf8');
const grizzSource = fs.readFileSync(path.join(root, 'client', 'js', 'ai-assistant.js'), 'utf8');

// Brace-matched extraction of a function from the source.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`${name} not found in source`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { if (--depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`Unterminated function ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFn(unitsSource, 'earnedUnitsFor'), sandbox);
vm.runInContext(extractFn(unitsSource, 'deriveOverallStatus'), sandbox);

let failed = 0;
function check(ok, label) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
}

// ---- earnedUnitsFor(record, subject) ----
const labSubject = { units: 3, lec_units: 2, lab_units: 1 };
const labLessSubject = { units: 3, lec_units: 3, lab_units: 0 };

const earnedCases = [
  ['full pass via both components -> all units',
    { lec_status: 'passed', lab_status: 'passed' }, labSubject, 3],
  ['overall passed wins even with a failed component recorded',
    { status: 'passed', lec_status: 'passed', lab_status: 'failed' }, labSubject, 3],
  ['lecture passed only -> lec_units',
    { status: 'failed', lec_status: 'passed', lab_status: 'failed' }, labSubject, 2],
  ['lab passed only -> lab_units',
    { status: 'failed', lec_status: 'failed', lab_status: 'passed' }, labSubject, 1],
  ['no component passed -> 0',
    { status: 'failed', lec_status: 'failed', lab_status: 'failed' }, labSubject, 0],
  ['both enrolled (current term) -> 0',
    { status: 'enrolled', lec_status: 'enrolled', lab_status: 'enrolled' }, labSubject, 0],
  ['legacy record without components, status passed -> full units',
    { status: 'passed' }, labSubject, 3],
  ['legacy record without components, status failed -> 0',
    { status: 'failed' }, labSubject, 0],
  ['lab-less legacy subject, status passed -> full units',
    { status: 'passed' }, labLessSubject, 3],
  ['null record -> 0',
    null, labSubject, 0],
];
for (const [label, record, subject, expected] of earnedCases) {
  const got = sandbox.earnedUnitsFor(record, subject);
  check(got === expected, `earnedUnitsFor ${label} (got ${got}, want ${expected})`);
}

// ---- deriveOverallStatus(lecStatus, labStatus) ----
const statusCases = [
  ['both passed -> passed', 'passed', 'passed', 'passed'],
  ['lecture failed -> failed', 'failed', 'passed', 'failed'],
  ['lab failed -> failed', 'passed', 'failed', 'failed'],
  ['both failed -> failed', 'failed', 'failed', 'failed'],
  ['lecture passed, lab enrolled -> enrolled', 'passed', 'enrolled', 'enrolled'],
  ['lecture passed, lab incomplete -> incomplete', 'passed', 'incomplete', 'incomplete'],
  ['lab incomplete alone -> incomplete', 'enrolled', 'incomplete', 'incomplete'],
  ['both dropped -> dropped', 'dropped', 'dropped', 'dropped'],
  ['both enrolled -> enrolled', 'enrolled', 'enrolled', 'enrolled'],
];
for (const [label, lec, lab, expected] of statusCases) {
  const got = sandbox.deriveOverallStatus(lec, lab);
  check(got === expected, `deriveOverallStatus ${label} (got ${got}, want ${expected})`);
}

// ---- Static wiring: units.js modal + save payload ----
const unitsWiring = [
  ['id="units-lab-status"', 'modal contains Laboratory Status field'],
  ['id="units-lab-grade"', 'modal contains Laboratory Grade field'],
  ['Lecture Status', 'shared status input relabelled as Lecture Status'],
  ['Lecture Grade (1.0', 'shared grade input relabelled as Lecture Grade'],
  ['Number(modalSubject?.lab_units) > 0', 'modal component fields gated on lab_units > 0'],
  ['body.lec_status = status;', 'save sends lec_status'],
  ['body.lec_grade  = gradeRaw', 'save sends lec_grade'],
  ['body.lab_status = document.getElementById(\'units-lab-status\').value;', 'save sends lab_status'],
  ['body.lab_grade  = labGradeRaw', 'save sends lab_grade'],
  ['body.status = deriveOverallStatus(status,', 'save derives the overall status'],
  ['Laboratory grade must be between 1.0 and 5.0.', 'save validates the laboratory grade'],
  ['rec.lec_status != null || rec.lab_status != null', 'badge splits on component records'],
  ['compBadge(\'Lec\', rec.lec_status, rec.lec_grade)', 'badge renders the Lecture component'],
  ['compBadge(\'Lab\', rec.lab_status, rec.lab_grade)', 'badge renders the Laboratory component'],
  ['rec ? sum + earnedUnitsFor(rec, s) : sum', 'progress math uses earnedUnitsFor per newest record'],
];
for (const [needle, label] of unitsWiring) {
  check(unitsSource.includes(needle), `units.js: ${label}`);
}

// ---- Static wiring: ai-assistant.js Grizz gating ----
const grizzWiring = [
  ['const partialPasses = new Map()', 'Grizz builds a partialPasses map'],
  ["u.status === 'passed' || (lecPassed && labPassed)", 'passedCodes requires a full pass'],
  ["partialPasses.set(code, lecPassed ? 'lecture' : 'laboratory')", 'partialPasses maps code -> passed component'],
  ['Component Backlog', 'Grizz renders a Component Backlog note'],
  ['retake the lab only', 'Component Backlog names the lab-only retake'],
  ['retake the lecture only', 'Component Backlog names the lecture-only retake'],
  ['classifyPasses(myUnits)', 'Grizz classifies passes from unit records'],
];
for (const [needle, label] of grizzWiring) {
  check(grizzSource.includes(needle), `ai-assistant.js: ${label}`);
}

if (failed) { console.error(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log('\nAll checks passed.');
