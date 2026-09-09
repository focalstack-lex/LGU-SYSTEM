// =============================================
// grizz-recommend.js - Pure "next load" recommendation engine.
// Decides which subjects Grizz suggests by:
//   1. analyzing the student's ACTUAL records (passed / failed / incomplete /
//      dropped / currently enrolled) to derive their standing,
//   2. resolving the target term (open load submission > records > default),
//   3. scoping candidates to that term's curriculum slot, owed retakes, and
//      lower-year backlog (never future years or the wrong semester),
//   4. enforcing code prerequisites and co-requisites (structured rows or
//      legacy free text; "Xth Yr/Year Standing" text is an ELIGIBILITY window
//      satisfied by the year scoping, so it never blocks a recommendation),
//   5. recommending owed retakes first (they unlock progression), then the
//      on-track subjects, then remaining backlog,
//   6. capping the load at BOTH 5 subjects AND 24 units.
// UMD: browsers get window.GrizzRecommend; Node tests require() it.
// =============================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GrizzRecommend = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_SUBJECTS = 5;
  var MAX_UNITS = 24;
  var FAIL_STATUSES = ['failed', 'dropped', 'incomplete'];

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

  // ---- Free-text prerequisite parsing helpers ----
  // The catalog's legacy `prerequisites` strings use many phrasings:
  //   "CE 211"                       plain prerequisite code
  //   "CpE 112; CpE 223"             code list
  //   "Co-req CpE 223"               corequisite
  //   "Co: ECE 211"                  corequisite
  //   "co-requisite: EMath 121"      corequisite
  //   "CE 211; co-requisite: CE 222"
  //   "2nd/3rd/4th Yr Standing"      eligibility note — satisfied by year scoping
  //   "3rd Year Standing"            eligibility note (full word) — never blocks
  //   "*240 hours / 4th Yr Standing" descriptive (hours/standing) — informational
  //   "Depends: CE 211"              "depends" phrasing still means prerequisite

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

  var COREQ_MARKER = /^(?:co[- ]?req|corequisite|co-requisite|co)\s*[:.]?\s*/i;
  var PREREQ_LABEL = /^(?:pre[- ]?req|pre-?requisite|prerequisite|depends?|subject to|requires?|take)\s*[:on-]*\s*/i;

  function standingRequirementOf(text) {
    var m = String(text || '').match(/(\d+)(?:st|nd|rd|th)?\s*(?:yr|year)s?\s*standing/i);
    return m ? { year: Number(m[1]), phrase: m[0].trim() } : null;
  }

  // ---- Record status helpers ----
  function isFullPass(u) {
    return u.status === 'passed' ||
      (u.lec_status === 'passed' && u.lab_status === 'passed');
  }

  // Anything on a settled (non-current-term) record that is not a full pass:
  // failed/dropped/incomplete full records, or records with a failed /
  // incomplete / dropped component (including single-component partial passes).
  function isFailedLike(u) {
    if (isFullPass(u)) return false;
    if (u.status === 'enrolled') return false;
    if (FAIL_STATUSES.indexOf(u.status) >= 0) return true;
    return ['lec_status', 'lab_status'].some(function (k) {
      return FAIL_STATUSES.indexOf(u[k]) >= 0;
    });
  }

  // Legacy pass classification retained for callers that only need the sets.
  function classifyPasses(records) {
    var passedCodes = new Set();
    var enrolledCodes = new Set();
    var attemptedCodes = new Set();
    var partialPasses = new Map();
    var seen = new Set();
    (records || []).forEach(function (u) {
      var code = String((u.subjects && u.subjects.code) || '').trim().toUpperCase();
      if (!code || seen.has(code)) return;
      seen.add(code);
      attemptedCodes.add(code);
      var lecPassed = u.lec_status === 'passed';
      var labPassed = u.lab_status === 'passed';
      if (isFullPass(u)) {
        passedCodes.add(code);
      } else if (u.status === 'enrolled') {
        enrolledCodes.add(code);
      } else if (lecPassed !== labPassed) {
        partialPasses.set(code, lecPassed ? 'lecture' : 'laboratory');
      }
    });
    return { passedCodes: passedCodes, enrolledCodes: enrolledCodes, attemptedCodes: attemptedCodes, partialPasses: partialPasses };
  }

  // Full record analysis: classifies every subject and derives the terms the
  // student has genuinely passed or is currently enrolled in, which is what
  // standing is inferred from. `failed` carries the retake debt with the units
  // and catalog position of each owed subject.
  function analyzeRecords(records) {
    var passedCodes = new Set();
    var enrolledCodes = new Set();
    var attemptedCodes = new Set();
    var failedCodes = new Set();
    var failed = [];
    var seen = new Set();
    var terms = new Map(); // "start:semester" -> bucket

    function bucket(u) {
      var start = startYearOf(u.school_year);
      var sem = Number(u.semester);
      if (!start || !sem) return null;
      var key = start + ':' + sem;
      if (!terms.has(key)) terms.set(key, { start: start, semester: sem, passedYear: 0, enrolledYear: 0, hasPassed: false, hasEnrolled: false });
      return terms.get(key);
    }

    (records || []).forEach(function (u) {
      var sub = u.subjects || {};
      var code = String(sub.code || '').trim().toUpperCase();
      if (!code) return;
      var b = bucket(u);
      var yl = Number(sub.year_level) || 0;

      if (!seen.has(code)) {
        seen.add(code);
        attemptedCodes.add(code);
      }

      if (isFullPass(u)) {
        passedCodes.add(code);
        if (b) {
          b.hasPassed = true;
          if (yl > b.passedYear) b.passedYear = yl;
        }
      } else if (u.status === 'enrolled') {
        enrolledCodes.add(code);
        if (b) {
          b.hasEnrolled = true;
          if (yl > b.enrolledYear) b.enrolledYear = yl;
        }
      } else if (isFailedLike(u)) {
        failedCodes.add(code);
        failed.push({
          code: code,
          units: Number(sub.units) || 0,
          year_level: yl,
          semester: Number(sub.semester) || 0,
          status: u.status || '',
        });
      }
    });

    function latestTerm(pred) {
      var best = null;
      terms.forEach(function (t) {
        if (!pred(t)) return;
        if (!best || t.start > best.start || (t.start === best.start && t.semester > best.semester)) best = t;
      });
      return best;
    }

    var currentTerm = latestTerm(function (t) { return t.hasEnrolled; });
    var passedTerm = latestTerm(function (t) { return t.hasPassed; });

    function toTerm(t) {
      return t ? { start: t.start, semester: t.semester, maxYear: t.hasEnrolled ? t.enrolledYear : t.passedYear } : null;
    }

    return {
      passedCodes: passedCodes,
      enrolledCodes: enrolledCodes,
      attemptedCodes: attemptedCodes,
      failedCodes: failedCodes,
      failed: failed,
      currentTerm: toTerm(currentTerm),
      passedTerm: toTerm(passedTerm),
      terms: terms,
    };
  }

  // Max subject year the student has genuinely passed/enrolled in during a
  // specific term, used to infer the standing year for an open load term.
  function termYear(recs, start, semester) {
    var t = recs.terms.get(start + ':' + semester);
    return t && t.hasPassed ? t.passedYear : (t && t.hasEnrolled ? t.enrolledYear : 0);
  }

  // Resolve the term Grizz is planning for and the student's standing year.
  // Priority: the open enrollment submission's term > the term after the
  // student's most recent proven work > the app default (Semester 1 of the
  // active SY at the profile year). Records drive the year; the profile is a
  // fallback only when the record gives no usable signal.
  function resolveTarget(opts) {
    var now = opts && opts.now ? new Date(opts.now) : new Date();
    var profileYear = clampYear(opts && opts.profileYear);
    var recs = analyzeRecords((opts && opts.myUnits) || []);
    var activeTerm = (opts && opts.activeTerm) || null;
    var semester, start, yearLevel, basis = 'profile';

    if (activeTerm && activeTerm.semester) {
      semester = Number(activeTerm.semester);
      start = startYearOf(activeTerm.schoolYear) ||
        (now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1);
      if (semester === 1) {
        var prev = termYear(recs, start - 1, 2);
        if (prev) { yearLevel = clampYear(prev + 1); basis = 'records'; }
        else { yearLevel = profileYear; }
      } else {
        var same = termYear(recs, start, 1);
        if (same) { yearLevel = clampYear(same); basis = 'records'; }
        else { yearLevel = profileYear; }
      }
    } else {
      var cur = recs.currentTerm;
      var passed = recs.passedTerm;
      if (cur && cur.maxYear > 0) {
        // They have enrolled records right now -> the next load is the term
        // right after the one they're in.
        if (cur.semester === 1) {
          start = cur.start;
          semester = 2;
          yearLevel = clampYear(cur.maxYear);
        } else {
          start = cur.start + 1;
          semester = 1;
          yearLevel = clampYear(cur.maxYear + 1);
        }
        basis = 'records';
      } else if (passed && passed.maxYear > 0) {
        // No current-term record, but proven passes -> plan after their last
        // completed term (finishing Sem 2 promotes into the next year).
        if (passed.semester === 1) {
          start = passed.start;
          semester = 2;
          yearLevel = clampYear(passed.maxYear);
        } else {
          start = passed.start + 1;
          semester = 1;
          yearLevel = clampYear(passed.maxYear + 1);
        }
        basis = 'records';
      } else {
        // No usable history (new student) -> the enrollment builder opens
        // Semester 1 of the active school year, so plan the same slot.
        start = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
        semester = 1;
        yearLevel = profileYear;
      }
    }

    return { schoolYear: label(start), semester: semester, yearLevel: yearLevel, basis: basis };
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

  // Full recommendation pass.
  function buildRecommendations(opts) {
    var subjects = (opts && opts.subjects) || [];
    var prereqRows = (opts && opts.prereqRows) || [];
    var myUnits = (opts && opts.myUnits) || [];
    var target = resolveTarget(opts);
    var recs = analyzeRecords(myUnits);

    var passedCodes = recs.passedCodes;
    var enrolledCodes = recs.enrolledCodes;
    var failedCodes = recs.failedCodes;
    var standingYear = target.yearLevel;
    var targetSem = target.semester;

    var prereqsBySubject = new Map();
    prereqRows.forEach(function (r) {
      if (!prereqsBySubject.has(r.subject_id)) prereqsBySubject.set(r.subject_id, []);
      prereqsBySubject.get(r.subject_id).push(r);
    });

    // Candidate pool: retake debt (owed failed/incomplete/dropped subjects at
    // or below standing), the on-track slot for the standing year + target
    // semester, and remaining lower-year backlog. Future years and the other
    // semester of the standing year are out of scope.
    var candidateScopeCodes = new Set();
    var candidates = [];
    subjects.forEach(function (s) {
      var code = normalizeCode(s.code);
      if (!code || passedCodes.has(code) || enrolledCodes.has(code)) return;
      var yl = Number(s.year_level) || 0;
      var sem = Number(s.semester) || 0;
      var owed = failedCodes.has(code);

      if (yl === standingYear && sem === targetSem) {
        // On-track slot: a retake if previously failed, else a fresh subject.
        candidates.push({ s: s, kind: owed ? 'retake' : 'primary', retake: owed });
      } else if (yl < standingYear) {
        // Lower-year work still unfinished (owed retake or never-taken gap).
        candidates.push({ s: s, kind: owed ? 'retake' : 'backlog', retake: owed });
      } else if (owed && yl === standingYear && sem < targetSem) {
        // Failed an earlier semester of the standing year; planning a later
        // semester now -> the failure is still owed this year.
        candidates.push({ s: s, kind: 'retake', retake: true });
      }
    });
    candidates.forEach(function (c) { candidateScopeCodes.add(normalizeCode(c.s.code)); });

    var eligible = [];
    var blocked = [];
    candidates.forEach(function (c) {
      var verdict = evaluateStructuredPrereqs(c.s, prereqsBySubject, passedCodes, enrolledCodes, candidateScopeCodes);
      if (verdict === null) verdict = evaluateLegacyPrereqs(c.s, passedCodes, enrolledCodes, candidateScopeCodes);
      if (verdict.satisfied) {
        eligible.push({ subject: c.s, kind: c.kind, retake: c.retake, notes: verdict.notes || [] });
      } else {
        blocked.push({ subject: c.s, reason: 'Missing prerequisite: ' + (verdict.missing || []).join(', ') });
      }
    });

    // Owed retakes first (they unlock progression), then on-track subjects,
    // then remaining backlog; deterministic within groups.
    function sortKey(c) {
      var group = c.kind === 'retake' ? 0 : (c.kind === 'primary' ? 1 : 2);
      var s = c.subject;
      return group + ':' +
        String(Number(s.year_level) || 0).padStart(2, '0') + ':' +
        String(Number(s.semester) || 0).padStart(2, '0') + ':' +
        String(s.code || '').toUpperCase();
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
        retake: recommended.filter(function (c) { return c.kind === 'retake'; }).length,
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
    analyzeRecords: analyzeRecords,
    resolveTarget: resolveTarget,
    buildRecommendations: buildRecommendations,
  };
});
