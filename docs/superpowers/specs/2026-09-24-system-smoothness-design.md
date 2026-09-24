# System Smoothness and Fluidity Architecture Specification

**Date:** 2026-09-24  
**Author:** Senior Lead Engineer  
**Status:** Approved for Implementation Planning  
**Target:** College of Engineering LGU System (Student, Officer, Faculty Portals)

---

## 1. Objective and Scope

This specification defines the complete end-to-end architecture to elevate the LGU System to native-grade smoothness, 60fps to 120fps rendering, instantaneous view switching, and tactile physical feedback across all device viewports.

### Core Goals
1. **Zero View Jank:** Eliminate abrupt `display: none / block` pop-ins by implementing GPU-accelerated micro-transitions and skeleton cross-fading.
2. **Instant Navigation (SWR Cache):** Provide 0ms perceived latency when switching between navigation tabs via Stale-While-Revalidate in-memory data caching.
3. **High-Performance Scroll Pipeline:** Prevent frame drops on long ledger datasets and feeds using CSS `content-visibility: auto` and layout containment.
4. **Tactile Spring Physics:** Add instant physical micro-feedback (`scale(0.98)`) and calibrated cubic-bezier deceleration curves to all interactive controls.
5. **Zero Layout Shifts:** Prevent scrollbar jumping when opening dialogs, bottom sheets, or drawer overlays.

---

## 2. Technical Architecture by Phase

### Phase 1: CSS Animation and GPU Rendering Engine

#### 1.1 Hardware-Accelerated View Transitions
- Target: `client/styles/main.css`, `client/styles/officer.css`
- Apply GPU-accelerated micro-entry to active views:
  ```css
  .view {
    display: none;
    opacity: 0;
    transform: translate3d(0, 4px, 0);
    will-change: opacity, transform;
  }
  .view.active {
    display: block;
    animation: viewEnterMicro 140ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  @keyframes viewEnterMicro {
    0% {
      opacity: 0;
      transform: translate3d(0, 4px, 0);
    }
    100% {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }
  }
  ```

#### 1.2 Tactile Press Feedback & Mobile Tap-Lag Elimination
- Eliminate the 300ms mobile browser double-tap delay by setting `touch-action: manipulation` across all interactive elements (`button`, `.btn`, `.nav-item`, `.tab-pill`, `.data-card`, `.dropdown-item`).
- Implement spring active state:
  ```css
  button:active,
  .btn:active,
  .tab-pill:active,
  .nav-item:active {
    transform: scale(0.98);
    transition: transform 80ms cubic-bezier(0.16, 1, 0.3, 1);
  }
  ```

#### 1.3 List Virtualization via CSS Content Visibility
- On large list containers (`.tx-list`, `.mobile-cards-container`, `.announcement-list`, `.of-table tbody tr`), apply:
  ```css
  .data-card,
  .announce-item,
  .of-table tbody tr {
    content-visibility: auto;
    contain-intrinsic-size: auto 64px;
  }
  ```
- This skips off-screen layout and paint until the user scrolls near them, reducing DOM calculation time by up to 80% on long financial ledgers.

#### 1.4 Smooth Skeleton Dismissal Cross-Fade
- Update `.skeleton-overlay` and `#skeleton-overlay`:
  ```css
  .skeleton-overlay {
    transition: opacity 180ms ease, visibility 180ms ease;
  }
  .skeleton-overlay.hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
  }
  ```

---

### Phase 2: Client-Side SWR In-Memory Caching & Instant Navigation

#### 2.1 In-Memory SWR Cache Manager
- Target: `client/js/swr-cache.js` (or integrated into client state utilities)
- Structure:
  - Cache store: `Map<string, { data: any, timestamp: number, ttl: number }>`
  - API method: `swrFetch(key, fetcherFn, options = { ttl: 45000, forceRefresh: false })`
  - Flow:
    1. If cached entry exists and is fresh (< TTL): return cached data immediately (0ms).
    2. If cached entry exists but is stale (> TTL): return cached data immediately to populate UI, then asynchronously invoke `fetcherFn()`. If new data differs from cached data, update cache and trigger UI callback.
    3. If no cached entry: show shimmer/skeleton, await `fetcherFn()`, cache result, and render.

#### 2.2 Scroll Position Retention
- Store scroll offsets in a session map `viewScrollMap.set(activeViewId, container.scrollTop)`.
- When switching tabs, restore `container.scrollTop` synchronously before frame paint.

#### 2.3 Debounced Search & Instant Filtering
- Add a 150ms debouncer for transaction ledger search, officer student directory search, and curriculum lookup.
- Perform local in-memory array filtering on the cached records rather than dispatching a network call per keystroke.

---

### Phase 3: Dialogs, Modals, Scrims & Scrollbar Shift Prevention

#### 3.1 Scrollbar Width Compensation
- When opening a modal, calculating `window.innerWidth - document.documentElement.clientWidth` and setting `padding-right` prevents the entire body layout from shifting left by 15px when `overflow: hidden` is applied.
- Apply `scrollbar-gutter: stable` to scrollable containers where appropriate.

#### 3.2 Modal & Sheet Deceleration Curves
- Standardize dialog entrance transitions:
  - Entrance: `opacity: 0 -> 1`, `transform: scale(0.96) translate3d(0, 8px, 0) -> scale(1) translate3d(0, 0, 0)` over 220ms with `cubic-bezier(0.16, 1, 0.3, 1)`.
  - Scrim Backdrop: `backdrop-filter: blur(8px)` with fade-in over 200ms.

---

## 3. Design System & Style Integrity

All changes MUST strictly adhere to the established project constraints:
1. **Palette:** Base `#121214`, Surface `#1C1C20`, Raised `#26262C`, Primary `#FF5533`.
2. **Zero Gradients:** No radial or linear gradient overlays.
3. **Zero Emojis:** Strictly vector SVG icons only.
4. **Zero Em-Dashes:** Standard hyphens, colons, or parentheses only.

---

## 4. Verification and Test Plan

1. **FPS and Rendering Verification:** Measure frame rate during rapid tab switching and ledger scrolling using Playwright / Chrome DevTools performance trace. Verify steady 60fps+ with 0 dropped frames.
2. **Perceived Latency Test:** Measure time from navigation click to view render (target: 0ms on repeat visits with SWR).
3. **Mobile Tap Verification:** Verify `touch-action: manipulation` eliminates 300ms tap delay on touch viewports.
4. **Regression Gate:** Run `scripts/verify-mobile-claims.mjs` and `scripts/verify-mobile-claims2.mjs` to ensure zero regressions across mobile and desktop breakpoints.
