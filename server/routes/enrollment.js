// =============================================
// server/routes/enrollment.js - Student load submission (Phase B).
// Students draft proposed loads and submit them for program-head evaluation.
// =============================================
const express  = require('express');
const supabase = require('../lib/supabase');
const { isValidUUID, assertRequired } = require('../lib/validate');
const { logError } = require('../lib/logger');
const { logAudit } = require('../lib/audit');
const { createNotification } = require('./notifications');
const { canStudentEdit, canTransition } = require('../lib/enrollment');
const { pilotGate } = require('../middleware/roles');

const router = express.Router();

const SCHOOL_YEAR_RE = /^\d{4}-\d{4}$/;
const ORIGINS = ['grizz', 'manual'];

// Students only — staff use /api/faculty.
function requireStudent(req, res, next) {
  if (req.profile?.role !== 'student') {
    return res.status(403).json({ error: 'Student account required.' });
  }
  next();
}
router.use(requireStudent);
router.use(pilotGate);

// GET /submissions/my - own submissions with items, newest term first
router.get('/submissions/my', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('enrollment_submissions')
      .select('*, enrollment_submission_items(*, subjects(id, code, title, units, lec_units, lab_units, program, year_level, semester))')
      .eq('student_id', req.user.id)
      .order('created_at', { ascending: false });
    if (error) {
      logError('enrollment/my', error);
      return res.status(500).json({ error: 'Failed to load your submissions.' });
    }
    res.json({ submissions: data || [] });
  } catch (err) {
    logError('enrollment/my', err);
    res.status(500).json({ error: 'Failed to load your submissions.' });
  }
});

// POST /submissions - create (or reuse) the draft for a term
router.post('/submissions', async (req, res) => {
  try {
    const { school_year, semester } = req.body || {};
    if (!SCHOOL_YEAR_RE.test(String(school_year || ''))) {
      return res.status(400).json({ error: 'School year must look like 2026-2027.' });
    }
    const sem = Number(semester);
    if (!Number.isInteger(sem) || sem < 1 || sem > 3) {
      return res.status(400).json({ error: 'Semester must be 1, 2, or 3.' });
    }

    const { data: existing } = await supabase
      .from('enrollment_submissions')
      .select('*')
      .eq('student_id', req.user.id)
      .eq('school_year', school_year)
      .eq('semester', sem)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'approved' || existing.status === 'rejected') {
        return res.status(409).json({ error: `A submission for this term is already ${existing.status}.` });
      }
      return res.json({ submission: existing }); // reuse draft/submitted/returned
    }

    const { data, error } = await supabase
      .from('enrollment_submissions')
      .insert({ student_id: req.user.id, school_year, semester: sem })
      .select('*')
      .single();
    if (error) {
      logError('enrollment/create', error);
      return res.status(500).json({ error: 'Failed to create the submission.' });
    }
    res.status(201).json({ submission: data });
  } catch (err) {
    logError('enrollment/create', err);
    res.status(500).json({ error: 'Failed to create the submission.' });
  }
});

// Shared: load own submission in an editable state
async function loadEditableSubmission(req, res) {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ error: 'Invalid submission id.' }); return null; }
  const { data: submission } = await supabase
    .from('enrollment_submissions')
    .select('*')
    .eq('id', id)
    .eq('student_id', req.user.id)
    .maybeSingle();
  if (!submission) { res.status(404).json({ error: 'Submission not found.' }); return null; }
  if (!canStudentEdit(submission.status)) {
    res.status(400).json({ error: `This submission is ${submission.status} and can no longer be edited.` });
    return null;
  }
  return submission;
}

