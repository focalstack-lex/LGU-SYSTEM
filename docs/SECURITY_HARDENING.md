# Security Hardening: Agent Instruction

**Target system:** COE Budget Transparency and Financial Monitoring System ("LGU System", deployed as `coelgu-system.engineer`)
**Document type:** executable instruction for an autonomous or semi-autonomous coding agent
**Written:** 2026-09-24
**Baseline commit:** `d4aa379`
**Repo root:** `C:\Users\User\Documents\LGU System`

---

## 0. How to use this document

This is not a checklist to skim. It is a work order. Execute it top to bottom, in priority order, one finding at a time. Every finding has four fields you must satisfy before you move on: **Evidence** (where the problem is), **Change** (what to do), **Acceptance** (how anyone can tell it is done), and **Verify** (the command or query that proves it). Do not mark a finding complete without pasting real command output into your report.

If a finding turns out to be already fixed or factually wrong, do not silently skip it. Record it in the report as "not reproducible, here is what I observed instead" with the command you ran. A false positive reported honestly is worth more than a silent omission.

---

## 1. Mission and scope

Harden the LGU System against realistic attack, without breaking working behavior, without changing the application's architecture or navigation, and without regressing any control that already works.

**In scope:** authentication and session handling, authorization and role enforcement, database row level security and grants, SQL function safety, input validation, transport and browser security policy, secrets management, dependency risk, third party integrations, the Electron desktop client, and continuous verification in CI.

**Out of scope unless separately authorized:** changing the product's features, redesigning the UI, replacing the stack, migrating away from Supabase, or rewriting the client. This is a hardening pass, not a rewrite.

**Deployment topology (verified):**

| Layer | Host | Notes |
|---|---|---|
| Client | Vercel | `www.coelgu-system.engineer`, static vanilla JS from `/client` |
| API | Render | `api.coelgu-system.engineer`, Express from `/server`, behind Cloudflare |
| Data | Supabase | project `hchkfunaofyoualrdnkk`, PostgreSQL |
| Email | Brevo | server side only, via `sib-api-v3-sdk` |
| Desktop | Electron | admin client in `/electron`, packaged as an MSI-style setup exe |

---

## 2. Operating rules (non-negotiable)

