// Static checks for migration 034 contents. Run: node scripts/smoke-test-migration-034.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'supabase', 'migrations', '034_faculty_roles_and_submissions.sql'), 'utf8');

let failed = 0;
const check = (label, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; };

check('widens roles with faculty/program_head/dean', /'faculty', 'program_head', 'dean'/.test(src));
check('guarded role constraint (no blind drop)', /pg_constraint.*conname = 'profiles_role_check'/.test(src));
check('defines is_faculty()', /CREATE OR REPLACE FUNCTION public\.is_faculty\(\)/.test(src));
check('defines is_program_head_for(target_student UUID)', /is_program_head_for\(target_student UUID\)/.test(src));
check('submissions unique per student+term', /UNIQUE \(student_id, school_year, semester\)/.test(src));
check('items unique per submission+subject', /UNIQUE \(submission_id, subject_id\)/.test(src));
check('submission status enum complete', /'draft','submitted','under_review','approved','returned','rejected'/.test(src));
check('item_state enum complete', /'submitted','removed_by_head','added_by_head'/.test(src));
check('RLS enabled on both tables', (src.match(/ENABLE ROW LEVEL SECURITY/g) || []).length >= 2);
check('anon revoked on both tables', (src.match(/REVOKE ALL ON TABLE/g) || []).length >= 2);
check('students insert only own drafts', /student_id = auth\.uid\(\) AND status = 'draft'/.test(src));
check('encoded_at/encoded_by columns present', /encoded_at\s+TIMESTAMPTZ/.test(src) && /encoded_by\s+UUID/.test(src));
check('notifications target_role widened', /notifications_target_role_check/.test(src));

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll migration 034 checks passed');
