# Grizz → Load Verification Add + Enrollment Pilot Gate

Date: 2026-09-08
Branch: testfeature/enrollment-automation → main
Status: Approved design (user selected: add-all + per-subject buttons; stay in chat + jump link; disabled + reason when locked; gate-and-merge scope includes the Grizz feature)

## Goal

Two pieces ship together behind one merge to `main`:

1. **Grizz recommendations become actionable** — students can push Grizz's "Next Sem Recommendations" straight into their Load Verification draft (Phase C's first user-facing step).
2. **Pilot gate for live testing** — the enrollment feature set (student Load Verification + `/faculty` portal + their APIs) is usable only by `lexmatondo@g.cjc.edu.ph` (role: admin). Every other account sees a "still under development" message. Production (Render + Vercel) auto-deploys from `main`, so this merge is the production release.

## Feature 1: Pilot gate

### Client

`client/js/config.js` gains the single source of truth — the pilot account plus the five test accounts (they share the same Supabase project as production, so they exist on `main` too and let Lex run the full multi-role flow live):

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
window.isEnrollmentPilot = function (email) {
  const v = String(email || '').trim().toLowerCase();
  return (window.ENROLLMENT_PILOT_EMAILS || []).some(e => String(e).trim().toLowerCase() === v);
};
```

- **Student side** (`client/js/enrollment.js`, top of `load()`): fetch profile, and if `!window.isEnrollmentPilot(profile?.email)` render an under-development panel inside `#view-enrollment` ("🚧 Load Verification is still under development — it will open for your account soon.") and return before any API calls. The nav item stays visible for everyone; the check lives at the head of `load()`, so desktop nav, the mobile menu sheet, and any Grizz link all funnel through it.
- **Faculty portal** (`client/js/faculty/faculty.js`, in `boot()` after the role check): non-pilot faculty/program heads/deans get the existing gate screen with the under-development message instead of the portal. The `app.js` redirect for faculty roles is unchanged — they land on `/faculty` and see the gated message.
- **Admin keeps both sides**: admin never triggered the `/faculty` redirect, so Lex uses Load Verification in the main app and can open `/faculty` directly.

### Server

