// Dry-run report for migration 031's legacy prereq parser.
// Prints every token mapping and highlights 'special' rows that need
// manual fix-up in the Curriculum Manager. Read-only.
// Run: node scripts/preview-prereq-parse.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('❌ Supabase credentials missing (SUPABASE_URL, SUPABASE_SERVICE_KEY)');
  process.exit(1);
}
const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase.rpc('preview_prereq_parse');
  if (error) {
    console.error('❌ preview_prereq_parse failed (is migration 031 applied?):', error.message);
    process.exit(1);
  }

  const kinds = { prerequisite: 0, corequisite: 0, year_standing: 0, special: 0 };
  for (const row of data) kinds[row.kind] = (kinds[row.kind] || 0) + 1;

  console.log(`\n=== PREREQ PARSE REPORT: ${data.length} tokens across all subjects ===`);
  console.log(`prerequisite: ${kinds.prerequisite} | corequisite: ${kinds.corequisite} | year_standing: ${kinds.year_standing} | special (flagged): ${kinds.special}\n`);

  const flagged = data.filter(r => r.kind === 'special');
  if (flagged.length) {
    console.log('⚠️  Tokens needing manual fix-up (landed as "special"):');
    for (const r of flagged) console.log(`   [${r.program}] ${r.subject_code}: "${r.raw_token}"`);
    console.log('');
  }

  console.log('Full mapping:');
  for (const r of data) {
    const resolved = r.depends_on_code ? ` -> ${r.depends_on_code}` : (r.detail ? ` -> "${r.detail}"` : '');
    console.log(`   [${r.program}] ${r.subject_code}: "${r.raw_token}" (${r.kind})${resolved}`);
  }
}

run();
