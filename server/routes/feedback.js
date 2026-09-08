// =============================================
// server/routes/feedback.js - Anonymous Feedback Portal
//
// Public, unauthenticated endpoint backing /feedback
// (standalone page, replaces the old Google Form).
// Writes go through the service-role client; the feedback table has RLS
// enabled with no public policies, so this route is the only door.
// =============================================
const express  = require('express');
const router   = express.Router();
const supabase = require('../lib/supabase');
const { logError } = require('../lib/logger');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const authMiddleware = require('../middleware/auth');

// Feedback is low-value to an attacker and high-noise if spammed:
// 5 submissions per IP per hour is generous for humans, hostile to bots.
// Applies to POST only - the developer viewer (GET) must not be throttled.
const feedbackLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many submissions from this network. Please try again later.' },
  keyGenerator:    ipKeyGenerator,
});

const RATING_FIELDS = ['ease', 'accuracy', 'ledger', 'grizz', 'performance'];
const PROGRAMS = ['BSCoE', 'BSCE', 'BSECE'];
const clampText = (v, max) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
};

// Submissions require a signed-in account; the identity is stored with the row.
router.post('/', authMiddleware, feedbackLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    // Honeypot: real users never see this field, bots love filling it.
    if (clampText(body.website, 100)) {
      return res.status(400).json({ error: 'Submission rejected.' });
    }

    const row = {};
    for (const f of RATING_FIELDS) {
      const v = body[f];
      if (v === undefined || v === null || v === '') { row[f] = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        return res.status(400).json({ error: 'Invalid rating value.' });
      }
      row[f] = n;
    }

    row.improve = clampText(body.improve, 2000);
    row.bug     = clampText(body.bug, 2000);

    const program = typeof body.program === 'string' ? body.program.trim().toUpperCase() : '';
    row.program = PROGRAMS.includes(program) ? program : null;

    const year = Number(body.year_level);
    row.year_level = Number.isInteger(year) && year >= 1 && year <= 6 ? year : null;

    row.user_id = req.user.id;
    row.email   = req.user.email;
    row.user_agent = clampText(req.headers['user-agent'], 200);

    // At least some signal: require every rating OR some written feedback,
    // so the table never fills with fully-empty rows.
    const hasRating = RATING_FIELDS.some((f) => row[f] !== null);
    if (!hasRating && !row.improve && !row.bug) {
      return res.status(400).json({ error: 'Answer at least one question before submitting.' });
    }

    const { error } = await supabase.from('feedback').insert(row);
    if (error) {
      logError('Feedback Insert Error', error);
      return res.status(500).json({ error: 'Could not save your feedback. Please try again.' });
    }

    return res.status(201).json({ ok: true });
  } catch (err) {
    logError('Feedback Route Error', err);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

// =============================================
// GET /api/feedback - Developer-only viewer feed
// Mounted behind Supabase auth + an email allowlist
// (DEVELOPER_EMAILS env var, comma-separated). Fails closed.
// =============================================
function devGate(req, res, next) {
  const allow = (process.env.DEVELOPER_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allow.length === 0) {
    return res.status(403).json({ error: 'Developer access is not configured (DEVELOPER_EMAILS is empty).' });
  }
  if (!req.user?.email || !allow.includes(req.user.email.toLowerCase())) {
    return res.status(403).json({ error: 'This view is restricted to the developer.' });
  }
  next();
}

router.get('/', authMiddleware, devGate, async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('feedback')
      .select('id, user_id, email, ease, accuracy, ledger, grizz, performance, improve, bug, program, year_level, user_agent, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      logError('Feedback Fetch Error', error);
      return res.status(500).json({ error: 'Could not load feedback.' });
    }

    const ratingFields = ['ease', 'accuracy', 'ledger', 'grizz', 'performance'];
    const stats = { total: items.length, avg: {}, perProgram: {} };
    for (const f of ratingFields) {
      const vals = items.map((it) => it[f]).filter((v) => typeof v === 'number');
      stats.avg[f] = vals.length
        ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
        : null;
      stats.avg[f + '_n'] = vals.length;
    }
    for (const it of items) {
      if (it.program) stats.perProgram[it.program] = (stats.perProgram[it.program] || 0) + 1;
    }

    return res.json({ stats, items });
  } catch (err) {
    logError('Feedback View Error', err);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
});

module.exports = router;