1. **Read before you write.** Cite `file:line` for every claim. Never edit a file you have not read in full.
2. **Change only what is necessary.** Preserve the existing structure, file layout, naming, and comments. Do not reorganize directories to make a fix tidier.
3. **Never weaken a control to make a test pass.** If a test fails because a control is working, fix the test, not the control.
4. **Never print a secret.** Not into chat, not into logs, not into a commit message, not into your report. Refer to secrets by name only. If you find one exposed, treat it as a leak that requires rotation, and report it without echoing the value.
5. **Verify with real output.** A change is done only when the build, the tests, and the specific verification command for that finding all pass. Paste the actual output.
6. **Work against staging, not production.** Any test that writes data, creates an account, or mutates a row runs against a staging Supabase project. Read only probes may run against production.
7. **Journal every change.** One line per change in `journal/YYYY-MM-DD.md`, format `- [HH:MM] what changed + how it was verified.`
8. **Do not rotate a live secret without coordinating.** Rotating `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, or `BREVO_API_KEY` invalidates live sessions or breaks email. Flag it, propose it, and wait for a human decision.
9. **Prefer fail-closed.** On ambiguity, deny. A control that fails open is worse than no control, because it looks safe.
10. **One finding per change set.** Do not bundle unrelated hardening into one commit. Small, reviewable, revertable.

---

## 3. System map (ground truth)

Verified file locations. Use these paths exactly.

```
server/index.js                    Express app: helmet, CORS, rate limits, route mounting
server/middleware/auth.js           Supabase JWT verification, profile lookup, forensic logging
server/middleware/roles.js          Role sets and role gates, enrollment pilot allowlist
server/lib/supabase.js              Service-role Supabase client (server only)
server/lib/validate.js              sanitizeText, validateDriveUrl (SSRF allowlist), number checks
server/lib/email.js                 Brevo sending
server/lib/logger.js                logError
server/routes/*.js                  admin, announcements, curriculum, cv, enrollment, events,
                                    faculty, feedback, notifications, public, reports,
                                    transactions, units
client/js/config.js                 Supabase URL, anon key, API base, pilot allowlist
supabase/migrations/001..037        Schema, RLS, triggers, functions
.github/workflows/smoke.yml         Smoke tests
.github/workflows/backup.yml        Backups
```

Key server mount points in `server/index.js`:

- `:29` `app.set('trust proxy', 1)`
- `:34-35` helmet with a content security policy
- `:90-99` CORS origin callback, `credentials: false`
- `:105-106` JSON and urlencoded body limits at 50kb
- `:112`, `:125`, `:140` global, sensitive, and write rate limiters
- `:150` `onlyWrites(limiter)` helper
- `:174` `/api/health`, exempt from the global limiter
- `:177-178` `/api/public` and `/api/feedback` mounted with no auth
- `:183-192` authenticated routers, each wrapped in `authMiddleware`
- `:196` `/api/cv` mounted without the global `authMiddleware` (the router applies it per route)

---

## 4. Baseline: controls that are already correct

These were verified working. **Do not "fix" them, and do not regress them.** If a change of yours makes one of these worse, that is a regression and it must be reverted.

- **Secrets are not in git.** Verified: `git ls-files --error-unmatch .env` returns "did not match any file(s) known to git", and `git log --all -- .env` is empty. `.gitignore` ignores `.env` and `.env.*` while keeping `!.env.example`. Keep it this way and add CI secret scanning (Section 6).
- **Service key is server only.** `server/lib/supabase.js` reads `SUPABASE_SERVICE_KEY` from the environment and exits if absent. No service key exists in `client/` or `electron/` (verified by grep). The key shipped to browsers is a legitimate anon key: its decoded JWT payload is `{"role":"anon"}`.
- **Row level security is on.** Verified live: with the anon key, `profiles`, `transactions`, `events`, `subjects`, `student_cvs`, `notifications`, `enrollment_submissions`, and `audit_logs` all return `401` with `42501 permission denied`.
- **The PostgREST root refuses non service keys**, so the schema is not published.
- **Authorized routes require a token.** Thirteen of nineteen probed routes return `401` without credentials.
- **Bearer-token auth with `credentials: false` CORS is a deliberate, correct decision.** The comment at `server/index.js:74-75` explains it. Do not switch to cookies to "fix" anything unless you also add CSRF protection, which would be a regression in work for no gain.
- **SSRF protection exists.** `server/lib/validate.js` `validateDriveUrl` allowlists Google Drive and Docs hosts, requires https, and rejects anything else. Preserve the allowlist approach.
- **Rate limiting exists** in three tiers, with a documented health-check exemption.
- **A hardening migration already exists.** `supabase/migrations/030_security_hardening.sql` enables RLS on nine tables and revokes grants, and `035_prevent_profile_role_tampering.sql` addresses role tampering. Twenty-two tables have RLS enabled across the migration set.
- **`/api/public` returning 403 is correct behavior, not a bug.** It is gated behind `PUBLIC_TRANSPARENCY_MODE`, which is currently off. The router's field set is deliberately conservative (aggregates only, no donor names, no user IDs, no receipt URLs). Leave the gate in place.
- **Prior audits exist. Read them before starting.** `journal/2026-09-24.md` records a `/copyright` audit (score 9.0/10, report at `reports/copyright/`) and a `/secure` Security-First Deployment Gate run that passed 9 of 10 checks and returned **BLOCKED** on the single dependency check: `npm audit` reported 4 high and 4 moderate vulnerabilities in indirect and dev dependencies. That is the same issue as P2-8 below, so do not re-litigate it as new; treat this document's P2-8 as the instruction for closing a finding that is already open and already known to block release.

---

## 5. Findings to remediate

### P0-1: `SECURITY DEFINER` functions without a pinned `search_path`

**Evidence.** Confirmed by grep. At least four function definitions declare `SECURITY DEFINER` with no `SET search_path`:

- `supabase/migrations/001_initial_schema.sql:39` `$$ LANGUAGE plpgsql SECURITY DEFINER;`
- `supabase/migrations/001_initial_schema.sql:131` `$$ LANGUAGE plpgsql SECURITY DEFINER;`
- `supabase/migrations/016_officer_roles.sql:35` `$$ LANGUAGE sql SECURITY DEFINER;`
- `supabase/migrations/016_officer_roles.sql:43` `$$ LANGUAGE sql SECURITY DEFINER;`

`SECURITY DEFINER` is present in ten migration files total, so this is not a four-line fix. A `SECURITY DEFINER` function runs with the privileges of its owner, typically a highly privileged role. If its `search_path` is not pinned, an attacker who can create a table, function, or operator in a schema that appears earlier in the path can shadow an object the function calls, and that code then executes as the function owner. This is a genuine privilege escalation path, and it is the single most serious technical issue in this codebase.

**Change.** For every `SECURITY DEFINER` function:

1. Add an explicit path pin: `SET search_path = ''` (or a minimal explicit list such as `SET search_path = pg_catalog, pg_temp` if the function needs it).
2. Schema-qualify every object referenced inside the function body, for example `public.profiles`, `auth.uid()`, `pg_catalog.now()`.
3. Deliver this as a new forward migration, for example `038_pin_function_search_path.sql`, using `CREATE OR REPLACE FUNCTION` for each. Do not edit historical migrations that have already run in production.
4. Add the lint check from Section 7 to CI so it cannot regress.

**Acceptance.** No `SECURITY DEFINER` function in `public` has a null or unsafe `proconfig`, and every one specifies a `search_path`. Function behavior is unchanged: the role-gate tests and the smoke suite still pass.

**Verify.** Run the query in Section 7.3. It must return zero rows. Before the fix it returns the offending functions, which you should capture as your before-state.

---

### P0-2: `script-src 'unsafe-inline'` combined with tokens in `localStorage`

**Evidence.** The live API host serves a CSP containing `script-src 'self' 'unsafe-inline' ...` (from `helmet` at `server/index.js:34-35`). The client keeps the Supabase session in `localStorage` with `persistSession: true` and `autoRefreshToken: true` at `client/js/config.js:20-22`, and `client/js/config.js:4-5` holds the Supabase URL and anon key.

`localStorage` is readable by any script in the origin. `'unsafe-inline'` means the CSP will not stop an injected inline script. So a single XSS becomes full account takeover, including refreshing the token so the session survives. The CSP is otherwise strong, which makes this one directive disproportionately damaging.

**Change.**

1. Remove `'unsafe-inline'` from `script-src`. Move inline event handlers and inline script blocks to external files under `/client/js/`. If a small number of inline blocks must remain, adopt CSP nonces or hashes.
2. Add `script-src-attr 'none'` to the server CSP. The API host already benefits from this on one response; make it explicit and consistent.
3. Reduce the blast radius of a token theft: shorten access-token lifetime and confirm refresh-token rotation is enabled in the Supabase project settings.
4. Document, in `docs/`, the decision to keep tokens in `localStorage` rather than cookies, and the reasoning in `server/index.js:74-75`. If you keep `localStorage`, the CSP work in step 1 stops being optional.

**Acceptance.** The CSP served by the API and by the client host contains no `'unsafe-inline'` in `script-src`, and `script-src-attr 'none'` is present. The client loads and every page renders with zero CSP violation reports in the browser console.

**Verify.** `curl -sI https://api.coelgu-system.engineer/ | grep -i content-security-policy` and the same against the www host. Then drive the app in a browser and confirm no `Content Security Policy` violations appear in the console.

---

### P1-3: Real student email addresses published in the client, and duplicated in server source

**Evidence.** `client/js/config.js:41-49` ships the enrollment pilot allowlist to every visitor:

```js
window.ENROLLMENT_PILOT_EMAILS = [
  'lexmatondo@g.cjc.edu.ph',   // admin / developer
  'test.newuser@g.cjc.edu.ph', // student: Alex Rivera (BSCoE, Yr 2)
  'bsce.test@g.cjc.edu.ph',    // student: Maria Santos (BSCE, seeded submitted load)
  'head.test@g.cjc.edu.ph',    // program head (BSCoE)
  'dean.test@g.cjc.edu.ph',    // dean
  'sa.test@g.cjc.edu.ph',      // student assistant (faculty role)
  'klydemodina@g.cjc.edu.ph',  // real student account for live testing
];
```

The same list is hardcoded server side in `server/middleware/roles.js:51-70` as `PILOT_DEFAULT`. The server copy is the enforceable one and is correctly designed (`pilotGate` reads `process.env.ENROLLMENT_PILOT_EMAILS` when set), so the control itself is not bypassable. Two problems remain: a real student's address is public data, and the list is a map of which accounts hold elevated roles (program head, dean, student assistant), which is a targeting aid.

**Change.**

1. Delete `ENROLLMENT_PILOT_EMAILS` and `isEnrollmentPilot` from `client/js/config.js`. Replace the client's use with a boolean fetched from an authenticated endpoint, for example `GET /api/enrollment/pilot-status` returning `{ pilot: true }` computed server side from `req.user.email`.
2. Remove `PILOT_DEFAULT` from `server/middleware/roles.js` and make the environment variable authoritative. Fail closed: if `ENROLLMENT_PILOT_EMAILS` is unset, the pilot gate denies everyone rather than falling back to a hardcoded list.
3. Replace real addresses with synthetic ones in any remaining test fixtures, and remove the real student's address from the codebase and from `docs/`.
4. Check `server/middleware/auth.js` for the same class of hardcoded identifier: the `FORENSIC_WATCH_EMAILS` and `FORENSIC_WATCH_IDS` defaults embed a specific email and a specific UUID. Remove the defaults and require the environment variables.

**Acceptance.** No real student email address appears anywhere under `client/`, `server/`, or `docs/`. The pilot gate denies by default when the environment variable is absent, and the enrollment feature still works for allowlisted accounts.

**Verify.** `grep -rn "g.cjc.edu.ph" client/ server/ docs/` returns only synthetic addresses, or nothing. Then log in as an allowlisted account and as a non-allowlisted one and confirm the pilot gate allows and denies respectively.

---

### P1-4: Tables granted to `anon` where only RLS stands in the way

**Evidence.** Measured live with the public anon key. `enrolled_students`, `announcements`, and `receipts` return `200` where every other table returns `401`. All three currently return **zero rows** (`Content-Range: */0`), so nothing is exposed today. But the `200` proves a `GRANT SELECT` to `anon` exists, meaning the only control between the public internet and these records is the RLS policy. `receipts` is financial and `enrolled_students` is student data.

**Change.**

1. Revoke the grants in a forward migration: `REVOKE SELECT ON public.enrolled_students, public.announcements, public.receipts FROM anon;`
2. Determine whether the zero rows are RLS filtering or an empty table, and record the answer. If the tables hold data and RLS is filtering, the grant is a live latent risk. If they are genuinely empty, the grant is still wrong but less urgent.
3. Do not rely on RLS alone. Grant only what a role needs.
4. If `announcements` is intended to be public, serve it through an explicit `/api/public` route with a conservative field set, exactly as `server/routes/public.js` already does, rather than through a raw table grant.

**Acceptance.** An anonymous request to all three tables returns `401` or `403`, not `200`. No client feature breaks.

**Verify.** Repeat the probe in Section 7.2 and confirm `401` for all three.

---

### P1-5: Client IP trust is unverified behind two proxies, which weakens rate limiting and the forensic log

**Evidence.** `server/index.js:29` sets `app.set('trust proxy', 1)`. The deployment sits behind Cloudflare **and** Render, which is two proxy hops, not one. `server/middleware/auth.js` reads `req.headers['x-forwarded-for']` directly for its forensic capture.

Both the rate limiters (`server/index.js:112`, `:125`, `:140`) and the forensic tracker depend on correctly identifying the client IP. With the wrong trust depth, `req.ip` can resolve to an intermediary address, which means either every user shares one rate-limit bucket (accidental denial of service for legitimate users) or, in the other failure mode, an attacker can influence the header to evade per-IP limits. The forensic log is only useful if its IP is the attacker's.

**Change.**

1. Determine the actual hop count by logging `req.ip`, `req.headers['x-forwarded-for']`, and `req.socket.remoteAddress` from the live Render service, and compare with a known client.
2. Set the trust depth to match reality, or use a trust function that validates against known Cloudflare ranges. Do not set `true`, which trusts arbitrary client-supplied values.
3. Use `req.ip` rather than the raw `x-forwarded-for` header in the forensic capture, so the value respects the trust configuration.
4. Verify the rate limiters key on the resolved client IP (they use `ipKeyGenerator` from `express-rate-limit`), and confirm the sensitive limiter covers the authentication and OTP endpoints specifically.

**Acceptance.** A request to a rate-limited endpoint consumes a bucket keyed to the real client IP, verified by two different client IPs receiving independent buckets. The forensic capture logs the same real IP.

**Verify.** Issue the same request from two networks or via two proxies and confirm independent limits. Check the Render logs for the captured IP and confirm it matches the client.

---

### P1-6: Verify the receipts storage bucket is not public

**Evidence.** `supabase/migrations/015_receipts_bucket.sql` creates a storage bucket for receipts. Public buckets are a common and serious Supabase misconfiguration: if the bucket is public, every receipt is readable by anyone who can guess or observe an object path, which for a financial transparency system means exposing payment evidence and possibly personal data.

**Change.**

1. Inspect `015_receipts_bucket.sql` and confirm the bucket is private.
2. Confirm access uses short-lived signed URLs generated server side, not permanent public URLs.
3. Confirm the storage policies scope objects so one user cannot read another's receipts.
4. If the bucket is public, make it private and update the client to request signed URLs from the API.

**Acceptance.** A direct unauthenticated request to a known receipt object path returns `400` or `403`, not `200`. The client still displays receipts via signed URLs.

**Verify.** Extract one object path as an authenticated user, then request it without credentials. Record the status code.

---

### P2-7: Preview deployment origins are trusted by CORS

**Evidence.** `server/index.js:90-99` allows origins matching `VERCEL_PREVIEW_RE`, in addition to the production origin. Preview deployments are reachable URLs that run the same client against the same API. They are a weaker link: they may be indexable, shareable, and they can be used as a convincing phishing surface on a legitimate-looking domain, or to exercise the API from a context with different configuration.

**Change.**

1. Confirm whether preview deployments need API access at all. If only production needs it, remove `VERCEL_PREVIEW_RE` from the allowlist.
2. If previews are needed, require the preview environment to prove itself, for example through an environment token checked server side, and ensure Vercel deployment protection is enabled on previews so they are not publicly reachable.
3. Confirm preview URLs are not indexed: check for `X-Robots-Tag: noindex` and a `robots.txt` that disallows them.

**Acceptance.** The CORS allowlist contains only the origins that must be allowed, or previews are protected and non-indexable.

**Verify.** Send a request with `Origin: https://<project>-git-branch.vercel.app` and confirm the response no longer grants the origin, or that previews are unreachable without authentication.

