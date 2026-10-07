# UI Change Plan: Ledger markup without inline style attributes

## Status

- **Status**: done
- **Audited against**: `3ecb2e8` on `2026-10-07`
- **Surface**: Student portal, Money group, Ledger tab (`#view-transactions`) markup in `client/index.html`
- **Finding**: "The ledger markup carries inline `style` attributes on the pagination bar, its button group, both pager buttons and the Actions header cell, which the binding markup rule forbids."
- **Confidence**: high

## The change

Move the five inline `style` attributes in the ledger section of `client/index.html` into named rules in `client/styles/main.css` with identical declarations, then delete the attributes. Class names: `pagination-bar` (already on the element, currently unstyled), `pagination-bar-controls` (the button group) and `th-center` (the Actions header cell). The pager buttons get their padding from `.pagination-bar .btn`. No visual change.

## Why

- **Contract**: `AGENTS.md:43`: "Do NOT use hardcoded magic color numbers or inline `style="..."` attributes in HTML files. Always reference CSS variables."
- **Runtime**: `client/index.html:527` (Actions `th`) and `client/index.html:535-539` (pagination bar, button group, two buttons) are the only owners of that layout. `.pagination-bar` appears in no stylesheet except the phone `min-height: 40px` rule at `client/styles/main.css:9408-9411`.
- **Consequence today**: the layout renders correctly but through attributes the contract forbids; the Pass C cleanup (journal 2026-10-06, 17:37) left these for a later pass.

## Reuse, do not invent

| Need | Reuse this | Location | Note |
| --- | --- | --- | --- |
| home for shared utility rules | the Pass C utilities block | `client/styles/main.css:9503-9515` | append the new rules there |
| phone touch target on pager buttons | `.pagination-bar .btn { min-height: 40px }` | `client/styles/main.css:9408-9411` | already present, keep |

## Files to change

1. `client/styles/main.css` after line 9515: append
   `.pagination-bar { display: flex; justify-content: space-between; align-items: center; padding: 1rem 0; margin-top: 0.5rem; flex-wrap: wrap; gap: 0.5rem; }`
   `.pagination-bar-controls { display: flex; gap: 0.5rem; }`
   `.pagination-bar .btn { padding: 0.4rem 0.8rem; }`
   `.th-center { text-align: center; }`
2. `client/index.html` line 527: `<th class="admin-only" style="text-align:center;">` becomes `<th class="admin-only th-center">`.
3. `client/index.html` line 535: remove the `style` attribute from `#tx-pagination`.
4. `client/index.html` line 537: `<div style="display:flex;gap:0.5rem;">` becomes `<div class="pagination-bar-controls">`.
5. `client/index.html` lines 538-539: remove the `style` attribute from `#tx-prev-btn` and `#tx-next-btn`.
6. `client/index.html` line 20: bump the `main.css` cache-buster.

## Explicitly out of scope

- Inline styles inside JS templates (`client/js/transactions.js`); the contract names HTML files.
- The other `style=` attributes in `client/index.html` (skeleton bones and other views) and all of `officer.html`.
- The Grizz launcher position and the pager overlap on short pages (no single supported correction).

## Verification

1. Server up (`npm start`, port 3000), then `node scripts/verify-nav-consolidation.mjs` and `THEME=light node scripts/verify-nav-consolidation.mjs`; compare `desktop-student-money-ledger.png` against the 2026-10-06 run: pager at the same place, buttons the same size.
2. `node scripts/verify-student-experience.mjs`.
3. `node check_txs.js`.
4. A grep for `style=` between `tx-pagination` and `tx-next-btn` in `client/index.html` returns nothing.

Report the actual output.

## Documentation to update

- `journal/2026-10-07.md`: one line, what changed and how it was verified.

## Risks

- Specificity: `.pagination-bar .btn` padding must win over `.btn` (`client/styles/main.css:1448`); it does, two class selectors against one. The phone rule at 9408 still adds min-height.

## Rollback

Revert the two files; the change is additive.
