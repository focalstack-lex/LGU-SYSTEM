// =============================================
// config.js - Supabase Client Configuration
// =============================================
window.SUPABASE_URL  = 'https://hchkfunaofyoualrdnkk.supabase.co';
window.SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhjaGtmdW5hb2Z5b3VhbHJkbmtrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDU2ODMsImV4cCI6MjA5NDA4MTY4M30.H42DgGtRkJv-bfuODygHcZhdeA5dB5jJ5wRy757Dp2A';
// Detect if running in Electron
window.IS_ELECTRON = window.navigator.userAgent.includes('Electron');
// Use production API by default for Desktop to avoid blank UI when local server is not running
// Override via preload if needed: window.electronAPI.getApiBase()
// On localhost dev, use the same origin - the CSP (connect-src 'self') blocks cross-origin API calls.
window.API_BASE = window.IS_ELECTRON
  ? (window.electronAPI && window.electronAPI.getApiBase ? window.electronAPI.getApiBase() : 'https://api.coelgu-system.engineer')
  : (['localhost', '127.0.0.1'].includes(window.location.hostname) ? '' : 'https://api.coelgu-system.engineer');

if (typeof supabase === 'undefined') {
  console.error('Supabase CDN failed to load. Check your internet connection.');
} else {
  window.supabaseClient = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON, {
    auth: {
      storage: window.localStorage, // explicit - never fall back to cookie storage
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  // Gracefully tear down Realtime channels when page hides or unloads to avoid abrupt disconnect warnings
  const cleanupRealtime = () => {
    if (window.supabaseClient && typeof window.supabaseClient.removeAllChannels === 'function') {
      try { window.supabaseClient.removeAllChannels(); } catch {}
    }
  };

  window.addEventListener('pagehide', cleanupRealtime);
  window.addEventListener('beforeunload', cleanupRealtime);
}

// =============================================
// Enrollment pilot allowlist (Phase B/C rollout, spec 2026-09-08).
// Server mirror: server/middleware/roles.js PILOT_DEFAULT.
// =============================================
window.ENROLLMENT_PILOT_EMAILS = [
  'lexmatondo@g.cjc.edu.ph',   // admin / developer
  'test.newuser@g.cjc.edu.ph', // student: Alex Rivera (BSCoE, Yr 2)
  'bsce.test@g.cjc.edu.ph',    // student: Maria Santos (BSCE, seeded submitted load)
  'head.test@g.cjc.edu.ph',    // program head (BSCoE)
  'dean.test@g.cjc.edu.ph',    // dean
  'sa.test@g.cjc.edu.ph',      // student assistant (faculty role)
  'klydemodina@g.cjc.edu.ph',  // real student account for live testing
];
window.isEnrollmentPilot = function (email) {
  const v = String(email || '').trim().toLowerCase();
  return (window.ENROLLMENT_PILOT_EMAILS || []).some(e => String(e).trim().toLowerCase() === v);
};