---

### P2-8: Dependency audit and pinning

**Evidence.** `package.json` pins ranges, not exact versions. `multer` is at `^1.4.5-lts.1`, an old line with a history of advisories, and `express`, `pdfkit`, `exceljs`, and `sib-api-v3-sdk` are all on caret ranges.

**Change.**

1. Run `npm audit --omit=dev` and `npm audit` and triage every finding. Record each with a justification if it is not actionable.
2. Upgrade `multer` to a maintained line and confirm upload handling still works. Note that `multer` is used for file uploads, so this is security relevant, not just hygiene.
3. Consider committing `package-lock.json` enforcement with `npm ci` in CI rather than `npm install`, so builds are reproducible.
4. Add a documented reason for every new dependency, per the project's standing rules.

**Acceptance.** `npm audit` reports no high or critical findings, or each remaining finding has a written justification. Uploads still function.

**Verify.** `npm audit --omit=dev` output pasted into the report, plus an upload smoke test.

---

### P2-9: Third party dependencies in the browser policy

**Evidence.** If the client still uses `api.qrserver.com` for QR rendering, the QR payload is sent to a third party. The API host CSP also allows `cdn.jsdelivr.net` and `cdnjs.cloudflare.com` for scripts, allowlisted by origin without Subresource Integrity.

