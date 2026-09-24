// =============================================
// init-theme.js - Instant Theme Initialization
// Runs in head to prevent theme flashing on load
// =============================================
(function () {
  'use strict';
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', savedTheme === 'dark' ? '#0B0F14' : '#F5F6F8');
  }
})();
