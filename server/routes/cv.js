const express = require('express');
const { rateLimit } = require('express-rate-limit');
const router  = express.Router();
const supabase = require('../lib/supabase');
const authMiddleware = require('../middleware/auth');

// =============================================
// CV field sanitation
//
// CV fields are rendered into HTML by cv-verify.html and cv-builder.html, so
// every string is tag-stripped and length-capped BEFORE it reaches the
// database; the render pages additionally escape on output (defense in
// depth). Unlike validate.sanitizeText this deliberately does NOT encode
// '&' - escaping happens at render time, and pre-encoding here would
// double-encode once the render pages escape.
// =============================================
function cvClean(value, max = 500) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, '')       // strip HTML tags
    .replace(/\s+/g, ' ')          // collapse whitespace/newlines
    .trim()
    .slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cvEmail(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim().toLowerCase();
  return (v.length <= 254 && EMAIL_RE.test(v)) ? v : '';
}

// Accepts what students actually type ("linkedin.com/in/juan") as well as full
// URLs. Bare domains get https:// prepended; only http(s) URLs with a real
// hostname survive, so javascript:/data: payloads are dropped.
function cvUrl(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v || v.length > 300) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (!u.hostname.includes('.')) return '';
    return withScheme;
  } catch {
    return '';
  }
}

function cvList(value, itemMax = 60, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const s = cvClean(raw, itemMax);
    const key = s.toLowerCase();
    if (s && !seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

// ---------------------------------------------
// CV entries (experience / leadership / certification / award)
// ---------------------------------------------
const ENTRY_TYPES = ['experience', 'leadership', 'certification', 'award'];
const MAX_ENTRIES = 25;          // keeps a worst-case payload well under the 50kb JSON body limit
const MAX_BULLETS = 4;
const ENTRY_ID_RE = /^[\w-]{1,60}$/;

function cvEntries(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const title = cvClean(raw.title, 120);
    if (!title) continue; // an entry without a title is an empty draft row - never stored
    out.push({
      id:           (typeof raw.id === 'string' && ENTRY_ID_RE.test(raw.id)) ? raw.id : `e-${out.length}-${Date.now().toString(36)}`,
      type:         ENTRY_TYPES.includes(raw.type) ? raw.type : 'experience',
      title,
      organization: cvClean(raw.organization, 120),
      date:         cvClean(raw.date, 40),
      bullets:      Array.isArray(raw.bullets)
        ? raw.bullets.map((b) => cvClean(b, 200)).filter(Boolean).slice(0, MAX_BULLETS)
        : []
    });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}

// ---------------------------------------------
// Education block
// ---------------------------------------------
const PROGRAMS = {
  BSCoE: 'BS Computer Engineering',
  BSCE:  'BS Civil Engineering',
  BSECE: 'BS Electronics Engineering'
};

function cvYear(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{4}$/.test(s)) return '';
  const n = Number(s);
  return (n >= 2000 && n <= 2100) ? s : '';
}

function cvEducation(value) {
  const e = (value && typeof value === 'object') ? value : {};
  const program = (e.program === 'OTHER' || PROGRAMS[e.program]) ? e.program : '';
  return {
    program,
    degree:     cvClean(e.degree, 120),
    grad_year:  cvYear(e.grad_year),
    coursework: cvList(e.coursework, 80, 20)
  };
}

// Pre-fill for a student who has never saved a CV. Only facts we actually have
// on their profile - no invented content.
function defaultEducation(profile) {
  const course = String(profile?.course || '').trim();
  const program = PROGRAMS[course] ? course : (course ? 'OTHER' : '');
  const start = Number(profile?.enrollment_year);
  return {
    program,
    degree:     PROGRAMS[course] || cvClean(course, 120),
    grad_year:  Number.isInteger(start) ? cvYear(String(start + 4)) : '',
    coursework: []
  };
}

/**
 * Helper: Aggregate verified college milestones for a given user ID
 */
async function fetchVerifiedMilestones(userId, userEmail) {
  const milestones = [];

  // 1. Fetch Roster Roles & Affiliations
  // Two separate equality lookups - never a string-interpolated .or filter,
  // because userEmail may originate from the CV owner's own contact_email
  // field (see the public /verify/:token route).
  try {
    const rosterFields = 'id, name, role, department, course, year_level, status, created_at';
    const lookups = [supabase.from('roster').select(rosterFields).eq('id', userId)];
    if (typeof userEmail === 'string' && EMAIL_RE.test(userEmail.trim())) {
      lookups.push(supabase.from('roster').select(rosterFields).eq('email', userEmail.trim().toLowerCase()));
    }

    const results = await Promise.all(lookups);
    const seen = new Set();
    const rosterEntries = [];
    for (const res of results) {
      for (const item of res.data || []) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          rosterEntries.push(item);
        }
      }
    }

    if (rosterEntries && rosterEntries.length > 0) {
      rosterEntries.forEach(item => {
        milestones.push({
          id: `roster-${item.id}`,
          type: 'leadership',
          source: 'roster',
          title: item.role ? `${item.role} (${item.department || 'COE'})` : `Member, ${item.department || 'College of Engineering'}`,
          organization: 'College of Engineering Local Government Unit',
          date_range: item.created_at ? new Date(item.created_at).getFullYear().toString() : 'Active',
          description: `Verified ${item.status || 'Active'} role in ${item.department || 'COE'}.`,
          is_verified: true
        });
      });
    }
  } catch (err) {
    console.warn('[CV] Error fetching roster milestones:', err.message);
  }

  // 2. Fetch Attended Events
  try {
    const { data: eventsData } = await supabase
      .from('event_attendees')
      .select('id, event_id, check_in_time, events(title, event_date, category, location)')
      .eq('user_id', userId);

    if (eventsData && eventsData.length > 0) {
      eventsData.forEach(item => {
        if (item.events) {
          milestones.push({
            id: `event-${item.id}`,
            type: 'seminar',
            source: 'events',
            title: `Participant - ${item.events.title}`,
            organization: 'COE LGU System Events',
            date_range: item.events.event_date ? new Date(item.events.event_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Verified',
            description: `Attended official ${item.events.category || 'academic'} event at ${item.events.location || 'College Campus'}.`,
            is_verified: true
          });
        }
      });
    }
  } catch (err) {
    console.warn('[CV] Error fetching event milestones:', err.message);
  }

  return milestones;
}

