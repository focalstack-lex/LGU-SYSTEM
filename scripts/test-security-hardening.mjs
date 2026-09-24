// ============================================================================
// scripts/test-security-hardening.mjs
// Automated verification suite for SECURITY_HARDENING.md controls
// ============================================================================
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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

console.log('=== Running Security Hardening Verification Suite ===\n');

// ----------------------------------------------------------------------------
// Test 1: Repository Secrets & Git Hygiene (Section 7.4)
// ----------------------------------------------------------------------------
console.log('1. Verifying Repository Hygiene and Secret Isolation...');
try {
  let envTracked = false;
  try {
    execSync('git ls-files --error-unmatch .env', { cwd: projectRoot, stdio: 'pipe' });
    envTracked = true;
  } catch {
    envTracked = false;
  }
  assert(!envTracked, '.env file is NOT tracked by Git');

  // Verify client and electron do not contain service keys or Brevo keys
  const clientFiles = fs.readdirSync(path.join(projectRoot, 'client/js')).map(f => path.join(projectRoot, 'client/js', f));
  let exposedSecretsFound = false;

  for (const file of clientFiles) {
    if (fs.statSync(file).isFile()) {
      const content = fs.readFileSync(file, 'utf8');
      if (/SUPABASE_SERVICE_KEY|BREVO_API_KEY|xkeysib/i.test(content)) {
        exposedSecretsFound = true;
      }
    }
  }
  assert(!exposedSecretsFound, 'No server secrets or service keys present in client assets');
} catch (err) {
  console.error('Error during hygiene check:', err.message);
  assert(false, 'Hygiene check completed without error');
}

// ----------------------------------------------------------------------------
// Test 2: Hardcoded Student Identifiers and Pilot Gate (P1-3)
// ----------------------------------------------------------------------------
console.log('\n2. Verifying Student Privacy and Pilot Gate Fail-Closed Behavior...');
try {
  const configJs = fs.readFileSync(path.join(projectRoot, 'client/js/config.js'), 'utf8');
  assert(!configJs.includes('ENROLLMENT_PILOT_EMAILS = ['), 'client/js/config.js does not expose hardcoded pilot student email list');

  const rolesJs = fs.readFileSync(path.join(projectRoot, 'server/middleware/roles.js'), 'utf8');
  assert(!rolesJs.includes('PILOT_DEFAULT'), 'server/middleware/roles.js does not include hardcoded PILOT_DEFAULT fallback');

  // Import pilotGate logic to test fail-closed behavior
  const { pilotGate } = await import('../server/middleware/roles.js');
  
  // Test when env is unset
  const oldEnv = process.env.ENROLLMENT_PILOT_EMAILS;
  delete process.env.ENROLLMENT_PILOT_EMAILS;
  let statusUnset = null;
  pilotGate({ user: { email: 'test@g.cjc.edu.ph' } }, {
    status: (s) => ({ json: () => { statusUnset = s; } })
  }, () => { statusUnset = 200; });
  assert(statusUnset === 403, 'pilotGate fails closed (403) when ENROLLMENT_PILOT_EMAILS is unset');

  // Test when env is set with allowlist
  process.env.ENROLLMENT_PILOT_EMAILS = 'allowed@g.cjc.edu.ph, pilot.student@g.cjc.edu.ph';
  let statusAllowed = null;
  pilotGate({ user: { email: 'allowed@g.cjc.edu.ph' } }, {
    status: (s) => ({ json: () => { statusAllowed = s; } })
  }, () => { statusAllowed = 200; });
  assert(statusAllowed === 200, 'pilotGate allows authorized user in ENROLLMENT_PILOT_EMAILS');

  let statusDenied = null;
  pilotGate({ user: { email: 'stranger@g.cjc.edu.ph' } }, {
    status: (s) => ({ json: () => { statusDenied = s; } })
  }, () => { statusDenied = 200; });
  assert(statusDenied === 403, 'pilotGate denies unauthorized user not in ENROLLMENT_PILOT_EMAILS');

  // Restore env
  if (oldEnv) process.env.ENROLLMENT_PILOT_EMAILS = oldEnv;
  else delete process.env.ENROLLMENT_PILOT_EMAILS;
} catch (err) {
  console.error('Error during pilot gate verification:', err.message);
  assert(false, 'Pilot gate test completed without error');
}

// ----------------------------------------------------------------------------
// Test 3: CSP and Header Directives (P0-2)
// ----------------------------------------------------------------------------
console.log('\n3. Verifying CSP and Server Security Directives...');
try {
  const serverIndex = fs.readFileSync(path.join(projectRoot, 'server/index.js'), 'utf8');
  assert(!serverIndex.includes("'unsafe-inline'") || !serverIndex.includes("scriptSrc:    [\"'self'\", \"'unsafe-inline'\""), "CSP scriptSrc does not permit 'unsafe-inline'");
  assert(serverIndex.includes("scriptSrcAttr: [\"'none'\"]"), "CSP explicitly sets scriptSrcAttr: [\"'none'\"]");
  assert(!serverIndex.includes('api.qrserver.com'), 'CSP does not allow external QR server endpoint');
} catch (err) {
  console.error('Error during CSP verification:', err.message);
  assert(false, 'CSP check completed without error');
}

// ----------------------------------------------------------------------------
// Test 4: Storage Bucket Security Configuration (P1-6)
// ----------------------------------------------------------------------------
console.log('\n4. Verifying Receipts Storage Bucket Private Configuration...');
try {
  const migration15 = fs.readFileSync(path.join(projectRoot, 'supabase/migrations/015_receipts_bucket.sql'), 'utf8');
  assert(/public\s*=\s*false/i.test(migration15), 'Receipts bucket configured as private (public: false)');
} catch (err) {
  console.error('Error during storage bucket verification:', err.message);
  assert(false, 'Storage bucket check completed without error');
}

// ----------------------------------------------------------------------------
// Test 5: Forward Migrations for Function Search Path and Anon Grants (P0-1, P1-4)
// ----------------------------------------------------------------------------
console.log('\n5. Verifying Forward Migrations for Search Path and Revoked Anon Grants...');
try {
  const migration38Path = path.join(projectRoot, 'supabase/migrations/038_pin_function_search_path.sql');
  assert(fs.existsSync(migration38Path), 'Migration 038_pin_function_search_path.sql exists');
  const m38Content = fs.readFileSync(migration38Path, 'utf8');
  assert(m38Content.includes('SET search_path = pg_catalog, public, auth, pg_temp;'), 'Migration 038 pins search_path across all functions');

  const migration39Path = path.join(projectRoot, 'supabase/migrations/039_revoke_anon_grants.sql');
  assert(fs.existsSync(migration39Path), 'Migration 039_revoke_anon_grants.sql exists');
  const m39Content = fs.readFileSync(migration39Path, 'utf8');
  assert(m39Content.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;'), 'Migration 039 revokes all public table grants from anon');
} catch (err) {
  console.error('Error during migration file verification:', err.message);
  assert(false, 'Migration verification completed without error');
}

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
console.log(`\n=== Verification Complete: ${passedTests}/${totalTests} Passed (${failedTests} Failed) ===\n`);

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
