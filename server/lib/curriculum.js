// =============================================
// server/lib/curriculum.js - Pure validation helpers for the
// Curriculum API. No dependencies so smoke tests can require it directly.
// =============================================
const PREREQ_KINDS = ['prerequisite', 'corequisite', 'year_standing', 'special'];

function validateComponentSplit(units, lec, lab) {
  const u = Number(units);
  const l = Number(lec);
  const b = Number(lab);
  if (!Number.isInteger(l) || !Number.isInteger(b) || l < 0 || b < 0) {
    return { ok: false, error: 'Lecture and laboratory units must be non-negative integers.' };
  }
  if (l + b !== u) {
    return { ok: false, error: `Lecture + laboratory units (${l} + ${b}) must equal the subject's total units (${u}).` };
  }
  return { ok: true };
}

function validatePrereqRow({ kind, depends_on_subject_id, detail }) {
  if (!PREREQ_KINDS.includes(kind)) {
    return { ok: false, error: `Kind must be one of: ${PREREQ_KINDS.join(', ')}.` };
  }
  const hasSubject = Boolean(depends_on_subject_id);
  const hasDetail = typeof detail === 'string' && detail.trim().length > 0;
  if (kind === 'prerequisite' || kind === 'corequisite') {
    if (!hasSubject) {
      return { ok: false, error: 'A prerequisite or corequisite row must reference a subject.' };
    }
    if (hasDetail) {
      return { ok: false, error: 'Only year-standing and special rows carry detail text.' };
    }
  } else {
    if (hasSubject) {
      return { ok: false, error: 'Year-standing and special rows must not reference a subject.' };
    }
    if (!hasDetail) {
      return { ok: false, error: 'A year-standing or special row requires detail text.' };
    }
  }
  return { ok: true };
}

module.exports = { PREREQ_KINDS, validateComponentSplit, validatePrereqRow };
