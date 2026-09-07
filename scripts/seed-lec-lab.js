// Seeds subjects.lec_units / lab_units from lec-lab-seed.json.
// Every subject gets values: mapped codes use the map, all others default
// to lec = units, lab = 0. Idempotent - safe to re-run.
// Run: node scripts/seed-lec-lab.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('❌ Supabase credentials missing (SUPABASE_URL, SUPABASE_SERVICE_KEY)');
  process.exit(1);
}
const supabase = createClient(url, key);

const seedMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'lec-lab-seed.json'), 'utf8'));

function lookup(code, program) {
  const perProgram = seedMap.programs?.[program]?.[code];
  if (perProgram) return perProgram;
  return seedMap.global?.[code] || null;
}

async function run() {
  const { data: subjects, error } = await supabase.from('subjects').select('id, code, program, units');
  if (error) { console.error('❌ Failed to load subjects:', error.message); process.exit(1); }

  let mapped = 0, defaulted = 0, failed = 0;
  for (const s of subjects) {
    const split = lookup(s.code, s.program);
    const lec = split ? Number(split[0]) : Number(s.units);
    const lab = split ? Number(split[1]) : 0;
    if (lec + lab !== Number(s.units)) {
      console.error(`❌ [${s.program}] ${s.code}: seed ${lec}+${lab} != units ${s.units} - SKIPPED`);
      failed++;
      continue;
    }
    const { error: upErr } = await supabase
      .from('subjects')
      .update({ lec_units: lec, lab_units: lab })
      .eq('id', s.id);
    if (upErr) { console.error(`❌ [${s.program}] ${s.code}: ${upErr.message}`); failed++; continue; }
    split ? mapped++ : defaulted++;
  }

  console.log(`\n=== LEC/LAB SEED SUMMARY ===`);
  console.log(`subjects: ${subjects.length} | from map: ${mapped} | defaulted (lec=units, lab=0): ${defaulted} | failed/skipped: ${failed}`);

  // Only safe to validate once failed === 0.
  if (failed === 0) {
    console.log(`\nNEXT STEP - run in the Supabase SQL editor:`);
    console.log(`  ALTER TABLE public.subjects VALIDATE CONSTRAINT subjects_units_components_check;`);
  } else {
    console.log('\n⚠️  Fix the failed rows above and re-run before validating the constraint.');
    process.exit(1);
  }
}

run();