**Change.**

1. Generate QR codes locally. The `qrcode` package is already a devDependency, so the capability exists without a network round trip. If a QR ever encodes a student or payment identifier, that is data leaving the trust boundary.
2. Vendor third-party scripts into `client/vendor/` as `supabase.min.js` already is, or add SRI hashes to any CDN script tag.
3. Review the CSP allowlist and remove any origin that is no longer needed.

**Acceptance.** The CSP contains no origin the app does not use. QR codes render with no third-party network request.

**Verify.** Load the app with the network tab open and confirm zero requests to third-party origins during normal use.

---

### P2-10: Secret scanning and dependency scanning in CI

**Evidence.** `.github/workflows/` contains `smoke.yml` and `backup.yml`. There is no secret scanning and no dependency audit job. Secrets are currently safe in git, but nothing prevents a future commit from introducing one.

**Change.**

1. Add a CI job that fails on detected secrets, for example `gitleaks` or `trufflehog`, run against the full history or at least the pull request diff.
2. Add `npm audit --audit-level=high` as a CI job.
3. Add the SQL lint checks from Section 7 as a CI job so RLS and function hygiene cannot regress.
4. Consider a pre-commit hook mirroring the secret scan, so the failure happens locally before the commit.

**Acceptance.** CI fails on a planted test secret and on a high-severity dependency finding, and passes on the clean tree.

