# UI/UX Audit: COE Student Portal (2026-09-28)

Stack: vanilla HTML/JS client (`client/`) served by Express (`server/index.js`), Supabase auth and data, no framework, hand-written CSS tokens in `client/styles/main.css`.

Method: the server was run locally (`npm start`, port 3000). Unauthenticated surfaces were checked live in a browser at desktop and at 375x812. Auth goes to the hosted Supabase project, so no sign-in was attempted. Authenticated journeys were audited from source, and the top findings were checked again by hand.

## Journey 0: First visit and sign in (live)

Goal: a student understands the portal and signs in.

Works: the purpose is clear within 5 seconds from the hero and the "Sign in" heading. Labels are linked (`index.html:73,79`). Inputs are 16px on mobile, so iOS does not zoom. The button disables while signing in (`app.js:32-33`). The focus ring on Sign In is visible. There is no horizontal overflow at 375px.

Breaks:
| Sev | Effort | Where | Finding | Fix |
|---|---|---|---|---|
| P1 | S | `app.js:46` | Raw Supabase messages reach users, for example "Email not confirmed" or "Invalid login credentials" | Map known codes to plain sentences; fall back to "Email or password is incorrect." |
| P1 | S | `index.html:88` | `#login-error` has no `role="alert"`, so the empty-submit error is not announced | Add `role="alert"` to every `.auth-error` |
| P2 | S | `index.html:52-92`, `app.js:56` | Not a `<form>`. Enter only works in the password field, and there is no `autocomplete` | Wrap in `<form>`, use a submit button, add `autocomplete="email"` / `"current-password"` |
| P2 | S | `index.html:81` | The `••••••••` placeholder looks like a prefilled password | Remove the placeholder |
| P2 | S | `index.html:85` vs `app.js:44` | The password "Notice" is shown twice (hint and error) in 12px text, and "GSuite" is jargon | Keep a single line: "School account? Use Continue with CJC Google Account." |
| P2 | M | mobile 375x812 | The page is 942px tall; the hero pushes Sign In below the fold | Hide the hero tagline under 480px and shrink the logo |
| P3 | S | login surface | No "Forgot password" path for password accounts | Add a link that calls `resetPasswordForEmail` |

## Journey 0b: Public feedback, CV verify, officer gate (live)

