# System Smoothness and Fluidity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver 60-120 FPS native-grade smoothness, instantaneous 0ms view navigation via in-memory SWR caching, tactile physical feedback, and zero-jank transitions across all portals.

**Architecture:** Build a 3-layer smoothness pipeline: (1) CSS hardware-accelerated micro-transitions, content-visibility virtualization, and tactile active states; (2) lightweight client-side Stale-While-Revalidate (SWR) in-memory cache for instant view rendering with background sync; (3) scrollbar-compensating modal scrims and spring physics.

**Tech Stack:** Vanilla CSS3 (Hardware Acceleration, Content Visibility, Cubic-Bezier Spring Physics), Vanilla JavaScript (ES6 Modules, SWR In-Memory Cache Store, Debounced Filtering), Playwright Automated Verification Suite.

**Spec:** [`docs/superpowers/specs/2026-09-24-system-smoothness-design.md`](file:///c:/Users/User/Documents/LGU%20System/docs/superpowers/specs/2026-09-24-system-smoothness-design.md)

## Global Constraints

- **Color Tokens:** Matte Flat Dark Charcoal `#121214`, Surface `#1C1C20`, Raised `#26262C`, Primary Coral-Orange `#FF5533`.
- **Zero Gradients:** No radial or linear gradients on any surface.
- **Zero Emojis:** Strictly SVG vector icons and typography across all UI and code.
- **Zero Em-Dashes:** Strictly standard hyphens, colons, or parentheses.
- **Performance Threshold:** View switches under 16ms (1 frame), zero layout shifts during modal toggles.

## Review Focus

1. View transition transform conflicts: Ensure `.view.active` animations do not override internal flex/grid display properties.
2. SWR Cache Invalidation: Ensure writing actions (e.g. paying transactions, editing units) invalidate the cache key immediately.
3. Mobile Tap Latency: Ensure `touch-action: manipulation` applies universally without breaking pinch-to-zoom on data tables.
4. Modal Scrim Scrollbar Shift: Verify `padding-right` scrollbar compensation works on Windows (where scrollbars take 15-17px width) without double-spacing on macOS/mobile overlay scrollbars.
5. Content Visibility Intrinsic Sizes: Ensure `contain-intrinsic-size` matches actual card heights to prevent scroll jumping on long ledgers.

---

### Task 1: CSS Animation, GPU Acceleration, and Content Visibility

**Files:**
- Modify: `client/styles/main.css`
- Modify: `client/styles/officer.css`
- Test: `scripts/verify-smoothness.mjs`

**Interfaces:**
- Consumes: Existing CSS design tokens (`--bg-surface`, `--primary`, `--radius-md`).
- Produces: Global `.view.active` micro-enter animation, tactile `:active` spring scaling, `content-visibility: auto` on tables and cards, and `touch-action: manipulation`.

- [ ] **Step 1: Add GPU-accelerated view transition animation in main.css and officer.css**

```css
/* GPU-Accelerated View Transitions */
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

.view.active,
.of-view.active {
  animation: viewEnterMicro 140ms cubic-bezier(0.16, 1, 0.3, 1) forwards !important;
  will-change: opacity, transform;
}
```

- [ ] **Step 2: Add tactile active feedback and eliminate mobile 300ms tap lag**

```css
/* Universal Tap-Lag Elimination and Tactile Physics */
button,
.btn,
.nav-item,
.tab-pill,
.data-card,
.of-nav-btn,
.of-stat,
.bottom-nav-item,
.dropdown-trigger {
  touch-action: manipulation;
}

button:active,
.btn:active,
.tab-pill:active,
.nav-item:active,
.of-nav-btn:active,
.bottom-nav-item:active {
  transform: scale(0.98);
  transition: transform 80ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
```

- [ ] **Step 3: Add CSS Content-Visibility for smooth 60-120 FPS scrolling**

```css
/* Content Visibility List Optimization */
.data-card,
.announce-item,
.of-announce-item,
.of-table tbody tr,
.tx-table tbody tr {
  content-visibility: auto;
  contain-intrinsic-size: auto 54px;
}
```

- [ ] **Step 4: Update skeleton overlay cross-fade**

```css
.skeleton-overlay,
#skeleton-overlay {
  transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), visibility 180ms ease !important;
}

.skeleton-overlay.hidden,
#skeleton-overlay.hidden {
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
```

- [ ] **Step 5: Commit Phase 1 Changes**

```bash
git add client/styles/main.css client/styles/officer.css
git commit -m "style: add GPU view transitions, tactile spring physics, and content-visibility"
```

---

### Task 2: Client-Side SWR In-Memory Caching & Instant Navigation

**Files:**
- Create: `client/js/swr-cache.js`
- Modify: `client/index.html` (load swr-cache.js)
- Modify: `client/js/app.js`
- Modify: `client/js/officer/officer-app.js`

**Interfaces:**
- Consumes: `api.js` network fetchers.
- Produces: `window.SWRCache = { get, set, fetch, invalidate, invalidateAll }` global caching helper.

- [ ] **Step 1: Create `client/js/swr-cache.js`**

```javascript
/**
 * In-memory Stale-While-Revalidate (SWR) cache manager.
 * Provides instant (0ms) data retrieval on view switches with background sync.
 */
(function (window) {
  'use strict';

  const store = new Map();
  const scrollMap = new Map();

  const SWRCache = {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return entry.data;
    },

    set(key, data, ttlMs = 45000) {
      store.set(key, {
        data,
        timestamp: Date.now(),
        ttl: ttlMs,
      });
    },

    invalidate(key) {
      store.delete(key);
    },

    invalidateAll() {
      store.clear();
    },

    async fetch(key, fetcherFn, onRevalidate, ttlMs = 45000) {
      const entry = store.get(key);
      const isFresh = entry && (Date.now() - entry.timestamp < entry.ttl);

      if (entry) {
        // Return cached version immediately
        if (isFresh) {
          return entry.data;
        }
        // Stale: trigger background revalidation
        fetcherFn().then((freshData) => {
          store.set(key, { data: freshData, timestamp: Date.now(), ttl: ttlMs });
          if (typeof onRevalidate === 'function') {
            onRevalidate(freshData);
          }
        }).catch((err) => {
          console.warn('[SWR] Background revalidation failed for', key, err);
        });
        return entry.data;
      }

      // No cache: perform initial fetch
      const freshData = await fetcherFn();
      store.set(key, { data: freshData, timestamp: Date.now(), ttl: ttlMs });
      return freshData;
    },

    saveScroll(viewId, top) {
      scrollMap.set(viewId, top);
    },

    getScroll(viewId) {
      return scrollMap.get(viewId) || 0;
    }
  };

  window.SWRCache = SWRCache;
})(window);
```

- [ ] **Step 2: Mount `swr-cache.js` in `client/index.html` and `client/officer.html`**

Add script tag before `app.js` and `officer-app.js`.

- [ ] **Step 3: Integrate SWR into `client/js/app.js` and `client/js/officer/officer-app.js`**

When switching views, populate with `SWRCache.get(viewId)` immediately if present, and restore scroll position with `SWRCache.getScroll(viewId)`. Invalidate relevant keys on mutate actions (`addTransaction`, `updateProfile`, `recordPayment`).

- [ ] **Step 4: Commit SWR Implementation**

```bash
git add client/js/swr-cache.js client/index.html client/officer.html client/js/app.js client/js/officer/officer-app.js
git commit -m "feat: add client-side in-memory SWR cache and instant tab navigation"
```

---

### Task 3: Modal & Scrim Scrollbar Shift Prevention

**Files:**
- Modify: `client/js/ui.js`
- Modify: `client/styles/main.css`
- Test: `scripts/verify-smoothness.mjs`

**Interfaces:**
- Consumes: Modal open/close lifecycle events.
- Produces: Zero-shift scrollbar compensation on `document.body`.

- [ ] **Step 1: Add scrollbar compensation helper in `client/js/ui.js`**

```javascript
export function lockScrollbar() {
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    const stickyHeaders = document.querySelectorAll('.app-mobile-header, .sticky-top');
    stickyHeaders.forEach((el) => {
      el.style.paddingRight = `calc(1rem + ${scrollbarWidth}px)`;
    });
  }
  document.body.classList.add('modal-open');
}

export function unlockScrollbar() {
  document.body.style.paddingRight = '';
  const stickyHeaders = document.querySelectorAll('.app-mobile-header, .sticky-top');
  stickyHeaders.forEach((el) => {
    el.style.paddingRight = '';
  });
  document.body.classList.remove('modal-open');
}
```

- [ ] **Step 2: Commit Phase 3 Changes**

```bash
git add client/js/ui.js client/styles/main.css
git commit -m "feat: add scrollbar shift compensation on modal lifecycle"
```

---

### Task 4: Automated Verification Suite

**Files:**
- Create: `scripts/verify-smoothness.mjs`

- [ ] **Step 1: Write `scripts/verify-smoothness.mjs`**

Create Playwright script testing:
1. View switch animation presence and timing.
2. `:active` scale styles computed.
3. `content-visibility: auto` computed on data cards.
4. SWR cache instant retrieval under 5ms.
5. Zero body layout shift during modal open.

- [ ] **Step 2: Run verification script**

```bash
node scripts/verify-smoothness.mjs
```

- [ ] **Step 3: Commit verification script and update JOURNAL.md**

```bash
git add scripts/verify-smoothness.mjs journal/2026-09-24.md
git commit -m "test: add automated system smoothness verification suite"
```
