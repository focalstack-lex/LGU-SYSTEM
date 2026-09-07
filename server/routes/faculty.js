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
const { createNotification } = require('./notifications');
const { sendLoadStatusEmail } = require('../lib/email');
const ExcelJS = require('exceljs');

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

// ---- shared notification + email helpers ----
function termLabel(s) { return `${s.school_year} Sem ${s.semester}`; }

async function notifyStudent(submission, status, extraChanges = []) {
  const lines = (submission.enrollment_submission_items || [])
    .filter(i => i.item_state !== 'removed_by_head')
    .map(i => `${i.subjects.code} - ${i.subjects.title}${i.item_state === 'added_by_head' ? ' (added by Program Head)' : ''}`);
  const changes = (submission.enrollment_submission_items || [])
    .filter(i => i.item_state !== 'submitted' && i.head_note)
    .map(i => `${i.item_state === 'removed_by_head' ? 'Removed' : 'Added'} ${i.subjects.code}: ${i.head_note}`)
    .concat(extraChanges);
  createNotification({
    userId: submission.student_id,
    type: 'units',
    category: 'units',
    title: `Load ${status.charAt(0).toUpperCase()}${status.slice(1)}`,
    message: `Your load for ${termLabel(submission)} was ${status}.`,
    link: '/',
  });
  sendLoadStatusEmail({
    to: submission.student?.email,
    name: submission.student?.full_name || 'COE Student',
    status, studentName: submission.student?.full_name || 'COE Student',
    term: termLabel(submission), lines, changes: changes.length ? changes : null,
  });
}

// POST /submissions/:id/approve - idempotent auto-enroll
router.post('/submissions/:id/approve', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (submission.status === 'approved') {
      return res.json({ ok: true, alreadyApproved: true }); // idempotent no-op
    }
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot approve a ${submission.status} load.` });
    }

    const active = (submission.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head');
    if (!active.length) {
      return res.status(400).json({ error: 'The load has no active subjects to approve.' });
    }

    // Idempotent auto-enroll: same shape + conflict target as /api/units/enroll.
    const subjectIds = active.map(i => i.subject_id);
    const { data: subjects } = await supabase
      .from('subjects')
      .select('id, units')
      .in('id', subjectIds);
    const unitsById = new Map((subjects || []).map(s => [s.id, s.units]));
    for (const item of active) {
      const { error } = await supabase
        .from('student_units')
        .upsert({
          student_id: submission.student_id,
          subject_id: item.subject_id,
          school_year: submission.school_year,
          semester: submission.semester,
          status: 'enrolled',
          grade: null,
        }, { onConflict: 'student_id,subject_id,school_year,semester' });
      if (error) {
        logError('faculty/approve-enroll', error);
        return res.status(500).json({ error: `Failed to enroll ${item.subjects.code}: ${error.message}` });
      }
    }

    const { data: updated, error } = await supabase
      .from('enrollment_submissions')
      .update({
        status: 'approved',
        reviewed_by: req.user.id,
        review_notes: req.body?.notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', submission.id)
      .eq('status', submission.status) // guard against concurrent decision
      .select(SUBMISSION_SELECT)
      .single();
    if (error) {
      logError('faculty/approve-status', error);
      return res.status(500).json({ error: 'Failed to record the approval.' });
    }

    logAudit(req.user.id, 'FACULTY_APPROVE', {
      submission_id: submission.id, student_id: submission.student_id,
      enrolled: active.length, term: termLabel(submission),
    });
    notifyStudent(updated, 'approved');
    res.json({ ok: true, submission: updated });
  } catch (err) {
    logError('faculty/approve', err);
    res.status(500).json({ error: 'Failed to approve the load.' });
  }
});

// POST /submissions/:id/return - send back to the student for changes
router.post('/submissions/:id/return', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot return a ${submission.status} load.` });
    }
    const notes = String(req.body?.notes || '').trim();
    if (!notes) return res.status(400).json({ error: 'Notes are required when returning a load.' });

    const { data: updated, error } = await supabase
      .from('enrollment_submissions')
      .update({ status: 'returned', reviewed_by: req.user.id, review_notes: notes.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', submission.id)
      .select(SUBMISSION_SELECT)
      .single();
    if (error) { logError('faculty/return', error); return res.status(500).json({ error: 'Failed to return the load.' }); }

    logAudit(req.user.id, 'FACULTY_RETURN', { submission_id: submission.id, notes });
    notifyStudent(updated, 'returned');
    res.json({ ok: true, submission: updated });
  } catch (err) {
    logError('faculty/return', err);
    res.status(500).json({ error: 'Failed to return the load.' });
  }
});

