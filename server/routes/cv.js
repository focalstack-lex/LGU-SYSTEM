const express = require('express');
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

function cvUrl(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  if (!v || v.length > 300) return '';
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? v : '';
  } catch {
    return '';
  }
}

// Recursively sanitize unknown-shape structures (work_experience,
// custom_sections): string values are cleaned, arrays/objects capped,
// depth-limited to guard against pathological payloads.
function cvDeep(value, depth = 0) {
  if (depth > 4) return null;
  if (typeof value === 'string') return cvClean(value, 2000);
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => cvDeep(v, depth + 1)).filter((v) => v !== null);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 30)) {
      out[String(k).replace(/[<>"'`]/g, '').slice(0, 60)] = cvDeep(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  return null;
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

// GET /api/cv/me - Fetch student's CV and available achievement locker items
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

    // Fetch available achievement locker items
    const lockerItems = await fetchVerifiedMilestones(userId, userEmail);

    // If CV exists, return it with populated locker items
    if (cv) {
      return res.json({
        ...cv,
        profile: req.profile,
        locker_items: lockerItems
      });
    }

    // If CV doesn't exist yet, return a pre-filled default template
    const defaultCv = {
      user_id: userId,
      headline: `${req.profile?.course || 'BS Engineering'} Candidate`,
      summary: `Motivated engineering student with a strong background in problem solving, leadership, and project execution. Seeking opportunities to apply technical skills in professional engineering roles.`,
      contact_email: userEmail,
      contact_phone: '',
      location: 'Manila, Philippines',
      linkedin_url: '',
      github_url: '',
      portfolio_url: '',
      technical_skills: ['AutoCAD', 'MS Office', 'Problem Solving', 'Project Management'],
      soft_skills: ['Leadership', 'Team Collaboration', 'Technical Writing'],
      capstone_project: {
        title: '',
        abstract: '',
        tech_stack: '',
        advisor: ''
      },
      work_experience: [],
      selected_locker_items: lockerItems.map(item => item.id), // Auto-select verified items
      custom_sections: [],
      template_style: 'harvard',
      is_public: true,
      profile: req.profile,
      locker_items: lockerItems
    };

    return res.json(defaultCv);
  } catch (err) {
    console.error('[CV GET Error]:', err);
    return res.status(500).json({ error: 'Server error fetching CV data.' });
  }
});

// PUT /api/cv/me - Save or update student CV
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const body = req.body || {};

    const cvData = {
      user_id: userId,
      headline:         cvClean(body.headline, 120),
      summary:          cvClean(body.summary, 2000),
      contact_email:    cvEmail(body.contact_email) || req.user.email,
      contact_phone:    cvClean(body.contact_phone, 40),
      location:         cvClean(body.location, 120),
      linkedin_url:     cvUrl(body.linkedin_url),
      github_url:       cvUrl(body.github_url),
      portfolio_url:    cvUrl(body.portfolio_url),
      technical_skills: Array.isArray(body.technical_skills)
        ? body.technical_skills.map((s) => cvClean(s, 60)).filter(Boolean).slice(0, 30)
        : [],
      soft_skills:      Array.isArray(body.soft_skills)
        ? body.soft_skills.map((s) => cvClean(s, 60)).filter(Boolean).slice(0, 30)
        : [],
      capstone_project: {
        title:      cvClean(body.capstone_project?.title, 150),
        abstract:   cvClean(body.capstone_project?.abstract, 2000),
        tech_stack: cvClean(body.capstone_project?.tech_stack, 200),
        advisor:    cvClean(body.capstone_project?.advisor, 120)
      },
      work_experience:  cvDeep(body.work_experience) || [],
      selected_locker_items: Array.isArray(body.selected_locker_items)
        ? body.selected_locker_items.filter((s) => typeof s === 'string' && /^[\w-]{1,80}$/.test(s)).slice(0, 50)
        : [],
      custom_sections:  cvDeep(body.custom_sections) || [],
      template_style:   ['harvard'].includes(body.template_style) ? body.template_style : 'harvard',
      is_public: body.is_public !== undefined ? Boolean(body.is_public) : true,
      updated_at: new Date()
    };

    const { data, error } = await supabase
      .from('student_cvs')
      .upsert(cvData, { onConflict: 'user_id' })
      .select()
      .single();

    if (error) {
      console.error('[CV PUT Supabase Error]:', error);
      return res.status(500).json({ error: 'Failed to save CV profile.' });
    }

    return res.json(data);
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
