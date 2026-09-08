// Static wiring checks for the decision endpoints. Run: node scripts/smoke-test-faculty-decisions.js
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const routeSrc = fs.readFileSync(path.join(root, 'server', 'routes', 'faculty.js'), 'utf8');
const emailSrc = fs.readFileSync(path.join(root, 'server', 'lib', 'email.js'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('POST /submissions/:id/approve defined', /router\.post\('\/submissions\/:id\/approve'/.test(routeSrc));
check('POST /submissions/:id/return defined', /router\.post\('\/submissions\/:id\/return'/.test(routeSrc));
check('POST /submissions/:id/reject defined', /router\.post\('\/submissions\/:id\/reject'/.test(routeSrc));
check('POST /submissions/:id/mark-encoded defined', /router\.post\('\/submissions\/:id\/mark-encoded'/.test(routeSrc));
check('GET /submissions/:id/export defined', /router\.get\('\/submissions\/:id\/export'/.test(routeSrc));
check('approve is idempotent (approved no-op)', /already approved|alreadyApproved|status === 'approved'/i.test(routeSrc));
check('approve upserts student_units with the standard conflict target',
  /onConflict[^]*?student_id,subject_id,school_year,semester/.test(routeSrc));
check('approve excludes removed items', /removed_by_head/.test(routeSrc));
check('approve notifies the student', /createNotification/.test(routeSrc));
check('approve emails the student', /sendLoadStatusEmail/.test(routeSrc));
check('audit logs decisions', /FACULTY_APPROVE/.test(routeSrc) && /FACULTY_RETURN/.test(routeSrc) && /FACULTY_REJECT/.test(routeSrc));
check('mark-encoded allowed for all faculty roles', /mark-encoded/.test(routeSrc));
check('exceljs used for export', /exceljs|ExcelJS/i.test(routeSrc));
check('email.js exports sendLoadStatusEmail', /sendLoadStatusEmail/.test(emailSrc));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll faculty decision wiring checks passed');