**Verify.** Open a temporary branch containing a fake `sk-` style string and confirm CI fails, then remove it. Record both runs.

---

### P2-11: Schema enumeration through PostgREST error hints

**Evidence.** Requesting a nonexistent table returns a suggestion naming real tables, for example `Perhaps you meant the table 'public.student_cvs'`. An unauthenticated user can walk the schema. This is low severity on its own, but it removes guesswork from anyone probing the tables in P1-4.

**Change.** Either accept this as a documented low risk, or route the browser away from direct PostgREST access so those errors are not reachable, serving the client through the API instead.

**Acceptance.** Either the risk is formally accepted in `docs/`, or anonymous schema probing no longer returns table names.

---

### P2-12: Public transparency mode needs a review before it is enabled

**Evidence.** `server/routes/public.js` is correctly gated behind `PUBLIC_TRANSPARENCY_MODE`, which is off in production, which is why anonymous requests receive `403`. The router's stated intent is conservative: aggregates only, no donor names, no user IDs, no receipt URLs.

**Change.** Before the flag is ever set to `true`, add a test that asserts the public endpoints return no personally identifying fields, and that transaction descriptions cannot be used to reconstruct individual gifts. The description field is free text and is the most likely place for a name to leak.

**Acceptance.** An automated test asserts the exact field set of every `/api/public/*` response, and fails if a new field is added without review.

