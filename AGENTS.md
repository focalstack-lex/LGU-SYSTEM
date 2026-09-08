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
