// =============================================
// roles.js - Shared Role Middleware
// =============================================

const OFFICER_ROLES  = ['admin', 'governor', 'cashier', 'officer'];
const GOVERNOR_ROLES = ['admin', 'governor'];

function requireAdmin(req, res, next) {
  if (req.profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin privileges required.' });
  }
  next();
}

function requireGovernorOrAdmin(req, res, next) {
  if (!GOVERNOR_ROLES.includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Governor or Admin privileges required.' });
  }
  next();
}

function requireOfficer(req, res, next) {
  if (!OFFICER_ROLES.includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Officer privileges required.' });
  }
  next();
}

const FACULTY_ROLES   = ['faculty', 'program_head', 'dean', 'admin'];
const HEAD_ROLES      = ['program_head', 'admin'];

function requireFaculty(req, res, next) {
  if (!FACULTY_ROLES.includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Faculty access required.' });
  }
  next();
}

function requireProgramHead(req, res, next) {
  if (!HEAD_ROLES.includes(req.profile?.role)) {
    return res.status(403).json({ error: 'Program head privileges required.' });
  }
  next();
}

// Enrollment pilot allowlist (Phase B/C rollout gate).
// Configured strictly via ENROLLMENT_PILOT_EMAILS="a@x.com, b@x.com" on the server.
// Fails closed if the environment variable is unset or empty.
function pilotGate(req, res, next) {
  const raw = process.env.ENROLLMENT_PILOT_EMAILS;
  if (!raw || !raw.trim()) {
    return res.status(403).json({ error: 'This feature is currently disabled in this environment.' });
  }
  const list = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const email = String(req.user?.email || '').trim().toLowerCase();
  if (!email || !list.includes(email)) {
    return res.status(403).json({ error: 'This feature is still under development.' });
  }
  next();
}

module.exports = { OFFICER_ROLES, GOVERNOR_ROLES, FACULTY_ROLES, requireAdmin, requireGovernorOrAdmin, requireOfficer, requireFaculty, requireProgramHead, pilotGate };