- P1 / S `feedback/index.html:156` and `feedback/view/index.html:61`: Supabase loads from jsdelivr, while the main app uses the vendored `/vendor/supabase.min.js`. In this run the CDN load failed in the browser pane (the CDN answered 200 from the host, so this may be down to the pane's network), and the page became a dead end with a sign-in form that cannot work. Fix: use `/vendor/supabase.min.js`.
- P2 / S `feedback.js:22`, `feedback-view.js:21`: "Supabase failed to load" is developer jargon shown to students. Fix: "Could not connect. Check your internet and refresh." When it shows, disable both sign-in buttons.
- P2 / M `styles/feedback.css:8-16`: a separate palette (`#141414`, accent `#f97316`, blue privacy link) diverges from the tokens (`#121214`, `#FF5533`). `cv-verify.html` is light-themed. Fix: import the tokens from `main.css`.
- Works: `officer.html` without a session shows a clear "Restricted Access" state with a single CTA.

## Journey 1: Student dashboard and transparency (static)

- P1 / S `transactions.js:52-54`: the error goes only to the table body. On mobile, `tx-mobile-cards` keeps the skeleton forever. Fix: write the error and a Retry button into both containers.
- P2 / S `reports.js:486,511`: failures use `alert()`. Fix: `UI.toast(msg,'error')`.
- P2 / M `events.js:127,151`: the `div.event-card` is click-only. Fix: use a `<button>`, or add `role="button" tabindex="0"` with an Enter/Space handler.
- P3 / S `dashboard.js:261,317`: "Failed to load" gives no reason and no retry.

## Journey 2: Enrollment (static)

- P1 / S `enrollment.js:520-532`: `submit()` never disables `#enrollment-submit-btn`, so a double click sends two submits (verified). Fix: disable the button before the `await` and restore it in `finally`.
- P2 / S `enrollment.js:534-540`, `index.html:686`: the error auto-hides after 5 seconds and has no `role="alert"`.
- Works: confirmation states the count and units (`enrollment.js:525`); there is an empty state.

## Journey 3: Profile edit (static)

- P1 / M `profile.js:246-311`: the modal has no initial focus, no Tab trap and no focus return. Fix: reuse the pattern at `receipt-modal.js:236,342`.
- P2 / S `profile.js:510-518`: password errors go to a shared box. Fix: add `aria-invalid` and `aria-describedby` on the field, plus `role="alert"`.
- Works: Save stays disabled until something changes (`profile.js:66`), and Escape closes the modal.

## Journey 4: Officer records a transaction (static)

- P1 / S `officer.html:176-196`: the form labels have no `for=`.
- P1 / S `officer.html:202`: the receipt remove button is `&times;` with no `aria-label`.
- P2 / S `officer-app.js:1055-1059`: only the event field gets an inline error; the others rely on native bubbles that disappear.
- P2 / M: a financial write has no review step. Fix: show a summary modal before `Api.transactions.create`.
- P3 / S: the same action is called "Record Transaction" (`officer.html:207`), "Submit Transaction" (`index.html:842`) and "New Entry" (`officer.html:173`).
- Works: the submit button disables; the success toast is specific and warns when the budget is exceeded.

## Journey 5: Officer delete and void (static)

- P1 / S `transactions.js:313` (verified): `desc` is only quote-escaped at `:97,103,134,140`, then decoded from `dataset` and inserted into `innerHTML`, which is HTML injection. The CSP (`script-src 'self'`, `script-src-attr 'none'`) blocks script execution, but markup injection remains. The same issue is at `events.js:132`. Fix: set the value with `textContent`.
- P1 / S `transactions.js:137,140`: the edit and delete buttons are icon-only with no `aria-label`.
- P1 / M `transactions.js:306-326`: the delete modal has no `role="dialog"`, Escape handling or focus management.
- P2 / S `officer-app.js:2722` `confirm()`, `:2610` `prompt()`, `units.js:751` `confirm()` on a permanent removal. Fix: reuse the custom delete modal.
- Works: the transaction delete requires a reason and disables while it runs.

## Journey 6: Faculty verification (static)

- P1 / S `faculty.js:195,236-237`: the queue row `div.fq-row` is click-only, which is the only way into the flow. Fix: use a `<button>`.
- P1 / S `faculty.js:280-286` (verified): Approve never disables and success gives no toast; `alert()` is used for the "already verified" case.
- P2 / S `faculty.html:62`: the note input has only a placeholder. `faculty.js:43`: the "Something went wrong." fallback gives no context.

## Cross-cutting

| Sev | Effort | Where | Finding | Fix |
|---|---|---|---|---|
| P1 | S | `main.css:21` | White on `#FF5533` is 3.18:1 and fails AA for CTA labels | Use `#121214` text on coral (5.88:1) |
| P1 | S | `main.css:31` | `--text-tertiary #6E6E7A` is 3.38:1 on `#1C1C20` and 2.99:1 on `#26262C`, and is used for real text (51 uses) | Raise it to about `#8A8A96`; keep the old value for placeholders only |
| P1 | S | `main.css:1227,3350,5938,6297,8370` | `outline:none` after the global `:focus-visible` (`:268`) removes keyboard focus | Add a `:focus-visible` outline per rule |
| P1 | S | `officer.html:868`, `faculty.html:95` | The toasts have no live region | `role="status" aria-live="polite"` as in `index.html:1290` |
| P2 | S | `main.css:2660` | A gradient fill, which the design rules forbid | `background: var(--primary)` |
| P2 | L | `index.html` (174), `officer.html` (113) | Inline `style=""` against AGENTS.md 3.2 | Move them into classes gradually |
| P3 | S | `index.html:110,328,692,1031`, `officer.html:571`, `officer-app.js:1796,1804` | Em/en dashes in UI copy | Replace with a hyphen, colon or period |

## Suggested order

1. The injection in the delete modal and events (`transactions.js:313`, `events.js:132`).
2. Double submits in enrollment and faculty approve.
3. Contrast tokens and stripped focus rings.
4. Live regions and `role="alert"` on every error container.
5. Keyboard access to the faculty queue rows and event cards; focus management in the modals.
6. Moving the feedback page to the vendored Supabase build, plus the login copy and form semantics.

## Resolution (2026-09-28)

Security fixes are on `security/hardening`: `6f86725` covers transactions and events, and `4e0c597` covers the admin user table. UI fixes are on `ui/audit-fixes`, which is branched from that commit. Evidence is in `reports/ui-verification/2026-09-28-audit-fixes/`. Rerun with `node scripts/verify-ui-audit-fixes.mjs` (48 checks) and `node scripts/verify-ui-audit-officer.mjs` (14 checks); both need `npm start` running.

Fixed: every item in Journeys 0 to 6 and in the cross-cutting table, except the ones listed below. Four fixes went beyond the findings above:
- The Cancel buttons in the transaction edit and delete modals and the Retry and Sign In buttons on the reports error were inline `onclick` handlers, which the Express CSP (`script-src-attr 'none'`) blocks. They now use listeners.
- `modalIn` animated to `opacity: 0.16` and then snapped to fully opaque. It now ends at 1.
- Modal cards now use `--radius-lg` (16px), as the design rules require.
- Destructive fills now use a new `--danger-fill: #DC2626` token (4.83:1 with white).

Corrected findings:
- Journey 6, faculty queue row: this was a false positive. Each row contains a real "Review" button whose click bubbles up to the row, so keyboard access already worked. The button now has a per-student `aria-label`.
- Journey 5: the injection was wider than reported. Descriptions, event names, officer names and the edit-modal `value` attribute were all raw, and the edit modal truncated any description containing a quote.

Not done, by decision:
- A review step before recording an officer transaction. It would add a click to every entry, and edits and deletes already require an audited reason. Revisit if mis-entries become common.
- Inline `style=""` migration (174 in `index.html`, 113 in `officer.html`). This is effort L; no new inline styles were added in HTML.
- `cv-verify.html` light theme. It is a public, certificate-style page for employers, so the theme looks intentional.
- Native `confirm()` for non-destructive yes/no prompts. They are accessible and working. Only the destructive and reason-required cases moved to `UI.confirmDialog`.

Open, needs a decision or a separate change:
- `feedback/index.html` "Privacy Policy" links to `#privacy`, which does not exist. It needs real policy content.
- The client pilot gate never blocks: `window.isEnrollmentPilot` is `async` (`config.js:42`), and `enrollment.js:38` negates the returned Promise. The server gate (`scripts/smoke-test-pilot-gate.js`) should be confirmed.
- About 29 more `innerHTML` sites in dashboard, reports, income, notifications and the rest of admin.js still interpolate database strings raw. This is queued as a separate security task.
- `docs/CODE_MAP.md` is regenerated on `ui/audit-fixes`, but it is stale on `security/hardening` after the two security commits.
