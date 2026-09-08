// =============================================
// auth.js - Authentication Module
// =============================================

const Auth = (() => {

  function client() {
    if (!window.supabaseClient) {
      throw new Error('Database connection not initialized. Please check your internet connection and refresh.');
    }
    return window.supabaseClient;
  }

  async function login(email, password) {
    const { data, error } = await client().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function register(fullName, email, password, extra = {}) {
    const { data, error } = await client().auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, ...extra } },
    });
    if (error) throw error;
    return data;
  }

  async function logout() {
    if (window.supabaseClient) {
      if (typeof window.supabaseClient.removeAllChannels === 'function') {
        try { window.supabaseClient.removeAllChannels(); } catch {}
      }
      if (window.supabaseClient.auth) {
        await window.supabaseClient.auth.signOut();
      }
    }
  }

  async function getSession() {
    if (!window.supabaseClient?.auth) return null;
    try {
      const { data: { session } } = await window.supabaseClient.auth.getSession();
      return session;
    } catch {
      return null;
    }
  }

  // Validates the stored session against GoTrue. A session restored from
  // localStorage can carry a token that no longer verifies (e.g. signed with a
  // pre-rotation JWT secret) — the app still works because data flows through
  // the backend with the service key, but every realtime join it attempts then
  // fails with JwtSignatureError on the Supabase logs. Purge such sessions so
  // the user re-authenticates with a fresh token.
  async function validateSession() {
    const session = await getSession();
    if (!session || !window.supabaseClient?.auth) return null;

    try {
      const { error } = await window.supabaseClient.auth.getUser();
      if (!error) return session;

      // 401/403 = GoTrue definitively rejected the token. Anything else
      // (offline, timeout, 5xx) must NOT log the user out.
      if (error.status === 401 || error.status === 403) {
        console.warn('[Auth] Stored session token was rejected by the server — clearing it. Please sign in again.');
        try { await window.supabaseClient.auth.signOut({ scope: 'local' }); } catch {}
        // Belt and braces: guarantee the rejected token is gone even when the
        // signOut network call itself fails with the same 401.
        try {
          Object.keys(localStorage)
            .filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
            .forEach((k) => localStorage.removeItem(k));
        } catch {}
        try { window.supabaseClient.realtime?.setAuth?.(window.SUPABASE_ANON); } catch {}
        return null;
      }

      console.debug('[Auth] Session validation skipped (non-rejection error):', error.message);
      return session;
    } catch (err) {
      // Network-level failure — keep the session, offline usage must survive.
      console.debug('[Auth] Session validation unreachable:', err?.message);
      return session;
    }
  }

  async function getProfile() {
    const session = await getSession();
    if (!session || !window.supabaseClient) return null;

    try {
      const { data, error } = await window.supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!error && data) {
        try { localStorage.setItem('cached_profile_' + session.user.id, JSON.stringify(data)); } catch {}
        return data;
      }
    } catch {
      /* offline or network error */
    }

    try {
      const cached = localStorage.getItem('cached_profile_' + session.user.id);
      if (cached) return JSON.parse(cached);
    } catch {}

    return null;
  }

  async function loginWithGoogle() {
    const sb = client();
    const redirectUrl = window.location.origin && window.location.origin !== 'null'
      ? (window.location.origin + window.location.pathname)
      : window.location.href.split('#')[0].split('?')[0];

    const { data, error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl,
        queryParams: {
          hd: 'g.cjc.edu.ph', // Enforces Cor Jesu College Google account selection
          prompt: 'select_account'
        }
      }
    });
    if (error) throw error;
    if (data?.url) {
      window.location.href = data.url;
    }
    return data;
  }

  async function updateProfile(userId, updates) {
    const session = await getSession();
    const token = session?.access_token || window._authToken;
    const apiBase = window.API_BASE || 'https://api.coelgu-system.engineer';

    // 1. Primary path: Use the backend API (/api/admin/profile) with service role
    if (token) {
      try {
        const res = await fetch(`${apiBase}/api/admin/profile`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(updates)
        });

        if (res.ok) {
          const data = await res.json();
          if (data && data.id) {
            return data;
          }
        }
      } catch (err) {
        console.warn('[Auth.updateProfile] Backend API update exception:', err);
      }
    }

    const sb = client();

    // 2. Direct Supabase Client update (works when row exists)
    const { data, error } = await sb
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .maybeSingle();

    if (data) return data;

    // 3. If direct update returned 0 rows and backend was unreachable:
    // Try upsert and catch any RLS errors with a friendly message
    const email = session?.user?.email || '';
    const { data: upsertData, error: upsertError } = await sb
      .from('profiles')
      .upsert({
        id: userId,
        email: email,
        role: 'student',
        ...updates
      }, { onConflict: 'id' })
      .select()
      .maybeSingle();

    if (upsertData) return upsertData;

    if (upsertError) {
      console.error('[Auth.updateProfile] Upsert error:', upsertError);
      throw new Error(upsertError.message?.includes('row-level security')
        ? 'Your account profile is pending activation. Please refresh or contact council officers.'
        : upsertError.message);
    }

    return null;
  }

  async function updatePassword(password) {
    const { data, error } = await client().auth.updateUser({ password });
    if (error) throw error;
    return data;
  }

  function onAuthChange(callback) {
    if (!window.supabaseClient?.auth) return;
    window.supabaseClient.auth.onAuthStateChange((event, session) => {
      // Expose token globally so reports downloads can authenticate
      window._authToken = session?.access_token || null;
      if (event === 'SIGNED_OUT' || !session) {
        try {
          if (window.supabaseClient?.realtime && typeof window.supabaseClient.realtime.setAuth === 'function' && window.SUPABASE_ANON) {
            window.supabaseClient.realtime.setAuth(window.SUPABASE_ANON);
          }
        } catch {}
      }
      callback(event, session);
    });
  }

  return { login, loginWithGoogle, register, logout, getSession, validateSession, getProfile, updateProfile, updatePassword, onAuthChange };
})();


