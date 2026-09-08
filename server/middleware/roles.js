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

// Enrollment pilot allowlist (Phase B/C rollout gate, spec 2026-09-08).
// Client mirror: client/js/config.js window.ENROLLMENT_PILOT_EMAILS.
// Override with ENROLLMENT_PILOT_EMAILS="a@x.com, b@x.com" on the server.
const PILOT_DEFAULT = [
  'lexmatondo@g.cjc.edu.ph',
  'test.newuser@g.cjc.edu.ph',
  'bsce.test@g.cjc.edu.ph',
  'head.test@g.cjc.edu.ph',
  'dean.test@g.cjc.edu.ph',
  'sa.test@g.cjc.edu.ph',
  'klydemodina@g.cjc.edu.ph',
];

function pilotGate(req, res, next) {
  const raw = process.env.ENROLLMENT_PILOT_EMAILS;
  const list = raw
    ? raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    : PILOT_DEFAULT;
  const email = String(req.user?.email || '').trim().toLowerCase();
  if (!list.includes(email)) {
    return res.status(403).json({ error: 'This feature is still under development.' });
  }
  next();
}

module.exports = { OFFICER_ROLES, GOVERNOR_ROLES, FACULTY_ROLES, requireAdmin, requireGovernorOrAdmin, requireOfficer, requireFaculty, requireProgramHead, pilotGate };

