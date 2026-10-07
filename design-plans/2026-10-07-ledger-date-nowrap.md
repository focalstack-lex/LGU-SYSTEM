# UI Change Plan: Ledger date cell never wraps

## Status

- **Status**: done
- **Audited against**: `3ecb2e8` on `2026-10-07`
- **Surface**: Student portal, Money group, Ledger tab (`#view-transactions`), desktop data table
- **Finding**: "Ledger dates break across two lines on desktop ("Aug 26," over "2026") while the same date string renders on one line in the ledger's own phone card and in the dashboard's transaction rows."
- **Confidence**: high

## The change

Give the date cell of every ledger row a class, `td-date`, and add one rule to `client/styles/main.css` beside the `.data-table td` owner: `.data-table .td-date { white-space: nowrap; }`. The date string itself (`UI.dateStr`, "Aug 26, 2026") does not change. No font, size or color change.

## Why

- **Contract**: internal contradiction within one task. The same formatted date renders on one line in the ledger phone card (`client/js/transactions.js:122`) and in the dashboard transaction rows (`client/js/dashboard.js:294`), and on two lines in the desktop ledger table. Header cells of the same table already carry `white-space: nowrap` (`client/styles/main.css:3295`).
- **Runtime**: the row template at `client/js/transactions.js:98` emits a bare `<td>` for the date. `.data-table td` (`client/styles/main.css:3299-3305`) sets no `white-space`, so the auto table layout wraps the first column when the Description column needs width.
- **Consequence today**: at 1366px the first rows read "Aug 26," over "2026" (see `reports/ui-verification/2026-10-06-nav-consolidation/desktop-student-money-ledger.png`).

## Reuse, do not invent

| Need | Reuse this | Location | Note |
| --- | --- | --- | --- |
| nowrap convention for table text | `.data-table th` rule | `client/styles/main.css:3287-3297` | same declaration, same table |

`.tx-date` was considered and rejected: it carries a `0.75rem !important` size override (`client/styles/main.css:9388-9395`) and a light-theme color override (`client/styles/main.css:2902-2906`) that would change the desktop cell. A new class is required.

## Files to change

1. `client/js/transactions.js` at line 98: `<td>${UI.dateStr(tx.transaction_date)}</td>` becomes `<td class="td-date">${UI.dateStr(tx.transaction_date)}</td>`.
2. `client/styles/main.css` after line 3305 (end of `.data-table td`): add `.data-table .td-date { white-space: nowrap; }`.
3. `client/index.html` line 20 and line 1718: bump the cache-busters for `main.css` and `transactions.js`.

## Explicitly out of scope

- The amount font conflict between `client/styles/main.css:393-410` and `:2985-2986` (rejected in the audit, product intent undetermined).
- The phone card template, the dashboard rows, the officer portal tables.
- Navigation, tabs, filters and pagination.

## Verification

1. Server up (`npm start`, port 3000), then `node scripts/verify-nav-consolidation.mjs` and `THEME=light node scripts/verify-nav-consolidation.mjs`; evidence in `reports/ui-verification/2026-10-06-nav-consolidation/` and the `-light` folder. Inspect `desktop-student-money-ledger.png`: every date on one line.
2. `node scripts/verify-student-experience.mjs`.
3. `node check_txs.js`.

Report the actual output.

## Documentation to update

- `UI_DESIGN.md` section "Data Tables" (line 303): add "Date cells carry `.td-date` and never wrap."
- `journal/2026-10-07.md`: one line, what changed and how it was verified.

## Risks

- A long Description could now force horizontal scroll inside `.table-wrapper` instead of wrapping the date. `.table-wrapper` already scrolls (`client/styles/main.css:3265-3271`) and Description still wraps, so the row height is unchanged. The desktop screenshot check catches it.

## Rollback

Revert the three files; the change is additive.
