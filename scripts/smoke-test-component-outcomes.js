// Smoke test for component-level outcomes (spec addendum 2026-09-08):
// extracts the component sanitizers from the live route source (same vm
// pattern as smoke-test-units-fields.js) and verifies enum status checks,
// 1.00–5.00 grade bounds, absent-field handling, and applyComponentOutcomes
// inclusion, plus static wiring checks for /my, the standing PDF, and
// migration 033. Run: node scripts/smoke-test-component-outcomes.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server', 'routes', 'units.js'), 'utf8');

// Brace-matched extraction of a top-level function from the source. The
// parameter list is skipped first (paren-matched) so default params like
// `src = {}` don't end the scan early.
function extractFn(src, name) {
  const start = src.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`${name} not found in route source`);
  const openParen = src.indexOf('(', start);
  let parenDepth = 0, paramsEnd = -1;
  for (let i = openParen; i < src.length; i++) {
    if (src[i] === '(') parenDepth++;
    else if (src[i] === ')') { if (--parenDepth === 0) { paramsEnd = i; break; } }
  }
  if (paramsEnd < 0) throw new Error(`Unmatched parameter list for ${name}`);
  let depth = 0;
  for (let i = src.indexOf('{', paramsEnd); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { if (--depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`Unterminated function ${name}`);
}

const sandbox = { isValidEnum: (val, allowed) => allowed.includes(val) };
vm.createContext(sandbox);
// The route's status enum is a top-level const - pull it in verbatim so the
// extracted sanitizers run against the real list.
const statusEnumMatch = source.match(/const VALID_STATUSES = \[[^\]]*\];/);
if (!statusEnumMatch) throw new Error('VALID_STATUSES not found in route source');
vm.runInContext(statusEnumMatch[0], sandbox);
// sanitizeComponentOutcomes closes over the two single-field sanitizers, and
// applyComponentOutcomes closes over sanitizeComponentOutcomes.
for (const name of ['isValidGrade', 'normalizeGrade', 'sanitizeComponentStatus', 'sanitizeComponentGrade', 'sanitizeComponentOutcomes', 'applyComponentOutcomes']) {
  vm.runInContext(extractFn(source, name), sandbox);
}

let failed = 0;
function check(label, ok, detail) {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` -> ${JSON.stringify(detail)}`}`);
}

// 1. Valid enum statuses pass through unchanged.
for (const s of ['enrolled', 'passed', 'failed', 'dropped', 'incomplete']) {
  check(`sanitizeComponentStatus('${s}') kept`, sandbox.sanitizeComponentStatus(s) === s, sandbox.sanitizeComponentStatus(s));
}

// 2. Invalid / absent statuses are nulled, never passed through.
const badStatuses = [
  ['PASSED', sandbox.sanitizeComponentStatus('PASSED')],   // case-sensitive enum
  ['dropped out', sandbox.sanitizeComponentStatus('dropped out')],
  ['<script>', sandbox.sanitizeComponentStatus('<script>')],
  ['', sandbox.sanitizeComponentStatus('')],
  [null, sandbox.sanitizeComponentStatus(null)],
  [undefined, sandbox.sanitizeComponentStatus(undefined)],
];
for (const [input, got] of badStatuses) {
  check(`sanitizeComponentStatus(${JSON.stringify(input ?? null)}) -> null`, got === null, got);
}

// 3. In-range grades are kept (reusing the file's 1.00-5.00 grade rules).
const goodGrades = [[1.75, 1.75], ['2.25', 2.25], [5, 5], [1, 1]];
for (const [input, expected] of goodGrades) {
  const got = sandbox.sanitizeComponentGrade(input);
  check(`sanitizeComponentGrade(${JSON.stringify(input)}) -> ${expected}`, got === expected, got);
}

// 4. Out-of-range / junk grades are rejected (nulled).
const badGrades = [0, 6, -1, 5.01, 'abc', null, undefined, ''];
for (const input of badGrades) {
  const got = sandbox.sanitizeComponentGrade(input);
  check(`sanitizeComponentGrade(${JSON.stringify(input ?? null)}) -> null`, got === null, got);
}

// 5. Bulk sanitizer: valid fields land on the row, invalid/absent ones are
//    omitted entirely (so an enroll that omits them never wipes prior values).
const row = { status: 'enrolled', grade: 3 };
sandbox.applyComponentOutcomes(row, {
  lec_status: 'passed', lec_grade: 1.75,
  lab_status: 'failed', lab_grade: 5,
});
check('applyComponentOutcomes copies lec_status', row.lec_status === 'passed', row);
check('applyComponentOutcomes copies lec_grade', row.lec_grade === 1.75, row);
check('applyComponentOutcomes copies lab_status', row.lab_status === 'failed', row);
check('applyComponentOutcomes copies lab_grade', row.lab_grade === 5, row);

const cleanRow = { status: 'enrolled' };
sandbox.applyComponentOutcomes(cleanRow, { lec_status: 'nope', lec_grade: 0, lab_grade: null, lab_status: undefined });
check('invalid/absent component fields omitted from row', Object.keys(cleanRow).length === 1, cleanRow);

// 6. Static wiring - /my SELECT carries the four component fields.
const mySelectNeedle = 'lec_grade, lab_grade, lec_status, lab_status, instructor, schedule, subjects(';
check('/my SELECT includes the four component fields', source.includes(mySelectNeedle));

// 7. Static wiring - standing PDF renders "/"-joined component grades.
check('standing PDF joins lec/lab grades with " / "', source.includes("} / ${rec.lab_grade != null ? String(rec.lab_grade) : '-'}"));
check('standing PDF keeps plain grade for non-component rows', source.includes("rec?.grade != null ? String(rec.grade) : '-'"));

// 8. Static wiring - enroll / batch-enroll / update all sanitize components.
check('/enroll applies component outcomes', /const payload = \{[\s\S]*?\};\s*applyComponentOutcomes\(payload, \{ lec_status, lab_status, lec_grade, lab_grade \}\);/.test(source));
check('/batch-enroll applies component outcomes', /rowsToUpsert\.push\(applyComponentOutcomes\(\{[\s\S]*?\}, \{ lec_status, lab_status, lec_grade, lab_grade \}\)\);/.test(source));
check('/update applies component outcomes', /applyComponentOutcomes\(updates, \{ lec_status, lab_status, lec_grade, lab_grade \}\);/.test(source));

// 9. Migration 033 exists with the four additive columns.
const migrationPath = path.join(root, 'supabase', 'migrations', '033_component_outcomes.sql');
check('migration 033_component_outcomes.sql exists', fs.existsSync(migrationPath));
if (fs.existsSync(migrationPath)) {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  for (const col of ['lec_grade NUMERIC(4,2)', 'lab_grade NUMERIC(4,2)', 'lec_status TEXT', 'lab_status TEXT']) {
    const re = new RegExp(`ADD COLUMN IF NOT EXISTS ${col.replace(/[()\\.$^*+?[\]{}|]/g, '\\$&')}`);
    check(`migration 033 adds ${col.split(' ')[0]}`, re.test(sql));
  }
  check('migration 033 constrains lec_status enum', /lec_status IN \('enrolled','passed','failed','dropped','incomplete'\)/.test(sql));
  check('migration 033 constrains lab_status enum', /lab_status IN \('enrolled','passed','failed','dropped','incomplete'\)/.test(sql));
}

if (failed) { console.error(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log('\nAll checks passed.');