New middleware (`server/middleware/roles.js`): `pilotGate` — allowlist from `process.env.ENROLLMENT_PILOT_EMAILS` (comma-separated), defaulting to the same seven addresses as the client list. Matches `req.user.email` (the auth middleware's `req.profile` select does not include email; `req.user` does). Non-pilot → `403 { error: 'This feature is still under development.' }`. Applied with `router.use(pilotGate)` at the top of `server/routes/enrollment.js` and `server/routes/faculty.js`, so the UI hiding is backed by a real API block.

Widening access later = edit the `config.js` array (client) + set the Render env var (server). No code archaeology.

## Feature 2: Grizz add buttons

### Enrollment module export widened (`client/js/enrollment.js`)

```js
window.Enrollment = {
  addFromGrizz,                                   // existing Phase C hook, unchanged
  ensureReady: load,                              // loads profile + checklists + submissions; creates the term draft if none
  canEdit: () => !!current && ['draft', 'returned'].includes(current.status),
  lockedReason: () => ({ submitted: 'Submitted — with your Program Head',
    under_review: 'Under evaluation', approved: 'Approved — locked',
    rejected: 'Rejected' }[current?.status] || ''),
  draftSubjectIds: () => new Set((current?.enrollment_submission_items || [])
    .filter(i => i.item_state !== 'removed_by_head').map(i => i.subject_id)),
};
```

**State timing:** `EnrollmentSection.load()` only runs when the student first activates the Load Verification view (`app.js:592`). On a fresh session the Grizz card renders before any enrollment state exists, so `handleNextSemRecommendations()` must `await window.Enrollment.ensureReady()` (pilot users only — non-pilot accounts make zero enrollment API calls) before computing button state. Without it `current` is null, `canEdit()` is falsely negative, and `addFromGrizz` silently no-ops. `load()` is safe to run repeatedly: it refetches and only auto-creates the draft term when no submission exists. All accessors stay null-safe regardless.

### Recommendation card (`client/js/ai-assistant.js`)

`appendBotMessage` returns the message element (one line, backwards compatible) so per-card listeners can bind after insertion.

In `handleNextSemRecommendations()`, after `recommended` is computed:

- **Non-pilot**: cards render exactly as today — no add UI at all.
- **Pilot, load locked** (submitted / under_review / approved / rejected): Add buttons render disabled with the reason inline ("Your load is Under evaluation — subjects can be added once it's returned to you.").
- **Pilot, load editable**:
  - An **"Add all recommended"** button beside the summary bar.
  - An **Add** button on each subject card; subjects already in the draft render a disabled **"In your load ✓"** tag instead.
  - Clicks call `Enrollment.addFromGrizz(subject, 'Recommended by Grizz')` (existing endpoint, origin `grizz` — the draft row shows the Grizz badge and the program head sees the origin). "Add all" runs sequentially over not-yet-in-load subjects and reports "✓ Added N subject(s) · M already in your load".
  - Successful per-card adds flip the button to disabled "✓ Added"; the add-all button disables once everything is in the load.
  - A persistent **"Open Load Verification →"** link uses the existing `ursa-nav-link data-view="enrollment"` pattern (nav item already exists at `index.html:301` — navigation for free).

### Errors

Fetch failures (session expired, server 400/403) surface as an inline error line inside the chat message — not a toast — since the user's attention is in the chat. Button state stays unchanged on failure so the click can be retried.

## Version bumps (cache-busting convention)

- `config.js?v=5.5` — every page that loads it (index, faculty, officer, any others).
- `ai-assistant.js?v=5.4` (from 5.3), `enrollment.js?v=1.1` (from 1.0), `main.css?v=7.2` on `index.html` (faculty.html only if shared classes change).

## Edge cases

- Grizz and the Load Verification module both read subjects from `Api.units.checklists`, so `subject.id` is consistent across the two; the server remains the authority on program match, duplicates, and status.
- The pilot gate precedes the add buttons, so non-pilot accounts never render (or click) add UI even if they reach the recommendation card.
- Smoke suites are static source-wiring checks, not live authenticated calls — unaffected by the server gate.

## Testing plan (local, before merge)

The gate's negative case needs an account that is deliberately **not** allowlisted: the seed script creates one more throwaway, `gated.test@g.cjc.edu.ph` (student role, no seeded load, excluded from `ENROLLMENT_PILOT_EMAILS`).

1. **Pilot student** (`test.newuser@g.cjc.edu.ph`): full flow — Load Verification loads, Grizz card shows add buttons, add-all and per-card adds land in the draft with the Grizz badge, "In your load ✓" dedupe, jump link switches views.
2. **Pilot locked state** (`bsce.test@g.cjc.edu.ph`, seeded submitted load): disabled buttons + correct reason.
3. **Pilot head** (`head.test@g.cjc.edu.ph`): redirected to `/faculty`, portal fully usable; `sa.test` sees Approved Loads; `dean.test` sees the overview.
4. **Non-pilot student** (`gated.test@g.cjc.edu.ph`): Load Verification shows the under-development panel; Grizz cards render with no add UI; direct API call returns 403 under-development error.
5. Existing smoke suites still pass.

## Deploy

`git merge --no-ff testfeature/enrollment-automation` into `main`, push. Render (API) and Vercel (client) deploy automatically — the same test accounts then work on production for live testing, since both environments share the Supabase project. Optionally set `ENROLLMENT_PILOT_EMAILS` on Render (default already covers admin + test accounts). When the pilot ends, widen the lists (or set the env var to `*` semantics if added later) — real users start seeing the feature the moment their email joins the list.

## Out of scope

No auto-submit of the load, no changes to recommendation logic, no officer-portal changes, no notification changes.
