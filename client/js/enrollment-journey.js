// =============================================
// enrollment-journey.js - Pure journey-state model for Enrollment Verification.
// Maps server submission states to student-visible journey steps + actions.
// UMD: browsers get window.EnrollmentJourney; Node tests require() it.
// =============================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EnrollmentJourney = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Four student-visible steps. `key` is stable; `label` is student copy.
  var STEPS = [
    { key: 'build',     label: 'Build your load',            short: 'Build' },
    { key: 'with-head', label: 'With your Program Head',     short: 'Head review' },
    { key: 'verified',  label: 'Verified: Final Load',       short: 'Verified' },
    { key: 'encoded',   label: 'Encoded: Complete',          short: 'Encoded' }
  ];

  function activeItems(sub) {
    return ((sub && sub.enrollment_submission_items) || [])
      .filter(function (i) { return i.item_state !== 'removed_by_head'; });
  }

  function normCode(code) {
    return String(code || '').trim().toUpperCase();
  }

  // Curriculum subjects the student can still take: excludes anything already
  // passed or currently enrolled (codes compared case/space-insensitively).
  function filterAvailable(subjects, passedCodes, enrolledCodes) {
    var passed = passedCodes || new Set();
    var enrolled = enrolledCodes || new Set();
    return (subjects || []).filter(function (s) {
      var code = normCode(s && s.code);
      return code && !passed.has(code) && !enrolled.has(code);
    });
  }

  // Server status -> { stepIndex, state, stepKey }.
  // state: 'current' | 'done' | 'upcoming' | 'defensive'
  function stepOf(sub) {
    if (!sub) return { stepIndex: 0, state: 'upcoming', stepKey: 'build' };
    var status = sub.status;
    if (status === 'draft') return { stepIndex: 0, state: 'current', stepKey: 'build' };
    if (status === 'submitted' || status === 'under_review') return { stepIndex: 1, state: 'current', stepKey: 'with-head' };
    if (status === 'approved') {
      return sub.encoded_at
        ? { stepIndex: 3, state: 'current', stepKey: 'encoded' }
        : { stepIndex: 2, state: 'current', stepKey: 'verified' };
    }
    // returned / rejected are legacy-only (spec D8): never reachable from the UI.
    return { stepIndex: 0, state: 'defensive', stepKey: 'build', legacyStatus: status };
  }

  function canEdit(sub) {
    return !!sub && sub.status === 'draft';
  }

  // One primary action per state (spec §5.3).
  function actionFor(sub) {
    if (!sub) return { kind: 'none', label: '', hint: '' };
    if (sub.status === 'draft') {
      var count = activeItems(sub).length;
      return count > 0
        ? { kind: 'submit', label: 'Submit to Program Head', hint: '' }
        : { kind: 'none', label: '', hint: 'Add at least one subject to submit your load.' };
    }
    if (sub.status === 'submitted') return { kind: 'none', label: '', hint: 'Your load was sent. You will be notified when your Program Head responds.' };
    if (sub.status === 'under_review') return { kind: 'none', label: '', hint: 'Your Program Head is reviewing your load. You will be notified when they respond.' };
    if (sub.status === 'approved' && !sub.encoded_at) return { kind: 'none', label: '', hint: 'Your load is verified. Nothing needed from you right now. Your final list was emailed to you.' };
    if (sub.status === 'approved' && sub.encoded_at) return { kind: 'none', label: '', hint: '' };
    return { kind: 'none', label: '', hint: 'This submission is no longer editable. Contact your Program Head or the COE office.' };
  }

  function toneFor(sub) {
    if (!sub) return 'neutral';
    if (sub.status === 'approved') return 'success';
    if (sub.status === 'submitted' || sub.status === 'under_review') return 'warning';
    if (sub.status === 'returned' || sub.status === 'rejected') return 'danger';
    return 'neutral';
  }

  return { STEPS: STEPS, stepOf: stepOf, canEdit: canEdit, actionFor: actionFor, toneFor: toneFor, activeItems: activeItems, filterAvailable: filterAvailable };
});
