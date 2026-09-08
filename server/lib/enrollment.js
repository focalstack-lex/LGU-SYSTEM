// =============================================
// server/lib/enrollment.js - Pure submission state machine.
// No dependencies so smoke tests can require it directly.
// =============================================
const SUBMISSION_STATUSES = ['draft', 'submitted', 'under_review', 'approved', 'returned', 'rejected'];
const TERMINAL_STATUSES = ['approved', 'rejected'];

// Legal status transitions. approved->approved exists so re-approval is a
// recognizable no-op, never an error.
const TRANSITIONS = {
  draft:        ['submitted'],
  submitted:    ['under_review', 'approved', 'returned', 'rejected'],
  under_review: ['approved', 'returned', 'rejected'],
  returned:     ['submitted'],
  approved:     ['approved'],
  rejected:     [],
};

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

function canStudentEdit(status) {
  return status === 'draft' || status === 'returned';
}

function canHeadAct(status) {
  return status === 'submitted' || status === 'under_review';
}

module.exports = { SUBMISSION_STATUSES, TERMINAL_STATUSES, TRANSITIONS, canTransition, canStudentEdit, canHeadAct };
