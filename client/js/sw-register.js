// =============================================
// sw-register.js - Progressive Web App Service Worker Registration
// Skipped in Electron file:// protocol contexts
// =============================================
(function () {
  'use strict';
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.debug('[PWA] Service worker registration skipped/failed:', err && err.message);
      });
    });
  }
})();
