// Static wiring checks for the enrollment pilot gate (spec 2026-09-08).
const fs = require('fs');
const path = require('path');
let failed = 0;
function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) failed++;
}
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// --- server gate (Task 1) ---
const roles = read('server/middleware/roles.js');
check('pilotGate middleware defined', /function pilotGate\(/.test(roles));
check('pilotGate checks req.user.email', /req\.user\?\.email/.test(roles));
check('pilotGate default includes admin + test accounts',
  ['lexmatondo', 'test.newuser', 'bsce.test', 'head.test', 'dean.test', 'sa.test', 'klydemodina']
    .every(e => roles.includes(e + '@g.cjc.edu.ph')));
check('pilotGate reads ENROLLMENT_PILOT_EMAILS env', /ENROLLMENT_PILOT_EMAILS/.test(roles));
check('pilotGate exported', /pilotGate/.test((roles.match(/module\.exports[^;]+/) || [''])[0]));

const enr = read('server/routes/enrollment.js');
check('enrollment router applies pilotGate', /router\.use\(requireStudent\);\s*\n\s*router\.use\(pilotGate\)/.test(enr));

const fac = read('server/routes/faculty.js');
check('faculty router applies pilotGate', /router\.use\(requireFaculty\);\s*\n\s*router\.use\(pilotGate\)/.test(fac));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll pilot-gate checks passed');
process.exit(failed ? 1 : 0);
