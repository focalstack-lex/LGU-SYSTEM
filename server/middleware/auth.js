const supabaseAdmin = require('../lib/supabase');

// 🚨 FORENSIC TRACKER watch list - configurable via env (comma-separated).
// Defaults preserve the current watch targets. Logs carry request METADATA
// only (IP, user agent, method, path) - never request bodies, which can
// contain passwords and other secrets that would leak into hosted-log
// retention on Render.
const WATCH_EMAILS = (process.env.FORENSIC_WATCH_EMAILS || 'newstudent@g.cjc.edu.ph')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const WATCH_IDS = (process.env.FORENSIC_WATCH_IDS || '48da9d90-88bd-45d4-be65-12b149515838')
  .split(',').map((e) => e.trim()).filter(Boolean);

/**
 * Auth Middleware
 * Verifies the Supabase JWT from the Authorization header.
 * Attaches the user object to req.user for downstream use.
 */
module.exports = async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.split(' ')[1];

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }

  // Fetch profile for role info
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, full_name, course, enrollment_year, created_at')
    .eq('id', user.id)
    .maybeSingle();

  req.user    = user;
  req.profile = profile;

  // 🚨 FORENSIC TRACKER: Real-time IP & activity capture for suspect accounts
  // (metadata only - see note above; bodies are deliberately not logged).
  if (WATCH_EMAILS.includes(String(user.email || '').toLowerCase()) || WATCH_IDS.includes(user.id)) {
    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    console.warn(`[🚨 FORENSIC CAPTURE] Suspect User Active!`);
    console.warn(`    Email:      ${user.email}`);
    console.warn(`    Client IP:  ${clientIp}`);
    console.warn(`    User Agent: ${userAgent}`);
    console.warn(`    Method/URL: ${req.method} ${req.originalUrl}`);
    console.warn(`    Timestamp:  ${new Date().toISOString()}\n`);
  }

  next();
};