// POST /submissions/:id/items - add a subject while draft/returned
router.post('/submissions/:id/items', async (req, res) => {
  try {
    const submission = await loadEditableSubmission(req, res);
    if (!submission) return;

    const { subject_id, origin, grizz_reason } = req.body || {};
    if (!isValidUUID(subject_id)) {
      return res.status(400).json({ error: 'Invalid subject id.' });
    }

    const { data: subject } = await supabase
      .from('subjects')
      .select('id, code, program')
      .eq('id', subject_id)
      .maybeSingle();
    if (!subject) return res.status(404).json({ error: 'Subject not found.' });
    if (subject.program !== req.profile.course) {
      return res.status(400).json({ error: `${subject.code} does not belong to your program.` });
    }

    const itemOrigin = ORIGINS.includes(origin) ? origin : 'manual';
    const { data: item, error } = await supabase
      .from('enrollment_submission_items')
      .insert({
        submission_id: submission.id,
        subject_id,
        origin: itemOrigin,
        grizz_reason: itemOrigin === 'grizz' ? String(grizz_reason || '').slice(0, 200) : null,
      })
      .select('*, subjects(id, code, title, units, lec_units, lab_units)')
      .single();
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: `${subject.code} is already in this submission.` });
      }
      logError('enrollment/add-item', error);
      return res.status(500).json({ error: 'Failed to add the subject.' });
    }

    logAudit(req.user.id, 'ENROLLMENT_ADD_ITEM', { submission_id: submission.id, subject_id });
    res.status(201).json({ item });
  } catch (err) {
    logError('enrollment/add-item', err);
    res.status(500).json({ error: 'Failed to add the subject.' });
  }
});

// DELETE /submissions/:id/items/:itemId - remove while draft/returned
router.delete('/submissions/:id/items/:itemId', async (req, res) => {
  try {
    const submission = await loadEditableSubmission(req, res);
    if (!submission) return;
    const { itemId } = req.params;
    if (!isValidUUID(itemId)) {
      return res.status(400).json({ error: 'Invalid item id.' });
    }
    const { error } = await supabase
      .from('enrollment_submission_items')
      .delete()
      .eq('id', itemId)
      .eq('submission_id', submission.id);
    if (error) {
      logError('enrollment/remove-item', error);
      return res.status(500).json({ error: 'Failed to remove the subject.' });
    }
    logAudit(req.user.id, 'ENROLLMENT_REMOVE_ITEM', { submission_id: submission.id, item_id: itemId });
    res.json({ ok: true });
  } catch (err) {
    logError('enrollment/remove-item', err);
    res.status(500).json({ error: 'Failed to remove the subject.' });
  }
});

// POST /submissions/:id/submit - draft/returned -> submitted; notify program heads
router.post('/submissions/:id/submit', async (req, res) => {
  try {
    const submission = await loadEditableSubmission(req, res);
    if (!submission) return;
    if (!canTransition(submission.status, 'submitted')) {
      return res.status(400).json({ error: `Cannot submit from ${submission.status}.` });
    }

    const { count } = await supabase
      .from('enrollment_submission_items')
      .select('id', { count: 'exact', head: true })
      .eq('submission_id', submission.id);
    if (!count) {
      return res.status(400).json({ error: 'Add at least one subject before submitting.' });
    }

    const { data: updated, error } = await supabase
      .from('enrollment_submissions')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', submission.id)
      .select('*')
      .single();
    if (error) {
      logError('enrollment/submit', error);
      return res.status(500).json({ error: 'Failed to submit for verification.' });
    }

    // Notify the program heads of the student's program (in-app + email are
    // wired in Task 5; the in-app notification is placed here).
    const { data: heads } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'program_head')
      .eq('course', req.profile.course);
    for (const head of heads || []) {
      createNotification({
        userId: head.id,
        // 'faculty' is outside every role broadcast filter, so delivery is
        // user_id-only and other users never see this notification.
        targetRole: 'faculty',
        type: 'units',
        category: 'units',
        title: 'New load for evaluation',
        message: `${req.profile.full_name || 'A student'} submitted a load for ${submission.school_year}.`,
        link: '/faculty',
      });
    }

    logAudit(req.user.id, 'ENROLLMENT_SUBMIT', { submission_id: submission.id, items: count });
    res.json({ submission: updated });
  } catch (err) {
    logError('enrollment/submit', err);
    res.status(500).json({ error: 'Failed to submit for verification.' });
  }
});

module.exports = router;
