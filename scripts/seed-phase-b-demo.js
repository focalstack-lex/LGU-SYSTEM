// Phase B demo seed: fake but realistic data for local testing. Idempotent.
// Touches ONLY the test accounts (Alex Rivera + a new BSCE student).
// Run: node scripts/seed-phase-b-demo.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = 'Coetest2026!';
const ALEX_ID = 'a8e399d9-2f2a-4e19-8e46-61b2a4f78d8a'; // test.newuser@g.cjc.edu.ph
const BSCE_EMAIL = 'bsce.test@g.cjc.edu.ph';
const BSCE_NAME = 'Maria Santos (Test)';

(async () => {
  // ---- Does migration 033 exist? (component outcome columns) ----
  let has033 = true;
  {
    const { error } = await admin.from('student_units').select('lec_status').limit(1);
    has033 = !error;
    console.log('migration 033 columns: ' + (has033 ? 'present' : 'MISSING (component seed skipped)'));
  }

  // ---- Load subjects per program ----
  const { data: bscoe } = await admin.from('subjects').select('id, code, title, units, lec_units, lab_units, program, year_level, semester')
    .eq('program', 'BSCoE').order('year_level').order('semester').order('code');
  const { data: bsce } = await admin.from('subjects').select('id, code, title, units, lec_units, lab_units, program, year_level, semester')
    .eq('program', 'BSCE').order('year_level').order('semester').order('code');
  if (!bscoe?.length || !bsce?.length) { console.log('subjects missing?'); return; }
  const pick = (list, yr, sem, n) => list.filter(s => String(s.year_level) === String(yr) && String(s.semester) === String(sem)).slice(0, n);

  // =============================================
  // 1. Alex Rivera: 3 terms of history (passed / failed / component split)
  // =============================================
  const rows = [];
  const yr1s1 = pick(bscoe, 1, 1, 6);
  yr1s1.forEach((s, i) => rows.push({
    student_id: ALEX_ID, subject_id: s.id, school_year: '2024-2025', semester: 1,
    status: i === 3 ? 'failed' : 'passed', grade: i === 3 ? 4.00 : [1.50, 1.75, 2.25, null, 2.00, 1.75][i],
  }));
  for (const s of pick(bscoe, 1, 2, 5)) rows.push({
    student_id: ALEX_ID, subject_id: s.id, school_year: '2024-2025', semester: 2, status: 'passed', grade: 2.00,
  });
  const yr2s1 = pick(bscoe, 2, 1, 5);
  const labSubject = yr2s1.find(s => (s.lab_units || 0) > 0);
  yr2s1.forEach((s, i) => {
    if (has033 && labSubject && s.id === labSubject.id) {
      // Phase A addendum: passed lecture, failed laboratory
      rows.push({
        student_id: ALEX_ID, subject_id: s.id, school_year: '2025-2026', semester: 1,
        status: 'failed', grade: 3.50,
        lec_status: 'passed', lec_grade: 1.75,
        lab_status: 'failed', lab_grade: 4.00,
      });
    } else {
      rows.push({
        student_id: ALEX_ID, subject_id: s.id, school_year: '2025-2026', semester: 1,
        status: 'passed', grade: [1.25, 1.50, 2.75, 2.00, 1.75][i % 5],
      });
    }
  });
  for (const r of rows) {
    const { error } = await admin.from('student_units')
      .upsert(r, { onConflict: 'student_id,subject_id,school_year,semester' });
    if (error) console.log('  history FAIL ' + (r.lec_status ? '(component row) ' : '') + error.message);
  }
  const failedRow = rows.find(r => r.status === 'failed');
  console.log('history seeded: ' + rows.length + ' records '
    + '(1 failed retake, 1 component lec-pass/lab-fail' + (has033 ? '' : ' - SKIPPED, 033 missing') + ')');

  // =============================================
  // 2. BSCE student with a submitted load (dean stats + program-scoping test)
  // =============================================
  let bsceUser = null;
  {
    let page = 1;
    for (let p = 1; p <= 5 && !bsceUser; p++) {
      const { data } = await admin.auth.admin.listUsers({ perPage: 200, page: p });
      bsceUser = (data?.users || []).find(u => (u.email || '').toLowerCase() === BSCE_EMAIL);
      if (!data?.users || data.users.length < 200) break;
    }
    if (!bsceUser) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email: BSCE_EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { full_name: BSCE_NAME },
      });
      if (error) { console.log('BSCE user FAIL: ' + error.message); return; }
      bsceUser = created.user;
      console.log('BSCE user created: ' + BSCE_EMAIL);
    } else {
      await admin.auth.admin.updateUserById(bsceUser.id, { password: PASSWORD });
      console.log('BSCE user exists (password reset): ' + BSCE_EMAIL);
    }
    const { data: prof } = await admin.from('profiles').select('id').eq('id', bsceUser.id).maybeSingle();
    if (!prof) {
      const { error } = await admin.from('profiles').insert({
        id: bsceUser.id, email: BSCE_EMAIL, full_name: BSCE_NAME, role: 'student', course: 'BSCE', year_level: '3', enrollment_year: 2023,
      });
      if (error) console.log('  BSCE profile FAIL: ' + error.message);
    } else {
      await admin.from('profiles').update({ role: 'student', course: 'BSCE', year_level: '3' }).eq('id', bsceUser.id);
    }
  }

  // Submitted load for the BSCE student
  {
    const { data: existing } = await admin.from('enrollment_submissions')
      .select('id').eq('student_id', bsceUser.id).eq('school_year', '2026-2027').eq('semester', 1).maybeSingle();
    let subId = existing?.id;
    if (!subId) {
      const { data: sub, error } = await admin.from('enrollment_submissions')
        .insert({ student_id: bsceUser.id, school_year: '2026-2027', semester: 1, status: 'submitted', submitted_at: new Date().toISOString() })
        .select('id').single();
      if (error) { console.log('  BSCE submission FAIL: ' + error.message); return; }
      subId = sub.id;
    }
    const items = pick(bsce, 3, 1, 5).map((s, i) => ({
      submission_id: subId, subject_id: s.id,
      origin: i % 2 === 0 ? 'grizz' : 'manual',
      grizz_reason: i % 2 === 0 ? 'Recommended: prerequisites satisfied, curriculum-aligned for Yr 3 Sem 1' : null,
    }));
    for (const it of items) {
      const { error } = await admin.from('enrollment_submission_items')
        .upsert(it, { onConflict: 'submission_id,subject_id' });
      if (error && error.code !== '23505') console.log('  item FAIL: ' + error.message);
    }
    console.log('BSCE submitted load: ' + items.length + ' subjects (mix of grizz/manual origin)');
  }

  console.log('\n=== SEED COMPLETE ===');
  console.log('Alex Rivera history: Yr1 passes + 1 failed subject (retake test) + 1 lec-pass/lab-fail');
  console.log('Maria Santos (BSCE): submitted 2026-2027 Sem 1 load awaiting HER program head (BSCE)');
  console.log('Logins: test.newuser / head.test / bsce.test @g.cjc.edu.ph - password: ' + PASSWORD);
})();
