// =============================================
// server/routes/units.js - Credit Unit Tracker API
// Students manage their own subject enrollment records.
// All ownership checks run against req.user.id (the verified
// Supabase JWT), never against client-supplied IDs.
// =============================================
const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const supabase = require('../lib/supabase');
const PDFDocument = require('pdfkit');
const { isValidEnum, isValidUUID, assertRequired } = require('../lib/validate');
const { logError } = require('../lib/logger');

const VALID_PROGRAMS = ['BSCoE', 'BSCE', 'BSECE'];
const VALID_STATUSES = ['enrolled', 'passed', 'failed', 'dropped', 'incomplete'];
const SCHOOL_YEAR_RE = /^\d{4}-\d{4}$/;

const PROGRAM_NAMES = {
  BSCoE: 'BS Computer Engineering',
  BSCE:  'BS Civil Engineering',
  BSECE: 'BS Electronics Engineering',
};
const STATUS_LABELS = {
  enrolled:   'Enrolled',
  passed:     'Passed',
  failed:     'Failed',
  dropped:    'Dropped',
  incomplete: 'Incomplete',
};
const SEM_LABELS = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer Term' };
const SEM_SHORT  = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };

function isValidGrade(val) {
  if (val === null || val === undefined || val === '') return true;
  const n = Number(val);
  return Number.isFinite(n) && n >= 1 && n <= 5;
}

function normalizeGrade(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

// Optional free-text details (instructor / schedule): trim, cap at 120
// chars, and normalize empty → NULL so "never filled" == "cleared".
function sanitizeOptionalText(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().slice(0, 120);
  return s === '' ? null : s;
}

function isMissingRelation(err) {
  return /relation .* does not exist/i.test(err?.message || '');
}

// GET /api/units/checklists?program=BSCoE
// Curriculum requirements + subjects (optionally filtered by program).
router.get('/checklists', async (req, res) => {
  try {
    const program = req.query.program || null;
    if (program && !isValidEnum(program, VALID_PROGRAMS)) {
      return res.status(400).json({ error: 'Invalid program.' });
    }

    const reqQuery = supabase.from('curriculum_requirements').select('*');
    let subjQuery = supabase
      .from('subjects')
      .select('*')
      .order('year_level', { ascending: true })
      .order('semester',   { ascending: true })
      .order('code',       { ascending: true });
    if (program) subjQuery = subjQuery.eq('program', program);

    const [reqRes, subjRes, prereqRes] = await Promise.all([
      reqQuery,
      subjQuery,
      supabase
        .from('subject_prerequisites')
        .select('id, subject_id, depends_on_subject_id, kind, detail, depends_on_subject_id(code)')
        .order('id', { ascending: true }),
    ]);
    if (reqRes.error || subjRes.error) {
      if (isMissingRelation(reqRes.error || subjRes.error)) {
        return res.status(503).json({ error: 'The credit unit tracker is not set up yet. Please run the 005_credit_unit_tracker.sql migration in the Supabase SQL console.' });
      }
      logError('units/checklists', reqRes.error || subjRes.error);
      return res.status(500).json({ error: 'Failed to load the curriculum.' });
    }

    // Graceful degradation: migration 031 not applied yet -> empty prereq list.
    let prerequisites = [];
    if (prereqRes.error) {
      if (!isMissingRelation(prereqRes.error)) {
        logError('units/checklists/prereqs', prereqRes.error);
      }
    } else {
      prerequisites = (prereqRes.data || []).map(r => ({
        id: r.id,
        subject_id: r.subject_id,
        kind: r.kind,
        detail: r.detail,
        depends_code: r.depends_on_subject_id?.code || null,
      }));
    }

    res.json({ requirements: reqRes.data, subjects: subjRes.data, prerequisites: prerequisites });
  } catch (err) {
    logError('units/checklists', err);
    res.status(500).json({ error: 'Failed to load the curriculum.' });
  }
});

// GET /api/units/my
// The logged-in student's enrollment records, joined with subject details.
router.get('/my', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('student_units')
      .select('id, school_year, semester, grade, status, created_at, instructor, schedule, subjects(id, code, title, units, lec_units, lab_units, program, year_level, semester)')
      .eq('student_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      if (isMissingRelation(error)) {
        return res.status(503).json({ error: 'The credit unit tracker is not set up yet. Please run the 005_credit_unit_tracker.sql migration in the Supabase SQL console.' });
      }
      logError('units/my', error);
      return res.status(500).json({ error: 'Failed to load your units.' });
    }

    res.json(data);
  } catch (err) {
    logError('units/my', err);
    res.status(500).json({ error: 'Failed to load your units.' });
  }
});