// POST /submissions/:id/reject
router.post('/submissions/:id/reject', requireProgramHead, async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res, { forHead: true });
    if (!submission) return;
    if (!canHeadAct(submission.status)) {
      return res.status(400).json({ error: `Cannot reject a ${submission.status} load.` });
    }
    const notes = String(req.body?.notes || '').trim();
    if (!notes) return res.status(400).json({ error: 'Notes are required when rejecting a load.' });

    const { data: updated, error } = await supabase
      .from('enrollment_submissions')
      .update({ status: 'rejected', reviewed_by: req.user.id, review_notes: notes.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('id', submission.id)
      .select(SUBMISSION_SELECT)
      .single();
    if (error) { logError('faculty/reject', error); return res.status(500).json({ error: 'Failed to reject the load.' }); }

    logAudit(req.user.id, 'FACULTY_REJECT', { submission_id: submission.id, notes });
    notifyStudent(updated, 'rejected');
    res.json({ ok: true, submission: updated });
  } catch (err) {
    logError('faculty/reject', err);
    res.status(500).json({ error: 'Failed to reject the load.' });
  }
});

// POST /submissions/:id/mark-encoded - any faculty role (SAs)
router.post('/submissions/:id/mark-encoded', async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res);
    if (!submission) return;
    if (submission.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved loads can be marked encoded.' });
    }
    if (submission.encoded_at) return res.json({ ok: true, alreadyEncoded: true });
    const { error } = await supabase
      .from('enrollment_submissions')
      .update({ encoded_at: new Date().toISOString(), encoded_by: req.user.id, updated_at: new Date().toISOString() })
      .eq('id', submission.id);
    if (error) { logError('faculty/encoded', error); return res.status(500).json({ error: 'Failed to mark as encoded.' }); }
    logAudit(req.user.id, 'FACULTY_MARK_ENCODED', { submission_id: submission.id });
    notifyStudent(submission, 'encoded');
    res.json({ ok: true });
  } catch (err) {
    logError('faculty/encoded', err);
    res.status(500).json({ error: 'Failed to mark as encoded.' });
  }
});

// GET /submissions/:id/export - Excel of the final load (SAs encode from this)
router.get('/submissions/:id/export', async (req, res) => {
  try {
    const submission = await loadSubmissionFor(req, res);
    if (!submission) return;
    if (submission.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved loads can be exported.' });
    }
    const active = (submission.enrollment_submission_items || []).filter(i => i.item_state !== 'removed_by_head');

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'COE LGU System';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Approved Load');
    sheet.columns = [
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Title', key: 'title', width: 46 },
      { header: 'Lec', key: 'lec', width: 8 },
      { header: 'Lab', key: 'lab', width: 8 },
      { header: 'Units', key: 'units', width: 8 },
      { header: 'Year', key: 'year', width: 8 },
      { header: 'Sem', key: 'sem', width: 8 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const i of active) {
      sheet.addRow({
        code: i.subjects.code, title: i.subjects.title,
        lec: i.subjects.lec_units, lab: i.subjects.lab_units, units: i.subjects.units,
        year: i.subjects.year_level, sem: i.subjects.semester,
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="approved-load-${submission.id}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    logError('faculty/export', err);
    res.status(500).json({ error: 'Failed to export the load.' });
  }
});

module.exports = router;
