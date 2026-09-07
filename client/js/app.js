// =============================================
// app.js - Main Application Router
// =============================================

(async () => {

  // Initialize Lucide icons on load
// Reveal the brand-panel artwork only after its PNG has finished loading,
  // so the fade-in always covers the moment it becomes visible.
  const brandPanel = document.querySelector('.auth-brand-panel');
  if (brandPanel) {
    const pattern = new Image();
    pattern.onload = pattern.onerror = () => brandPanel.classList.add('brand-pattern-ready');
    pattern.src = 'assets/bg-pattern-front.png';
  }

  // ---- Login ----
  document.getElementById('login-btn').addEventListener('click', async () => {
    const errEl = document.getElementById('login-error');
    const btn   = document.getElementById('login-btn');
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-password').value;

    errEl.classList.add('hidden');

    if (!email || !pass) {
      errEl.textContent = 'Please enter your email and password.';
      errEl.classList.remove('hidden');
      return;
    }

    btn.textContent = 'Signing in…';
    btn.disabled = true;

    try {
      await Auth.login(email, pass);
    } catch (err) {
      const lowerEmail = email.toLowerCase();
      const isSchoolEmail = lowerEmail.endsWith('@g.cjc.edu.ph');
      
      if (err.message.includes('missing email or phone') || err.message.includes('phone')) {
        errEl.textContent = 'Please enter your email and password.';
      } else if (isSchoolEmail && (err.message.includes('Invalid login credentials') || err.message.includes('Invalid credentials') || err.message.includes('invalid_grant'))) {
        errEl.innerHTML = '<strong>Notice:</strong> You will not use your official GSuite/Google account password in this area. Please click <strong>Continue with CJC Google Account</strong> above to sign in securely with your school account.';
      } else {
        errEl.textContent = err.message || 'Invalid email or password.';
      }
      errEl.classList.remove('hidden');
    } finally {
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  });

  // Allow Enter key on login form
  document.getElementById('login-password').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });

  // ---- Google OAuth Sign-in Handler ----
  const googleLoginBtn = document.getElementById('google-login-btn');

  async function handleGoogleAuth(btn, errorElId) {
    const errEl = document.getElementById(errorElId);
    if (errEl) errEl.classList.add('hidden');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>Connecting to Google…</span>';
    btn.disabled = true;

    try {
      await Auth.loginWithGoogle();
      // Supabase redirects to Google OAuth flow
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'Google sign-in failed. Please try again.';
        errEl.classList.remove('hidden');
      }
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }

  if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', () => handleGoogleAuth(googleLoginBtn, 'login-error'));
  }

  // ---- Custom animated dropdowns (shared component, see dropdown.js) ----
  // Onboarding selects
  ['onboarding-course', 'onboarding-year', 'onboarding-enrollment-year'].forEach(id => {
    const el = document.getElementById(id);
    if (el) Dropdowns.bindDropdown(el);
  });

  // Auto-calculate enrollment year based on selected Year Level (SY 2026-2027 base: 2026)
  const onboardingYearSelect = document.getElementById('onboarding-year');
  const onboardingEnrollSelect = document.getElementById('onboarding-enrollment-year');
  if (onboardingYearSelect && onboardingEnrollSelect) {
    onboardingYearSelect.addEventListener('change', () => {
      const y = parseInt(onboardingYearSelect.value, 10);
      if (y >= 1 && y <= 5) {
        const computedYear = String(2026 - (y - 1));
        onboardingEnrollSelect.value = computedYear;
        Dropdowns.syncAll();
      }
    });
  }

  // Every other select in the logged-in app
  Dropdowns.bindAll('#app-screen');

  // ---- First-Time Onboarding / Registration Gate ----
  const onboardingModal = document.getElementById('onboarding-modal');
  const onboardingSubmitBtn = document.getElementById('onboarding-submit-btn');
  const onboardingLogoutBtn = document.getElementById('onboarding-logout-btn');
  const onboardingError = document.getElementById('onboarding-error');
  const onboardingPendingLogoutBtn = document.getElementById('onboarding-pending-logout-btn');
  const onboardingRefreshBtn = document.getElementById('onboarding-refresh-btn');

  let _isRosterMatched = false;
  let _existingRequest = null;
  let _currentUser = null;
  let _currentProfile = null;

  async function checkRosterVerification(name, email = '') {
    if (!window.Roster) return null;
    const match = await Roster.findStudentAsync(name, email);
    const courseSel = document.getElementById('onboarding-course');
    const yearSel = document.getElementById('onboarding-year');

    const isApproved = Boolean(match || (_existingRequest && _existingRequest.status === 'approved'));

    if (isApproved) {
      _isRosterMatched = true;
      if (courseSel && match?.course) courseSel.value = match.course;
      if (yearSel && match?.year) yearSel.value = match.year;
      Dropdowns.syncAll();
      applyOnboardingState(true);
    } else {
      _isRosterMatched = false;
      applyOnboardingState(false);
    }
    return match;
  }

  function applyOnboardingState(isMatched) {
    const banner = document.getElementById('onboarding-unmatched-banner');
    const notesWrap = document.getElementById('onboarding-notes-wrap');
    const passSec = document.getElementById('onboarding-password-section');
    const submitText = document.getElementById('onboarding-submit-text');
    const modalTitle = document.getElementById('onboarding-modal-title');
    const eyebrow = document.getElementById('onboarding-modal-eyebrow');

    if (isMatched) {
      if (banner) banner.classList.add('hidden');
      if (notesWrap) notesWrap.style.display = 'none';
      if (passSec) passSec.style.display = 'block';
      if (submitText) submitText.textContent = 'Complete Registration & Enter Portal';
      if (modalTitle) modalTitle.textContent = 'Complete Your Student Profile';
      if (eyebrow) eyebrow.innerHTML = '<iconify-icon icon="solar:shield-check-linear"></iconify-icon> Student Registration';
    } else {
      if (banner) banner.classList.remove('hidden');
      if (notesWrap) notesWrap.style.display = 'block';
      if (passSec) passSec.style.display = 'none';
      if (submitText) submitText.textContent = 'Submit Verification Request';
      if (modalTitle) modalTitle.textContent = 'Enrollment Verification Required';
      if (eyebrow) eyebrow.innerHTML = '<iconify-icon icon="solar:shield-warning-linear"></iconify-icon> Verification Required';
    }
  }

  async function showOnboardingModal(user, profile) {
    if (!onboardingModal) return;
    _currentUser = user;
    _currentProfile = profile;

    const formSec = document.getElementById('onboarding-form-section');
    const pendingSec = document.getElementById('onboarding-pending-state');

    // 1. Check if user already submitted a verification request
    let existingReq = null;
    if (window.Api && window.Api.rosterRequests) {
      existingReq = await Api.rosterRequests.getMyRequest();
    }

    if (!existingReq) {
      try {
        if (user?.email) localStorage.removeItem(`coe_req_${user.email.toLowerCase()}`);
        if (user?.id) localStorage.removeItem(`coe_req_${user.id}`);
        localStorage.removeItem('coe_pending_verification');
      } catch {}
    }

    _existingRequest = existingReq;

    if (existingReq && existingReq.status === 'pending') {
      // Show pending review state screen
      if (formSec) formSec.classList.add('hidden');
      if (pendingSec) {
        pendingSec.classList.remove('hidden');
        const nameEl = document.getElementById('onboarding-pending-name');
        const courseEl = document.getElementById('onboarding-pending-course');
        if (nameEl) nameEl.textContent = existingReq.full_name || user?.user_metadata?.full_name || '—';
        if (courseEl) courseEl.textContent = `${existingReq.course} - Year ${existingReq.year_level}`;
      }
      onboardingModal.classList.remove('hidden');
      document.body.classList.add('modal-open');
      return;
    }

    // Otherwise show form
    if (formSec) formSec.classList.remove('hidden');
    if (pendingSec) pendingSec.classList.add('hidden');

    const nameInput = document.getElementById('onboarding-name');
    let defaultName = user?.user_metadata?.full_name || user?.user_metadata?.name || profile?.full_name || '';
    if (nameInput) {
      nameInput.value = defaultName;
      nameInput.placeholder = 'Firstname Lastname';
    }
    const courseSel = document.getElementById('onboarding-course');
    const yearSel = document.getElementById('onboarding-year');
    const enrollSel = document.getElementById('onboarding-enrollment-year');
    const passInput = document.getElementById('onboarding-password');
    const confirmInput = document.getElementById('onboarding-confirm');

    if (courseSel && profile?.course) courseSel.value = profile.course;
    if (yearSel && profile?.year_level) yearSel.value = profile.year_level;
    if (enrollSel && profile?.enrollment_year) enrollSel.value = profile.enrollment_year;
    if (passInput) passInput.value = '';
    if (confirmInput) confirmInput.value = '';

    // Auto-verify against master roster
    const match = await checkRosterVerification(defaultName, user?.email || profile?.email);
    if (!match && existingReq && existingReq.status === 'approved') {
      _isRosterMatched = true;
      applyOnboardingState(true);
    } else if (!match) {
      _isRosterMatched = false;
      applyOnboardingState(false);
    }

    Dropdowns.syncAll();
    onboardingModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  // Live auto-match when student types their name in onboarding
  document.getElementById('onboarding-name')?.addEventListener('input', async (e) => {
    await checkRosterVerification(e.target.value.trim(), _currentUser?.email);
  });

  if (onboardingLogoutBtn) {
    onboardingLogoutBtn.addEventListener('click', async () => {
      await Auth.logout();
      window.location.reload();
    });
  }

  if (onboardingPendingLogoutBtn) {
    onboardingPendingLogoutBtn.addEventListener('click', async () => {
      await Auth.logout();
      window.location.reload();
    });
  }

  if (onboardingRefreshBtn) {
    onboardingRefreshBtn.addEventListener('click', async () => {
      onboardingRefreshBtn.disabled = true;
      onboardingRefreshBtn.innerHTML = '<iconify-icon icon="solar:refresh-linear" class="spin"></iconify-icon> Checking Status…';

      try {
        if (window.Roster && window.Roster.getRoster) {
          await window.Roster.getRoster();
        }
        const req = await Api.rosterRequests.getMyRequest();
        const match = await checkRosterVerification(req?.full_name || _currentProfile?.full_name, _currentUser?.email);

        if ((req && req.status === 'approved') || match) {
          UI.toast('Verification approved! Entering student portal…', 'success');
          setTimeout(() => window.location.reload(), 1000);
          return;
        } else if (req && req.status === 'rejected') {
          UI.toast(`Verification request rejected: ${req.rejection_reason || 'Please contact executive officers.'}`, 'error');
          // Re-open form so student can correct details
          document.getElementById('onboarding-pending-state')?.classList.add('hidden');
          document.getElementById('onboarding-form-section')?.classList.remove('hidden');
          applyOnboardingState(false);
        } else {
          UI.toast('Your request is still pending review by the Executive Board.', 'info');
        }
      } catch (err) {
        UI.toast(`Error checking status: ${err.message}`, 'error');
      } finally {
        onboardingRefreshBtn.disabled = false;
        onboardingRefreshBtn.innerHTML = '<iconify-icon icon="solar:refresh-linear"></iconify-icon> <span>Check Approval Status</span>';
      }
    });
  }

  if (onboardingSubmitBtn) {
    onboardingSubmitBtn.addEventListener('click', async () => {
      const name = document.getElementById('onboarding-name')?.value.trim();
      const course = document.getElementById('onboarding-course')?.value;
      const year = document.getElementById('onboarding-year')?.value;
      const enrollYear = document.getElementById('onboarding-enrollment-year')?.value;
      const notes = document.getElementById('onboarding-notes')?.value.trim();
      const pass = document.getElementById('onboarding-password')?.value;
      const confirm = document.getElementById('onboarding-confirm')?.value;

      onboardingError.classList.add('hidden');

      if (!name) {
        onboardingError.textContent = 'Please enter your Full Name.';
        onboardingError.classList.remove('hidden');
        return;
      }

      if (!course || !year || !enrollYear) {
        onboardingError.textContent = 'Please select your Engineering Program, Year Level, and Enrollment Year.';
        onboardingError.classList.remove('hidden');
        return;
      }

      // If student is NOT matched in masterlist, submit verification request
      if (!_isRosterMatched) {
        onboardingSubmitBtn.disabled = true;
        onboardingSubmitBtn.innerHTML = '<span>Submitting Request…</span>';

        try {
          await Api.rosterRequests.submitRequest({
            full_name: name,
            email: _currentUser?.email,
            course,
            year_level: year,
            enrollment_year: Number(enrollYear),
            notes
          });

          UI.toast('Verification request submitted successfully! Awaiting Executive confirmation.', 'success');

          // Switch to pending review view
          document.getElementById('onboarding-form-section')?.classList.add('hidden');
          const pendingSec = document.getElementById('onboarding-pending-state');
          if (pendingSec) {
            pendingSec.classList.remove('hidden');
            document.getElementById('onboarding-pending-name').textContent = name;
            document.getElementById('onboarding-pending-course').textContent = `${course} - Year ${year}`;
          }
        } catch (err) {
          onboardingError.textContent = err.message || 'Failed to submit verification request.';
          onboardingError.classList.remove('hidden');
        } finally {
          onboardingSubmitBtn.disabled = false;
          onboardingSubmitBtn.innerHTML = '<span>Submit Verification Request</span>';
        }
        return;
      }

      // Standard Registration / Onboarding Completion
      if (pass || confirm) {
        if (!pass || pass.length < 8) {
          onboardingError.textContent = 'Password must be at least 8 characters long.';
          onboardingError.classList.remove('hidden');
          return;
        }
        if (pass !== confirm) {
          onboardingError.textContent = 'Passwords do not match.';
          onboardingError.classList.remove('hidden');
          return;
        }
      }

      const originalText = '<span>Complete Registration &amp; Enter Portal</span>';
      onboardingSubmitBtn.disabled = true;
      onboardingSubmitBtn.innerHTML = '<span>Saving Profile…</span>';

      try {
        const session = await Auth.getSession();
        if (!session?.user?.id) throw new Error('Session expired. Please sign in again.');

        await Auth.updateProfile(session.user.id, {
          full_name: name,
          course,
          year_level: year,
          enrollment_year: Number(enrollYear)
        });

        // Set/update account password if provided
        if (pass) {
          await Auth.updatePassword(pass);
        }

        // Dismiss modal smoothly
        onboardingModal.classList.add('modal-closing');
        setTimeout(() => {
          onboardingModal.classList.add('hidden');
          onboardingModal.classList.remove('modal-closing');
          document.body.classList.remove('modal-open');
        }, 160);

        UI.toast('Profile & credentials setup complete! Welcome to COE Portal.', 'success');

        // Now boot the registered student into the app
        _bootedUserId = null;
        await bootApp(session);
      } catch (err) {
        onboardingError.textContent = err.message || 'Failed to update profile. Please try again.';
        onboardingError.classList.remove('hidden');
      } finally {
        onboardingSubmitBtn.disabled = false;
        onboardingSubmitBtn.innerHTML = originalText;
      }
    });
  }


  // ---- Logout (sidebar + mobile headers + profile modal) ----
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await Auth.logout();
  });
  document.getElementById('app-mobile-logout-btn')?.addEventListener('click', async () => {
    await Auth.logout();
  });
  document.getElementById('bottom-logout-btn')?.addEventListener('click', async () => {
    await Auth.logout();
  });
  document.getElementById('profile-modal-logout-btn')?.addEventListener('click', async () => {
    const modal = document.getElementById('profile-modal');
    const overlay = document.getElementById('profile-modal-overlay');
    if (modal) modal.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
    await Auth.logout();
  });

  // ---- Theme Manager (Light / Dark Mode Toggle & Sync) ----
  const ThemeManager = {
    init() {
      const toggleBtn = document.getElementById('theme-toggle-btn');
      const ursaThemeBtn = document.getElementById('ursa-theme-btn');
      const profileThemeSelect = document.getElementById('profile-theme-select');

      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => this.toggleTheme());
      }
      if (ursaThemeBtn) {
        ursaThemeBtn.addEventListener('click', () => this.toggleTheme());
      }
      document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        btn.addEventListener('click', () => this.toggleTheme());
      });
      if (profileThemeSelect) {
        profileThemeSelect.value = localStorage.getItem('theme') || 'dark';
        profileThemeSelect.addEventListener('change', (e) => {
          this.setTheme(e.target.value);
        });
      }

      this.updateUI();
    },

    setTheme(theme) {
      localStorage.setItem('theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
      if (typeof UI !== 'undefined' && UI.syncThemeColor) UI.syncThemeColor(theme);
      this.updateUI();
      // Dispatch a custom event to notify other components (e.g. Chart.js redraw in reports.js)
      window.dispatchEvent(new CustomEvent('themechanged', { detail: { theme } }));
    },

    toggleTheme() {
      const currentTheme = localStorage.getItem('theme') || 'dark';
      const targetTheme = currentTheme === 'dark' ? 'light' : 'dark';
      this.setTheme(targetTheme);
    },

    updateUI() {
      const currentTheme = localStorage.getItem('theme') || 'dark';
      const icon = currentTheme === 'dark' ? 'solar:sun-linear' : 'solar:moon-linear';
      const title = currentTheme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme';

      const themeIcon = document.getElementById('theme-icon');
      const themeBtn = document.getElementById('theme-toggle-btn');
      if (themeIcon) themeIcon.setAttribute('icon', icon);
      if (themeBtn) themeBtn.setAttribute('title', title);

      document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
        const iconEl = btn.querySelector('iconify-icon');
        if (iconEl) iconEl.setAttribute('icon', icon);
        btn.setAttribute('title', title);
      });

      const ursaThemeIcon = document.getElementById('ursa-theme-icon');
      const ursaThemeBtn = document.getElementById('ursa-theme-btn');
      if (ursaThemeIcon) ursaThemeIcon.setAttribute('icon', icon);
      if (ursaThemeBtn) ursaThemeBtn.setAttribute('title', title);

      const profileThemeSelect = document.getElementById('profile-theme-select');
      if (profileThemeSelect) profileThemeSelect.value = currentTheme;
    }
  };
  window.ThemeManager = ThemeManager; // Expose globally for profile.js access
  ThemeManager.init();


  let _bootedUserId = null;

  // ---- Auth State Observer ----
  Auth.onAuthChange(async (event, session) => {
    if (session) {
      // Ignore background token refresh or window refocus events if already booted
      if (_bootedUserId === session.user.id) {
        return;
      }
      _bootedUserId = session.user.id;
      await bootApp(session);
    } else {
      _bootedUserId = null;
      // Fresh login should start at the dashboard, not a stale last view
      try { sessionStorage.removeItem('lastView'); } catch { /* storage unavailable */ }
      UI.showScreen('auth');
      Dashboard.destroy();
      if (typeof Notifications !== 'undefined' && Notifications.destroy) {
        Notifications.destroy();
      }
    }
  });

  // ---- Boot on existing session ----
  // validateSession() (not plain getSession()) drops localStorage sessions whose
  // token the server no longer accepts — those are what produce the recurring
  // JwtSignatureError noise in the Supabase realtime logs.
  const session = await (Auth.validateSession ? Auth.validateSession() : Auth.getSession());
  if (session) {
    if (_bootedUserId !== session.user.id) {
      _bootedUserId = session.user.id;
      await bootApp(session);
    }
  } else {
    try {
      const publicStatus = await fetch(`${window.API_BASE || ''}/api/public/status`).then(r => r.json()).catch(() => ({ enabled: false }));
      if (publicStatus?.enabled) {
        window.IS_PUBLIC_VIEWER = true;
        UI.showScreen('app');
        UI.showView('dashboard');
        Dashboard.load();
        document.querySelectorAll('[data-view="admin"], [data-view="income"], [data-view="units"]').forEach(el => el.style.display = 'none');
      } else {
        UI.showScreen('auth');
      }
    } catch {
      UI.showScreen('auth');
    }
  }

  // ---- Offline banner listeners ----
  window.addEventListener('offline', () => {
    const b = document.getElementById('offline-banner');
    if (b) b.classList.remove('hidden');
  });
  window.addEventListener('online', () => {
    const b = document.getElementById('offline-banner');
    if (b) b.classList.add('hidden');
  });

  // ---- Navigation (sidebar + bottom nav) ----
  function navigateTo(view) {
    UI.showView(view);

    // Sync active class on both sidebar and bottom nav
    const moreViews = ['income', 'units', 'enrollment', 'admin'];
    const isMoreActive = moreViews.includes(view);
    const moreBtn = document.getElementById('bottom-nav-more-btn');
    if (moreBtn) moreBtn.classList.toggle('active', isMoreActive);

    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(el => {
      if (el !== moreBtn) {
        el.classList.toggle('active', el.dataset.view === view);
      }
    });

    // Glide the liquid pill to the newly active icon
    UI.moveNavIndicator(document.getElementById('bottom-nav'));

    if (view === 'dashboard')    Dashboard.load();
    if (view === 'events')       Events.load();
    if (view === 'transactions') Transactions.load();
    if (view === 'reports')      Reports.load();
    if (view === 'income') {
        Income.load();
        Income.bindForm();
    }
    if (view === 'units')       Units.load();
    if (view === 'enrollment')  EnrollmentSection.load();
    if (view === 'admin')        Admin.init();
  }

  // Expose navigateTo globally for modular triggers (e.g. dashboard cards, quick links)
  window.navigateTo = navigateTo;

  function bindMobileMoreSheet() {
    const moreBtn = document.getElementById('bottom-nav-more-btn');
    const sheet = document.getElementById('mobile-more-sheet');
    const backdrop = document.getElementById('mobile-more-sheet-backdrop');
    const closeBtn = document.getElementById('mobile-sheet-close-btn');
    const dragHandle = document.getElementById('mobile-sheet-drag-handle');

    function preventScrollOutsideSheet(e) {
      if (!sheet || sheet.classList.contains('hidden')) return;
      if (!sheet.contains(e.target)) {
        e.preventDefault();
      }
    }

    function openSheet() {
      if (!sheet || !backdrop) return;
      sheet.classList.remove('hidden');
      backdrop.classList.remove('hidden');
      if (moreBtn) moreBtn.setAttribute('aria-expanded', 'true');
      document.body.classList.add('more-sheet-open');
      const main = document.querySelector('.main-content');
      if (main) {
        main.style.overflow = 'hidden';
        main.style.touchAction = 'none';
      }
      document.addEventListener('touchmove', preventScrollOutsideSheet, { passive: false });
    }

    function closeSheet() {
      if (!sheet || !backdrop) return;
      sheet.classList.add('hidden');
      backdrop.classList.add('hidden');
      if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('more-sheet-open');
      const main = document.querySelector('.main-content');
      if (main) {
        main.style.overflow = '';
        main.style.touchAction = '';
      }
      document.removeEventListener('touchmove', preventScrollOutsideSheet);
    }

    if (moreBtn) moreBtn.addEventListener('click', e => {
      e.preventDefault();
      if (sheet && sheet.classList.contains('hidden')) openSheet();
      else closeSheet();
    });

    if (closeBtn) closeBtn.addEventListener('click', closeSheet);
    if (backdrop) {
      backdrop.addEventListener('click', closeSheet);
      backdrop.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    }

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    if (dragHandle) {
      dragHandle.addEventListener('click', closeSheet);
      dragHandle.addEventListener('touchstart', e => {
        if (!e.touches || !e.touches[0]) return;
        startY = e.touches[0].clientY;
        currentY = startY;
        isDragging = true;
      }, { passive: true });

      dragHandle.addEventListener('touchmove', e => {
        if (!isDragging || !e.touches || !e.touches[0]) return;
        currentY = e.touches[0].clientY;
        const diffY = currentY - startY;
        if (diffY > 0) {
          sheet.style.transform = `translateY(${diffY}px)`;
        }
      }, { passive: true });

      dragHandle.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        const diffY = currentY - startY;
        sheet.style.transform = '';
        if (diffY > 50) {
          closeSheet();
        }
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && sheet && !sheet.classList.contains('hidden')) {
        closeSheet();
      }
    });

    if (sheet) {
      sheet.querySelectorAll('[data-sheet-action]').forEach(el => {
        el.addEventListener('click', () => {
          const action = el.dataset.sheetAction;
          if (action === 'nav' && el.dataset.view) {
            closeSheet();
            navigateTo(el.dataset.view);
          } else if (action === 'profile') {
            closeSheet();
            if (typeof Profile !== 'undefined' && Profile.open) {
              Profile.open();
            } else {
              document.getElementById('profile-settings-btn')?.click();
            }
          }
        });
      });

      sheet.querySelectorAll('a.mobile-sheet-row, a[href]').forEach(a => {
        a.addEventListener('click', () => {
          closeSheet();
        });
      });
    }
  }
  bindMobileMoreSheet();

  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(item => {
    item.addEventListener('click', async e => {
      if (item.dataset.view) {
        e.preventDefault();
        navigateTo(item.dataset.view);
      }
    });
  });

  // Global [data-nav] delegate handler for springboards
  document.addEventListener('click', e => {
    const navEl = e.target.closest('[data-nav]');
    if (navEl && navEl.dataset.nav) {
      // Don't intercept if clicking an actual anchor with an href to another page
      if (navEl.tagName === 'A' && navEl.getAttribute('href') && !navEl.getAttribute('href').startsWith('#')) return;
      e.preventDefault();
      navigateTo(navEl.dataset.nav);
    }
  });

  Events.bindBackButton();

  // "+ New Event" button on events view goes to admin tab
  const createEvtBtn = document.getElementById('create-event-btn');
  if (createEvtBtn) {
    createEvtBtn.addEventListener('click', () => {
      UI.showView('admin');
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.getElementById('nav-admin').classList.add('active');
      Admin.init();
    });
  }

  // ---- Boot App ----
  async function bootApp(session) {
    // ---- Email confirmation gate ----
    if (!session.user.email_confirmed_at) {
      await Auth.logout();
      UI.showScreen('auth');
      const errEl = document.getElementById('login-error');
      errEl.textContent = 'Please confirm your email address before logging in. Check your CJC Gmail inbox.';
      errEl.classList.remove('hidden');
      return;
    }

    // Determine the view to restore on a refresh, so the splash skeleton
    // already matches it before the splash is revealed.
    let saved = null;
    try { saved = sessionStorage.getItem('lastView'); } catch { /* storage unavailable */ }

    // Show splash screen during boot and record start time
    const splash = document.getElementById('splash-screen');
    const splashStart = Date.now();
    if (splash) {
      UI.setSplashView(saved && document.getElementById(`view-${saved}`) ? saved : 'dashboard');
      splash.style.opacity = '1';
      splash.style.visibility = 'visible';
      splash.classList.remove('hidden');
    }

    const isOffline = (navigator.onLine === false);
    const profile = await Auth.getProfile();
    const roleKey = profile?.role || 'student';
    const officerRole = ['admin', 'governor', 'cashier', 'officer'].includes(roleKey);

    const offlineBanner = document.getElementById('offline-banner');
    if (offlineBanner) offlineBanner.classList.toggle('hidden', !isOffline);

    // ---- Strict Student Masterlist & Verification Gate ----
    if (!officerRole && !isOffline) {
      // 1. Check if student is found in the official enrolled masterlist
      let rosterMatch = null;
      if (window.Roster && window.Roster.findStudentAsync) {
        rosterMatch = await Roster.findStudentAsync(
          profile?.full_name || session.user.user_metadata?.full_name || session.user.user_metadata?.name,
          session.user.email
        );
      }

      // 2. Check if student has an existing approved verification request
      let existingReq = null;
      if (window.Api && window.Api.rosterRequests) {
        try {
          existingReq = await Api.rosterRequests.getMyRequest();
        } catch (e) {
          console.warn('[Gate] Verification request check error:', e);
        }
      }

      const isApproved = existingReq && existingReq.status === 'approved';
      const isVerified = Boolean(rosterMatch || isApproved);

      // BLOCK unverified students (not in masterlist AND not approved)
      // Displays the "Enrollment Verification Required" modal
      if (!isVerified) {
        if (splash) {
          splash.style.opacity = '0';
          splash.style.visibility = 'hidden';
          splash.classList.add('hidden');
        }
        await showOnboardingModal(session.user, profile);
        return; // BLOCK unverified student accounts from entering the portal
      }

      // If verified, check if they need to complete their profile setup
      const needsProfileSetup = !profile?.course || !profile?.year_level || !profile?.enrollment_year;
      if (needsProfileSetup) {
        if (splash) {
          splash.style.opacity = '0';
          splash.style.visibility = 'hidden';
          splash.classList.add('hidden');
        }
        await showOnboardingModal(session.user, profile);
        return; // Prompt verified students to complete registration & profile
      }
    }

    UI.showScreen('app');

    // Sidebar & Mobile Header user info
    const displayName = profile?.full_name || session.user.email;
    const roleLabels  = { admin: 'Administrator', governor: 'Governor', cashier: 'Cashier', officer: 'Officer', student: 'Student' };
    const roleLabel   = roleLabels[roleKey] || UI.capitalize(roleKey);

    document.getElementById('user-name').textContent   = displayName;
    document.getElementById('user-role').textContent   = roleLabel;

    const mobileRoleBadge = document.getElementById('mobile-user-role-badge');
    if (mobileRoleBadge) {
      mobileRoleBadge.textContent = roleLabel;
      mobileRoleBadge.className = `role-badge role-${roleKey}`;
    }

    UI.setAdminVisibility(profile?.role === 'admin');
    UI.setOfficerVisibility(officerRole);
    
    if (window.ProfileModal) {
      ProfileModal.init();
      ProfileModal.syncAvatars(profile?.avatar_url, displayName);
    } else {
      document.getElementById('user-avatar').textContent = displayName[0].toUpperCase();
      const mobileAvatar = document.getElementById('mobile-user-avatar');
      if (mobileAvatar) mobileAvatar.textContent = displayName[0].toUpperCase();
    }

    if (window.GrizzAI) {
      GrizzAI.init();
    } else if (window.UrsaAI) {
      UrsaAI.init();
    }

    if (typeof Notifications !== 'undefined' && Notifications.init) {
      Notifications.init();
    }

    // Return the user to the view they were last on instead of resetting to
    // the dashboard. Fall back to the dashboard when nothing is saved, the
    // view no longer exists, or a non-admin somehow saved 'admin'.
    const isAdmin = profile?.role === 'admin';
    const target = saved
      && document.getElementById(`view-${saved}`)
      && (saved !== 'admin' || isAdmin)
      ? saved : 'dashboard';
    navigateTo(target);

    // Ensure splash stays visible for at least 1.2s to show off the animation smoothly
    const elapsed = Date.now() - splashStart;
    const minSplashDuration = 1200; 
    const hideDelay = Math.max(0, minSplashDuration - elapsed);

    setTimeout(() => {
      // 0.5s CSS transition handles the fade out
      if (splash) {
        splash.style.opacity = '0';
        splash.style.visibility = 'hidden';
        setTimeout(() => splash.classList.add('hidden'), 500);
      }
    }, hideDelay);

    // Schedule background pre-fetching AFTER the splash is completely hidden
    // so the initial active view loads at full speed without network competition
    setTimeout(() => {
      if (typeof Api.prefetchAll === 'function') {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => Api.prefetchAll(profile?.role, profile?.course));
        } else {
          Api.prefetchAll(profile?.role, profile?.course);
        }
      }
    }, hideDelay + 600);
  }

})();
