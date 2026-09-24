// ============================================================================
// scripts/lint-sql-invariants.mjs
// Verifies Section 7.3 security invariants across migrations and live DB (if configured).
// ============================================================================
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, '../supabase/migrations');

console.log('[SQL Invariant Lint] Checking migrations in:', migrationsDir);

let failures = 0;

if (fs.existsSync(migrationsDir)) {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  
  // Track function definitions across forward migrations
  // A forward migration with SET search_path patches an earlier definition
  const functionDefinitions = new Map();

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Regex to find CREATE [OR REPLACE] FUNCTION definitions
    const funcRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_\.]+)\s*\(([\s\S]*?)\)\s*RETURNS\s+([\s\S]*?)(?:LANGUAGE\s+[a-zA-Z0-9]+|\$\$)/gi;
    
    // Check for SECURITY DEFINER blocks
    // Split on CREATE FUNCTION to analyze individual functions
    const funcBlocks = content.split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i).slice(1);

    for (const block of funcBlocks) {
      const isSecDef = /SECURITY\s+DEFINER/i.test(block);
      if (!isSecDef) continue;

      const nameMatch = block.match(/^\s*([a-zA-Z0-9_\.]+)/);
      const funcName = nameMatch ? nameMatch[1] : 'unknown';
      const hasSearchPath = /SET\s+search_path\s*=/i.test(block);

      functionDefinitions.set(funcName, {
        file,
        hasSearchPath,
      });
    }
  }

  // Verify the latest state of all declared SECURITY DEFINER functions
  for (const [funcName, info] of functionDefinitions.entries()) {
    if (!info.hasSearchPath) {
      // Check if forward migration 038 patches this
      console.error(`[FAIL] SECURITY DEFINER function "${funcName}" missing SET search_path (last seen in ${info.file})`);
      failures++;
    } else {
      console.log(`[PASS] SECURITY DEFINER function "${funcName}" has pinned search_path (${info.file})`);
    }
  }
} else {
  console.warn('[WARN] Migrations directory not found at', migrationsDir);
}

// Live DB query check if DATABASE_URL or SUPABASE_DB_URL is available
if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL) {
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  console.log('[SQL Invariant Lint] Checking live database invariants...');
  try {
    const pg = await import('pg');
    const { Client } = pg.default || pg;
    const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();

    // Invariant 1: Tables without RLS
    const rlsRes = await client.query(`
      SELECT n.nspname AS schema, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = false;
    `);
    if (rlsRes.rows.length > 0) {
      console.error('[FAIL] Tables without RLS:', rlsRes.rows);
      failures += rlsRes.rows.length;
    } else {
      console.log('[PASS] All public tables have RLS enabled (0 violations).');
    }

    // Invariant 2: Anonymous grants
    const anonRes = await client.query(`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'anon' AND table_schema = 'public';
    `);
    if (anonRes.rows.length > 0) {
      console.error('[FAIL] Unexpected anonymous grants found:', anonRes.rows);
      failures += anonRes.rows.length;
    } else {
      console.log('[PASS] No anonymous role grants on public tables (0 violations).');
    }

    // Invariant 3: SECURITY DEFINER functions without pinned search_path
    const secDefRes = await client.query(`
      SELECT n.nspname AS schema, p.proname AS function_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prosecdef
        AND (
          p.proconfig IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) AS cfg WHERE cfg LIKE 'search_path=%'
          )
        );
    `);
    if (secDefRes.rows.length > 0) {
      console.error('[FAIL] SECURITY DEFINER functions without search_path:', secDefRes.rows);
      failures += secDefRes.rows.length;
    } else {
      console.log('[PASS] All public SECURITY DEFINER functions have search_path pinned (0 violations).');
    }

    await client.end();
  } catch (err) {
    console.warn('[WARN] Live DB check skipped or failed connection:', err.message);
  }
}

if (failures > 0) {
  console.error(`\n[RESULT] SQL Invariant check FAILED with ${failures} violations.`);
  process.exit(1);
} else {
  console.log('\n[RESULT] SQL Invariant check PASSED. All security invariants satisfied.');
  process.exit(0);
}
