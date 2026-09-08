// =============================================
// server/routes/curriculum.js - Admin curriculum management (Phase A).
// All routes require admin (service key bypasses RLS server-side).
// =============================================
const express  = require('express');
const supabase = require('../lib/supabase');
const { requireAdmin } = require('../middleware/roles');
const { isValidUUID } = require('../lib/validate');
const { logError } = require('../lib/logger');
const { logAudit } = require('../lib/audit');
const { validateComponentSplit, validatePrereqRow } = require('../lib/curriculum');

const router = express.Router();
router.use(requireAdmin);

// PATCH /api/curriculum/subjects/:id  { lec_units, lab_units }
router.patch('/subjects/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid subject id.' });
    }

    const { data: subject, error: fetchErr } = await supabase
      .from('subjects')
      .select('id, code, program, units')
      .eq('id', id)
      .single();
    if (fetchErr || !subject) {
      return res.status(404).json({ error: 'Subject not found.' });
    }

    const verdict = validateComponentSplit(subject.units, req.body?.lec_units, req.body?.lab_units);
    if (!verdict.ok) {
      return res.status(400).json({ error: verdict.error });
    }

    const lec = Number(req.body.lec_units);
    const lab = Number(req.body.lab_units);
    const { error } = await supabase
      .from('subjects')
      .update({ lec_units: lec, lab_units: lab })
      .eq('id', id);
    if (error) {
      logError('curriculum/subjects/update', error);
      return res.status(500).json({ error: 'Failed to update the subject.' });
    }

    logAudit(req.user.id, 'CURRICULUM_UPDATE_COMPONENTS', {
      subject_id: id, code: subject.code, program: subject.program,
      lec_units: lec, lab_units: lab,
    });
    res.json({ ok: true });
  } catch (err) {
    logError('curriculum/subjects/update', err);
    res.status(500).json({ error: 'Failed to update the subject.' });
  }
});

// GET /api/curriculum/subjects/:id/prerequisites
router.get('/subjects/:id/prerequisites', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) {
      return res.status(400).json({ error: 'Invalid subject id.' });
    }

    const { data, error } = await supabase
      .from('subject_prerequisites')
      .select('id, subject_id, depends_on_subject_id, kind, detail, depends:depends_on_subject_id(code)')
      .eq('subject_id', id)
      .order('id', { ascending: true });
    if (error) {
      logError('curriculum/prereqs/list', error);
      return res.status(500).json({ error: 'Failed to load prerequisites.' });
    }

    const prerequisites = (data || []).map(r => ({
      id: r.id,
      subject_id: r.subject_id,
      depends_on_subject_id: r.depends_on_subject_id,
      kind: r.kind,
      detail: r.detail,
      depends_code: r.depends?.code || null,
    }));
    res.json({ prerequisites });
  } catch (err) {
    logError('curriculum/prereqs/list', err);
    res.status(500).json({ error: 'Failed to load prerequisites.' });
  }
});

// POST /api/curriculum/prerequisites
// { subject_id, kind, depends_on_subject_id?, detail? }
router.post('/prerequisites', async (req, res) => {
  try {
    const { subject_id, kind, depends_on_subject_id, detail } = req.body || {};
    if (!isValidUUID(subject_id)) {
      return res.status(400).json({ error: 'Invalid subject id.' });
    }
    if (depends_on_subject_id && !isValidUUID(depends_on_subject_id)) {
      return res.status(400).json({ error: 'Invalid dependency subject id.' });
    }

    const verdict = validatePrereqRow({ kind, depends_on_subject_id, detail });
    if (!verdict.ok) {
      return res.status(400).json({ error: verdict.error });
    }

    const { data, error } = await supabase
      .from('subject_prerequisites')
      .insert({
        subject_id,
        kind,
        depends_on_subject_id: depends_on_subject_id || null,
        detail: detail ? detail.trim() : null,
      })
      .select('id')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That prerequisite row already exists for this subject.' });
      }
      logError('curriculum/prereqs/create', error);
      return res.status(500).json({ error: 'Failed to add the prerequisite.' });
    }

    logAudit(req.user.id, 'CURRICULUM_ADD_PREREQ', {
      subject_id, prereq_id: data.id, kind,
      depends_on_subject_id: depends_on_subject_id || null,
      detail: detail || null,
    });
    res.status(201).json({ id: data.id });
  } catch (err) {
    logError('curriculum/prereqs/create', err);
    res.status(500).json({ error: 'Failed to add the prerequisite.' });
  }
});

// DELETE /api/curriculum/prerequisites/:id
// subject_prerequisites.id is a BIGINT identity (unlike subjects.id, which is a UUID).
router.delete('/prerequisites/:id', async (req, res) => {
  try {
    const prereqId = Number(req.params.id);
    if (!Number.isInteger(prereqId) || prereqId <= 0) {
      return res.status(400).json({ error: 'Invalid prerequisite id.' });
    }

    const { data, error } = await supabase
      .from('subject_prerequisites')
      .delete()
      .eq('id', prereqId)
      .select('id')
      .single();
    if (error || !data) {
      return res.status(404).json({ error: 'Prerequisite row not found.' });
    }

    logAudit(req.user.id, 'CURRICULUM_DELETE_PREREQ', { prereq_id: prereqId });
    res.json({ ok: true });
  } catch (err) {
    logError('curriculum/prereqs/delete', err);
    res.status(500).json({ error: 'Failed to remove the prerequisite.' });
  }
});

module.exports = router;
