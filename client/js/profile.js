// =============================================
// profile.js - User Account Profile & Settings Controller
// =============================================

const ProfileModal = (() => {
  const AVATAR_PRESETS = [
    { id: 'coe-logo', category: 'others', name: 'Official COE Seal', src: 'assets/coe-logo.png' },
    { id: 'grizz-1', category: 'grizz', name: 'Grizz Smiling', src: 'assets/avatars/grizz/grizz-1.webp' },
    { id: 'grizz-2', category: 'grizz', name: 'Grizz Waving', src: 'assets/avatars/grizz/grizz-2.webp' },
    { id: 'grizz-3', category: 'grizz', name: 'Grizz Chill', src: 'assets/avatars/grizz/grizz-3.webp' },
    { id: 'grizz-4', category: 'grizz', name: 'Grizz Happy', src: 'assets/avatars/grizz/grizz-4.webp' },
    { id: 'icebear-1', category: 'icebear', name: 'Ice Bear Cool', src: 'assets/avatars/icebear/icebear-1.webp' },
    { id: 'icebear-2', category: 'icebear', name: 'Ice Bear Ninja', src: 'assets/avatars/icebear/icebear-2.webp' },
    { id: 'icebear-3', category: 'icebear', name: 'Ice Bear Serious', src: 'assets/avatars/icebear/icebear-3.webp' },
    { id: 'icebear-4', category: 'icebear', name: 'Ice Bear Chef', src: 'assets/avatars/icebear/icebear-4.webp' },
    { id: 'panda-1', category: 'panda', name: 'Panda Cute', src: 'assets/avatars/panda/panda-1.webp' },
    { id: 'panda-2', category: 'panda', name: 'Panda Phone', src: 'assets/avatars/panda/panda-2.webp' },
    { id: 'panda-3', category: 'panda', name: 'Panda Shy', src: 'assets/avatars/panda/panda-3.webp' },
    { id: 'panda-4', category: 'panda', name: 'Panda Wink', src: 'assets/avatars/panda/panda-4.webp' },
    { id: 'other-1', category: 'others', name: 'Chloe', src: 'assets/avatars/others/other-1.webp' },
    { id: 'other-2', category: 'others', name: 'Nom Nom', src: 'assets/avatars/others/other-2.webp' },
    { id: 'other-3', category: 'others', name: 'Charlie', src: 'assets/avatars/others/other-3.webp' },
    { id: 'other-4', category: 'others', name: 'Ranger Tabes', src: 'assets/avatars/others/other-4.webp' },
    { id: 'other-5', category: 'others', name: 'Captain Craboo', src: 'assets/avatars/others/other-5.webp' },
    { id: 'other-6', category: 'others', name: 'Bears Stack', src: 'assets/avatars/others/other-6.webp' },
  ];

  let _currentProfile = null;
  let _currentSession = null;
  let _selectedAvatarUrl = null;
  let _currentCategory = 'all';
  let _initialized = false;
  let _initialState = {
    fullName: '',
    course: 'BSCoE',
    yearLevel: '1',
    enrollmentYear: '',
    avatarUrl: null
  };

  function isGeneralFormDirty() {
    const nameInput = document.getElementById('profile-name-input');
    const courseSelect = document.getElementById('profile-course-select');
    const yearSelect = document.getElementById('profile-year-select');
    const enrollInput = document.getElementById('profile-enrollment-year');

    const curName = nameInput ? nameInput.value.trim() : '';
    const curCourse = courseSelect ? courseSelect.value : '';
    const curYear = yearSelect ? yearSelect.value : '';
    const curEnroll = enrollInput && enrollInput.value ? String(enrollInput.value) : '';
    const curAvatar = _selectedAvatarUrl || null;

    return (
      curName !== _initialState.fullName ||
      curCourse !== _initialState.course ||
      curYear !== _initialState.yearLevel ||
      curEnroll !== String(_initialState.enrollmentYear || '') ||
      curAvatar !== _initialState.avatarUrl
    );
  }

  function updateSaveButtonState() {
    const saveBtn = document.getElementById('profile-save-general-btn');
    if (!saveBtn) return;
    const dirty = isGeneralFormDirty();
    saveBtn.disabled = !dirty;
    saveBtn.classList.toggle('is-disabled', !dirty);
  }

  function init() {
    if (_initialized) return;
    _initialized = true;
    if (typeof Dropdowns !== 'undefined') {
      Dropdowns.bindAll('#profile-modal');
    }
    bindGlobalTriggers();
    bindTabs();
    bindForms();
    renderAvatarGallery('all');
    updateSaveButtonState();
  }

  function bindGlobalTriggers() {
    // Document-level event delegation for all profile opening triggers
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('#user-pill, #profile-settings-btn, #bottom-profile-btn, .mobile-profile-btn, [data-action="open-profile"]');
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        open();
      }

      // Close triggers
      if (e.target.closest('#profile-modal-close') || e.target.closest('#profile-cancel-btn') || e.target.id === 'profile-modal-overlay') {
        e.preventDefault();
        close();
      }

      // Avatar hero wrap click (toggle/scroll into picker)
      if (e.target.closest('#avatar-hero-wrap')) {
        const picker = document.getElementById('avatar-picker-section');
        if (picker) {
          picker.classList.toggle('highlighted');
          picker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }

      // Avatar category button click
      const catBtn = e.target.closest('.avatar-cat-btn');
      if (catBtn) {
        e.preventDefault();
        const cat = catBtn.dataset.cat;
        _currentCategory = cat;
        document.querySelectorAll('.avatar-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
        renderAvatarGallery(cat);
      }

      // Avatar thumbnail selection
      const avatarCard = e.target.closest('.avatar-thumb-card');
      if (avatarCard) {
        e.preventDefault();
        const src = avatarCard.dataset.src;
        selectAvatar(src);
      }

      // Reset to Letter Initial
      if (e.target.closest('#profile-reset-avatar-btn')) {
        e.preventDefault();
        selectAvatar(null);
      }
    });

    // Keyboard trigger on user-pill
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        close();
      }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'user-pill') {
        e.preventDefault();
        open();
      }
    });
  }

  function renderAvatarGallery(category = 'all') {
    const track = document.getElementById('avatar-gallery-track');
    if (!track) return;

    const filtered = category === 'all'
      ? AVATAR_PRESETS
      : AVATAR_PRESETS.filter(a => a.category === category);

    track.innerHTML = filtered.map(a => {
      const isSelected = _selectedAvatarUrl === a.src;
      return `
        <button type="button" class="avatar-thumb-card ${isSelected ? 'active' : ''}" data-src="${a.src}" title="${a.name}">
          <img src="${a.src}" alt="${a.name}" class="avatar-thumb-img" loading="lazy" />
          ${isSelected ? '<span class="avatar-check-badge"><iconify-icon icon="solar:check-circle-linear"></iconify-icon></span>' : ''}
        </button>
      `;
    }).join('');
  }

  function selectAvatar(src) {
    _selectedAvatarUrl = src;
    const heroAvatar = document.getElementById('profile-modal-avatar');
    const curName = document.getElementById('profile-name-input')?.value || _currentProfile?.full_name || 'COE';
    
    renderAvatarElement(heroAvatar, src, curName);
    renderAvatarGallery(_currentCategory);
    updateSaveButtonState();
  }

  function bindTabs() {
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.profile-tab-btn');
      if (!tab) return;
      
      const targetTab = tab.dataset.tab;
      document.querySelectorAll('.profile-tab-btn').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === targetTab);
      });
      document.querySelectorAll('.profile-tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `profile-tab-${targetTab}`);
      });
    });
  }

  function bindForms() {
    // 1. General Info Form
    const generalForm = document.getElementById('profile-general-form');
    if (generalForm) {
      generalForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await saveGeneralProfile();
      });
    }

    // Input listeners to track dirty state
    const inputIds = [
      'profile-name-input',
      'profile-course-select',
      'profile-year-select',
      'profile-enrollment-year'
    ];

    // Helper to calculate enrollment year based on current school year (SY 2026-2027 start year: 2026)
    const computeEnrollmentYear = (yearLevel) => {
      const y = parseInt(yearLevel, 10);
      if (!y || y < 1) return null;
      const currentSYStart = 2026;
      return currentSYStart - (y - 1);
    };

    // Auto calculate enrollment year when year level changes
    const yearSelect = document.getElementById('profile-year-select');
    const enrollInput = document.getElementById('profile-enrollment-year');
    if (yearSelect && enrollInput) {
      yearSelect.addEventListener('change', () => {
        const calculated = computeEnrollmentYear(yearSelect.value);
        if (calculated) {
          enrollInput.value = calculated;
        }
        updateSaveButtonState();
      });
    }

    inputIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', updateSaveButtonState);
        el.addEventListener('change', updateSaveButtonState);
      }
    });

    // 2. Security / Password Form
    const securityForm = document.getElementById('profile-security-form');
    if (securityForm) {
      securityForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await savePassword();
      });
    }
  }

  async function open(defaultTab = 'general') {
    const modal = document.getElementById('profile-modal');
    const overlay = document.getElementById('profile-modal-overlay');
    if (!modal || !overlay) {
      console.warn('Profile modal elements not found in DOM');
      return;
    }

    // 1. Instantly show modal to user (Zero Lag)
    overlay.classList.remove('hidden');
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');

    // 2. Reset tabs
    document.querySelectorAll('.profile-tab-btn').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === defaultTab);
    });
    document.querySelectorAll('.profile-tab-content').forEach(c => {
      c.classList.toggle('active', c.id === `profile-tab-${defaultTab}`);
    });

    // 3. Clear feedbacks
    setFeedback('profile-general-feedback', '');
    setFeedback('profile-security-feedback', '');

    // 4. Pre-fill from current UI state immediately
    const curName = document.getElementById('user-name')?.textContent || document.getElementById('of-user-name')?.textContent || '';
    if (curName && curName !== 'Loading...' && !curName.includes('@')) {
      const nameInput = document.getElementById('profile-name-input');
      if (nameInput && !nameInput.value) nameInput.value = curName;
    }

    if (_currentProfile) {
      populateFields(_currentProfile, _currentSession);
    }

    // 5. Asynchronously fetch latest profile from Supabase
    try {
      if (typeof Auth !== 'undefined' && Auth.getSession) {
        _currentSession = await Auth.getSession();
        _currentProfile = await Auth.getProfile();
      } else if (window.supabaseClient) {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        _currentSession = session;
        if (session?.user) {
          const { data: prof } = await window.supabaseClient
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();
          _currentProfile = prof;
        }
      }
      if (_currentProfile) {
        populateFields(_currentProfile, _currentSession);
      }
    } catch (err) {
      console.error('Failed to load profile data:', err);
    }
  }

  function close() {
    const modal = document.getElementById('profile-modal');
    const overlay = document.getElementById('profile-modal-overlay');
    if (modal) modal.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  function isOpen() {
    const modal = document.getElementById('profile-modal');
    return modal && !modal.classList.contains('hidden');
  }

  function populateFields(profile, session) {
    if (!profile && !session) return;

    const email = profile?.email || session?.user?.email || '';
    const fullName = profile?.full_name || '';
    const course = profile?.course || 'BSCoE';
    const yearLevel = String(profile?.year_level || '1');
    const enrollmentYear = profile?.enrollment_year || (2026 - (parseInt(yearLevel, 10) - 1));
    const ROLE_LABELS = {
      admin: 'Administrator',
      governor: 'Governor',
      cashier: 'Cashier',
      officer: 'Officer',
      student: 'Student Member'
    };
    const roleKey = (profile?.role || '').toLowerCase();
    const role = ROLE_LABELS[roleKey] || (roleKey ? UI.capitalize(roleKey) : 'Student Member');
    _selectedAvatarUrl = profile?.avatar_url ? profile.avatar_url.replace(/\.jpg$/, '.webp') : null;

    // Headers & Identifiers
    const avatarEl = document.getElementById('profile-modal-avatar');
    const emailEl = document.getElementById('profile-modal-email');
    const secEmailEl = document.getElementById('profile-security-email');
    const roleEl = document.getElementById('profile-role-display');

    renderAvatarElement(avatarEl, _selectedAvatarUrl, fullName || email);
    if (emailEl) emailEl.textContent = email;
    if (secEmailEl) secEmailEl.textContent = email;
    if (roleEl) {
      roleEl.textContent = role;
      roleEl.className = `role-badge role-${roleKey || 'student'}`;
    }

    // Input fields
    const nameInput = document.getElementById('profile-name-input');
    const courseSelect = document.getElementById('profile-course-select');
    const yearSelect = document.getElementById('profile-year-select');
    const enrollInput = document.getElementById('profile-enrollment-year');

    if (nameInput) nameInput.value = fullName;
    if (courseSelect) courseSelect.value = course;
    if (yearSelect) yearSelect.value = yearLevel;
    if (enrollInput) enrollInput.value = enrollmentYear;

    if (typeof Dropdowns !== 'undefined') {
      Dropdowns.bindAll('#profile-modal');
      Dropdowns.syncAll();
    }

    // Reset password inputs
    const newPass = document.getElementById('profile-new-password');
    const confPass = document.getElementById('profile-confirm-password');
    if (newPass) newPass.value = '';
    if (confPass) confPass.value = '';

    _initialState = {
      fullName: fullName,
      course: course,
      yearLevel: yearLevel,
      enrollmentYear: String(enrollmentYear || ''),
      avatarUrl: _selectedAvatarUrl
    };

    renderAvatarGallery(_currentCategory);
    updateSaveButtonState();
  }

  function renderAvatarElement(element, avatarUrl, fallbackText) {
    if (!element) return;
    if (avatarUrl) {
      const cleanUrl = (avatarUrl.endsWith('.jpg') || avatarUrl.endsWith('.jpeg'))
        ? avatarUrl.replace(/\.(jpg|jpeg)$/i, '.webp')
        : avatarUrl;
      element.innerHTML = `<img src="${cleanUrl}" alt="Avatar" class="avatar-img" />`;
    } else {
      element.innerHTML = '';
      element.textContent = (fallbackText || '?')[0].toUpperCase();
    }
  }

  async function saveGeneralProfile() {
    const nameInput = document.getElementById('profile-name-input');
    const courseSelect = document.getElementById('profile-course-select');
    const yearSelect = document.getElementById('profile-year-select');
    const enrollInput = document.getElementById('profile-enrollment-year');
    const saveBtn = document.getElementById('profile-save-general-btn');

    const fullName = nameInput ? nameInput.value.trim() : '';
    const course = courseSelect ? courseSelect.value : 'BSCoE';
    const yearLevel = yearSelect ? yearSelect.value : '1';
    const enrollmentYear = enrollInput && enrollInput.value ? Number(enrollInput.value) : null;

    if (!fullName) {
      setFeedback('profile-general-feedback', 'Please enter your full name.', 'error');
      return;
    }

    setFeedback('profile-general-feedback', '');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<iconify-icon icon="solar:refresh-circle-linear" class="spin-icon"></iconify-icon> Saving…`;
    }

    try {
      if (!_currentSession) {
        _currentSession = await Auth.getSession();
      }
      if (!_currentProfile && _currentSession) {
        _currentProfile = await Auth.getProfile();
      }

      const userId = _currentProfile?.id || _currentSession?.user?.id;
      if (!userId) throw new Error('User session not active');

      const updates = {
        full_name: fullName,
        course,
        year_level: yearLevel,
        enrollment_year: enrollmentYear,
        avatar_url: _selectedAvatarUrl,
      };

      const updated = await Auth.updateProfile(userId, updates);
      _currentProfile = updated;

      _initialState = {
        fullName,
        course,
        yearLevel,
        enrollmentYear: String(enrollmentYear || ''),
        avatarUrl: _selectedAvatarUrl
      };

      // Synchronize all avatars across the UI (Main Portal & Executive Portal)
      syncAvatars(updated.avatar_url, updated.full_name);

      // Invalidate units cache so the credit tracker reloads for new course/year if changed
      if (typeof Api !== 'undefined' && Api.invalidateCache) {
        Api.invalidateCache('/units/my');
        Api.invalidateCache('/units/checklists');
      }

      // Reload Units view if active
      if (typeof Units !== 'undefined' && Units.load) {
        Units.load();
      }

      UI.toast('Account profile & avatar updated successfully!', 'success');
      close();
    } catch (err) {
      console.error('Profile update failed:', err);
      setFeedback('profile-general-feedback', err.message || 'Failed to update profile.', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.innerHTML = `<iconify-icon icon="solar:check-circle-linear"></iconify-icon> Save Changes`;
        updateSaveButtonState();
      }
    }
  }

  function syncAvatars(avatarUrl, fullName) {
    const cleanUrl = avatarUrl
      ? ((avatarUrl.endsWith('.jpg') || avatarUrl.endsWith('.jpeg')) ? avatarUrl.replace(/\.(jpg|jpeg)$/i, '.webp') : avatarUrl)
      : null;
    const userNameEl = document.getElementById('user-name');
    const userAvatarEl = document.getElementById('user-avatar');
    const mobileAvatarEl = document.getElementById('mobile-user-avatar');
    const ofNameEl = document.getElementById('of-user-name');
    const ofAvatarEl = document.getElementById('of-avatar');

    if (userNameEl && fullName) userNameEl.textContent = fullName;
    if (userAvatarEl) renderAvatarElement(userAvatarEl, cleanUrl, fullName);
    if (mobileAvatarEl) renderAvatarElement(mobileAvatarEl, cleanUrl, fullName);

    if (ofNameEl && fullName) ofNameEl.textContent = fullName;
    if (ofAvatarEl) renderAvatarElement(ofAvatarEl, cleanUrl, fullName);

    if (window.GrizzAI && window.GrizzAI.setProfile) {
      window.GrizzAI.setProfile({ avatar_url: cleanUrl, full_name: fullName });
    }
  }

  async function savePassword() {
    const newPassEl = document.getElementById('profile-new-password');
    const confPassEl = document.getElementById('profile-confirm-password');
    const saveBtn = document.getElementById('profile-save-security-btn');

    const newPassword = newPassEl ? newPassEl.value : '';
    const confirmPassword = confPassEl ? confPassEl.value : '';

    if (!newPassword || newPassword.length < 8) {
      setFeedback('profile-security-feedback', 'Password must be at least 8 characters long.', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFeedback('profile-security-feedback', 'Passwords do not match.', 'error');
      return;
    }

    setFeedback('profile-security-feedback', '');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `<iconify-icon icon="solar:refresh-circle-linear" class="spin-icon"></iconify-icon> Updating…`;
    }

    try {
      await Auth.updatePassword(newPassword);
      UI.toast('Security password updated successfully!', 'success');
      if (newPassEl) newPassEl.value = '';
      if (confPassEl) confPassEl.value = '';
      close();
    } catch (err) {
      console.error('Password update failed:', err);
      setFeedback('profile-security-feedback', err.message || 'Failed to update password.', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = `<iconify-icon icon="solar:lock-keyhole-linear"></iconify-icon> Update Password`;
      }
    }
  }

  function setFeedback(elementId, message, type = 'info') {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.classList.add('hidden');
      el.className = 'profile-feedback hidden';
      return;
    }
    el.textContent = message;
    el.className = `profile-feedback profile-feedback--${type}`;
    el.classList.remove('hidden');
  }

  return { init, open, close, populateFields, renderAvatarElement, syncAvatars };
})();

window.ProfileModal = ProfileModal;

// Auto-initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ProfileModal.init());
} else {
  ProfileModal.init();
}