// GET /api/units/standing
// PDF transcript of the student's academic standing - every subject from
// Year 1 to 4 with units, status, grade, and school year, laid out on the
// institutional letterhead (LETTER TEMPLATE.docx).
router.get('/standing', async (req, res) => {
  try {
    const studentProgram = VALID_PROGRAMS.find(
      p => p.toUpperCase() === String(req.profile?.course || '').trim().toUpperCase()
    );
    if (!studentProgram) {
      return res.status(400).json({ error: 'No enrolled program on your profile - cannot build a standing report.' });
    }

    const [reqRes, subjRes, myRes] = await Promise.all([
      supabase.from('curriculum_requirements').select('*').eq('program', studentProgram).single(),
      supabase.from('subjects').select('*').eq('program', studentProgram)
        .order('year_level', { ascending: true })
        .order('semester',   { ascending: true })
        .order('code',       { ascending: true }),
      supabase.from('student_units').select('*').eq('student_id', req.user.id),
    ]);

    if (reqRes.error || subjRes.error || myRes.error) {
      logError('units/standing', reqRes.error || subjRes.error || myRes.error);
      return res.status(500).json({ error: 'Failed to load standing data.' });
    }

    const subjects = subjRes.data || [];
    const records  = myRes.data || [];
    const total    = Number(reqRes.data?.total_units) || 0;

    // Summary - a passed subject counts once (mirrors the tracker's progress)
    const passedIds = new Set(records.filter(r => r.status === 'passed').map(r => r.subject_id));
    const completed = subjects
      .filter(s => passedIds.has(s.id))
      .reduce((sum, s) => sum + Number(s.units || 0), 0);
    const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

    // Newest record per subject wins (API stores newest first)
    const recordBySubject = new Map();
    records.forEach(r => {
      if (!recordBySubject.has(r.subject_id)) recordBySubject.set(r.subject_id, r);
    });

    const enrolledYear = Number(req.profile?.enrollment_year) || null;
    const created = req.profile?.created_at ? new Date(req.profile.created_at) : null;
    const gradYear = enrolledYear
      ? enrolledYear + 4
      : (created && !isNaN(created) ? created.getFullYear() + 4 : new Date().getFullYear() + 4);

    const fullName = req.profile?.full_name || req.user.email || 'Student';

    // ── Build PDF ──
    // Institutional letter format from LETTER TEMPLATE.docx: long-bond paper
    // (8.5" × 13"), 1" margins, the letterhead banner repeated on every page,
    // and a footer with the school seal + institution name. The template's
    // Calibri/Georgia are approximated by Helvetica (pdfkit's built-in fonts).
    const doc = new PDFDocument({ size: [612, 936], margin: 72 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition',
      `attachment; filename="Academic-Standing-${fullName.replace(/[^a-zA-Z0-9]+/g, '-')}-${studentProgram}.pdf"`);
    doc.pipe(res);

    const primary   = '#1a1f35';  /* ink */
    const accent    = '#ed2024';  /* template letterhead red - sole accent */
    const textMuted = '#64748b';
    const faint     = '#e2e8f0';  /* hairlines / track */
    const veryLight = '#f8fafc';  /* alternating row fill */
    const contentLeft  = 72;
    const contentRight = 540;
    const pageWidth    = contentRight - contentLeft; /* 468 */

    const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    // Letterhead assets extracted from the template (repeated on every page)
    const bannerPath = path.join(__dirname, '../../client/assets/letterhead-banner.jpg');
    const logoPath   = path.join(__dirname, '../../client/assets/coe-logo.png');
    const hasBanner  = fs.existsSync(bannerPath);
    const hasLogo    = fs.existsSync(logoPath);

    function drawLetterhead() {
      // Preserve the caller's cursor - doc.text()/doc.image() move doc.x/doc.y,
      // and this handler runs inside addPage() where tableHeader() then reads
      // the cursor to position the next table on the fresh page.
      const savedX = doc.x, savedY = doc.y;
      // Full-bleed letterhead banner across the top
      if (hasBanner) doc.image(bannerPath, 0, 0, { width: 612 });
      // Footer - matches LETTER TEMPLATE.docx: a light rule, then the COE logo
      // with COLLEGE OF ENGINEERING in Times bold (the template's footer type)
      // at the bottom-left. The template anchors this in the footer zone below
      // the 1" bottom margin (936 - 72 = 864), so relax the page's bottom
      // margin while drawing; text flowing past the margin would otherwise
      // open a new page, which re-fires pageAdded and recurses.
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fillColor('#9c9898').rect(0, 878, 612, 4).fill();
      if (hasLogo) doc.image(logoPath, 40, 886, { width: 36, height: 36 });
      doc.fillColor(primary).font('Times-Bold').fontSize(12)
         .text('COLLEGE OF ENGINEERING', 84, 897);
      doc.page.margins.bottom = savedBottom;
      // Continuation pages start their content below the letterhead banner
      // (which fills the top ~80pt), not at the top margin.
      doc.x = savedX; doc.y = Math.max(savedY, 92);
    }
    doc.on('pageAdded', drawLetterhead);
    // The first page is created inside the PDFDocument constructor, before the
    // pageAdded handler above is attached, so draw the letterhead on it once.
    drawLetterhead();

    // ── Page 1: report title below the banner ──
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(14)
       .text('OFFICIAL ACADEMIC STANDING REPORT', contentLeft, 94);
    doc.font('Helvetica').fontSize(9.5).fillColor(textMuted)
       .text('Subject Status Report - Year 1 to 4', contentLeft, 115);

    // ── Student information - two-column metadata block ──
    const metaTop = 136;
    const metaH   = 12 + 4 * 16 + 10;
    doc.rect(contentLeft, metaTop, pageWidth, metaH).fillAndStroke(veryLight, faint);
    const leftMeta = [
      ['Name',            fullName],
      ['Email',           req.user.email],
      ['Enrollment Year', enrolledYear || '-'],
      ['Generated',       generated],
    ];
    const rightMeta = [
      ['     Program',              PROGRAM_NAMES[studentProgram] || studentProgram],
      ['     Estimated Graduation', String(gradYear)],
    ];
    leftMeta.forEach(([label, value], i) => {
      const y = metaTop + 12 + i * 16;
      doc.fillColor(textMuted).font('Helvetica-Bold').fontSize(8)
         .text(label, contentLeft + 12, y);
      doc.fillColor(primary).font('Helvetica').fontSize(9)
         .text(value, contentLeft + 100, y, { width: 140 });
    });
    rightMeta.forEach(([label, value], i) => {
      const y = metaTop + 12 + i * 16;
      doc.fillColor(textMuted).font('Helvetica-Bold').fontSize(8)
         .text(label, 305, y);
      doc.fillColor(primary).font('Helvetica').fontSize(8.5)
         .text(value, 428, y, { width: 110 });
    });
    doc.y = metaTop + metaH + 10;

    // ── Progress summary - vector bar (PDFKit has no text glyphs for block
    //    characters in its built-in fonts, so the bar is drawn with shapes) ──
    doc.fillColor(textMuted).font('Helvetica-Bold').fontSize(8.5)
       .text('PROGRESS', contentLeft, doc.y);
    const trackTop = doc.y + 4;
    doc.roundedRect(contentLeft, trackTop, pageWidth, 12, 6).fill(faint);
    const fillW = total > 0 ? Math.max(12, (pageWidth * pct) / 100) : 0;
    if (fillW > 0) doc.roundedRect(contentLeft, trackTop, fillW, 12, 6).fill(accent);
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(9.5)
       .text(`${pct}% complete (${completed} / ${total || '-'} units completed)`, contentLeft, trackTop + 18, { width: pageWidth });
    doc.moveDown(5);

    // ── Subject table ──
    const cols = { code: 72, title: 126, units: 298, sy: 332, sem: 392, status: 442, grade: 504 };
    const colW = { code: 52, title: 170, units: 32, sy: 58, sem: 48, status: 60, grade: 36 };

    function tableHeader() {
      const y = doc.y;
      doc.rect(contentLeft, y, pageWidth, 20).fill(veryLight);
      doc.fillColor(primary).font('Helvetica-Bold').fontSize(7.5);
      doc.text('CODE',         cols.code,  y + 7, { width: colW.code });
      doc.text('SUBJECT TITLE', cols.title, y + 7, { width: colW.title });
      doc.text('UNITS',        cols.units, y + 7, { width: colW.units, align: 'right' });
      doc.text('SCHOOL YEAR',  cols.sy,    y + 7, { width: colW.sy });
      doc.text('SEM',          cols.sem,   y + 7, { width: colW.sem });
      doc.text('STATUS',       cols.status,y + 7, { width: colW.status });
      doc.text('GRADE',        cols.grade, y + 7, { width: colW.grade, align: 'right' });
      doc.rect(contentLeft, y + 20, pageWidth, 1).fill(faint); // hairline under the header
      return y + 21;
    }

    const statusColors = {
      passed:     '#10b981',
      enrolled:   '#f97316',
      failed:     '#ef4444',
      incomplete: '#f59e0b',
      dropped:    '#64748b',
      'not taken': '#94a3b8',
    };

    // Keep rows clear of the footer letterhead (footer sits at ~820–854)
    const pageBottom = 800;

    let rowY = tableHeader();
    let band = 0;
    const years = [1, 2, 3, 4].filter(y => subjects.some(s => s.year_level === y));

    years.forEach(year => {
      // Year banner - light band with a 3px accent left bar, no heavy fill
      if (rowY > pageBottom - 60) { doc.addPage(); rowY = tableHeader(); }
      doc.rect(contentLeft, rowY, pageWidth, 20).fill(veryLight);
      doc.rect(contentLeft, rowY, 3, 20).fill(accent);
      doc.fillColor(primary).font('Helvetica-Bold').fontSize(10).text(`YEAR ${year}`, contentLeft + 10, rowY + 5);
      rowY += 20;

      [1, 2, 3].filter(sem => subjects.some(s => s.year_level === year && s.semester === sem))
        .forEach(sem => {
          // Semester sub-header - italic gray
          if (rowY > pageBottom - 40) { doc.addPage(); rowY = tableHeader(); }
          doc.fillColor(textMuted).font('Helvetica-Oblique').fontSize(8.5)
             .text(`${SEM_LABELS[sem] || 'Semester ' + sem}`, contentLeft + 10, rowY + 2);
          rowY += 15;

          subjects.filter(s => s.year_level === year && s.semester === sem).forEach(s => {
            const rec = recordBySubject.get(s.id);
            const status = rec?.status || 'not taken';
            const titleH = doc.heightOfString(s.title, { width: colW.title });
            const rowH = Math.max(20, titleH + 10);
            if (rowY + rowH > pageBottom) { doc.addPage(); rowY = tableHeader(); }

            const bg = band % 2 === 0 ? '#ffffff' : veryLight;
            doc.rect(contentLeft, rowY, pageWidth, rowH).fill(bg);
            doc.rect(contentLeft, rowY + rowH - 0.5, pageWidth, 0.5).fill(faint); // hairline row border

            doc.fillColor('#475569').font('Helvetica').fontSize(8.5)
               .text(s.code, cols.code, rowY + 6, { width: colW.code });
            doc.fillColor(primary).font('Helvetica').fontSize(8.5)
               .text(s.title, cols.title, rowY + 6, { width: colW.title, height: rowH - 8 });
            doc.fillColor(textMuted).font('Helvetica').fontSize(8.5)
               .text(String(s.units), cols.units, rowY + 6, { width: colW.units, align: 'right' });
            doc.text(rec?.school_year || '-', cols.sy, rowY + 6, { width: colW.sy });
            doc.text(SEM_SHORT[rec?.semester ?? s.semester] || '-', cols.sem, rowY + 6, { width: colW.sem });
            doc.fillColor(statusColors[status] || textMuted).font('Helvetica-Bold').fontSize(8)
               .text((STATUS_LABELS[status] || status).toUpperCase(), cols.status, rowY + 6, { width: colW.status });
            doc.fillColor(textMuted).font('Helvetica').fontSize(8.5)
               .text(rec?.grade != null ? String(rec.grade) : '-', cols.grade, rowY + 6, { width: colW.grade, align: 'right' });

            rowY += rowH;
            band++;
          });
        });
    });

    // ── Final page - summary + signature block ──
    doc.addPage();
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(13).text('SUMMARY', contentLeft, 94);
    doc.rect(contentLeft, 106, 60, 2).fill(accent);

    const sumY = 122;
    doc.fillColor(textMuted).font('Helvetica').fontSize(9.5)
       .text('Subjects Passed:', contentLeft, sumY);
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(10.5)
       .text(String(passedIds.size), contentLeft + 100, sumY);
    doc.fillColor(textMuted).font('Helvetica').fontSize(9.5)
       .text('Units Completed:', contentLeft, sumY + 20);
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(10.5)
       .text(`${completed} / ${total || '-'}`, contentLeft + 100, sumY + 20);
    doc.fillColor(textMuted).font('Helvetica').fontSize(9.5)
       .text('Progress:', 300, sumY);
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(10.5)
       .text(`${pct}%`, 380, sumY);
    doc.fillColor(textMuted).font('Helvetica').fontSize(9.5)
       .text('Est. Graduation:', 300, sumY + 20);
    doc.fillColor(primary).font('Helvetica-Bold').fontSize(10.5)
       .text(String(gradYear), 380, sumY + 20);

    // Signature block
    const sigY = sumY + 70;
    doc.moveTo(contentLeft, sigY).lineTo(contentLeft + 180, sigY).lineWidth(1).strokeColor(faint).stroke();
    doc.moveTo(300, sigY).lineTo(480, sigY).lineWidth(1).strokeColor(faint).stroke();
    doc.fillColor(textMuted).font('Helvetica').fontSize(8.5)
       .text('Student Signature', contentLeft, sigY + 6);
    doc.text('Date', 300, sigY + 6);
    doc.moveDown(3);
    doc.fillColor(textMuted).font('Helvetica-Oblique').fontSize(8)
       .text('This document is system-generated and unofficial unless bearing the Office of the Registrar\'s seal.', contentLeft, doc.y + 6, { width: pageWidth });

    doc.end();
  } catch (err) {
    logError('units/standing', err);
    res.status(500).json({ error: 'Failed to generate the standing report.' });
  }
});

// POST /api/units/enroll
// Log a subject for the current student.
router.post('/enroll', async (req, res) => {
  try {
    const { subject_id, school_year, semester, status = 'enrolled', grade = null, instructor = null, schedule = null } = req.body || {};

    const missing = assertRequired({ subject_id, school_year, semester });
    if (missing) return res.status(400).json({ error: missing });
    if (!isValidUUID(subject_id))                return res.status(400).json({ error: 'Invalid subject id.' });
    if (!SCHOOL_YEAR_RE.test(school_year))       return res.status(400).json({ error: 'School year must look like "2026-2027".' });
    if (![1, 2, 3].includes(Number(semester)))   return res.status(400).json({ error: 'Semester must be 1, 2, or 3 (summer).' });
    if (!isValidEnum(status, VALID_STATUSES))    return res.status(400).json({ error: 'Invalid status.' });
    if (!isValidGrade(grade))                    return res.status(400).json({ error: 'Grade must be between 1.0 and 5.0.' });

    // Subject must exist and belong to the student's enrolled program -
    // students can only log subjects from their own course.
    const { data: subject, error: subjErr } = await supabase
      .from('subjects')
      .select('id, program')
      .eq('id', subject_id)
      .single();
    if (subjErr || !subject) return res.status(404).json({ error: 'Subject not found.' });

    // Students can only log subjects from their own course. Match
    // case/whitespace-insensitively so profiles storing " bscoe " or
    // "BSCOE" still resolve to the canonical program code.
    const studentProgram = VALID_PROGRAMS.find(
      p => p.toUpperCase() === String(req.profile?.course || '').trim().toUpperCase()
    );
    if (!studentProgram || subject.program !== studentProgram) {
      return res.status(403).json({ error: 'You can only log subjects from your enrolled program.' });
    }

    const { error } = await supabase
      .from('student_units')
      .upsert({
        student_id: req.user.id,
        subject_id,
        school_year,
        semester: Number(semester),
        status,
        grade: normalizeGrade(grade),
        instructor: sanitizeOptionalText(instructor),
        schedule: sanitizeOptionalText(schedule),
      }, {
        onConflict: 'student_id,subject_id,school_year,semester',
      });

    if (error) {
      logError('units/enroll', error);
      return res.status(500).json({ error: 'Failed to log the subject.' });
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    logError('units/enroll', err);
    res.status(500).json({ error: 'Failed to log the subject.' });
  }
});

// POST /api/units/batch-enroll
// Bulk log or update multiple subjects for the current student in one single atomic call.
router.post('/batch-enroll', async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required.' });
    }
    if (items.length > 80) {
      return res.status(400).json({ error: 'Cannot log more than 80 subjects at once.' });
    }

    const studentProgram = VALID_PROGRAMS.find(
      p => p.toUpperCase() === String(req.profile?.course || '').trim().toUpperCase()
    );

    const subjectIds = items.map(it => it.subject_id).filter(isValidUUID);
    if (subjectIds.length !== items.length) {
      return res.status(400).json({ error: 'All items must have a valid subject_id UUID.' });
    }

    const { data: dbSubjects, error: fetchErr } = await supabase
      .from('subjects')
      .select('id, program')
      .in('id', subjectIds);

    if (fetchErr) {
      logError('units/batch-enroll fetch', fetchErr);
      return res.status(500).json({ error: 'Failed to verify subjects.' });
    }

    const validSubjectMap = new Map((dbSubjects || []).map(s => [s.id, s]));

    const rowsToUpsert = [];
    for (const item of items) {
      const { subject_id, school_year, semester, status = 'enrolled', grade = null } = item;
      if (!SCHOOL_YEAR_RE.test(school_year)) {
        return res.status(400).json({ error: `Invalid school year format: ${school_year}` });
      }
      if (![1, 2, 3].includes(Number(semester))) {
        return res.status(400).json({ error: `Invalid semester: ${semester}` });
      }
      if (!isValidEnum(status, VALID_STATUSES)) {
        return res.status(400).json({ error: `Invalid status: ${status}` });
      }
      if (!isValidGrade(grade)) {
        return res.status(400).json({ error: `Invalid grade: ${grade}` });
      }

      const subj = validSubjectMap.get(subject_id);
      if (!subj) {
        return res.status(404).json({ error: `Subject ${subject_id} not found.` });
      }
      if (studentProgram && subj.program !== studentProgram) {
        return res.status(403).json({ error: 'You can only log subjects from your enrolled program.' });
      }

      rowsToUpsert.push({
        student_id: req.user.id,
        subject_id,
        school_year,
        semester: Number(semester),
        status,
        grade: normalizeGrade(grade),
      });
    }

    const { error: upsertErr } = await supabase
      .from('student_units')
      .upsert(rowsToUpsert, {
        onConflict: 'student_id,subject_id,school_year,semester',
      });

    if (upsertErr) {
      logError('units/batch-enroll upsert', upsertErr);
      return res.status(500).json({ error: 'Failed to batch log subjects.' });
    }

    res.status(200).json({ ok: true, count: rowsToUpsert.length });
  } catch (err) {
    logError('units/batch-enroll', err);
    res.status(500).json({ error: 'Failed to batch log subjects.' });
  }
});

