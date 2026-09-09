# Enrollment Verification — Student Journey UX Redesign

**Status:** Approved for implementation planning
**Date:** 2026-09-10
**Branch:** `redesign` (synced to `origin/redesign/ui-enhancement`)
**Related specs:** `2026-09-08-faculty-portal-and-load-approval-design.md`, `2026-09-08-grizz-load-add-and-pilot-gate-design.md`

---

## 1. Background & goal

The **Enrollment Verification** feature (today's "Load Verification" view) lets a College of Engineering student build a proposed load from Grizz-suggested or eligible courses, submit it to their Program Head for evaluation, and then be marked *encoded* by the Student Assistant (SA) once the load is approved. The university registrar is **outside the department** and is not a user of this system; the in-system journey ends when the SA encodes the load and the student continues at the registrar for assessment.

**The university registrar and assessment claiming are outside the College of Engineering and are NOT part of this system** (confirmed by product owner, 2026-09-10).

**Goal:** students should have a great experience across the whole journey — they should always be able to answer three questions at a glance:

1. **Where is my load right now?** — a visible step in a clear journey.
2. **What's happening?** — plain-language status, not raw state strings.
3. **What do I do next?** — exactly one clear action, or a calm "nothing — wait."

**Real users (confirmed):** COE students, Program Heads, and the Student Assistant. No registrar account exists in the system.

**Rollout stage (confirmed):** pre-launch / testing with seeded accounts (`gated.test`, `bsce.test`, etc.). No real-student feedback exists yet — this design is the experience students meet on day one.

**Primary device:** the app is a PWA with mobile + desktop layouts. The enrollment experience is designed responsive-first and thumb-friendly, with the current responsive split (desktop two-column, mobile single-column) respected.

---

## 2. What is wrong today (evidence)

From code review of `client/index.html`, `client/js/enrollment.js`, and the faculty/SA flows:

1. **No journey framing.** Status is plain bold text; no badges, timeline, or "what happens next." The student cannot tell who has the load or what they are waiting for.
2. **Controls ignore state.** The Submit button is always rendered/enabled, and every draft row shows a ✕ remove button even when the submission is locked (`submitted`/`under_review`/`approved`). Clicking surfaces raw server errors like *"This submission is under_review and can no longer be edited."* directly into an inline error box (`client/js/enrollment.js:208`, `:260-268`).
3. **Terminology drift.** The view mixes *verification / evaluation / proposed load / load / term / semester*. Sidebar and heading say "Load Verification"; status copy says "evaluation" and "verification" interchangeably; the course grid says "Term" while footers say "Yr X • Sem Y".
4. **Dead ends and weak hand-offs.** *Returned* shows the head's notes but no obvious "fix and resubmit" affordance. *Rejected* is terminal with no guidance. *Approved-but-not-encoded* looks identical to *Approved-and-encoded* until the SA acts; there is no visible "waiting for SA" state and no completion state pointing the student to the registrar.
5. **Mobile is effectively unreachable.** The view is absent from the bottom nav and the "More" sheet; the only mobile entry is a link inside Grizz chat (`client/js/ai-assistant.js:1002-1008`). The nav label also doesn't persist on refresh (`client/js/ui.js:21`).
6. **Silent implicit term.** Visiting the view auto-creates a Semester 1 draft; there is no term picker, no window awareness, and no "no active term" handling. If a prior-year submission exists and none for the current year, the student is stuck viewing an old locked term.
7. **Raw/absent feedback.** Raw `err.message` strings are shown verbatim; no confirm on submit; no loading/empty state design beyond a bare "Loading eligible courses…".
8. **Notification routing mismatch.** Load status notifications use category `units`, so the unread dot lands on "Academic Progress" rather than the enrollment entry, and there is no in-portal message list; the click-through URL is home (`server/routes/faculty.js:197-207`).

---

## 3. Approved design decisions

| # | Decision | Owner note |
|---|---|---|
| D1 | Approach **A: Journey + timeline**. One screen that always answers "where am I / what's happening / what do I do next?", with a persistent status column and a state-aware workspace. | Approved |
| D2 | View renamed **"Enrollment Verification"** everywhere student-facing; short mobile label **"Enrollment"**. | Approved — replaces "Load Verification" |
| D3 | **No print/download** of an enrollment summary. After encoding, students are pointed to the registrar in copy only. | Approved |
| D4 | **Students receive email ONLY when the SA encodes.** All other transitions are in-app notification only. | Approved — deliberate, small server change (see §8) |
| D5 | **Email plan: Brevo Free now → Starter at rollout.** A small send outbox/queue is implemented either way so no rework is needed at the plan switch. | Approved |
| D6 | **Two-mode availability:** editing only during an office-defined enrollment window and while the submission is editable (draft/returned); outside the window the view is a read-only status hub. | Approved |
| D7 | Work stays client-focused per `AGENTS.md`. Only functional server change is the email-gating condition in D4. Server state machine, pilot gate, RLS, and Supabase client (`client/js/api.js`) are untouched. | Constraint |

---

## 4. Journey model & language

### 4.1 Server states → student journey

| Server state | Journey step (student-facing) | What the student should do |
|---|---|---|
| `draft` | **1 · Build your load** | Pick subjects (Grizz-suggested or eligible grid) → Submit |
| `submitted` | **2 · With your Program Head** | Nothing — wait. Include sent timestamp. |
| `under_review` | **2 · Program Head is reviewing** | Nothing — wait |
| `returned` | **2 · Needs your changes** (flagged) | Read the requested changes, fix the load, resubmit |
| `approved` (no `encoded_at`) | **3 · Approved — waiting for SA encoding** | Nothing — wait |
| `approved` + `encoded_at` | **4 · Encoded — done in this system** | Completion state; next step is at the University Registrar (outside this system) |
| `rejected` | **Held — needs help** (rare/terminal) | Explanation + "contact your Program Head / COE office" |

### 4.2 Terminology rules (all student-facing copy)

- **One consistent verb set:** *build → submit → review → approved → encoded*. Never "evaluation" vs "verification" drift.
- **"Semester"** replaces "term" in student-facing prose.
- Status labels (with the existing `UI.renderStatusBadge` color language):
  - *Build* — neutral
  - *Submitted / Under review / With your Program Head* — amber (waiting)
  - *Needs your changes (returned)* — coral/red
  - *Approved* — green
  - *Encoded* — green
- Header subtitle describes the real process: *"Build your proposed load, get it evaluated by your Program Head, and encoded by the SA."*

---

## 5. Layout & components

### 5.1 Desktop (≥ 768px)

Two columns, purpose-driven:

- **Left — Journey / Status (persistent anchor, ~40%):**
  - Four-step tracker: *Build → With Program Head → Approved → Encoded*. Done steps get a coral check; current step is a solid coral dot; future steps muted; "Needs changes" renders as a flagged state inside step 2.
  - "What's happening" panel: one plain-language paragraph + timestamp (e.g., *"Your load was sent to the BSCE Program Head. You'll be notified when they respond."*).
  - Head changes feed: each head-added / head-removed item renders as a timeline row — icon + subject code + the head's note.
  - Exactly one action (see 5.3) pinned bottom-left.
- **Right — Workspace (editable) or read-only summary (locked):**
  - Editable states: Proposed Load list (with badges + remove ✕) above the Eligible Courses grid.
  - Locked states (`submitted` → `encoded`): read-only load summary only — no add/remove/submit affordances at all.

### 5.2 Mobile (≤ 768px)

Single column with deliberate order: **journey/status first**, then proposed-load list, then eligible courses. The tracker collapses to a compact chip row on very small screens. A primary action button is bottom-anchored full-width. The view becomes reachable from the mobile "More" sheet (new "Enrollment" row) and persists as a nav destination on refresh (registration in the same nav registry the other views use).

### 5.3 State-aware action panel

| State | Primary action |
|---|---|
| `draft` (items ≥ 1) | **Submit to Program Head** |
| `draft` (0 items) | (disabled) + helper copy to pick subjects |
| `returned` | Workspace re-enables; then **Submit to Program Head** (resubmit) |
| `submitted` / `under_review` / `approved` | No button — *"Nothing needed from you right now."* |
| `encoded` | Success completion card (green), copy pointing to the registrar |
| `rejected` | Guidance copy + contact route |

Rule: **no control that can trigger a server edit error is ever rendered in a locked state.** The rough-edge errors from §2.2 become impossible to reach.

---

## 6. Interactions & microcopy

- **Submit confirmation:** lightweight confirm panel — *"Submit 5 subjects (18 units) to the BSCE Program Head?"* — one tap to confirm, cancel returns to the load.
- **Returned loop:** journey jumps back to *Build* with the "Needs changes" flag on step 2 for history; the head's requested changes are listed at the top of the workspace; student edits and resubmits in one flow.
- **Waiting transparency:** waiting states show *"With your Program Head since <date>."* No countdowns, no fake urgency.
- **No silent destructive action:** removing a subject toasts confirmation and nothing is removed that can't be re-added while editable.
- **Rejected:** no server change; purely a friendlier presentation with next steps.

---

## 7. Availability model (two modes)

- **Open window:** office-defined enrollment window for the student's current program + semester. Editing (build/submit) is available **only** while the window is open **and** the submission is editable (`draft`/`returned`).
- **Closed / outside window:** the screen renders read-only — *"Enrollment for Semester 2 is not open yet"* — but the tracker and last-submission history remain visible so the view is a year-round status hub.
- After `encoded`, the completion state stays year-round ("your load was encoded — proceed to the registrar for assessment").

**Rollout prerequisite (flagged, NOT in this UI workstream):** the client currently hard-codes Semester 1 and auto-creates the term on first visit with no window concept (`client/js/enrollment.js:71-73`). To support the real cadence (2 semesters/year) the client must receive its **active term + enrollment window from the server**. This requires a small backend/data contract change and is listed in §10 as a prerequisite to be planned separately; the client UI in this spec is designed to consume such a contract when it lands.

---

## 8. Email & notifications

### 8.1 Event table (student-facing)

| Event | In-app bell | Email to student |
|---|---|---|
| Submitted | ✅ (existing) | ❌ none |
| Returned / Rejected | ✅ | ❌ none |
| Approved by head | ✅ | ❌ none |
| **Encoded by SA** | ✅ | ✅ **only email sent** |

Heads/SA email and in-app notifications are unchanged. Subject line example: *"Enrollment Verification — Your load is encoded."* Body reuses the redesigned COE template already on this branch (`server/lib/email.js`), states the program/term, and tells the student the next step is at the University Registrar for assessment.

### 8.2 Volume & plan

- One encode email per student per term ≈ **500 emails × 2 terms/year ≈ 1,000/year** (≈85/month average) — trivially small.
- Brevo **Free**: 300 emails/day — fine for testing; fails on an encode-day burst > 300.
- Brevo **Starter** (≈ $25–30/mo, ~5,000 emails/month, no daily 300 cap — verify current pricing/limits): burst-safe; a full 500-student day fits easily.
- **Strategy (D5):** stay **Free** during testing; switch to **Starter** at rollout. Implement a tiny **send outbox/queue** behind the encode event so the plan switch requires zero rework. Optional free-plan fallback: drip at ≤ 280/day (must respect Brevo's daily reset clock, not local midnight).
- **One email per student per cycle:** the existing `encoded_at` timestamp already guarantees no re-send on re-encode. Send via the **transactional API** (`sib-api-v3-sdk`), not campaigns.

### 8.3 Scope note

D4 requires touching the server email dispatch path (gating the student email to the encode event only) — a deliberate exception to the client-only rule, approved by the owner, and confined to the notification/email wiring. No change to the status state machine, pilot gate, RLS, or Supabase client.

---

## 9. Edge, empty & error states

- **Loading:** skeleton shimmer rows on first open; tracker shows a neutral "loading your enrollment status…".
- **No eligible courses:** proper empty state with the year-filter pills still visible, and copy making clear it's an office data state, not a bug.
- **No active term / `createTerm` failure:** friendly explainer card — *"We couldn't find an open enrollment term for you — contact the COE office."* (Replaces the ambiguous *"No submission for this term yet."* with dead add buttons.)
- **Locked:** a subtle "locked — read-only" hint on the read-only summary; no buttons that error.
- **Rejected:** explanation + contact guidance; presented calmly, not as a wall.

---

## 10. Visual & accessibility constraints

Strictly within the tokens in `AGENTS.md` and `UI_DESIGN.md` (`client/styles/main.css`):

- Flat charcoal surfaces (`#121214` / `#1C1C20` / `#26262C`), coral-orange `#FF5533` accents. **No gradients, glows, or mesh backgrounds anywhere.**
- Journey dots/trackers, badges, and statuses use only the semantic token palette (success `#22C55E`, warning `#F59E0B`, error `#EF4444`).
- Card geometry via `--radius-lg`; inputs via `--radius-md`; pill tracks via `border-radius: 9999px` for segmented filters.
- Motion: restrained `fadeIn` / `slideUp` only; `prefers-reduced-motion: reduce` respected.
- `:focus-visible` orange focus ring; `font-size: 16px` minimum on inputs (no iOS zoom); touch targets ≥ 44px.
- No inline `style=""`, no hardcoded magic colors — all through CSS variables in `main.css`.
- `UI.renderStatusBadge` (existing helper) is used for status chips.

---

## 11. Out of scope

- Server state machine, pilot gate, roster gates, RLS policies, Supabase client queries (`client/js/api.js`) — untouched.
- University registrar / assessment integration (outside the system by definition).
- Official transcript / enrollment form printing.
- Second-semester window mechanics and term picker (see §7 prerequisite).
- Officer/faculty portal visual redesign (future workstreams).

---

## 12. Verification & QA

- **Playwright GUI flows** (tooling already in the repo): build → submit → returned loop → fix & resubmit → approved (locked, read-only) → SA encodes → completion state; run at mobile (≤ 768px) and desktop widths.
- Assert: add/remove/submit controls never appear in locked states; no raw server error text ever renders; journey step reflects each state.
- **Manual:** email sent **only** on encode (one per student per cycle); bell shows all other transitions; encode-day burst behavior under the current plan (Free: ≤300/day respected; Starter: burst ok).
- Terminology scan: no *evaluation/verification/term* drift, no "Load Verification" remnants in student-facing copy.
- Contrast/keyboard spot checks on the new tracker and action panel.
- Run `node check_txs.js` before any push, per `AGENTS.md`.

---

## 13. Rollout prerequisites (separate workstreams)

1. **Term + window contract (server):** provide the active term (school year + semester 1/2) and office-defined enrollment open/close window so the client stops hard-coding Semester 1. Enables D6 two-mode availability.
2. **Brevo Starter switch** at rollout (decision gate) — with the send outbox/queue in place, this is a config change, not code.
3. **Notification routing cleanup** (optional): align load-notification click target/category with the new "Enrollment Verification" destination so the unread dot lands on the right entry. Currently server-side (`server/routes/faculty.js:197-207`); to be confirmed as a follow-up if the visual redesign alone is insufficient.
