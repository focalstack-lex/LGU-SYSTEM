// =============================================
// scripts/recalculate-enrollment-years.js
// Recalculates profiles.enrollment_year & enrollment_verification_requests.enrollment_year
// based on year_level for SY 2026-2027 (baseline 2026).
// =============================================
require('dotenv').config();
const supabase = require('../server/lib/supabase');

function calcYear(yearLevel) {
  if (!yearLevel) return 2026;
  const str = String(yearLevel);
  const match = str.match(/\d+/);
  const num = match ? parseInt(match[0], 10) : 1;
  const yearNum = (num >= 1 && num <= 6) ? num : 1;
  return 2026 - (yearNum - 1);
}

async function run() {
  console.log('🔄 Starting enrollment year recalculation...');

  // 1. Update Profiles
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, year_level, enrollment_year');

  if (pErr) {
    console.error('❌ Failed to fetch profiles:', pErr.message);
  } else if (profiles && profiles.length > 0) {
    let updatedCount = 0;
    for (const p of profiles) {
      const correctYear = calcYear(p.year_level);
      if (p.enrollment_year !== correctYear) {
        const { error: upErr } = await supabase
          .from('profiles')
          .update({ enrollment_year: correctYear })
          .eq('id', p.id);

        if (upErr) {
          console.error(`❌ Failed to update profile ${p.id}:`, upErr.message);
        } else {
          updatedCount++;
          console.log(`  [Profile ${p.id}] Updated year_level "${p.year_level}" -> enrollment_year ${correctYear} (was ${p.enrollment_year})`);
        }
      }
    }
    console.log(`✅ Profiles update finished: ${updatedCount} rows recalculated.`);
  } else {
    console.log('ℹ️ No profiles found to update.');
  }

  // 2. Update Enrollment Verification Requests
  const { data: requests, error: rErr } = await supabase
    .from('enrollment_verification_requests')
    .select('id, year_level, enrollment_year');

  if (rErr) {
    console.warn('⚠️ Could not fetch verification requests (table might not exist yet):', rErr.message);
  } else if (requests && requests.length > 0) {
    let updatedReqCount = 0;
    for (const req of requests) {
      const correctYear = calcYear(req.year_level);
      if (req.enrollment_year !== correctYear) {
        const { error: upErr } = await supabase
          .from('enrollment_verification_requests')
          .update({ enrollment_year: correctYear })
          .eq('id', req.id);

        if (upErr) {
          console.error(`❌ Failed to update request ${req.id}:`, upErr.message);
        } else {
          updatedReqCount++;
          console.log(`  [Request ${req.id}] Updated year_level "${req.year_level}" -> enrollment_year ${correctYear}`);
        }
      }
    }
    console.log(`✅ Verification requests update finished: ${updatedReqCount} rows recalculated.`);
  }

  console.log('🎉 Enrollment year recalculation complete!');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
