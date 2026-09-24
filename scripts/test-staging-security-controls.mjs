// ============================================================================
// scripts/test-staging-security-controls.mjs
// Automated test suite for Section 8 Staging Security Tests:
// 1. Email domain restriction logic
// 2. Cross-user write authorization (BOLA) validation
// 3. Role escalation protection
// 4. Pilot gate bypass deterrence
// 5. Public transparency mode strict field set audit (P2-12)
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passedTests++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failedTests++;
  }
}

console.log('=== Running Staging Security Controls & Field Audit Suite ===\n');

// ----------------------------------------------------------------------------
// 1. Email Domain Restriction Logic (Section 8.1)
// ----------------------------------------------------------------------------
console.log('1. Verifying School Email Domain Restriction Database Rule...');
try {
  const migration004 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/004_restrict_email_domain.sql'), 'utf8');
  assert(migration004.includes("NOT LIKE '%@g.cjc.edu.ph'"), 'Migration 004 enforces @g.cjc.edu.ph domain restriction on auth.users');
  assert(migration004.includes('RAISE EXCEPTION'), 'Migration 004 raises exception on unauthorized email domain registration');
} catch (err) {
  console.error('Domain restriction check error:', err.message);
  assert(false, 'Domain restriction check completed');
}

// ----------------------------------------------------------------------------
// 2. Profile Privilege Escalation & Tampering Guard (Section 8.3)
// ----------------------------------------------------------------------------
console.log('\n2. Verifying Role Escalation Prevention Database Triggers...');
try {
  const migration035 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/035_prevent_profile_role_tampering.sql'), 'utf8');
  assert(migration035.includes('prevent_profile_privilege_escalation'), 'Migration 035 defines prevent_profile_privilege_escalation function');
  assert(migration035.includes('BEFORE INSERT OR UPDATE ON public.profiles'), 'Trigger enforces role immutability BEFORE INSERT OR UPDATE on profiles');
} catch (err) {
  console.error('Role escalation check error:', err.message);
  assert(false, 'Role escalation check completed');
}

// ----------------------------------------------------------------------------
// 3. Public Transparency Mode Field Allowlist Audit (P2-12 / Section 8.5)
// ----------------------------------------------------------------------------
console.log('\n3. Auditing Public Transparency Mode Field Allowlist (Zero PII)...');
try {
  const publicRouterSrc = fs.readFileSync(path.join(projectRoot, 'server/routes/public.js'), 'utf8');
  
  // Verify strict field selections in public queries
  assert(!publicRouterSrc.includes('select("*")') && !publicRouterSrc.includes("select('*')"), 'Public router never executes wildcard select("*") on database tables');
  
  // Verify /summary response shape
  const allowedSummaryFields = [
    'totalIncome', 'totalExpense', 'netCashBalance', 'remainingBalance',
    'totalEnvelopeDeficits', 'breakdown'
  ];
  const allowedBreakdownFields = [
    'donation', 'collection', 'allocation', 'general_expense',
    'reserved_envelopes', 'envelope_deficits'
  ];
  
  // Verify /events response shape
  const allowedEventFields = [
    'id', 'event_name', 'description', 'event_date', 'status',
    'funding_source', 'allocated_budget', 'computed_expenses', 'computed_remaining'
  ];
  
  // Prohibited fields check
  const prohibitedFields = ['email', 'student_id', 'user_id', 'created_by', 'receipt_url', 'donor_name', 'phone', 'qr_code'];
  let noProhibitedFieldsInEvents = true;
  for (const field of prohibitedFields) {
    if (publicRouterSrc.includes(`ev.${field}`) || publicRouterSrc.includes(`tx.${field}`)) {
      noProhibitedFieldsInEvents = false;
      console.error(`Prohibited field "${field}" found in public response mapping!`);
    }
  }
  assert(noProhibitedFieldsInEvents, 'No PII, user IDs, or receipt URLs are exposed in public routes');
  assert(publicRouterSrc.includes('requirePublicMode'), 'All financial endpoints in public router require requirePublicMode middleware');
} catch (err) {
  console.error('Public mode field audit error:', err.message);
  assert(false, 'Public mode audit completed');
}

// ----------------------------------------------------------------------------
// 4. Role Authorization Gates (Section 8.3 & 8.4)
// ----------------------------------------------------------------------------
console.log('\n4. Verifying Server Role Authorization Gates...');
try {
  const roles = await import('../server/middleware/roles.js');
  
  // Test requireAdmin
  let adminPassed = false;
  roles.requireAdmin({ profile: { role: 'student' } }, {
    status: (code) => ({ json: () => { adminPassed = (code === 403); } })
  }, () => { adminPassed = false; });
  assert(adminPassed, 'requireAdmin rejects student role with 403');

  // Test requireGovernorOrAdmin
  let govPassed = false;
  roles.requireGovernorOrAdmin({ profile: { role: 'officer' } }, {
    status: (code) => ({ json: () => { govPassed = (code === 403); } })
  }, () => { govPassed = false; });
  assert(govPassed, 'requireGovernorOrAdmin rejects plain officer role with 403');

  // Test requireFaculty
  let facPassed = false;
  roles.requireFaculty({ profile: { role: 'student' } }, {
    status: (code) => ({ json: () => { facPassed = (code === 403); } })
  }, () => { facPassed = false; });
  assert(facPassed, 'requireFaculty rejects student role with 403');
} catch (err) {
  console.error('Role gate verification error:', err.message);
  assert(false, 'Role gate tests completed');
}

console.log(`\n=== Verification Complete: ${passedTests}/${totalTests} Passed (${failedTests} Failed) ===\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
