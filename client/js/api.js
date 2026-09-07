// =============================================
// api.js - API Helper Module with SWR Pre-Caching
// =============================================

const Api = (() => {

  async function _getToken() {
    if (!window.supabaseClient?.auth) return null;
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    return session?.access_token || null;
  }

  // Cache Map stores: key -> { data, timestamp, ttlMs }
  const _cache = new Map();
  // In-flight Promise Map to deduplicate concurrent requests
  const _inFlight = new Map();

  function invalidateCache(...prefixes) {
    if (prefixes.length === 0 || (prefixes.length === 1 && !prefixes[0])) {
      _cache.clear();
      return;
    }
    const flat = prefixes.flat().filter(Boolean);
    for (const key of _cache.keys()) {
      if (flat.some(p => key.startsWith(p) || key.includes(p))) {
        _cache.delete(key);
      }
    }
  }

  function hasCache(path) {
    return _cache.has(path);
  }

  function getCache(path) {
    const entry = _cache.get(path);
    return entry ? JSON.parse(JSON.stringify(entry.data)) : null;
  }

  async function _fetchRaw(method, path, body = null, isFormData = false) {
    const token = await _getToken();
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);

    const res = await fetch(`${window.API_BASE}/api${path}`, opts);

    if (res.status === 401) {
      if (window.supabaseClient?.auth) window.supabaseClient.auth.signOut();
      throw new Error('Invalid or expired session token. Please log in again.');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  }

  async function _request(method, path, body = null, isFormData = false, ttlMs = 0) {
    const isGet = method.toUpperCase() === 'GET';
    const cacheKey = `${path}`;

    // 1. SWR Cache check for GET requests
    if (isGet && ttlMs > 0 && _cache.has(cacheKey)) {
      const entry = _cache.get(cacheKey);
      const isFresh = (Date.now() - entry.timestamp) < ttlMs;

      if (isFresh) {
        // Return fresh cached copy immediately
        return JSON.parse(JSON.stringify(entry.data));
      }

      // Stale cache hit: return cached data immediately, then revalidate in background
      if (!_inFlight.has(cacheKey)) {
        const bgFetch = (async () => {
          try {
            const freshData = await _fetchRaw('GET', path);
            _cache.set(cacheKey, { data: freshData, timestamp: Date.now(), ttlMs });
            // Notify active listeners that fresh data arrived in background
            document.dispatchEvent(new CustomEvent('api:cache-updated', { detail: { path, data: freshData } }));
          } catch (err) {
            // Silently ignore background revalidation errors so user keeps stale UI
            console.debug('[SWR] Background revalidation failed for', path, err?.message);
          } finally {
            _inFlight.delete(cacheKey);
          }
        })();
        _inFlight.set(cacheKey, bgFetch);
      }

      return JSON.parse(JSON.stringify(entry.data));
    }

    // 2. Deduplicate in-flight GET requests
    if (isGet && _inFlight.has(cacheKey)) {
      return _inFlight.get(cacheKey);
    }

    // 3. Perform network request
    const fetchPromise = (async () => {
      try {
        const data = await _fetchRaw(method, path, body, isFormData);

        if (isGet && ttlMs > 0) {
          _cache.set(cacheKey, { data, timestamp: Date.now(), ttlMs });
        } else if (!isGet) {
          // Mutating calls invalidate caches based on target route
          if (path.startsWith('/events')) {
            invalidateCache('/events', '/reports', '/dashboard');
          } else if (path.startsWith('/transactions')) {
            invalidateCache('/transactions', '/reports', '/dashboard', '/income');
          } else if (path.startsWith('/admin')) {
            invalidateCache('/admin', '/reports', '/transactions', '/dashboard');
          } else if (path.startsWith('/units')) {
            invalidateCache('/units/my');
          } else {
            invalidateCache();
          }
        }

        return data;
      } finally {
        if (isGet) _inFlight.delete(cacheKey);
      }
    })();

    if (isGet) _inFlight.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  // ---- Endpoints with Calibrated SWR TTLs ----
  const events = {
    list:    ()       => _request('GET', window.IS_PUBLIC_VIEWER ? '/public/events' : '/events', null, false, 60000),
    get:     (id)     => _request('GET', `/events/${id}`, null, false, 60000),
    create:  (body)   => _request('POST', '/events', body),
    update:  (id, b)  => _request('PATCH', `/events/${id}`, b),
    archive: (id)     => _request('PATCH', `/admin/events/${id}/archive`),
  };

  const transactions = {
    list:   (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return _request('GET', `/transactions${q ? '?' + q : ''}`, null, false, 30000);
    },
    create: (body)        => _request('POST',   '/transactions', body, body instanceof FormData),
    bulkCreate: (body)    => _request('POST',   '/transactions/bulk', { transactions: body }),
    update: (id, body)    => _request('PATCH',  `/transactions/${id}`, body),
    remove: (id, body)    => _request('DELETE', `/transactions/${id}`, body),
  };

  const reports = {
    summary:       () => _request('GET', window.IS_PUBLIC_VIEWER ? '/public/summary' : '/reports/summary', null, false, 45000),
    monthly:       () => _request('GET', '/reports/monthly', null, false, 45000),
    eventsSummary: () => _request('GET', '/reports/events-summary', null, false, 45000),
  };

  const admin = {
    users:                  ()            => _request('GET',   '/admin/users', null, false, 30000),
    setRole:                (id, role)    => _request('PATCH', `/admin/users/${id}/role`, { role }),
    verifyUser:             (id)          => _request('POST',  `/admin/users/${id}/verify`),
    sendApprovalEmail:      (email, full_name) => _request('POST', '/admin/send-approval-email', { email, full_name }),
    backfillApprovalEmails: ()            => _request('POST',  '/admin/backfill-approval-emails'),
    auditLogs:              (params={})   => {
      const q = new URLSearchParams(params).toString();
      return _request('GET', `/admin/audit-logs${q ? '?' + q : ''}`, null, false, 30000);
    },
    transfer:               (body)        => _request('POST',  '/admin/budget-transfer', body),
  };

  const units = {
    checklists:  (program) => _request('GET', `/units/checklists${program ? '?program=' + encodeURIComponent(program) : ''}`, null, false, 180000),
    my:          ()        => _request('GET', '/units/my', null, false, 30000),
    enroll:      (body)    => _request('POST',  '/units/enroll', body),
    batchEnroll: (items)   => _request('POST',  '/units/batch-enroll', { items }),
    update:      (id, b)   => _request('PATCH', `/units/update/${id}`, b),
    drop:        (id)      => _request('DELETE', `/units/drop/${id}`),
  };

  const announcements = {
    list:   ()       => _request('GET',  '/announcements', null, false, 45000),
    create: (body)   => _request('POST', '/announcements', body),
  };

  // Enrollment submissions (Phase B): student draft/submit flow.
  const enrollment = {
    my:        () => _request('GET', '/enrollment/submissions/my', null, false, 15000),
    createTerm: (school_year, semester) => _request('POST', '/enrollment/submissions', { school_year, semester }),
    addItem:   (id, subject_id, grizz_reason) => _request('POST', `/enrollment/submissions/${id}/items`,
                  grizz_reason ? { subject_id, origin: 'grizz', grizz_reason } : { subject_id }),
    removeItem:(id, itemId) => _request('DELETE', `/enrollment/submissions/${id}/items/${itemId}`),
    submit:    (id) => _request('POST', `/enrollment/submissions/${id}/submit`),
  };

  // Faculty portal (Phase B): program-head evaluation + SA encoding queue.
  const faculty = {
    submissions: (status) => _request('GET', `/faculty/submissions${status ? '?status=' + encodeURIComponent(status) : ''}`, null, false, 15000),
    detail:      (id) => _request('GET', `/faculty/submissions/${id}`, null, false, 0),
    open:        (id) => _request('POST', `/faculty/submissions/${id}/open`),
    addItem:     (id, subject_id, head_note) => _request('POST', `/faculty/submissions/${id}/items`, { subject_id, head_note }),
    removeItem:  (id, itemId, head_note) => _request('PATCH', `/faculty/submissions/${id}/items/${itemId}`, { head_note }),
    approve:     (id, notes) => _request('POST', `/faculty/submissions/${id}/approve`, notes ? { notes } : {}),
    return:      (id, notes) => _request('POST', `/faculty/submissions/${id}/return`, { notes }),
    reject:      (id, notes) => _request('POST', `/faculty/submissions/${id}/reject`, { notes }),
    markEncoded: (id) => _request('POST', `/faculty/submissions/${id}/mark-encoded`),
    exportBlob: async (id) => {
      const token = await _getToken();
      const res = await fetch(`${window.API_BASE}/api/faculty/submissions/${id}/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Export failed.');
      return res.blob();
    },
  };

  // Curriculum management (Phase A). The route contract uses full /api/...
  // paths, but _request already prepends the /api prefix itself, so this
  // local shim strips it before delegating to the shared request helper.
  const request = (method, path, body) =>
    _request(method, path.replace(/^\/api(?=\/)/, ''), body);


  // ---- Background Pre-fetch Queue (Paced & Idle-friendly) ----
  async function prefetchAll(role = 'student', program = 'BSCoE') {
    try {
      // Step 1: Core data (Events, Transactions, Dashboard summary)
      await Promise.allSettled([
        events.list(),
        transactions.list({ limit: 200 }),
        reports.summary(),
        announcements.list(),
      ]);

      // Small breather for the browser main thread
      await new Promise(r => setTimeout(r, 120));

      // Step 2: Reports trends and student tracker data
      const step2 = [
        reports.monthly(),
        reports.eventsSummary(),
        units.my(),
      ];
      if (program) step2.push(units.checklists(program));
      await Promise.allSettled(step2);

      // Step 3: Admin & Officer tools (when user is admin/governor/cashier)
      if (['admin', 'governor', 'cashier'].includes(role)) {
        await new Promise(r => setTimeout(r, 120));
        await Promise.allSettled([
          admin.users(),
          admin.auditLogs({ limit: 100 }),
        ]);
      }
    } catch (err) {
      console.debug('[Api.prefetchAll] Notice:', err?.message || err);
    }
  }

  const roster = {
    async list() {
      if (window.supabaseClient) {
        const { data, error } = await window.supabaseClient
          .from('enrolled_students')
          .select('*')
          .order('full_name', { ascending: true });
        if (error) throw new Error(error.message);
        return data || [];
      }
      return [];
    },
    async create(studentData) {
      if (!window.supabaseClient) throw new Error('Supabase client not available');
      const { data, error } = await window.supabaseClient
        .from('enrolled_students')
        .insert([{
          full_name: studentData.full_name.toUpperCase().trim(),
          sex: studentData.sex || 'M',
          department: studentData.department || 'CoE',
          course: studentData.course,
          year_level: String(studentData.year_level)
        }])
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async update(id, studentData) {
      if (!window.supabaseClient) throw new Error('Supabase client not available');
      const { data, error } = await window.supabaseClient
        .from('enrolled_students')
        .update({
          full_name: studentData.full_name.toUpperCase().trim(),
          sex: studentData.sex || 'M',
          department: studentData.department || 'CoE',
          course: studentData.course,
          year_level: String(studentData.year_level)
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    async bulkCreate(records) {
      if (!window.supabaseClient) throw new Error('Supabase client not available');
      const payload = records.map(r => ({
        full_name: r.full_name.toUpperCase().trim(),
        sex: r.sex || 'M',
        department: r.department || 'CoE',
        course: r.course,
        year_level: String(r.year_level)
      }));
      const { data, error } = await window.supabaseClient
        .from('enrolled_students')
        .insert(payload)
        .select();
      if (error) throw new Error(error.message);
      return data;
    },
    async delete(id) {
      if (!window.supabaseClient) throw new Error('Supabase client not available');
      const { error } = await window.supabaseClient
        .from('enrolled_students')
        .delete()
        .eq('id', id);
      if (error) throw new Error(error.message);
      return true;
    }
  };

  const rosterRequests = {
    async getMyRequest() {
      let sessionUser = null;
      if (window.supabaseClient) {
        try {
          const { data: { session } } = await window.supabaseClient.auth.getSession();
          sessionUser = session?.user;
        } catch {}
      }

      const email = sessionUser?.email?.toLowerCase();
      const userId = sessionUser?.id;

      let cached = null;
      try {
        if (email) {
          const raw = localStorage.getItem(`coe_req_${email}`);
          if (raw) cached = JSON.parse(raw);
        }
        if (!cached && userId) {
          const raw = localStorage.getItem(`coe_req_${userId}`);
          if (raw) cached = JSON.parse(raw);
        }
        if (!cached) {
          const raw = localStorage.getItem('coe_pending_verification');
          if (raw) cached = JSON.parse(raw);
        }
      } catch {}

      if (!window.supabaseClient || (!userId && !email)) return cached;

      try {
        let query = window.supabaseClient
          .from('enrollment_verification_requests')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1);

        if (userId && email) {
          query = query.or(`user_id.eq.${userId},email.eq.${email}`);
        } else if (userId) {
          query = query.eq('user_id', userId);
        } else if (email) {
          query = query.eq('email', email);
        }

        const { data, error } = await query;
        if (error) {
          console.warn('[RosterRequests] getMyRequest warning:', error.message);
          return null;
        }

        const latest = data && data.length > 0 ? data[0] : null;
        if (latest) {
          try {
            if (email) localStorage.setItem(`coe_req_${email}`, JSON.stringify(latest));
            if (userId) localStorage.setItem(`coe_req_${userId}`, JSON.stringify(latest));
            localStorage.setItem('coe_pending_verification', JSON.stringify(latest));
          } catch {}
          return latest;
        }

        // Database returned empty array: request was deleted or does not exist
        // Clear stale local storage immediately so deleted accounts are treated as brand new
        try {
          if (email) localStorage.removeItem(`coe_req_${email}`);
          if (userId) localStorage.removeItem(`coe_req_${userId}`);
          localStorage.removeItem('coe_pending_verification');
        } catch {}

        return null;
      } catch (err) {
        console.warn('[RosterRequests] getMyRequest exception:', err);
        return null;
      }
    },

    async submitRequest(reqData) {
      let user = null;
      if (window.supabaseClient) {
        try {
          const { data: { session } } = await window.supabaseClient.auth.getSession();
          user = session?.user;
        } catch {}
      }

      const email = (reqData.email || user?.email || '').trim().toLowerCase();
      const userId = user?.id || 'usr_' + Date.now();
      const payload = {
        user_id: user?.id || null,
        full_name: reqData.full_name.trim().toUpperCase(),
        email: email,
        course: reqData.course,
        year_level: String(reqData.year_level),
        enrollment_year: reqData.enrollment_year ? Number(reqData.enrollment_year) : null,
        notes: reqData.notes || '',
        status: 'pending'
      };

      const localRecord = {
        ...payload,
        id: 'req_' + Date.now(),
        created_at: new Date().toISOString()
      };

      // Always save locally immediately
      try {
        if (email) localStorage.setItem(`coe_req_${email}`, JSON.stringify(localRecord));
        if (userId) localStorage.setItem(`coe_req_${userId}`, JSON.stringify(localRecord));
        localStorage.setItem('coe_pending_verification', JSON.stringify(localRecord));
      } catch {}

      if (window.supabaseClient && user?.id) {
        try {
          const { data, error } = await window.supabaseClient
            .from('enrollment_verification_requests')
            .insert([{ ...payload, user_id: user.id }])
            .select()
            .single();

          if (!error && data) {
            try {
              if (email) localStorage.setItem(`coe_req_${email}`, JSON.stringify(data));
              localStorage.setItem(`coe_req_${user.id}`, JSON.stringify(data));
              localStorage.setItem('coe_pending_verification', JSON.stringify(data));
            } catch {}
            return data;
          }
        } catch (dbErr) {
          console.warn('[RosterRequests] DB submission note:', dbErr);
        }
      }

      return localRecord;
    },

    async list(status = 'pending') {
      if (!window.supabaseClient) return [];
      let query = window.supabaseClient
        .from('enrollment_verification_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (status && status !== 'all') {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data || [];
    },

    async countPending() {
      if (!window.supabaseClient) return 0;
      const { count, error } = await window.supabaseClient
        .from('enrollment_verification_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');
      if (error) return 0;
      return count || 0;
    },

    async approve(requestId, studentName = '') {
      if (!window.supabaseClient) throw new Error('Supabase client not available');
      const { data: { user } } = await window.supabaseClient.auth.getUser();

      // 1. Fetch request details
      const { data: req, error: reqErr } = await window.supabaseClient
        .from('enrollment_verification_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();
      if (reqErr || !req) throw new Error(reqErr?.message || 'Verification request not found');

      // 2. Insert into enrolled_students (ignore if duplicate)
      try {
        await window.supabaseClient
          .from('enrolled_students')
          .insert([{
            full_name: studentName || req.full_name,
            sex: req.sex || 'M',
            department: 'CoE',
            course: req.course,
            year_level: req.year_level
          }]);
      } catch (e) {
        console.warn('Student insert warning:', e);
      }

      // 3. Mark request as approved
      const { data, error } = await window.supabaseClient
        .from('enrollment_verification_requests')
        .update({
          status: 'approved',
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .maybeSingle();

      if (error) throw new Error(error.message);

      // 4. Verify user account profile & dispatch Gmail notification
      const targetUserId = req.user_id;
      const targetEmail = req.email || req.user_email;

      if (targetUserId) {
        try {
          await admin.verifyUser(targetUserId);
        } catch (err) {
          console.warn('[RosterRequests] User profile verification by ID note:', err?.message || err);
        }
      }
      
      if (targetEmail) {
        try {
          await admin.sendApprovalEmail(targetEmail, req.full_name || studentName);
        } catch (err) {
          console.warn('[RosterRequests] Direct email approval dispatch note:', err?.message || err);
        }
      }

      return data || req;
    },

    async bulkApprove(requestIds) {
      if (!window.supabaseClient) throw new Error('Supabase client not available');
      if (!requestIds || requestIds.length === 0) return [];
      const { data: { user } } = await window.supabaseClient.auth.getUser();

      // 1. Fetch request details for all selected requests
      const { data: reqs, error: reqErr } = await window.supabaseClient
        .from('enrollment_verification_requests')
        .select('*')
        .in('id', requestIds);
      if (reqErr) throw new Error(reqErr.message || 'Failed to fetch verification requests');
      if (!reqs || reqs.length === 0) return [];

      // 2. Prepare enrolled_students bulk payload
      const studentsToInsert = reqs.map(r => ({
        full_name: r.full_name,
        sex: r.sex || 'M',
        department: 'CoE',
        course: r.course,
        year_level: r.year_level
      }));

      try {
        await window.supabaseClient
          .from('enrolled_students')
          .insert(studentsToInsert);
      } catch (e) {
        console.warn('[RosterRequests] Bulk student insert note:', e);
      }

      // 3. Mark all selected requests as approved
      const { data, error: updateErr } = await window.supabaseClient
        .from('enrollment_verification_requests')
        .update({
          status: 'approved',
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString()
        })
        .in('id', requestIds)
        .select();

      if (updateErr) throw new Error(updateErr.message);

      // Verify user profiles & dispatch Gmail notification
      for (const r of reqs) {
        if (r.user_id) {
          admin.verifyUser(r.user_id).catch(() => {});
        }
      }

      return data || reqs;
    },

    async reject(requestId, reason = '') {
      if (!window.supabaseClient) throw new Error('Supabase client not available');
      const { data: { user } } = await window.supabaseClient.auth.getUser();

      const { data, error } = await window.supabaseClient
        .from('enrollment_verification_requests')
        .update({
          status: 'rejected',
          rejection_reason: reason || null,
          reviewed_by: user?.id || null,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId)
        .select()
        .maybeSingle();

      if (error) throw new Error(error.message);
      return data;
    }
  };

  const profile = {
    update: (updates) => _request('POST', '/admin/profile', updates),
  };

  return {
    events,
    transactions,
    reports,
    admin,
    units,
    announcements,
    // Load submission flows (Phase B): student enrollment + faculty evaluation.
    enrollment,
    faculty,
    // Curriculum management (Phase A): contract paths are full /api/... —
    // `request` (above) strips the prefix before delegating to _request.
    curriculum: {
      subjects: (program) =>
        request('GET', `/api/units/checklists?program=${encodeURIComponent(program)}`),
      updateComponents: (id, lec_units, lab_units) =>
        request('PATCH', `/api/curriculum/subjects/${id}`, { lec_units, lab_units }),
      prerequisites: (subjectId) =>
        request('GET', `/api/curriculum/subjects/${subjectId}/prerequisites`),
      addPrereq: (payload) => request('POST', '/api/curriculum/prerequisites', payload),
      deletePrereq: (id) => request('DELETE', `/api/curriculum/prerequisites/${id}`),
    },
    roster,
    rosterRequests,
    profile,
    request: _request,
    invalidateCache,
    hasCache,
    getCache,
    prefetchAll,
  };
})();

