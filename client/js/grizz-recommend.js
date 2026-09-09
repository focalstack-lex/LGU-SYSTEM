// =============================================
// grizz-recommend.js - Pure "next semester" load recommendation engine.
// Decides which subjects Grizz suggests for the upcoming term by:
//   1. resolving the target term (active load submission > history > default),
//   2. scoping candidates to that term's curriculum slot + lower-year backlog,
//   3. enforcing prereq/co-req/standing gates (structured rows or legacy text),
//   4. capping the load at BOTH 5 subjects AND 24 units.
// UMD: browsers get window.GrizzRecommend; Node tests require() it.
// =============================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GrizzRecommend = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_SUBJECTS = 5;
  var MAX_UNITS = 24;

  function clampYear(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(4, n));
  }

  function startYearOf(sy) {
    var n = parseInt(String(sy || '').slice(0, 4), 10);
    return Number.isFinite(n) ? n : null;
  }

  function label(start) { return start + '-' + (start + 1); }

  // Component-aware pass classification (mirrors ai-assistant.js).
  // passedCodes / enrolledCodes gate prerequisites; attemptedCodes marks any
  // code that has ever appeared in the student's record (failed/incomplete/
  // dropped retakes) so Grizz can label and reprioritize retakes.
  function classifyPasses(records) {
    var passedCodes = new Set();
    var enrolledCodes = new Set();
    var attemptedCodes = new Set();
    var seen = new Set();
    (records || []).forEach(function (u) {
      var code = String((u.subjects && u.subjects.code) || '').trim().toUpperCase();
      if (!code || seen.has(code)) return;
      seen.add(code);
      attemptedCodes.add(code);
      var lecPassed = u.lec_status === 'passed';
      var labPassed = u.lab_status === 'passed';
      if (u.status === 'passed' || (lecPassed && labPassed)) {
        passedCodes.add(code);
      } else if (u.status === 'enrolled') {
        enrolledCodes.add(code);
      }
    });
    return { passedCodes: passedCodes, enrolledCodes: enrolledCodes, attemptedCodes: attemptedCodes };
  }

  // Most recent term present in the student's unit history.
  // Returns { start, semester, maxYear } or null. maxYear = highest subject
  // year_level enrolled in that term (the student's standing that term).
  function mostRecentTerm(records) {
    var best = null;
    (records || []).forEach(function (u) {
      var start = startYearOf(u.school_year);
      var sem = Number(u.semester);
      if (!start || !sem) return;
      if (!best || start > best.start || (start === best.start && sem > best.semester)) {
        best = { start: start, semester: sem, maxYear: 0 };
      }
    });
    if (!best) return null;
    var maxYear = 0;
    (records || []).forEach(function (u) {
      var start = startYearOf(u.school_year);
      if (start === best.start && Number(u.semester) === best.semester) {
        var yl = Number((u.subjects && u.subjects.year_level)) || 0;
        if (yl > maxYear) maxYear = yl;
      }
    });
    best.maxYear = maxYear;
    return best;
  }

  function termWithSemester(records, semester, start) {
    var maxYear = 0;
    var found = false;
    (records || []).forEach(function (u) {
      if (startYearOf(u.school_year) === start && Number(u.semester) === semester) {
        found = true;
        var yl = Number((u.subjects && u.subjects.year_level)) || 0;
        if (yl > maxYear) maxYear = yl;
      }
    });
    return found ? { start: start, semester: semester, maxYear: maxYear } : null;
  }

  // Resolve the term Grizz is planning for.
  // Priority: active enrollment submission term > the term after the most
  // recent history entry > the app's default (Semester 1 of the active SY).
  // Year level for that term is inferred from history when it is reliable
  // (finishing Sem 2 promotes you into the next year's Sem 1), otherwise the
  // profile's year level stands.
  function resolveTarget(opts) {
    var now = opts && opts.now ? new Date(opts.now) : new Date();
    var profileYear = clampYear(opts && opts.profileYear);
    var myUnits = (opts && opts.myUnits) || [];
    var activeTerm = (opts && opts.activeTerm) || null;
    var semester, start, yearLevel;

    if (activeTerm && activeTerm.semester) {
      semester = Number(activeTerm.semester);
      start = startYearOf(activeTerm.schoolYear) ||
        (now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1);
      if (semester === 1) {
        var prev2 = termWithSemester(myUnits, 2, start - 1);
        yearLevel = prev2 && prev2.maxYear ? clampYear(prev2.maxYear + 1) : profileYear;
      } else {
        var prev1 = termWithSemester(myUnits, 1, start);
        yearLevel = prev1 && prev1.maxYear ? clampYear(prev1.maxYear) : profileYear;
      }
    } else {
      var last = mostRecentTerm(myUnits);
      if (last && last.maxYear) {
        if (last.semester === 1) {
          start = last.start;
          semester = 2;
          yearLevel = clampYear(last.maxYear);
        } else {
          start = last.start + 1;
          semester = 1;
          yearLevel = clampYear(last.maxYear + 1);
        }
      } else {
        // No history yet (new student), or history without reliable subject
        // year levels. The enrollment builder opens Semester 1 of the active
        // school year, so Grizz plans for the same slot at the profile year.
        start = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
        semester = 1;
        yearLevel = profileYear;
      }
    }
    return { schoolYear: label(start), semester: semester, yearLevel: yearLevel };
  }

  // Structured prereq gate (migration 031 rows). A corequisite is satisfied if
  // the paired subject is passed, enrolled, OR also being planned in the same
  // upcoming term (candidateScope) — co-reqs travel together in one load.
  function evaluateStructuredPrereqs(subject, prereqsBySubject, passedCodes, enrolledCodes, candidateScope, standingYear) {
    var rows = prereqsBySubject.get(subject.id) || [];
    if (!rows.length) return null; // caller falls back to legacy parsing

    var satisfied = true;
    var missing = [];
    var notes = [];
    rows.forEach(function (row) {
      var depCode = row.depends_code;
      if (row.kind === 'prerequisite' && depCode) {
        if (!passedCodes.has(depCode) && !enrolledCodes.has(depCode)) {
          satisfied = false;
          missing.push(depCode);
        }
      } else if (row.kind === 'corequisite' && depCode) {
        if (!passedCodes.has(depCode) && !enrolledCodes.has(depCode) && !candidateScope.has(depCode)) {
          satisfied = false;
          missing.push(depCode);
        }
      } else if (row.kind === 'year_standing' && row.detail) {
        var requiredYr = Number((String(row.detail).match(/(\d+)/) || [])[1] || 0);
        if (standingYear < requiredYr) {
          satisfied = false;
          missing.push(row.detail);
        }
      } else if (row.kind === 'special' && row.detail) {
        notes.push(row.detail);
      }
    });
    return { satisfied: satisfied, missing: missing, notes: notes };
  }

  // Legacy free-text fallback (identical rules to ai-assistant.js).
  function evaluateLegacyPrereqs(subject, passedCodes, enrolledCodes, standingYear) {
    var prereqStr = String(subject.prerequisites || '').trim();
    if (!prereqStr || prereqStr === 'None' || prereqStr === '-') {
      return { satisfied: true, missing: [], notes: [] };
    }
    var standingMatch = prereqStr.match(/(\d+)(?:st|nd|rd|th)?\s*Yr\s*Standing/i);
    if (standingMatch) {
      var requiredYr = Number(standingMatch[1]);
      if (standingYear < requiredYr) {
        return { satisfied: false, missing: ['Year ' + requiredYr + ' standing'], notes: [] };
      }
    }
    var rawTokens = prereqStr.split(/[;,/]/)
      .map(function (t) { return String(t).replace(/co-req/i, '').trim(); })
      .filter(Boolean);
    var satisfied = true;
    var missing = [];
    rawTokens.forEach(function (token) {
      var normToken = String(token).trim().toUpperCase();
      if (normToken && !normToken.includes('STANDING') &&
          !passedCodes.has(normToken) && !enrolledCodes.has(normToken) &&
          /^[A-Z0-9\s-]+$/.test(normToken)) {
        satisfied = false;
        missing.push(String(token).trim());
      }
    });
    return { satisfied: satisfied, missing: missing, notes: [] };
  }

  function unitsOf(s) {
    return Number(s.units) || 0;
  }

  // Full recommendation pass. Returns everything the UI needs to render the
  // recommended load, the eligible-but-over-the-limit remainder, and the
  // prerequisite-blocked subjects with their reasons.
  function buildRecommendations(opts) {
    var subjects = (opts && opts.subjects) || [];
    var prereqRows = (opts && opts.prereqRows) || [];
    var myUnits = (opts && opts.myUnits) || [];
    var target = resolveTarget(opts);

    var classes = classifyPasses(myUnits);
    var passedCodes = classes.passedCodes;
    var enrolledCodes = classes.enrolledCodes;
    var attemptedCodes = classes.attemptedCodes;

    var prereqsBySubject = new Map();
    prereqRows.forEach(function (r) {
      if (!prereqsBySubject.has(r.subject_id)) prereqsBySubject.set(r.subject_id, []);
      prereqsBySubject.get(r.subject_id).push(r);
    });

    // In-scope candidates: the target semester's own row (primary) plus any
    // lower-year unfinished subjects or same-year retakes from earlier
    // semesters (backlog). Future years and the other semester of the target
    // year are out of scope for this term's load.
    var candidateScopeCodes = new Set();
    var candidates = [];
    subjects.forEach(function (s) {
      var code = String(s.code || '').trim().toUpperCase();
      if (!code || passedCodes.has(code) || enrolledCodes.has(code)) return;
      var yl = Number(s.year_level) || 0;
      var sem = Number(s.semester) || 0;
      if (yl === target.yearLevel && sem === target.semester) {
        candidates.push({ s: s, kind: 'primary', retake: attemptedCodes.has(code) });
      } else if (yl < target.yearLevel) {
        candidates.push({ s: s, kind: 'backlog', retake: attemptedCodes.has(code) });
      } else if (yl === target.yearLevel && sem < target.semester && attemptedCodes.has(code)) {
        // Same-year course from an earlier semester that the student failed.
        candidates.push({ s: s, kind: 'backlog', retake: true });
      }
    });
    candidates.forEach(function (c) { candidateScopeCodes.add(String(c.s.code).trim().toUpperCase()); });

    var eligible = [];
    var blocked = [];
    candidates.forEach(function (c) {
      var verdict = evaluateStructuredPrereqs(
        c.s, prereqsBySubject, passedCodes, enrolledCodes, candidateScopeCodes, target.yearLevel);
      if (verdict === null) verdict = evaluateLegacyPrereqs(c.s, passedCodes, enrolledCodes, target.yearLevel);
      if (verdict.satisfied) {
        eligible.push({
          subject: c.s, kind: c.kind, retake: c.retake,
          notes: verdict.notes || [],
        });
      } else {
        blocked.push({ subject: c.s, reason: 'Missing prerequisite: ' + (verdict.missing || []).join(', ') });
      }
    });

    // On-track subjects first, then backlog; deterministic order within groups.
    function sortKey(c) {
      var s = c.subject;
      var group = c.kind === 'primary' ? 0 : 1;
      var yl = Number(s.year_level) || 0;
      var sem = Number(s.semester) || 0;
      return group + ':' + String(yl).padStart(2, '0') + ':' + String(sem).padStart(2, '0') + ':' + String(s.code || '').toUpperCase();
    }
    eligible.sort(function (a, b) { return sortKey(a).localeCompare(sortKey(b)); });

    // Load cap: BOTH at most 5 subjects AND at most 24 units.
    var recommended = [];
    var totalUnits = 0;
    var remainder = [];
    eligible.forEach(function (c) {
      var u = unitsOf(c.subject);
      if (totalUnits + u <= MAX_UNITS && recommended.length < MAX_SUBJECTS) {
        recommended.push(c);
        totalUnits += u;
      } else {
        remainder.push(c);
      }
    });

    return {
      target: target,
      recommended: recommended,
      totalUnits: totalUnits,
      remainder: remainder,
      blocked: blocked,
      counts: {
        primary: recommended.filter(function (c) { return c.kind === 'primary'; }).length,
        backlog: recommended.filter(function (c) { return c.kind === 'backlog'; }).length,
        blocked: blocked.length,
      },
    };
  }

  return {
    MAX_SUBJECTS: MAX_SUBJECTS,
    MAX_UNITS: MAX_UNITS,
    classifyPasses: classifyPasses,
    resolveTarget: resolveTarget,
    buildRecommendations: buildRecommendations,
  };
});
