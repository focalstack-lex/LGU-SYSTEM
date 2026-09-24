/**
 * swr-cache.js — In-Memory Stale-While-Revalidate (SWR) Client Cache & Utilities
 * Provides instant 0ms view navigation, background revalidation, scroll position memory,
 * and debounced filtering.
 */
(function (window) {
  'use strict';

  const store = new Map();
  const scrollMap = new Map();

  const SWRCache = {
    /**
     * Retrieve cached payload if present
     * @param {string} key
     * @returns {any|null}
     */
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return entry.data;
    },

    /**
     * Store payload with time-to-live
     * @param {string} key
     * @param {any} data
     * @param {number} ttlMs
     */
    set(key, data, ttlMs = 45000) {
      store.set(key, {
        data: data,
        timestamp: Date.now(),
        ttl: ttlMs,
      });
    },

    /**
     * Invalidate specific key
     * @param {string} key
     */
    invalidate(key) {
      store.delete(key);
    },

    /**
     * Invalidate all keys matching a prefix or entire cache
     * @param {string} [prefix]
     */
    invalidateAll(prefix) {
      if (!prefix) {
        store.clear();
        return;
      }
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) {
          store.delete(k);
        }
      }
    },

    /**
     * Stale-While-Revalidate fetch pattern
     * @param {string} key
     * @param {Function} fetcherFn
     * @param {Function} [onRevalidate]
     * @param {number} [ttlMs]
     * @returns {Promise<any>}
     */
    async fetch(key, fetcherFn, onRevalidate, ttlMs = 45000) {
      const entry = store.get(key);
      const isFresh = entry && (Date.now() - entry.timestamp < entry.ttl);

      if (entry) {
        // Fresh entry: return cached version immediately
        if (isFresh) {
          return entry.data;
        }

        // Stale entry: return cached version immediately, revalidate in background
        Promise.resolve().then(async () => {
          try {
            const freshData = await fetcherFn();
            store.set(key, { data: freshData, timestamp: Date.now(), ttl: ttlMs });
            if (typeof onRevalidate === 'function') {
              onRevalidate(freshData);
            }
          } catch (err) {
            console.warn('[SWRCache] Background revalidation failed for', key, err);
          }
        });

        return entry.data;
      }

      // Cold fetch
      const freshData = await fetcherFn();
      store.set(key, { data: freshData, timestamp: Date.now(), ttl: ttlMs });
      return freshData;
    },

    /**
     * Save scroll position for a view
     * @param {string} viewId
     * @param {number} top
     */
    saveScroll(viewId, top) {
      scrollMap.set(viewId, top);
    },

    /**
     * Get saved scroll position for a view
     * @param {string} viewId
     * @returns {number}
     */
    getScroll(viewId) {
      return scrollMap.get(viewId) || 0;
    },

    /**
     * Reusable debounce helper for instant search / filtering
     * @param {Function} fn
     * @param {number} waitMs
     * @returns {Function}
     */
    debounce(fn, waitMs = 150) {
      let timeoutId = null;
      return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          fn.apply(this, args);
        }, waitMs);
      };
    },
  };

  window.SWRCache = SWRCache;
})(window);
