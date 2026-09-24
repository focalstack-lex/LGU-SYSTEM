# AGENTS.md — Collaborator & Agent Guidelines for UI Enhancement

This file defines mandatory instructions for AI coding assistants (Antigravity / Gemini) and human collaborators working on the **College of Engineering LGU System**.

---

## 1. Branch & Git Scope Directives
- **Target Branch:** All UI enhancement work must take place strictly on the `redesign/ui-enhancement` branch (or local `redesign` synced to `origin/redesign/ui-enhancement`).
- **Forbidden Actions:** Never commit or push directly to `main`, `feature/*`, or `testfeature/*` branches.
- **Git Push Syntax:** Use `git push origin redesign:refs/heads/redesign/ui-enhancement` if local branch name is `redesign`.

---

## 2. UI & Design System Rules (Flat Charcoal & Coral-Orange)
All UI modifications MUST strictly obey the project's design system tokens in [`client/styles/main.css`](file:///c:/Users/User/Documents/LGU%20System/client/styles/main.css) and reference doc [`UI_DESIGN.md`](file:///c:/Users/User/Documents/LGU%20System/UI_DESIGN.md):

1. **Strictly NO Gradients:**
   - Do NOT add background mesh gradients, radial glows, or linear gradient overlays to buttons, cards, or page backgrounds. All surfaces must remain flat, solid, high-contrast matte colors.
2. **Color Palette:**
   - **Base App Shell:** Flat dark charcoal `#121214`.
   - **Card & Surface Containers:** Flat matte dark slate `#1C1C20`.
   - **Raised Fields & Sub-cards:** Raised dark surface `#26262C`.
   - **Primary Action CTA & Accents:** Vibrant Solid Coral-Orange `#FF5533` (Hover `#FF6B4A`, Active `#E04826`).
   - **Divider Borders:** Faint 1px structural dividers (`rgba(255, 255, 255, 0.08)`).
3. **Geometry & Pill Controls:**
   - **Segmented Tab Toggles & Action Filters:** Use full rounded pill tracks (`border-radius: 9999px`).
   - **Card & Modal Geometry:** Use 16px rounded corners (`--radius-lg: 16px`).
   - **Input Controls:** Use 12px rounded corners (`--radius-md: 12px`).
4. **Typography & Contrast:**
   - Headings, page titles, and monetary figures must be crisp `#FFFFFF`.
   - Secondary labels `#9A9AA6`; hints/metadata `#6E6E7A`.
   - Financial amounts must retain tabular numbers (`font-variant-numeric: tabular-nums`).

---

## 3. Preserving System Integrity & Code Safety
1. **API & Database Protection:**
   - Do NOT alter Supabase client queries (`client/js/api.js`), backend routing, or database table schemas. UI enhancements must be strictly visual and layout-focused.
2. **Centralized CSS Tokens:**
   - Do NOT use hardcoded magic color numbers or inline `style="..."` attributes in HTML files. Always reference CSS variables (`var(--primary)`, `var(--surface)`, `var(--radius-lg)`).
3. **No Destructive Refactoring:**
   - Do NOT comment out or delete existing event listeners, modal lifecycle hooks, or validation logic in `client/js/app.js`, `client/js/officer/officer-app.js`, or `client/js/ui.js`.
4. **Verification Before Push:**
   - Always test functionality and run `node check_txs.js` before committing/pushing changes.

---

## 4. Security Hardening Directive (mandatory)

- **Canonical spec:** [`docs/SECURITY_HARDENING.md`](file:///c:/Users/User/Documents/LGU%20System/docs/SECURITY_HARDENING.md) is the single authoritative work order for security hardening (findings, required changes, acceptance criteria, verification commands, and prohibited actions). Read it in full before making any security-related change. Do not reconstruct it from memory and do not substitute a generic checklist for it.
- **Scope clarification:** Section 3.1 above forbids altering Supabase client queries, backend routing, and database schemas during **UI enhancement** work. Security hardening is a separate, explicitly authorized workstream: it may modify `server/`, `supabase/migrations/`, and security-relevant client configuration, but only where the spec directs, one finding per change set.
- **Branch policy:** Security work must NOT run on `redesign/ui-enhancement`. Use a dedicated branch (for example `security/hardening-<finding-id>`) and never commit directly to `main`, per Section 1.
- **Non-negotiable rules**, overriding convenience: never print, log, or commit a secret; never weaken a control (RLS, rate limits, CORS, CSP) to make something pass; run write or account-creation tests against staging only; journal every change in `journal/YYYY-MM-DD.md`.
- **Verification:** a finding is complete only with real command output pasted into the report. Section 7 of the spec holds the shell commands and the SQL invariant queries.

---
