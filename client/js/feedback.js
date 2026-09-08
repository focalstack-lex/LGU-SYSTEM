// =============================================
// feedback.js - /feedback portal
// Students must sign in before answering; the session token is sent with
// the submission so the server can record who left it.
// =============================================
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const loginView = $('fb-login');
  const formWrap = $('fb-form-wrap');
  const doneView = $('fb-done');
  const form = $('fb-form');
  const errorBox = $('fb-error');
  const loginError = $('fb-login-error');
  const submitBtn = $('fb-submit');

  let client = null;

  if (typeof supabase === 'undefined' || !window.SUPABASE_URL) {
    showLogin('Supabase failed to load. Check your connection and refresh.');
    return;
  }
  client = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON, {
    auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: true },
  });

  // ---------- view switching ----------

  function showLogin(message) {
    formWrap.classList.add('hidden');
    doneView.classList.add('hidden');
    loginView.classList.remove('hidden');
    if (message) {
      loginError.textContent = message;
      loginError.classList.remove('hidden');
    }
  }

  function showForm() {
    loginView.classList.add('hidden');
    doneView.classList.add('hidden');
    formWrap.classList.remove('hidden');
    client.auth.getSession().then(({ data: { session } }) => {
      $('fb-who').textContent = session?.user?.email || 'student account';
    });
  }

  function showDone() {
    loginView.classList.add('hidden');
    formWrap.classList.add('hidden');
    doneView.classList.remove('hidden');
    window.scrollTo({ top: 0 });
  }

  // ---------- rating scales (radio group rendered as pill buttons) ----------

  document.querySelectorAll('.fb-scale').forEach((group) => {
    const name = group.dataset.name;
    const naLabel = group.dataset.na === '0' ? null : group.dataset.na;
    const values = [1, 2, 3, 4, 5];
    if (naLabel) values.push(null);

    values.forEach((v) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = v === null ? naLabel : String(v);
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      if (v === null) btn.classList.add('fb-na');
      btn.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((b) => {
          b.classList.remove('on');
          b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('on');
        btn.setAttribute('aria-checked', 'true');
        group.dataset.value = v === null ? 'NA' : String(v);
      });
      group.appendChild(btn);
    });
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', group.parentElement.querySelector('.fb-label').textContent.trim());
  });

  // ---------- login ----------

  $('fb-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const btn = $('fb-login-btn');
    btn.disabled = true;
    const { error } = await client.auth.signInWithPassword({
      email: $('fb-email').value.trim(),
      password: $('fb-password').value,
    });
    btn.disabled = false;
    if (error) {
      loginError.textContent = error.message;
      loginError.classList.remove('hidden');
    }
  });

  $('fb-google-btn').addEventListener('click', async () => {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { hd: 'g.cjc.edu.ph', prompt: 'select_account' },
      },
    });
    if (error) {
      loginError.textContent = error.message;
      loginError.classList.remove('hidden');
    }
  });

  $('fb-signout').addEventListener('click', () => client.auth.signOut());

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      showForm();
    } else if (event === 'SIGNED_OUT') {
      form.reset();
      showLogin();
    }
  });

  // ---------- submit ----------

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');

    const { data: { session } } = await client.auth.getSession();
    if (!session) {
      showLogin('Session expired. Please sign in again.');
      return;
    }

    const payload = {};
    document.querySelectorAll('.fb-scale').forEach((g) => {
      if (g.dataset.value && g.dataset.value !== 'NA') payload[g.dataset.name] = Number(g.dataset.value);
    });
    payload.program = $('fb-program').value;
    payload.year_level = $('fb-year').value;
    payload.improve = $('fb-improve').value;
    payload.bug = $('fb-bug').value;
    payload.website = form.elements.website.value; // honeypot

    const hasAnything = Object.keys(payload).some((k) =>
      ['ease', 'accuracy', 'ledger', 'grizz', 'performance', 'improve', 'bug'].includes(k) && payload[k]
    );
    if (!hasAnything) {
      errorBox.textContent = 'Answer at least one question before submitting.';
      errorBox.classList.remove('hidden');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      const res = await fetch((window.API_BASE || '') + '/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401 || res.status === 403) {
        showLogin('Please sign in again to continue.');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }
      showDone();
    } catch (err) {
      errorBox.textContent = err.message || 'Network error. Please try again.';
      errorBox.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit feedback';
    }
  });

  // ---------- boot ----------

  (async () => {
    const { data: { session } } = await client.auth.getSession();
    if (session) showForm();
    else showLogin();
  })();
})();