**Verify.** Run the test against a staging database seeded with representative data.

---

## 6. Defense in depth backlog

Lower priority, do after the findings above. Each is independent.

1. **Structured logging with redaction.** Centralize logging through `server/lib/logger.js` and add a redaction pass for emails and tokens, so no future log statement can leak a secret. `server/middleware/auth.js` already avoids logging bodies for this reason, and that discipline should be enforced by code rather than by memory.
2. **Response field allowlists.** For every endpoint returning rows, select explicit columns rather than `*`, so a new sensitive column cannot silently become exposed.
3. **Account verification hardening.** `026_account_verification.sql` and `027_fix_verification_requests_rls.sql` exist. Verify that a user cannot self-approve their own verification request, and that the request table cannot be written by the requesting user to set an approved status.
4. **Session behavior.** Confirm logout invalidates server side, and that a disabled account cannot continue using an unexpired token. `authMiddleware` calls `auth.getUser(token)` per request, which does validate against the auth server, so verify that a deleted or banned user is rejected promptly.
5. **File upload limits.** `multer` is present. Confirm a maximum file size, a MIME allowlist, and that uploaded filenames cannot traverse paths. Prefer storing to object storage with a generated key rather than a user-supplied name.
6. **Error handling.** Confirm the error handler at `server/index.js:208` does not return stack traces to clients in production, and that `NODE_ENV` is set to production on the API host.
7. **Backup restoration proof.** `backup.yml` exists. Confirm a restore has actually been tested, not just that a backup is produced.
8. **Electron client hygiene.** Verify `nodeIntegration` is disabled, `contextIsolation` is enabled, `webSecurity` is on, and `allowRunningInsecureContent` is off. Confirm the packaged build does not embed secrets (verified absent today) and that the update path is over TLS with a verified signature.
9. **Dashboard and client hardening.** Ensure the client never trusts a role claim from storage for UI authorization decisions that matter. UI gating is cosmetic; the server is the authority, and `server/middleware/roles.js` is where enforcement lives.

