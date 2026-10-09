// =============================================
// enrollment-journey.js - Pure journey-state model for Enrollment Verification.
// Maps server submission states to student-visible journey steps + actions.
// UMD: browsers get window.EnrollmentJourney; Node tests require() it.
// The browser branch is tested first: the Vite bundle wraps this file with a
// CommonJS shim, so a module.exports check would win there and the window
// global would never be set.
// =============================================
(function (root, factory) {
  if (root && root.document) root.EnrollmentJourney = factory();
  else if (typeof module === 'object' && module.exports) module.exports = factory();
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

  // Newest record per subject decides its state (the API returns newest
  // first). A subject whose newest record is 'failed' is a retake candidate.
  function failedCodes(records) {
    var seen = new Set();
    var failed = new Set();
    (records || []).forEach(function (u) {
      var code = normCode(u && u.subjects && u.subjects.code);
      if (!code || seen.has(code)) return;
      seen.add(code);
      if (u.status === 'failed') failed.add(code);
    });
    return failed;
  }

  function passedAndEnrolled(records) {
    var seen = new Set();
    var passed = new Set();
    var enrolled = new Set();
    (records || []).forEach(function (u) {
      var code = normCode(u && u.subjects && u.subjects.code);
      if (!code || seen.has(code)) return;
      seen.add(code);
      if (u.status === 'passed') passed.add(code);
      else if (u.status === 'enrolled') enrolled.add(code);
    });
    return { passed: passed, enrolled: enrolled };
  }

  // Subjects a student may add to a load. Passed and currently enrolled
  // subjects are out. A failed subject is offered from any year (retake).
  // Everything else stays inside the one-year window below the student's
  // level; yearLevel 0 means no window. Each result carries `retake`.
  function eligibleSubjects(subjects, records, yearLevel) {
    var state = passedAndEnrolled(records);
    var failed = failedCodes(records);
    var year = Number(yearLevel) || 0;
    return (subjects || []).filter(function (s) {
      var code = normCode(s && s.code);
      if (!code || state.passed.has(code) || state.enrolled.has(code)) return false;
      if (failed.has(code)) return true;
      return !year || Number(s.year_level) >= year - 1;
    }).map(function (s) {
      var copy = {};
      for (var k in s) copy[k] = s[k];
      copy.retake = failed.has(normCode(s.code));
      return copy;
    });
  }

  // A load belongs to one semester; adding the other semester's subject is
  // refused with a sentence the student can act on. Null means no problem.
  function semesterMismatch(subject, term) {
    if (!subject || !term || !term.semester || !subject.semester) return null;
    if (Number(subject.semester) === Number(term.semester)) return null;
    return subject.code + ' is a Semester ' + subject.semester + ' subject; this load is for Semester ' + term.semester + '.';
  }

  // Prerequisite codes the student has not passed. Structured rows win; the
  // legacy free-text `prerequisites` field is the fallback. Corequisites are
  // not blockers here (they are taken together).
  function unmetPrerequisites(subject, rows, passedCodes) {
    var passed = passedCodes || new Set();
    var codes = [];
    var structured = (rows || []).filter(function (r) { return r && r.subject_id === subject.id && r.kind === 'prerequisite'; });
    if (structured.length) {
      structured.forEach(function (r) {
        var dep = r.depends_on_subject_id;
        var code = normCode(dep && typeof dep === 'object' ? dep.code : (r.depends_on_code || ''));
        if (code) codes.push(code);
      });
    } else if (subject.prerequisites) {
      String(subject.prerequisites).split(/[,;/]|\band\b/i).forEach(function (part) {
        var code = normCode(part.replace(/^(?:pre[- ]?req(?:uisite)?s?|requires?|depends?)\s*:?\s*/i, ''));
        if (/^[A-Z]{2,5}\s?\d{2,4}[A-Z]?$/.test(code)) codes.push(code);
      });
    }
    return codes.filter(function (c, i) { return codes.indexOf(c) === i && !passed.has(c); });
  }

  // Units in the active load against the program cap (null cap = no limit).
  function loadUnits(sub, cap) {
    var total = activeItems(sub).reduce(function (sum, i) {
      return sum + (Number(i.subjects && i.subjects.units) || 0);
    }, 0);
    var limit = cap == null ? null : Number(cap);
    return { total: total, cap: limit, over: limit != null && total > limit };
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

  return { STEPS: STEPS, stepOf: stepOf, canEdit: canEdit, actionFor: actionFor, toneFor: toneFor, activeItems: activeItems, filterAvailable: filterAvailable,
    failedCodes: failedCodes, eligibleSubjects: eligibleSubjects, semesterMismatch: semesterMismatch, unmetPrerequisites: unmetPrerequisites, loadUnits: loadUnits };
});