// Autosave means a busy student can PUT every few seconds. Limit per USER, not
// per IP: campus Wi-Fi puts hundreds of students behind one NAT address, so an
// IP-keyed bucket would be exhausted by a handful of people. Mounted after
// authMiddleware so req.user is always set.
const cvSaveLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,
  max:             40,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Saving too frequently. Your changes are kept in this browser and will sync shortly.' },
  keyGenerator:    (req) => req.user.id,
});

// GET /api/cv/me - Fetch student's CV and available verified college records
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;

    // Fetch existing CV record
    const { data: cv, error } = await supabase
      .from('student_cvs')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: 'Failed to fetch CV profile.' });
    }

    // Verified college records the student may choose to include
    const lockerItems = await fetchVerifiedMilestones(userId, userEmail);

    // If CV exists, return it with populated locker items
    if (cv) {
      return res.json({
        ...cv,
        education: cvEducation(cv.education),
        profile: req.profile,
        locker_items: lockerItems
      });
    }

    // No CV yet: pre-fill only what the student's profile already states.
    return res.json({
      user_id: userId,
      exists: false,
      full_name: cvClean(req.profile?.full_name, 100),
      contact_email: userEmail || '',
      contact_phone: '',
      location: '',
      linkedin_url: '',
      github_url: '',
      portfolio_url: '',
      education: defaultEducation(req.profile),
      summary: '',
      technical_skills: [],
      soft_skills: [],
      capstone_project: { title: '', abstract: '', tech_stack: '' },
      custom_sections: [],
      selected_locker_items: [],
      profile: req.profile,
      locker_items: lockerItems
    });
  } catch (err) {
    console.error('[CV GET Error]:', err);
    return res.status(500).json({ error: 'Server error fetching CV data.' });
  }
});

// PUT /api/cv/me - Save or update student CV
router.put('/me', authMiddleware, cvSaveLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    const cvData = {
      user_id: userId,
      full_name:        cvClean(body.full_name, 100),
      summary:          cvClean(body.summary, 1000),
      contact_email:    cvEmail(body.contact_email) || req.user.email,
      contact_phone:    cvClean(body.contact_phone, 40),
      location:         cvClean(body.location, 120),
      linkedin_url:     cvUrl(body.linkedin_url),
      github_url:       cvUrl(body.github_url),
      portfolio_url:    cvUrl(body.portfolio_url),
      education:        cvEducation(body.education),
      technical_skills: cvList(body.technical_skills, 60, 30),
      soft_skills:      cvList(body.soft_skills, 60, 30),
      capstone_project: {
        title:      cvClean(body.capstone_project?.title, 150),
        abstract:   cvClean(body.capstone_project?.abstract, 600),
        tech_stack: cvClean(body.capstone_project?.tech_stack, 200)
      },
      custom_sections:  cvEntries(body.custom_sections),
      selected_locker_items: Array.isArray(body.selected_locker_items)
        ? body.selected_locker_items.filter((s) => typeof s === 'string' && /^[\w-]{1,80}$/.test(s)).slice(0, 50)
        : [],
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('student_cvs')
      .upsert(cvData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('[CV PUT Supabase Error]:', error);
      // 42703 / PGRST204: the columns added by migration 037 are missing.
      if (error.code === '42703' || error.code === 'PGRST204') {
        return res.status(503).json({ error: 'CV storage is being updated. Your changes are kept in this browser and will sync once it is done.' });
      }
      return res.status(500).json({ error: 'Failed to save CV profile.' });
    }

    return res.json({ ok: true, updated_at: data.updated_at });
  } catch (err) {
    console.error('[CV PUT Error]:', err);
    return res.status(500).json({ error: 'Server error updating CV.' });
  }
});

// GET /api/cv/verify/:token - Public lookup endpoint for QR verification
router.get('/verify/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const { data: cv, error } = await supabase
      .from('student_cvs')
      .select('*, profiles(full_name, course, year_level, enrollment_year)')
      .eq('share_token', token)
      .eq('is_public', true)
      .maybeSingle();

    if (error || !cv) {
      return res.status(404).json({ error: 'Verified CV not found or private.' });
    }

    // Fetch verified locker items for the CV owner
    const lockerItems = await fetchVerifiedMilestones(cv.user_id, cv.contact_email);

    return res.json({
      student_name: cv.profiles?.full_name || 'COE Student',
      course: cv.profiles?.course || 'Engineering',
      enrollment_year: cv.profiles?.enrollment_year || '',
      headline: cv.headline,
      summary: cv.summary,
      contact_email: cv.contact_email,
      linkedin_url: cv.linkedin_url,
      portfolio_url: cv.portfolio_url,
      technical_skills: cv.technical_skills,
      capstone_project: cv.capstone_project,
      work_experience: cv.work_experience,
      verified_milestones: lockerItems.filter(item => (cv.selected_locker_items || []).includes(item.id)),
      share_token: cv.share_token,
      updated_at: cv.updated_at
    });
  } catch (err) {
    console.error('[CV VERIFY Error]:', err);
    return res.status(500).json({ error: 'Server error looking up CV.' });
  }
});

module.exports = router;
