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

---

## 1. Design Philosophy

The system follows a **light-first, institutional minimalist** aesthetic. The visual language is modeled on official government and academic publications — calm paper surfaces, defined 1px structure, a sober navy action color — while retaining the College of Engineering's orange strictly as an identity accent.

**Core principles:**
- **Structure over decoration** — Hierarchy is carried by 1px borders, spacing, and typographic weight. No glows, no gradients on controls, no hover-lift theatrics.
- **Light default, dark opt-in** — `:root` is the light institutional theme; `[data-theme="dark"]` retains a graphite variant for users who prefer it.
- **Institutional navy actions** — `--primary` (#1F3A5F) is used for buttons, links, focus rings, and active states. It passes WCAG AA against white text.
- **Engineering orange is identity, not action** — `--brand-accent` (#B23A0A light / #ED7D33 dark) appears only on the logo context, unread/live indicator dots, and official marks.
- **Color carries meaning** — Green = income/positive, Red = expense/negative, Navy = action, Neutral gray = transfers/allocation.
- **Motion is restrained** — Animations are ≤ 0.45 s, ease/ease-out only (no spring bounce), and are disabled for `prefers-reduced-motion` users.

---

## 2. Color System

### Light Mode (Default — `:root`)

| Token | Value | Usage |
|---|---|---|
| `--background` | `#F5F6F8` | Paper-gray app shell, page backgrounds |
| `--surface` | `#FFFFFF` | Sidebar, cards, modals |
| `--surface-secondary` | `#EEF1F4` | Input fields, raised surfaces |
| `--surface-hover` | `#E4E8EC` | Hover states |
| `--border` | `#D5DBE2` | Defined 1px structural borders |
| `--border-hover` | `#B9C2CC` | Borders on hover |
| `--primary` | `#1F3A5F` | Institutional navy — action/active/links |
| `--primary-hover` | `#2A4A73` | Hover state of primary |
| `--primary-active` | `#152C48` | Pressed/active state |
| `--brand-accent` | `#B23A0A` | Engineering orange — identity accents only |
| `--text-primary` | `#17202B` | Headings, primary body text |
| `--text-secondary` | `#4E5D6E` | Sub-labels, metadata |
| `--text-tertiary` | `#78859A` | Placeholders, disabled hints |
| `--success` | `#17703B` | Income, collection, donations |
| `--warning` | `#B45309` | Over-budget alerts |
| `--error` | `#B42318` | Expenses, destructive actions |

### Dark Mode (opt-in — `[data-theme="dark"]`)

Retains the graphite palette with institutional actions:

| Token | Value |
|---|---|
| `--background` | `#090D14` |
| `--surface` | `#0E1520` |
| `--surface-secondary` | `#131B27` |
| `--border` | `rgba(255,255,255,0.08)` |
| `--primary` | `#3E6393` (hover `#4E77AC`, active `#32517D`) |
| `--brand-accent` | `#ED7D33` |
| `--text-primary` | `#F1F5F9` |
| `--success / --warning / --error` | `#22C55E / #F59E0B / #EF4444` |

### Semantic Aliases

| Alias | Resolves To | Context |
|---|---|---|
| `--accent` | `--primary` | Navy in action elements |
| `--accent-muted` | navy/steel tint | Subtle action tint backgrounds |
| `--status-positive` | `--success` | Income / donations |
| `--status-negative` | `--error` | Expenses |
| `--status-warning` | `--warning` | Over-budget |
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

*Last updated: 2026-09-03. Institutional minimalist redesign on the `redesign` branch — light-first tokens, navy action color, flattened depth and motion.*
