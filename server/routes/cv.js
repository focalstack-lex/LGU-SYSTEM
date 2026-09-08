const express = require('express');
const router  = express.Router();
const supabase = require('../lib/supabase');
const authMiddleware = require('../middleware/auth');

/**
 * Helper: Aggregate verified college milestones for a given user ID
 */
async function fetchVerifiedMilestones(userId, userEmail) {
  const milestones = [];

  // 1. Fetch Roster Roles & Affiliations
  try {
    const { data: rosterEntries } = await supabase
      .from('roster')
      .select('id, name, role, department, course, year_level, status, created_at')
      .or(`email.eq.${userEmail},id.eq.${userId}`);

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
    const {
      headline,
      summary,
      contact_email,
      contact_phone,
      location,
      linkedin_url,
      github_url,
      portfolio_url,
      technical_skills,
      soft_skills,
      capstone_project,
      work_experience,
      selected_locker_items,
      custom_sections,
      template_style,
      is_public
    } = req.body;

    const cvData = {
      user_id: userId,
      headline: headline || '',
      summary: summary || '',
      contact_email: contact_email || req.user.email,
      contact_phone: contact_phone || '',
      location: location || '',
      linkedin_url: linkedin_url || '',
      github_url: github_url || '',
      portfolio_url: portfolio_url || '',
      technical_skills: Array.isArray(technical_skills) ? technical_skills : [],
      soft_skills: Array.isArray(soft_skills) ? soft_skills : [],
      capstone_project: capstone_project || {},
      work_experience: Array.isArray(work_experience) ? work_experience : [],
      selected_locker_items: Array.isArray(selected_locker_items) ? selected_locker_items : [],
      custom_sections: Array.isArray(custom_sections) ? custom_sections : [],
      template_style: template_style || 'harvard',
      is_public: is_public !== undefined ? Boolean(is_public) : true,
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
