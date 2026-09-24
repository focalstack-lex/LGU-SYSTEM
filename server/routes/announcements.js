const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { sendAnnouncementEmail } = require('../lib/email');
const { sanitizeText, assertRequired } = require('../lib/validate');
const { logAudit } = require('../lib/audit');
const { requireAdmin, requireGovernorOrAdmin, requireOfficer } = require('../middleware/roles');
const { createNotification } = require('./notifications');

const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH  = 5000;

// Poster role -> label shown as the announcement author. Announcements have no
// author column, so the label is derived from the poster's profile role.
// Legacy rows with posted_by = null fall back to a neutral brand label.
const ROLE_LABELS = {
  admin: 'Admin',
  governor: 'Governor',
  cashier: 'Cashier',
  officer: 'Officer',
  program_head: 'Program Head',
  dean: 'Dean',
  faculty: 'Student Assistant',
  student: 'Student',
};

// GET /api/announcements
router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: 'Failed to fetch announcements.' });

  const rows = data || [];
  const posterIds = [...new Set(rows.map(r => r.posted_by).filter(Boolean))];
  let posters = new Map();
  if (posterIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, role, full_name')
      .in('id', posterIds);
    posters = new Map((profiles || []).map(p => [p.id, p]));
  }

  res.json(rows.map(r => {
    const poster = r.posted_by ? posters.get(r.posted_by) : null;
    return {
      ...r,
      author: poster ? (ROLE_LABELS[poster.role] || poster.role || 'COE LGU') : 'COE LGU',
      poster_role: poster ? poster.role : null,
      poster_name: poster ? poster.full_name : null,
    };
  }));
});

// POST /api/announcements (governors and admins)
router.post('/', requireGovernorOrAdmin, async (req, res) => {
  const { title, body } = req.body;

  // 1. Required fields
  const missing = assertRequired({ title, body });
  if (missing) return res.status(400).json({ error: missing });

  // 2. Sanitize (strips HTML tags - prevents XSS in emails and PDF)
  const cleanTitle = sanitizeText(String(title));
  const cleanBody  = sanitizeText(String(body));

  // 3. Length limits
  if (cleanTitle.length > MAX_TITLE_LENGTH) {
    return res.status(400).json({ error: `Title must be ${MAX_TITLE_LENGTH} characters or less.` });
  }
  if (cleanBody.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ error: `Body must be ${MAX_BODY_LENGTH} characters or less.` });
  }

  const { data, error } = await supabase
    .from('announcements')
    .insert({ title: cleanTitle, body: cleanBody, posted_by: req.user.id })
    .select()
    .single();

  if (error) return res.status(400).json({ error: 'Failed to create announcement.' });

  // Audit log
  logAudit(req.user.id, 'POST_ANNOUNCEMENT', { announcement_id: data.id, title: cleanTitle });

  // Create real-time notification for all users
  createNotification({
    targetRole: 'all',
    type: 'announcement',
    title: `📢 New Announcement: ${cleanTitle}`,
    message: cleanBody.length > 120 ? cleanBody.substring(0, 120) + '...' : cleanBody,
    category: 'announcements',
    link: 'more',
    metadata: { announcement_id: data.id }
  });

  // Send email notifications in the background (non-blocking) - DISABLED AS PER REQUEST
  /*
  sendAnnouncementEmail(cleanTitle, cleanBody).catch(err =>
    console.error('[Email] Background send failed:', err.message)
  );
  */

  res.status(201).json({ ...data, email_status: 'off' });
});

module.exports = router;
