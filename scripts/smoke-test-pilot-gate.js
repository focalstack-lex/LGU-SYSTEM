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
check('pilotGate fails closed without hardcoded fallback', !roles.includes('PILOT_DEFAULT'));
check('pilotGate reads ENROLLMENT_PILOT_EMAILS env', /ENROLLMENT_PILOT_EMAILS/.test(roles));
check('pilotGate exported', /pilotGate/.test((roles.match(/module\.exports[^;]+/) || [''])[0]));

const enr = read('server/routes/enrollment.js');
check('enrollment router applies pilotGate', /router\.use\(pilotGate\)/.test(enr));

const fac = read('server/routes/faculty.js');
check('faculty router applies pilotGate', /router\.use\(pilotGate\)/.test(fac));

// --- client flag + student gate (Task 2) ---
const cfg = read('client/js/config.js');
check('config does not expose hardcoded emails', !cfg.includes('ENROLLMENT_PILOT_EMAILS = ['));
check('config defines isEnrollmentPilot async function', /window\.isEnrollmentPilot\s*=/.test(cfg));

const enrollmentJs = read('client/js/enrollment.js');
check('enrollment load() checks isEnrollmentPilot', /isEnrollmentPilot/.test(enrollmentJs));
check('enrollment renders gated notice', /renderGatedNotice/.test(enrollmentJs));

// --- faculty portal gate (Task 3) ---
const facultyJs = read('client/js/faculty/faculty.js');
check('faculty boot() checks isEnrollmentPilot', /isEnrollmentPilot/.test(facultyJs));

// --- enrollment export widening (Task 4) ---
check('Enrollment exports ensureReady', /ensureReady:\s*load/.test(enrollmentJs));
check('Enrollment exports canEdit', /canEdit:\s*\(\)/.test(enrollmentJs));
check('Enrollment exports lockedReason', /lockedReason:\s*\(\)/.test(enrollmentJs));
check('Enrollment exports draftSubjectIds', /draftSubjectIds:\s*\(\)/.test(enrollmentJs));
check('addItem returns ok/error contract', /return\s*\{\s*ok:\s*false,\s*error/.test(enrollmentJs));

// --- Grizz add buttons (Task 5) ---
const aiJs = read('client/js/ai-assistant.js');
check('appendBotMessage returns message element', /scrollToBottom\(\);\s*\n\s*return msg;/.test(aiJs));
check('recommendations await ensureReady', /await window\.Enrollment\?\.ensureReady\(\)/.test(aiJs));
check('per-card add buttons rendered', /data-grizz-add=/.test(aiJs));
check('add-all button rendered', /data-grizz-add-all/.test(aiJs));
check('jump link to enrollment view', /ursa-nav-link"\s+data-view="enrollment"/.test(aiJs));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll pilot-gate checks passed');
process.exit(failed ? 1 : 0);