---

## 7. Verification protocol

Run these before and after. Paste actual output.

### 7.1 Deployed header check

```bash
curl -sI https://api.coelgu-system.engineer/ | grep -i -E 'content-security-policy|strict-transport|x-content-type|x-frame|referrer|permissions'
curl -sI https://www.coelgu-system.engineer/ | grep -i -E 'content-security-policy|strict-transport|x-content-type|x-frame|referrer|permissions'
```

Assert: no `unsafe-inline` in `script-src`, `script-src-attr 'none'` present, `object-src 'none'`, `frame-ancestors 'self'`, `nosniff` present.

### 7.2 Anonymous table probe (must be `401` for every table listed)

```bash
ANON=$(node -e "const fs=require('fs');const m=fs.readFileSync('client/js/config.js','utf8').match(/SUPABASE_ANON = '([^']+)'/);process.stdout.write(m[1])")
SB="https://hchkfunaofyoualrdnkk.supabase.co/rest/v1"
for t in enrolled_students announcements receipts profiles transactions events; do
  printf "%-22s -> %s\n" "$t" "$(curl -sS -o /dev/null -w '%{http_code}' -H "apikey: $ANON" -H "Authorization: Bearer $ANON" "$SB/$t?select=id&limit=0")"
done
```

### 7.3 RLS, grant, and function hygiene (the CI invariant)

Run as a migration-check script. Each query must return zero rows.

Tables without RLS:

```sql
select n.nspname as schema, c.relname as table
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
```

Anonymous grants:

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public';
```

`SECURITY DEFINER` functions with an unpinned `search_path`:

```sql
select n.nspname as schema, p.proname as function
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (
    p.proconfig is null
    or not exists (
      select 1 from unnest(p.proconfig) as cfg where cfg like 'search_path=%'
    )
  );