// PATCH /api/units/update/:id
// Update status / grade / school year / semester of one of the student's records.
router.patch('/update/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid record id.' });

    const { data: existing, error: fetchErr } = await supabase
      .from('student_units')
      .select('id')
      .eq('id', id)
      .eq('student_id', req.user.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Record not found.' });

    const { status, grade, school_year, semester, instructor, schedule } = req.body || {};
    const updates = {};

    if (status !== undefined) {
      if (!isValidEnum(status, VALID_STATUSES)) return res.status(400).json({ error: 'Invalid status.' });
      updates.status = status;
    }
    if (grade !== undefined) {
      if (!isValidGrade(grade)) return res.status(400).json({ error: 'Grade must be between 1.0 and 5.0.' });
      updates.grade = normalizeGrade(grade);
    }
    if (school_year !== undefined) {
      if (!SCHOOL_YEAR_RE.test(school_year)) return res.status(400).json({ error: 'School year must look like "2026-2027".' });
      updates.school_year = school_year;
    }
    if (semester !== undefined) {
      if (![1, 2, 3].includes(Number(semester))) return res.status(400).json({ error: 'Semester must be 1, 2, or 3 (summer).' });
      updates.semester = Number(semester);
    }
    if (instructor !== undefined) updates.instructor = sanitizeOptionalText(instructor);
    if (schedule !== undefined) updates.schedule = sanitizeOptionalText(schedule);
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const { error } = await supabase
      .from('student_units')
      .update(updates)
      .eq('id', id)
      .eq('student_id', req.user.id);

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Another record already exists for that school year and semester.' });
      }
      logError('units/update', error);
      return res.status(500).json({ error: 'Failed to update the record.' });
    }

    res.json({ ok: true });
  } catch (err) {
    logError('units/update', err);
    res.status(500).json({ error: 'Failed to update the record.' });
  }
});

// DELETE /api/units/drop/:id
// Remove one of the student's records (e.g. dropped subject).
router.delete('/drop/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!isValidUUID(id)) return res.status(400).json({ error: 'Invalid record id.' });

    const { data: existing, error: fetchErr } = await supabase
      .from('student_units')
      .select('id')
      .eq('id', id)
      .eq('student_id', req.user.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Record not found.' });

    const { error } = await supabase
      .from('student_units')
      .delete()
      .eq('id', id)
      .eq('student_id', req.user.id);

    if (error) {
      logError('units/drop', error);
      return res.status(500).json({ error: 'Failed to remove the record.' });
    }

    res.json({ ok: true });
  } catch (err) {
    logError('units/drop', err);
    res.status(500).json({ error: 'Failed to remove the record.' });
  }
});

module.exports = router;
