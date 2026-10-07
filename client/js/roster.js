// =============================================
// roster.js - Official CoE Student Roster Validation (Supabase DB-backed)
// =============================================

const Roster = (() => {
  let _cachedRoster = null;
  let _fetchPromise = null;

  // Tokenize & normalize a name string (lowercase, remove punctuation, split into words)
  function tokenize(str) {
    if (!str) return [];
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip accents/diacritics
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 0 && t !== "jr" && t !== "sr" && t !== "iii" && t !== "ii" && t !== "na");
  }

  // Fetch roster dynamically from Supabase table `enrolled_students` (cached in memory)
  async function getRoster() {
    if (_cachedRoster) return _cachedRoster;
    if (_fetchPromise) {
      const shared = await _fetchPromise;
      if (_cachedRoster) return _cachedRoster;
      if (shared.length > 0) return shared;
      // The shared fetch was the page-load pre-fetch that ran without a session and
      // came back empty. The caller (the login gate) may have a session now, so fetch
      // again instead of handing it the empty list.
    }

    _fetchPromise = (async () => {
      if (window.supabaseClient) {
        try {
          // The roster is not readable by anon (migration 039 revoked the
          // grant), so querying without a session only produces a 401.
          // Skip the request and leave the cache unpinned for after login.
          const { data: { session } } = await window.supabaseClient.auth.getSession();
          if (!session) {
            _fetchPromise = null;
            return [];
          }

          const { data, error } = await window.supabaseClient
            .from("enrolled_students")
            .select("full_name, sex, course, year_level");

          if (!error && data && data.length > 0) {
            _cachedRoster = data.map(d => ({
              name: d.full_name,
              sex: d.sex,
              course: d.course,
              year: d.year_level
            }));
            return _cachedRoster;
          }
          // Empty or failed result: don't pin that empty promise, allow a
          // re-fetch on the next call.
          _fetchPromise = null;
        } catch (e) {
          console.warn("[Roster] DB fetch fallback:", e);
        }
      }
      return [];
    })();

    return _fetchPromise;
  }

  function matchInList(list, fullName, email) {
    const searchTokens = [];
    if (fullName && typeof fullName === "string") {
      searchTokens.push(...tokenize(fullName));
    }
    if (email && typeof email === "string") {
      const emailPrefix = email.split("@")[0];
      searchTokens.push(...tokenize(emailPrefix.replace(/[._\-0-9]/g, " ")));
    }

    if (searchTokens.length === 0) return null;
    const uniqueSearchTokens = [...new Set(searchTokens)];

    let bestMatch = null;
    let maxMatchCount = 0;

    for (const student of list) {
      const studentTokens = tokenize(student.name);
      let matchCount = 0;
      for (const st of uniqueSearchTokens) {
        if (studentTokens.includes(st)) {
          matchCount++;
        }
      }

      if (matchCount >= 2 && matchCount > maxMatchCount) {
        maxMatchCount = matchCount;
        bestMatch = student;
      }
    }

    return bestMatch;
  }

  // Synchronous match on cached data
  function findStudent(fullName, email = "") {
    const list = _cachedRoster || [];
    return matchInList(list, fullName, email);
  }

  // Async match that guarantees DB fetch completes first
  async function findStudentAsync(fullName, email = "") {
    const list = await getRoster();
    return matchInList(list, fullName, email);
  }

  return {
    getRoster,
    findStudent,
    findStudentAsync,
    async validate(name, email = "") {
      const student = await findStudentAsync(name, email);
      return {
        isEnrolled: !!student,
        student: student || null
      };
    }
  };
})();

if (typeof window !== "undefined") {
  window.Roster = Roster;
  // Pre-trigger background fetch of DB roster on load
  Roster.getRoster().catch(() => {});
}