```

### 7.4 Repository hygiene

```bash
git ls-files --error-unmatch .env          # must fail: not tracked
git log --all --oneline -- .env            # must be empty
grep -rn "g.cjc.edu.ph" client/ server/ docs/   # only synthetic addresses
grep -rn -i -E "SUPABASE_SERVICE|BREVO_API_KEY|xkeysib" client/ electron/  # must be empty
```

### 7.5 Build and tests

```bash
npm ci
npm audit --omit=dev
npm start            # server must boot with .env present
```

Then run the smoke suite in `.github/workflows/smoke.yml` locally, and the Playwright checks if configured.

---

## 8. Tests that require staging, never production

These are the highest value remaining tests and they cannot be run safely against live data. Create a staging Supabase project, seed it, and run them there.

1. **Signup and email domain trust.** Determine whether an account can be created with a `@g.cjc.edu.ph` address by someone who does not own it, and whether email confirmation is enforced. `004_restrict_email_domain.sql` suggests the domain is restricted; verify what happens on a signup attempt with an unowned address on that domain. If a stranger can register as any student address, that is a critical authorization bypass. Also verify the Google OAuth path, since `012_scale_and_google_oauth_indexes.sql` and the CSP allowlist indicate Google login is enabled, and an OAuth flow can bypass email confirmation.
2. **Cross user write authorization, the classic BOLA test.** With two seeded student accounts, attempt to read and write the other account's records: profile, enrollment submission, CV, notifications. Confirm every attempt fails with `403`, not `200`.
3. **Role escalation.** As a plain student, attempt to set `role` on your own profile row, and attempt to call every `/api/admin/*` route. `035_prevent_profile_role_tampering.sql` should block the first; `requireAdmin` in `server/middleware/roles.js` should block the second. Confirm both.
4. **Pilot gate bypass.** As a non-allowlisted account, call the enrollment endpoints directly. Confirm `403`.
5. **Public mode field audit.** With `PUBLIC_TRANSPARENCY_MODE=true` in staging, capture every `/api/public/*` response and diff the field set against an expectation. Assert no names, no emails, no ids, no receipt URLs.

---

## 9. Prohibited actions

- Do not commit `.env` or any credential, in any branch, ever.
- Do not print, paste, or log a secret value. Refer to secrets by name.
- Do not run write tests, account creation, or data mutation against production.
- Do not disable RLS, remove a rate limiter, widen a CORS allowlist, or relax a CSP to make something work. If a control blocks legitimate function, fix the integration, not the control.
- Do not rotate live secrets without human sign-off.
- Do not restructure directories, rename files, or reformat unrelated code.
- Do not change navigation, routes, or user-facing behavior as part of a security fix.
- Do not remove the `/api/public` feature flag gate, even if asked to "just turn on transparency". Review it first (P2-12).
- Do not claim a control works without running its verification command.

---

## 10. Deliverables and reporting

Produce all of the following.

1. **A findings report** at `docs/SECURITY_HARDENING_REPORT.md`, one section per finding from Section 5, each with: status (fixed, mitigated, accepted, not reproducible), the exact change, the file and line, the verification command, and its real output.
2. **Forward migrations** for every schema change, numbered sequentially from the current highest. Never edit a migration that has already run in production.
3. **CI jobs** for secret scanning, dependency audit, and the Section 7.3 invariants.
4. **Tests** for the staging-only cases in Section 8, committed and runnable, even if they only run against staging.
5. **An updated `.env.example`** listing every variable the server reads, including `ENROLLMENT_PILOT_EMAILS`, `PUBLIC_TRANSPARENCY_MODE`, `FORENSIC_WATCH_EMAILS`, and `FORENSIC_WATCH_IDS`, with placeholder values and no real addresses.
6. **A journal entry** in `journal/YYYY-MM-DD.md` per the project convention.
7. **A short changelog summary** stating what changed, what was verified, and what remains open.

**Report format per finding:**

```
### <ID> <title>
Status: fixed | mitigated | accepted | not reproducible
Evidence before: <file:line or command output>
Change: <what you did>
Verification: <command>
Output: <pasted real output>
Residual risk: <what still remains, if anything>
```

---

## 11. Definition of done

The pass is complete when:

1. Every finding in Section 5 has a status and a pasted verification output.
2. The Section 7.3 invariant queries all return zero rows, enforced in CI.
3. `npm audit` is clean or fully triaged with written justification.
4. The staging tests in Section 8 have been run and their results recorded.
5. No secret appears in git history, in the client bundle, or in the Electron build.
6. The smoke suite and the existing Playwright checks still pass, proving nothing was broken.
7. The report, the migrations, the CI jobs, and the journal entry are all committed.
