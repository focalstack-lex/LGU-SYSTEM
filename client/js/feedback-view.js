// =============================================
// feedback-view.js - developer-only feedback viewer (/feedback/view)
// Login via Supabase auth, then GET /api/feedback (server enforces
// the DEVELOPER_EMAILS allowlist - this script only renders).
// =============================================
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const loginView = $('view-login');
  const dataView = $('view-data');
  const loginForm = $('fbv-login-form');
  const loginError = $('fbv-login-error');
  const listEl = $('fbv-list');
  const statsEl = $('fbv-stats');
  const dataError = $('fbv-error');

  let client = null;

  if (typeof supabase === 'undefined' || !window.SUPABASE_URL) {
    showLogin('Supabase failed to load. Check your connection and refresh.');
    return;
  }
  client = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON, {
    auth: { storage: window.localStorage, persistSession: true, autoRefreshToken: true },
  });

  // ---------- helpers ----------

  function showLogin(message) {
    dataView.classList.add('hidden');
    loginView.classList.remove('hidden');
    if (message) {
      loginError.textContent = message;
      loginError.classList.remove('hidden');
    }
  }

  function showData() {
    loginView.classList.add('hidden');
    dataView.classList.remove('hidden');
  }

  function ratingCell(label, value) {
    if (typeof value !== 'number') {
      return `<span class="na">${label} n/a</span>`;
    }
    return `<span>${label} <b>${value}</b></span>`;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---------- data ----------

  async function loadData() {
    dataError.classList.add('hidden');
    listEl.innerHTML = '<p class="fbv-empty">Loading…</p>';

    const { data: { session } } = await client.auth.getSession();
    if (!session) { showLogin(); return; }

    let res;
    try {
      res = await fetch((window.API_BASE || '') + '/api/feedback', {
        headers: { Authorization: 'Bearer ' + session.access_token },
      });
    } catch {
      listEl.innerHTML = '';
      dataError.textContent = 'Network error. Click Refresh to retry.';
      dataError.classList.remove('hidden');
      return;
    }

    if (res.status === 401 || res.status === 403) {
      const body = await res.json().catch(() => ({}));
      showLogin(body.error || 'Access denied.');
      await client.auth.signOut();
      return;
    }
    if (!res.ok) {
      listEl.innerHTML = '';
      dataError.textContent = 'Could not load feedback. Click Refresh to retry.';
      dataError.classList.remove('hidden');
      return;
    }

    const { stats, items } = await res.json();

    const statBlock = (num, sub, label) =>
      `<div class="fbv-stat"><b>${num}${sub ? ` <em>${sub}</em>` : ''}</b><span>${label}</span></div>`;

    const avg = stats.avg || {};
    statsEl.innerHTML =
      statBlock(stats.total, '', 'Total') +
      statBlock(avg.ease ?? 'n/a', `n=${avg.ease_n || 0}`, 'Ease') +
      statBlock(avg.accuracy ?? 'n/a', `n=${avg.accuracy_n || 0}`, 'Reliability') +
      statBlock(avg.ledger ?? 'n/a', `n=${avg.ledger_n || 0}`, 'Ledger') +
      statBlock(avg.grizz ?? 'n/a', `n=${avg.grizz_n || 0}`, 'Grizz') +
      statBlock(avg.performance ?? 'n/a', `n=${avg.performance_n || 0}`, 'Perf');

    if (!items.length) {
      listEl.innerHTML = '<p class="fbv-empty">No submissions yet.</p>';
      return;
    }

    listEl.innerHTML = items.map((it) => {
      const who = [it.email, it.program, it.year_level ? it.year_level + (it.year_level === 1 ? 'st' : it.year_level === 2 ? 'nd' : it.year_level === 3 ? 'rd' : 'th') : null]
        .filter(Boolean).join(' · ') || 'no account';
      const ratings = [
        ratingCell('Ease', it.ease),
        ratingCell('Reliability', it.accuracy),
        ratingCell('Ledger', it.ledger),
        ratingCell('Grizz', it.grizz),
        ratingCell('Perf', it.performance),
      ].join('');
      const improve = it.improve ? `<p class="fbv-text"><span>Improve</span>${esc(it.improve)}</p>` : '';
      const bug = it.bug ? `<p class="fbv-text"><span>Bug</span>${esc(it.bug)}</p>` : '';
      return `<article class="fbv-item">
        <div class="fbv-meta"><span>${fmtDate(it.created_at)}</span><span>${esc(who)}</span></div>
        <div class="fbv-ratings">${ratings}</div>
        ${improve}${bug}
      </article>`;
    }).join('');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- events ----------

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const btn = $('fbv-login-btn');
    btn.disabled = true;
    const { error } = await client.auth.signInWithPassword({
      email: $('fbv-email').value.trim(),
      password: $('fbv-password').value,
    });
    btn.disabled = false;
    if (error) {
      loginError.textContent = error.message;
      loginError.classList.remove('hidden');
    }
  });

  $('fbv-google-btn').addEventListener('click', async () => {
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

  $('fbv-refresh').addEventListener('click', loadData);
  $('fbv-logout').addEventListener('click', () => client.auth.signOut());

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
      showData();
      loadData();
    } else if (event === 'SIGNED_OUT') {
      showLogin();
    }
  });

  // ---------- boot ----------

  (async () => {
    const { data: { session } } = await client.auth.getSession();
    if (session) {
      showData();
      loadData();
    } else {
      showLogin();
    }
  })();
})();
