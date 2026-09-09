// =============================================
// grizz-recommend.js - Pure "next semester" load recommendation engine.
// Decides which subjects Grizz suggests for the upcoming term by:
//   1. resolving the target term (active load submission > history > default),
//   2. scoping candidates to that term's curriculum slot + lower-year backlog,
//   3. enforcing code prerequisites and co-requisites (structured rows or
//      legacy free text; "Xth Yr/Year Standing" text is an ELIGIBILITY window
//      satisfied by the year scoping, so it never blocks a recommendation),
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

  // ---- Free-text prerequisite parsing helpers ----
  // The catalog's legacy `prerequisites` strings use many phrasings:
  //   "CE 211"                     plain prerequisite code
  //   "CpE 112; CpE 223"           code list
  //   "Co-req CpE 223"             corequisite
  //   "Co: ECE 211"                corequisite
  //   "co-requisite: EMath 121"    corequisite
  //   "CE 211; co-requisite: CE 222"
  //   "2nd/3rd/4th Yr Standing"    eligibility note — satisfied by year scoping
  //   "3rd Year Standing"          eligibility note (full word) — never blocks
  //   "*240 hours / 4th Yr Standing" descriptive (hours/standing) — informational
  //   "Depends: CE 211"            "depends" phrasing still means prerequisite

  function normalizeCode(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
  }

  // A code-like token starts with letters, contains at least one letter and
  // one digit, and uses only letters/digits/optional spaces (e.g. "CPE 223",
  // "EMATH 100", "RS 1", "ECE L1", "MATH5"). Free-text phrases like "240 hours"
  // or "Understanding the Self" must NOT be treated as codes.
  function isCodeLike(s) {
    var norm = normalizeCode(s);
    if (!/[A-Z]/.test(norm) || !/\d/.test(norm)) return false;
    return /^[A-Z]{1,10}(?:\s?[A-Z0-9]{1,5}){0,3}$/.test(norm);
  }

  // Markers that introduce a course requirement in free text.
  var COREQ_MARKER = /^(?:co[- ]?req|corequisite|co-requisite|co)\s*[:.]?\s*/i;
  var PREREQ_LABEL = /^(?:pre[- ]?req|pre-?requisite|prerequisite|depends?|subject to|requires?|take)\s*[:on-]*\s*/i;

  function standingRequirementOf(text) {
    var m = String(text || '').match(/(\d+)(?:st|nd|rd|th)?\s*(?:yr|year)s?\s*standing/i);
    return m ? { year: Number(m[1]), phrase: m[0].trim() } : null;
  }

  // Structured prereq gate (migration 031 rows). A corequisite is satisfied if
  // the paired subject is passed, enrolled, OR also planned in the same load
  // (candidateScope) — co-reqs travel together. Standing rows are eligibility
  // only and never block (term scoping already limits candidates by year).
  // Detail-only rows (no depends_code) fall back to free-text parsing so
  // "standing"-in-detail and code-in-detail rows are never silently skipped.
  function evaluateStructuredPrereqs(subject, prereqsBySubject, passedCodes, enrolledCodes, candidateScope) {
    var rows = prereqsBySubject.get(subject.id) || [];
    if (!rows.length) return null; // caller falls back to legacy parsing

    var satisfied = true;
    var missing = [];
    var notes = [];
    rows.forEach(function (row) {
      var depCode = row.depends_code;
      if ((row.kind === 'prerequisite' || row.kind === 'corequisite') && depCode) {
        var ok = passedCodes.has(normalizeCode(depCode)) || enrolledCodes.has(normalizeCode(depCode));
        if (row.kind === 'corequisite' && !ok) ok = candidateScope.has(normalizeCode(depCode));
        if (!ok) {
          satisfied = false;
          missing.push(depCode);
        }
      } else if (row.kind === 'special' && row.detail) {
        notes.push(row.detail);
      } else if (row.kind === 'year_standing' && row.detail) {
        // Standing is an ELIGIBILITY window, not a prerequisite. Term scoping
        // only offers courses at/below the student's target year, so a standing
        // requirement is satisfied by construction — it never blocks here.
      } else if (row.detail) {
        // Detail-only rows (no depends_code) fall back to free-text parsing so
        // code-in-detail rows are honored and standing/hours text is ignored.
        var norm = normalizeCode(row.detail);
        if (isCodeLike(norm) && !standingRequirementOf(row.detail)) {
          if (!passedCodes.has(norm) && !enrolledCodes.has(norm)) {
            satisfied = false;
            missing.push(row.detail);
          }
        } else if (!standingRequirementOf(row.detail)) {
          notes.push(row.detail); // descriptive-only (e.g. "240 hours") — informational
        }
      }
    });
    return { satisfied: satisfied, missing: missing, notes: notes };
  }

  // Legacy free-text fallback (identical rules to ai-assistant.js, extended to
  // "Year Standing", "Co:"/"co-requisite", and "Depends:" phrasing).
  function evaluateLegacyPrereqs(subject, passedCodes, enrolledCodes, candidateScope) {
    var prereqStr = String(subject.prerequisites || '').trim();
    if (!prereqStr || prereqStr === 'None' || prereqStr === '-') {
      return { satisfied: true, missing: [], notes: [] };
    }

    var satisfied = true;
    var missing = [];
    var tokens = prereqStr.split(/[;,/\r\n]+/).map(function (t) { return String(t).trim(); }).filter(Boolean);

    tokens.forEach(function (token) {
      // 1) Year-standing clause ("3rd Yr/Year Standing"). Standing is an
      //    ELIGIBILITY window, satisfied by term scoping — it never blocks.
      if (standingRequirementOf(token)) return;
      // 2) Corequisite marker -> may be satisfied by a co-planned subject.
      var coreqMatch = token.match(COREQ_MARKER);
      var isCoreq = false;
      if (coreqMatch) {
        isCoreq = true;
        token = token.slice(coreqMatch[0].length).trim();
      } else {
        // 3) "Depends:"-style labels still denote a plain prerequisite.
        token = token.replace(PREREQ_LABEL, '').trim();
      }
      // 4) Only code-like tokens gate; descriptive phrases are informational.
      if (!token || !isCodeLike(token)) return;
      var norm = normalizeCode(token);
      var ok = passedCodes.has(norm) || enrolledCodes.has(norm);
      if (isCoreq && !ok) ok = candidateScope.has(norm);
      if (!ok) {
        satisfied = false;
        missing.push(token);
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
    candidates.forEach(function (c) { candidateScopeCodes.add(normalizeCode(c.s.code)); });

    var eligible = [];
    var blocked = [];
    candidates.forEach(function (c) {
      var verdict = evaluateStructuredPrereqs(
        c.s, prereqsBySubject, passedCodes, enrolledCodes, candidateScopeCodes);
      if (verdict === null) verdict = evaluateLegacyPrereqs(c.s, passedCodes, enrolledCodes, candidateScopeCodes);
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
