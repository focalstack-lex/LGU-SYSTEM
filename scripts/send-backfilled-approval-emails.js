// =============================================
// scripts/send-backfilled-approval-emails.js
// Sends Gmail verification/approval notifications in COE Orange theme
// to all verified student accounts and approved roster requests.
// =============================================
require('dotenv').config();
const supabase = require('../server/lib/supabase');
const { sendAccountApprovalEmail } = require('../server/lib/email');

async function run() {
  console.log('🚀 Starting backfill email verification dispatch...');

  // 1. Fetch verified student profiles
  const { data: verifiedProfiles, error: pErr } = await supabase
    .from('profiles')
    .select('email, full_name, role, is_verified')
    .neq('role', 'admin')
    .or('email.ilike.%@gmail.com,email.ilike.%@g.cjc.edu.ph');

  if (pErr) {
    console.error('❌ Error fetching profiles:', pErr.message);
  }

  // 2. Fetch approved verification requests
  const { data: approvedRequests, error: rErr } = await supabase
    .from('enrollment_verification_requests')
    .select('email, full_name, status')
    .eq('status', 'approved')
    .or('email.ilike.%@gmail.com,email.ilike.%@g.cjc.edu.ph');

  if (rErr) {
    console.warn('⚠️ Could not fetch verification requests:', rErr.message);
  }

  // Combine into a map to deduplicate by email
  const recipientsMap = new Map();

  (verifiedProfiles || []).forEach(p => {
    if (p.email && (p.is_verified === true || p.is_verified === undefined)) {
      recipientsMap.set(p.email.trim().toLowerCase(), {
        email: p.email.trim(),
        name: p.full_name || 'COE Member'
      });
    }
  });

  (approvedRequests || []).forEach(r => {
    if (r.email) {
      const em = r.email.trim().toLowerCase();
      if (!recipientsMap.has(em)) {
        recipientsMap.set(em, {
          email: r.email.trim(),
          name: r.full_name || 'COE Member'
        });
      }
    }
  });

  const recipients = Array.from(recipientsMap.values());
  console.log(`📋 Found ${recipients.length} target verified student accounts.`);

  if (recipients.length === 0) {
    console.log('ℹ️ No eligible accounts found to send verification emails to.');
    process.exit(0);
  }

  let successCount = 0;
  let failCount = 0;

  for (const item of recipients) {
    console.log(`✉️ Sending verification email to ${item.name} (${item.email})...`);
    const res = await sendAccountApprovalEmail(item.email, item.name);
    if (res && res.sent > 0) {
      successCount++;
      console.log(`  ✅ Successfully sent to ${item.email} (MessageID: ${res.messageId || 'OK'})`);
    } else {
      failCount++;
      console.warn(`  ⚠️ Failed to send to ${item.email}: ${res?.reason || res?.error || 'Unknown error'}`);
    }
  }

  console.log('\n=============================================');
  console.log(`🎉 Backfill verification email dispatch completed!`);
  console.log(`Total Target: ${recipients.length}`);
  console.log(`Successfully Sent: ${successCount}`);
  console.log(`Failed/Skipped: ${failCount}`);
  console.log('=============================================\n');

  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error in backfill email script:', err);
  process.exit(1);
});
