// =============================================
// server/routes/faculty.js - Load evaluation + SA encoding queue (Phase B).
// program_head: evaluate/decide on their program. faculty: SA read-only queue
// + mark-encoded. dean: read-only across programs (enforced by requireProgramHead
// exclusion on every mutating route).
// =============================================
const express  = require('express');
const supabase = require('../lib/supabase');
const { isValidUUID } = require('../lib/validate');
const { logError } = require('../lib/logger');
const { logAudit } = require('../lib/audit');
const { requireFaculty, requireProgramHead } = require('../middleware/roles');
const { canHeadAct } = require('../lib/enrollment');

const router = express.Router();
router.use(requireFaculty);

// student_id references public.profiles(id) inline in migration 034, so the
// FK constraint is auto-named enrollment_submissions_student_id_fkey.
const SUBMISSION_SELECT = `
  *, student:profiles!enrollment_submissions_student_id_fkey(id, full_name, email, course, year_level, enrollment_year),
     enrollment_submission_items(*, subjects(id, code, title, units, lec_units, lab_units, program, year_level, semester))
`;

// Shared: load a submission and enforce faculty access scope.
// deans/admins: any. program_head: own program only. faculty (SA): read-only.
async function loadSubmissionFor(req, res, { forHead = false } = {}) {
  const { id } = req.params;
  if (!isValidUUID(id)) { res.status(400).json({ error: 'Invalid submission id.' }); return null; }
  const { data: submission } = await supabase
    .from('enrollment_submissions')
    .select(SUBMISSION_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (!submission) { res.status(404).json({ error: 'Submission not found.' }); return null; }

  const role = req.profile.role;
  const isOwnProgram = role === 'program_head' && submission.student?.course === req.profile.course;
  if (forHead && !(role === 'admin' || isOwnProgram)) {
    res.status(403).json({ error: 'This load belongs to another program.' });
    return null;
  }
  return submission;
}

// GET /submissions?status= - queue list
router.get('/submissions', async (req, res) => {
  try {
    let query = supabase.from('enrollment_submissions').select(SUBMISSION_SELECT);
    if (req.query.status) query = query.eq('status', String(req.query.status));
    const { data, error } = await query.order('submitted_at', { ascending: true, nullsFirst: false });
    if (error) {
      logError('faculty/list', error);
      return res.status(500).json({ error: 'Failed to load submissions.' });
    }
    // program_head scoping: filter in JS on the embedded student's course
    // (avoids relying on nested-path filters through the student join).
    let submissions = data || [];
    if (req.profile.role === 'program_head') {
      submissions = submissions.filter(s => s.student?.course === req.profile.course);
    }
    res.json({ submissions });
  } catch (err) {
    logError('faculty/list', err);
    res.status(500).json({ error: 'Failed to load submissions.' });
  }
});

// GET /submissions/:id - full evaluation payload
router.get('/submissions/:id', async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res);
    if (!submission) return;

    const [historyRes, prereqRes] = await Promise.all([
      supabase.from('student_units')
        .select('*, subjects(code, title, units, lec_units, lab_units, program)')
        .eq('student_id', submission.student_id)
        .order('created_at', { ascending: false }),
      // subject_prerequisites has two FKs to subjects (subject_id and
      // depends_on_subject_id), so the embed must be disambiguated by column.
      supabase.from('subject_prerequisites')
        .select('id, subject_id, kind, detail, depends_code:depends_on_subject_id(code)')
        .order('id', { ascending: true }),
    ]);
    if (historyRes.error) logError('faculty/detail-history', historyRes.error);
    res.json({
      submission,
      history: historyRes.data || [],
      prerequisites: prereqRes.data || [],
    });
  } catch (err) {
    logError('faculty/detail', err);
    res.status(500).json({ error: 'Failed to load the submission.' });
  }
});

// POST /submissions/:id/open - touch under_review (program head only)
router.post('/submissions/:id/open', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) return res.json({ ok: true });
    await supabase
      .from('enrollment_submissions')
      .update({ status: 'under_review', updated_at: new Date().toISOString() })
      .eq('id', submission.id);
    res.json({ ok: true });
  } catch (err) {
    logError('faculty/open', err);
    res.status(500).json({ error: 'Failed to open the submission.' });
  }
});

// POST /submissions/:id/items - program head adds a subject
router.post('/submissions/:id/items', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot edit a ${submission.status} load.` });
    }
    const { subject_id, head_note } = req.body || {};
    if (!isValidUUID(subject_id)) return res.status(400).json({ error: 'Invalid subject id.' });
    if (!head_note || !String(head_note).trim()) {
      return res.status(400).json({ error: 'A reason (head_note) is required when adding a subject.' });
    }
    const { data: item, error } = await supabase
      .from('enrollment_submission_items')
      .insert({
        submission_id: submission.id,
        subject_id,
        origin: 'manual',
        item_state: 'added_by_head',
        head_note: String(head_note).trim().slice(0, 300),
      })
      .select('*, subjects(id, code, title, units, lec_units, lab_units)')
      .single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That subject is already in this load.' });
      logError('faculty/add-item', error);
      return res.status(500).json({ error: 'Failed to add the subject.' });
    }
    logAudit(req.user.id, 'FACULTY_ADD_ITEM', { submission_id: submission.id, subject_id, head_note });
    res.status(201).json({ item });
  } catch (err) {
    logError('faculty/add-item', err);
    res.status(500).json({ error: 'Failed to add the subject.' });
  }
});

// PATCH /submissions/:id/items/:itemId - program head removes a subject
router.patch('/submissions/:id/items/:itemId', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot edit a ${submission.status} load.` });
    }
    const { itemId } = req.params;
    if (!isValidUUID(itemId)) return res.status(400).json({ error: 'Invalid item id.' });
    const { head_note } = req.body || {};
    if (!head_note || !String(head_note).trim()) {
      return res.status(400).json({ error: 'A reason (head_note) is required when removing a subject.' });
    }
    const { data: item, error } = await supabase
      .from('enrollment_submission_items')
      .update({ item_state: 'removed_by_head', head_note: String(head_note).trim().slice(0, 300) })
      .eq('id', itemId)
      .eq('submission_id', submission.id)
      .select('*, subjects(id, code, title, units)')
      .single();
    if (error || !item) return res.status(404).json({ error: 'Item not found.' });
    logAudit(req.user.id, 'FACULTY_REMOVE_ITEM', { submission_id: submission.id, item_id: itemId, head_note });
    res.json({ item });
  } catch (err) {
    logError('faculty/remove-item', err);
    res.status(500).json({ error: 'Failed to remove the subject.' });
  }
});

module.exports = router;
