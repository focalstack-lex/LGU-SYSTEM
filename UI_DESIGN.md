# UI Design Reference — COE Budget Transparency & Financial Monitoring System

> A complete reference for the visual design, design tokens, component patterns, and layout rules used across the system. Maintained alongside `client/styles/main.css` and `client/styles/officer.css`.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Color System](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing & Layout Tokens](#4-spacing--layout-tokens)
5. [Shadows & Depth](#5-shadows--depth)
6. [App Shell & Navigation](#6-app-shell--navigation)
7. [Component Library](#7-component-library)
8. [Motion & Animations](#8-motion--animations)
9. [Light Theme](#9-light-theme)
10. [Responsive Breakpoints](#10-responsive-breakpoints)
11. [Mobile Navigation](#11-mobile-navigation)
12. [Executive (Officer) Portal](#12-executive-officer-portal)
13. [Accessibility & Touch](#13-accessibility--touch)
14. [Scrollbar Styling](#14-scrollbar-styling)
15. [File Map](#15-file-map)
16. [Enrollment Verification Architecture](#16-enrollment-verification-architecture)

---

## 1. Design Philosophy

The system follows a **Flat Dark Charcoal & Vibrant Coral-Orange Pill** aesthetic. Inspired by modern high-contrast financial and administrative interfaces, the visual language combines flat dark matte surfaces, rounded card geometry, circular action controls, segmented pill toggles, and solid high-energy coral-orange action accents — strictly **without gradients or radial glow overlays**.

**Core principles:**
- **Flat Solid Surfaces** — Hierarchy is carried by high-contrast matte surfaces (`#121214` base, `#1C1C20` cards, `#26262C` raised controls) and defined 1px structural borders. No gradients, glows, or radial background overlays.
- **High-Energy Action Accent** — `--primary` and `--brand-accent` (`#FF5533`) provide instant visual clarity for CTAs, active pill tabs, active switches, and circular action icons.
- **Modern Pill & Card Geometry** — Segmented control tracks use full rounded pills (`border-radius: 9999px`), while surface cards and modals use rounded 16px corners (`--radius-lg: 16px`).
- **High Contrast Typography** — Headings and monetary metrics use crisp white (`#FFFFFF`) against muted secondary labels (`#9A9AA6`), passing WCAG AAA legibility standards.
- **Restrained Motion** — State changes use swift 0.25s linear/ease transitions without spring bounce.

---

## 2. Color System

### Dark System (Default — `:root` / `[data-theme="dark"]`)

| Token | Value | Usage |
|---|---|---|
| `--background` | `#121214` | Deep matte charcoal app shell & page background |
| `--surface` | `#1C1C20` | Flat dark card surface, sidebar, modals |
| `--surface-secondary` | `#26262C` | Input fields, raised control tracks, sub-cards |
| `--surface-hover` | `#303038` | Interactive hover states |
| `--border` | `rgba(255,255,255,0.08)` | Crisp 1px structural dividers |
| `--border-hover` | `rgba(255,255,255,0.16)` | Borders on hover |
| `--primary` | `#FF5533` | Solid Vibrant Coral-Orange — action CTAs, active pills, links |
| `--primary-hover` | `#FF6B4A` | Hover state of primary CTA |
| `--primary-active` | `#E04826` | Pressed/active state of primary CTA |
| `--brand-accent` | `#FF5533` | Vibrant Coral-Orange brand identity accent |
| `--text-primary` | `#FFFFFF` | Crisp headings, primary metric amounts |
| `--text-secondary` | `#9A9AA6` | Sub-labels, tab text, metadata |
| `--text-tertiary` | `#6E6E7A` | Placeholders, disabled hints |
| `--success` | `#22C55E` | Income, collection, positive balance |
| `--warning` | `#F59E0B` | Over-budget alerts |
| `--error` | `#EF4444` | Expenses, destructive actions |

### Light Theme (`[data-theme="light"]`)

Flat paper slate surfaces with solid coral-orange action accents:

| Token | Value |
|---|---|
| `--background` | `#F4F5F7` |
| `--surface` | `#FFFFFF` |
| `--surface-secondary` | `#EAECEF` |
| `--border` | `#D5DBE2` |
| `--primary / --brand-accent` | `#FF5533` |
| `--text-primary / --text-secondary` | `#121417 / #4E5766` |
| `--success / --warning / --error` | `#16A34A / #D97706 / #DC2626` |

### Semantic Aliases

| Alias | Resolves To | Context |
|---|---|---|
| `--accent` | `--primary` | Coral-orange in action elements |
| `--accent-muted` | `rgba(255, 85, 51, 0.12)` | Subtle coral-orange tint backgrounds |
| `--status-positive` | `--success` | Income / collections |
| `--status-negative` | `--error` | Expenses |
| `--status-warning` | `--warning` | Over-budget alerts |
| `--status-neutral` | `--text-secondary` | Allocations, transfers |

---

## 3. Typography

### Font Stack

| Token | Font | Usage |
|---|---|---|
| `--font-ui` | `Inter`, system fallbacks | All UI text, navigation, headings, labels |
| `--font-proxima` | `Public Sans` | Currency figures, KPI values, unit counts |
| `--font-data` | `JetBrains Mono` → `SF Mono` → `Consolas` | IDs, codes, monospaced data cells |

> **Why Public Sans?** It is the open-licensed typeface designed for the U.S. federal design system (USWDS): sober, institutional, with excellent tabular numerals. It replaced Proxima Nova, which requires a paid license for institutional deployment.

### Type Scale

| Token | px equivalent | Used for |
|---|---|---|
| `--font-size-display` | `clamp(26px, 2.5vw, 31px)` | Hero headings (auth screen) |
| `--font-size-page-title` | `30px` | View/page `<h1>` |
| `--font-size-section` | `17px` | Section `<h3>` headings |
| `--font-size-kpi-value` | `25px` | Stat card amounts |
| `--font-size-kpi-label` | `11px` | Stat card labels (uppercase) |
| `--font-size-body` | `14px` | Body text |
| `--font-size-body-sm` | `13px` | Secondary body / metadata |
| `--font-size-metadata` | `12px` | Timestamps, footnotes |
| `--font-size-badge` | `11.5px` | Status badges |

### Heading Rules

```
h1 — 30px, weight 700, tracking -0.02em
h2 — 24px, weight 700, tracking -0.02em
h3 — 17px, weight 600, tracking -0.01em
h4 — 15px, weight 600
```

### Tabular Figures

All financial amounts use `font-variant-numeric: tabular-nums; font-feature-settings: "tnum"` globally on:
- `.stat-value`, `.tx-amount`, `.metric-value`, `.financial-amount`
- `.units-pct-badge`, `.fee-amount`
- Data table columns 4 & 5

---

## 4. Spacing & Layout Tokens

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `6px` | Buttons, inputs, chips |
| `--radius-md` | `8px` | Cards, dropdowns |
| `--radius-lg` | `12px` | Modals, receipt cards |
| `--sidebar-w` | `252px` | Left sidebar fixed width |
| `--transition` | `0.25s ease` | Default state transitions |

### Layout Grid

**Desktop (> 768px):**
- Shell: `display: flex` — sidebar + scrollable main content side-by-side
- Dashboard: `grid-template-columns: 1.6fr 1fr; gap: 1.25rem`
- KPI Stats: `repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem`

**Mobile (≤ 768px):**
- Sidebar hidden; replaced by bottom nav
- Dashboard grid → single column
- Stats grid → 2-column `minmax(140px, 1fr)`

---

## 5. Shadows & Depth

| Token | Value | Usage |
|---|---|---|
| `--shadow-card` | `0 1px 3px rgba(0,0,0,0.3), inset highlight` | Card resting state |
| `--shadow-card-hover` | `0 4px 14px -2px rgba(0,0,0,0.42), inset highlight` | Card on hover |
| `--shadow-popover` | `0 8px 24px -4px rgba(0,0,0,0.5), inset highlight` | Dropdowns, stat popovers |
| `--shadow-modal` | `0 20px 48px -6px rgba(0,0,0,0.65), inset highlight` | Modals |

The `inset 0 1px 0 rgba(255,255,255,N)` highlight simulates a top-edge light reflection for tactile depth without glassmorphism.

---

## 6. App Shell & Navigation

### Desktop Shell

```
+--------------------------------------------------+
| Sidebar (252px fixed)  |  .main-content (flex:1) |
|  Logo / Brand          |  .view-header (sticky)   |
|  .nav-item x N         |  .stats-grid             |
|  (active: orange left  |  .dashboard-grid         |
|   3px indicator)       |  .data-table             |
|  Sidebar Footer        |                          |
+--------------------------------------------------+
```

- **Nav item active:** `background: var(--bg-surface-raised)`, left `3px solid var(--accent)` via `::before`, weight 600
- **Nav item hover:** `background: var(--surface-hover)`, `color: var(--text-primary)`

### Mobile Shell (≤ 768px)

Sidebar replaced by:
- Sticky top header (`.app-mobile-header`) — brand name + action buttons
- Fixed bottom navigation bar (`.bottom-nav`) — 4 tabs with icons + labels

---

## 7. Component Library

### Buttons

#### `.btn-primary` — Primary Action
- Background: `var(--primary)` (institutional navy), flat — no gradient
- Shadow: none
- Hover: `var(--primary-hover)` background, no transform
- Active: `var(--primary-active)` background
- Font: weight `600`, `letter-spacing: 0.01em`

#### `.btn-secondary` / `.btn-ghost` — Secondary Action
- Background: `var(--surface-secondary)`
- Border: `1px solid var(--border)`
- Hover: `var(--surface-hover)`, lighter border

#### Shared Button Rules
- Padding: `0.65rem 1.4rem` | Radius: `6px` | Font: `0.9rem` weight `600`
- Active: `scale(0.98)` on `.btn`, `.nav-item`, `.bottom-nav-item`, `.admin-tab-btn`
- Disabled: `opacity: 0.6`, `cursor: not-allowed`, no transform

---

### KPI / Stat Cards

```
+--------------------------------------+
| [Icon Box]  LABEL                    |
|             P 0.00                   |  <- tabular Proxima Nova
|             Sub-label / breakdown    |
+--------------------------------------+
```

- Background: `var(--bg-surface)` | Border: `1px solid var(--border-default)` | Radius: `8px`
- Hover: `translateY(-1.5px)`, brighter shadow | Active: `scale(0.99)`
- **Icon box** (32x32): `var(--bg-surface-raised)` background, tints on hover by card type:
  - `.stat-income` → green | `.stat-expense` → red | `.stat-balance` / `.stat-donations` → orange
- **Popover** (hover/long-press): floating breakdown card anchored to stat card with animated arrow action link

---

### Dashboard Cards

Two-column grid (`1.6fr 1fr`): Recent Transactions (wider) + Quick Summary (narrower).

- Background: `var(--bg-surface)` | Padding: `1.35rem 1.5rem` | Shadow: `var(--shadow-card)`

---

### Status Badges

```html
<span class="status-badge">
  <span class="status-dot status-dot--income"></span>
  <span class="status-label">Income</span>
</span>
```

Dot color map:

| Class | Color | Meaning |
|---|---|---|
| `status-dot--income/collection/donation/ongoing/officer` | Orange | Positive/active |
| `status-dot--expense/cancelled` | Red | Negative/cancelled |
| `status-dot--allocation/transfer/upcoming/completed` | Gray | Neutral |

---

### Transaction Items

```
[Status dot + type]  Description              P amount
                     Event name · timestamp
```

Amount classes: `.expense` → red | `.income/.collection/.donation/.allocation` → green | `.transfer` → neutral.

Amount font: JetBrains Mono, weight 700, `letter-spacing: -0.02em`, tabular nums.

---

### Data Tables

- `border-collapse: collapse`, full-width
- Header: uppercase, `letter-spacing: 0.06em`, `font-size: 11px`
- Row hover: `var(--surface-hover)` | Mobile: horizontally scrollable in `.table-wrapper`

---

### Modals & Overlays

Three-layer stack pattern:

```
.modal-overlay  <- full-screen dimmed backdrop (z: 9990+)
  .modal-card   <- centered content card
    header      <- title + close button
    body        <- scrollable content
    footer      <- optional action row
```

- Backdrop: `position: fixed; inset: 0`, `background: rgba(0,0,0,0.75)`, `backdrop-filter: blur(6px)`
- Card: `max-height: calc(100dvh - 2rem)`, `overflow-y: auto`, radius `12px`
- Entry: `modalIn` (scale + fade, 0.25s spring) | Exit: `modalOut`
- **Scroll lock:** `body.modal-open` → `overflow: hidden; touch-action: none`
- **Escape key** dismisses all modals globally

Modal z-index hierarchy:

| Modal | z-index |
|---|---|
| Units log/edit | 9990 |
| Profile modal | 9998–9999 |
| Event detail sheet | 10000 |
| Roster modal | 10100 |
| Receipt viewer | 10600 |

---

### Form Controls

- `font-size: 16px` minimum (prevents iOS zoom on focus)
- Background: `var(--bg-surface-raised)` | Border: `1px solid var(--border-default)` | Radius: `6px`
- Focus ring: `2px solid var(--accent)`, `outline-offset: 2px` + `0 0 0 3px rgba(255,94,20,0.15)` glow
- Label: `0.68rem`, uppercase, weight `700`, `var(--text-secondary)`

---

### Custom Dropdowns (`.dd`)

JS-driven `<div>` replacement for `<select>`:

```
.dd                 <- wrapper (position: relative)
  .dd-trigger       <- button showing current value
    .dd-label       <- truncated selected text
    .dd-chevron     <- rotates 180° when open
  .dd-menu          <- absolutely positioned list (max 180px)
    .dd-option x N
```

- Open state: `.dd.dd-open` | Animation: opacity + scale + translateY
- Mobile: viewport-edge clamped to never clip off-screen
- Touch: `touchstart` outside dismisses immediately

---

### Notifications & Toasts

- Float bottom-right (desktop) / bottom-center (mobile)
- Left accent bar: 4px colored by type (green/red/orange)
- Entry: slide up + fade | Auto-dismiss with configurable timeout
- Bell badge: `pulseNotifBadge` keyframe (scale + opacity pulse) on new arrivals

---

### Receipt Viewer

Full-screen modal for financial receipt images:

```
.receipt-viewer-overlay  <- z: 10600, blur backdrop
  .receipt-viewer-card   <- max 760px wide, 92dvh tall
    header
    .receipt-viewer-stage  <- image/PDF display
    footer (download, verify)
```

- Desktop: `92dvh` | Mobile: `90dvh`, max-width `440px`
- Entry: `receiptModalIn` (spring) | Exit: `receiptModalOut`

---

### Profile Modal

Two-tab account settings modal (`General` and `Security`):

- z-index: 9998/9999 | Width: `520px`, `max-width: 94vw`
- Body: `max-height: calc(94vh - 150px)`, `overflow-y: auto`
- Entry: `modalScaleUp` (scale from 96% + fade)
- `modal-open` scroll lock on open/close

---

## 8. Motion & Animations

> All animations are disabled when `prefers-reduced-motion: reduce` is set.

| Keyframe | Duration | Easing | Used for |
|---|---|---|---|
| `fadeIn` | 0.3s | ease | View entry, tab content, overlays |
| `brandTextIn` | 0.7s | `cubic-bezier(0.22,1,0.36,1)` | Auth headline cascade |
| `authFormIn` | 0.45s | spring | Auth card entry |
| `authFieldIn` | 0.35s | spring | Auth input cascade |
| `modalIn` | 0.25s | `cubic-bezier(0.16,1,0.3,1)` | Modal card entry |
| `modalScaleUp` | 0.25s | `cubic-bezier(0.16,1,0.3,1)` | Profile modal entry |
| `shimmer` | 1.5s ∞ | ease-in-out | Skeleton loading |
| `slideUp` | 0.3s | ease | Sheet / bottom panel |
| `sheetSectionCascade` | 0.4s | spring | More-sheet items stagger |
| `receiptModalIn` | 0.22s | `cubic-bezier(0.16,1,0.3,1)` | Receipt card entry |
| `pulseNotifBadge` | 1.4s ∞ | ease | Notification bell pulse |

**Micro-interactions:**
- Hover states change background and border color only — no translateY lifts, no glow
- Dropdown chevron: `rotate(180deg)` on open
- Stat popover arrow: `translateX(3px)` on hover
- Spring/bounce easing has been removed system-wide (ease/ease-out only)

---

## 9. Light Theme

Toggled via `data-theme="light"` on `<html>`.

| Token | Light Value |
|---|---|
| `--background` | `#F8FAFC` (slate-50) |
| `--surface` | `#FFFFFF` |
| `--surface-secondary` | `#F1F5F9` (slate-100) |
| `--surface-hover` | `#E2E8F0` (slate-200) |
| `--border` | `#E2E8F0` |
| `--text-primary` | `#0F172A` (slate-900) |
| `--text-secondary` | `#475569` (slate-600) |
| `--primary` | `#FF5E14` (same orange) |
| `--success` | `#16A34A` (green-600) |
| `--warning` | `#D97706` (amber-600) |
| `--error` | `#DC2626` (red-600) |

Shadows are re-tuned for light surfaces. Auth screen is excluded — always dark.

---

## 10. Responsive Breakpoints

| Breakpoint | Zone | Key changes |
|---|---|---|
| `≤ 1024px` | Tablet | Sidebar narrower, some columns collapse |
| `≤ 768px` | Mobile | Sidebar hidden → bottom nav, single-column grid |
| `≤ 640px` | Small mobile | Auth card full-width, reduced padding |
| `≤ 600px` | Compact | Smaller auth form controls |
| `≤ 480px` | Extra-small | 2-col stats grid, further padding reduction |
| `≥ 1024px` | Desktop only | Bottom nav hidden, full sidebar |

**Mobile-specific overrides (≤ 768px):**
- `.main-content`: `height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch`
- `.view`: `padding: 0 0.75rem`
- `.view-header`: `position: static` (de-stickied)
- `.main-content`: `padding-bottom: calc(96px + env(safe-area-inset-bottom))`

---

## 11. Mobile Navigation

### Bottom Nav (`.bottom-nav`)
- Fixed bottom bar, 4 tabs, icon + label
- Active: orange icon + label, `2px solid var(--accent)` top border
- Height: ~56px + safe-area inset

### More Sheet (`.more-sheet`)
- Slides up above bottom nav via `slideUp`
- Drag handle at top — **swipe-down ≥50px to dismiss**
- Escape key closes it
- Items animate with staggered `sheetSectionCascade`

### Safe Area Insets
- `viewport-fit=cover` on both `index.html` and `officer.html`
- `env(safe-area-inset-*)` applied to:
  - `.app-mobile-header` / `.of-mobile-header` padding
  - Bottom nav padding-bottom
  - `.main-content` / `.of-main` padding-bottom

---

## 12. Executive (Officer) Portal

Defined in `client/styles/officer.css`. Extends main.css tokens with portal-specific layout.

### Shell

```
+------------------------------------------+
| .of-sidebar (252px) | .of-main (flex: 1) |
|   .of-nav           | .of-view x N       |
+------------------------------------------+
```

- `.of-shell`: `display: flex; height: 100dvh; overflow: hidden`
- `.of-main`: `flex: 1; overflow-y: auto; overflow-x: hidden`

### Mobile Officer Shell
- Same bottom-nav pattern (`#of-bottom-nav`)
- `#of-more-sheet` with same drag-to-dismiss behavior

### Officer-Only Modals

| Component | z-index | Description |
|---|---|---|
| Event detail sheet | 10000 | Full-height slide-up event breakdown |
| Roster modal | 10100 | Student enrollment + add/edit/import |

---

## 13. Accessibility & Touch

| Rule | Effect |
|---|---|
| `*, *::before, *::after { -webkit-tap-highlight-color: transparent }` | No grey tap flash |
| `button, a, input, .btn, .stat-card, .nav-item { touch-action: manipulation }` | No 300ms iOS delay |
| `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` | Orange keyboard focus ring |
| `input, select, textarea { font-size: 16px }` | No iOS auto-zoom |
| `body.modal-open { overflow: hidden; touch-action: none }` | Scroll lock behind modals |
| Global `Escape` handlers | All modals/sheets dismiss on Escape |

---

## 14. Scrollbar Styling

Applied globally:

- Width: `5px` (WebKit) / `thin` (Firefox)
- Thumb dark: `rgba(255,255,255,0.16)` → hover `rgba(255,255,255,0.32)`
- Thumb light: `rgba(15,23,42,0.18)` → hover `rgba(15,23,42,0.35)`
- Track: `transparent` | Buttons: hidden | Corner: `transparent`

Horizontal scroll containers (`.table-wrapper`, `.events-filter-bar`, tab bars) use `overscroll-behavior-x: contain`.

---

## 15. File Map

| File | Purpose |
|---|---|
| `client/styles/main.css` | Master design system — tokens, resets, all student portal components |
| `client/styles/officer.css` | Executive portal shell, layout overrides, officer-specific modals |
| `client/styles/ai.css` | AI assistant panel styles |
| `client/index.html` | Student portal HTML |
| `client/officer.html` | Officer portal HTML |
| `client/js/app.js` | Student portal JS — modal lifecycle, animations, scroll locks |
| `client/js/officer/officer-app.js` | Officer portal JS — modal lifecycle, scroll locks, sheet gestures |
| `client/js/dropdown.js` | Custom `.dd` dropdown — positioning, touch dismissal |
| `client/js/profile.js` | Profile modal open/close/populate logic |
| `client/js/units.js` | Units checklist modal and log/edit action buttons |
| `client/js/receipt-capture.js` | Receipt viewer modal render and dismiss |

---

## 16. Enrollment Verification Architecture

Added in Phase B/C (September 2026). Strictly adheres to flat matte charcoal UI principles, zero decorative AI slop, and real-time Supabase sync across student and program head portals.

### Visual & Component Standards
- **Flat Matte Containers**: Status cards (`.ev-done-card`, `.ev-defensive-card`) use flat matte dark slate (`#26262C`) with subtle 1px structural dividers (`rgba(255,255,255,0.08)`).
- **Crisp Left-Border Accents**: Status distinction is conveyed using a solid 4px accent line (`border-left: 4px solid var(--success)` for verified loads; `border-left: 4px solid var(--status-negative)` for locked/defensive loads).
- **Zero Decorative Slop**:
  - No background mesh gradients or translucent tinted card overlays (`rgba(34, 197, 94, 0.08)` replaced with solid matte `#26262C`).
  - No box-shadow glowing rings on step indicators (`.ev-step--current .ev-step-dot`).
  - No colored dot pseudo-elements (`.ev-chip::before` set to `display: none`).
  - No em-dashes (`—`) in UI copy; replaced with colons (`:`), middle dots (`·`), or clean parenthesis.

### Real-Time Synchronization Protocol
- **Student View (`client/js/enrollment.js`)**: Subscribes to Supabase Realtime channel `enrollment-student-realtime` on `enrollment_submissions` and `enrollment_submission_items`. Whenever a Program Head verifies a load or an SA marks it encoded, the student's view updates instantly without manual page refresh.
- **Faculty / Program Head Portal (`client/js/faculty/faculty.js`)**: Subscribes to Supabase Realtime channel `enrollment-faculty-realtime`. Program Head review queue, student list counts, and open evaluation detail modals sync live across active devices.

---

*Last updated: 2026-09-10. Enrollment Verification flat matte redesign and real-time sync architecture on the `redesign` branch (`origin/redesign/ui-enhancement`).*

