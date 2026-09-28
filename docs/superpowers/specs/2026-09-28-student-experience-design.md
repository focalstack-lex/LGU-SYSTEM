# Student experience: design

Date: 2026-09-28. Source: `reports/uiux/2026-09-28-student-walkthrough.md` (28 findings from a driven walkthrough as a third-year BSCoE student). Approved by Lex in chat, with three decisions: add the three navigation entries, leave Grizz for a separate AI project (copy fixes only), lock program and enrollment year for verified students, and enforce a unit cap server-side with a default of 24.

Branch `ui/student-experience`, stacked on `ui/soft-palette` (both touch `main.css`). Merge order: palette first.

## Approach

Extend the existing modules in place. Each item is a bounded edit to the module that already owns the screen, so the existing driven suites keep covering it. A separate student shell was rejected (weeks of work, breaks every test); fixes-only was rejected (leaves the home and inbox gaps).

## 1. Enrollment

- Eligibility rule moves into `client/js/enrollment-journey.js` as `eligibleSubjects(subjects, records, yearLevel, term)` and is unit-tested. Rules: exclude passed and currently enrolled subjects; include any subject with a `failed` record regardless of year (badge "Retake"); otherwise keep the current `year_level >= yearLevel - 1` window.
- The semester filter defaults to the load's semester. Adding a subject from the other semester is refused inline: "CPE 321 is a Semester 2 subject; this load is for Semester 1."
- `submit()` re-renders the course cards; `.btn-add-course:disabled` gets a visible disabled style.
- Cards show prerequisites from `checklists.prerequisites` (already returned by `/api/units/checklists`). Unmet prerequisites grey the card and show "Needs CPE 211".
- Unit cap: `curriculum_requirements.max_units_per_term SMALLINT NOT NULL DEFAULT 24` (SQL run by Lex). `POST /enrollment/submissions/:id/submit` rejects loads over the cap with `{ error: "Your load is 27 units; the limit for BSCoE is 24." }`. The load header reads "9 of 24 units" and turns to the warning colour above the cap.
- Removing a subject asks for confirmation through `UI.confirmDialog`; submit uses `UI.confirmDialog` instead of `window.confirm`.
- Post-submit copy: one sentence; the timestamp uses the body font.

## 2. Student home

For `role === 'student'` only, `#student-status` renders above the fund hero on the dashboard: enrollment step and its next action (from `EnrollmentJourney.actionFor`), units in progress this term (from `/units/my`), the next upcoming event (from `/events`), unread notifications (from `/notifications`), and a "Send feedback" link. Data calls already exist; the strip only reads them. Officers and admins see no strip.

## 3. Announcements and Notifications pages, Feedback link

- `#view-announcements`: every announcement the API returns (20 latest), newest first, full body, date. Sidebar entry "Announcements" after Dashboard; More-sheet row under a new "Updates" group. Dashboard card gets "View all".
- `#view-notifications`: notifications grouped by category with unread first; opening the view calls `POST /notifications/read` per category shown. Sidebar entry "Notifications" with the unread badge `notifications.js` already paints on `[data-view]` items; More-sheet row under "Updates".
- Feedback: link in the sidebar footer, a More-sheet row under "Account", and the status strip.

## 4. Fixes and polish

- `.mobile-sheet-row.hidden { display: none !important; }` after the forcing rule (`main.css:8165`).
- Event detail: "Budget Utilization" becomes a percentage of the allocation; "Remaining" stays as the sublabel.
- Academic Progress: when no requirement row exists, show "Required units are not set for {program}" and hide the percentage. Page heading "Academic Progress". A "Self-reported" notice under the header, mirroring the PDF footer.
- Skip link `<a class="skip-link" href="#main-content">Skip to content</a>` as the first focusable element on `index.html` and `officer.html`.
- `.main-content` bottom padding reserves the Grizz launcher height.
- Naming: "Transactions" everywhere (heading, sheet row); bottom tab "Academic" stays (space) but its label matches the page name on the sheet.
- Copy: "Student Council (LGU)" and "Student Assistant (SA)" on first use; reports section "Per-Event Budgets" for students with the Export column hidden; a one-line definition under "Budget Utilized" and "Net Cash"; Grizz greeting opens on the prompt list, quote removed; "Account" replaces "Administration" for the profile row.
- Type: secondary text floored at 0.75rem, bottom-nav labels 0.72rem.
- Touch: receipt links, year tabs, "Add to Load", Edit/Remove reach 40px in height on phones.
- Profile: verified students see Degree Program and Enrollment Year read-only with "Request a correction" (opens `/feedback/`); Year Level stays editable. The avatar gallery moves below the fields behind "Change avatar".

## 5. Verification

- `tests/enrollment-eligibility.test.js`: retake included, passed excluded, wrong semester refused, cap arithmetic.
- `scripts/verify-student-experience.mjs`: driven, mocked student, asserts the retake card, disabled cards after submit, cap message, no staff rows on the phone sheet, skip link first in Tab order, no text under 12px, all tap targets at least 40px high on phone, announcements and notifications views render, profile fields locked.
- Existing suites: `verify-contrast.mjs` (both themes), `verify-dropdown-sweep.mjs`, `verify-icons-offline.mjs`, `verify-ui-audit-fixes.mjs`, `verify-ui-audit-officer.mjs`, `node --test`, `map:code:check`, `icons:check`, `check_txs.js`.

## Deviations recorded during implementation

- The avatar gallery is collapsed in place behind "Change avatar" rather than moved below the fields: same effect on the reading order, no restructuring of the modal (Lex's "do not change my structure" rule).
- Retakes stay visible under every year filter (a retake is a state, not a year), so the year dropdown counts include them.
- Two pre-existing defects surfaced by the verification drive and were fixed: `notifications.js` called a global `API` that the student portal never defines, so badges never loaded (it now uses `Api`); and the shared `UI.confirmDialog` closed itself when the second click of a double-click hit its backdrop (backdrop clicks are ignored for the first 400ms).
- Not changed, noted for the security workstream: `api.js` signs the user out on any 401, so a transient 401 on the 30-second notifications poll would end a session mid-use.
- The shared test mocks (`scripts/lib-capture-mocks.mjs`) now stub `/api/notifications` and `/api/enrollment/pilot-status`.

## Out of scope

Grizz typed questions (needs a model backend and a privacy decision), officer-side editing of the unit cap (SQL for now), an announcements composer for students.

## SQL to run in Supabase (collected at the end of implementation)

`ALTER TABLE public.curriculum_requirements ADD COLUMN IF NOT EXISTS max_units_per_term SMALLINT NOT NULL DEFAULT 24;` plus the check for migration 038 from earlier today. Final list is in the journal entry for this work.
