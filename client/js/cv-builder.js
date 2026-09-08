// =============================================
// cv-builder.js - Harvard CV Builder & Locker Engine
// =============================================

const CvBuilder = (() => {
  let cvData = null;
  let lockerItems = [];
  let selectedItems = new Set();
  let activeFilter = 'all';

  /**
   * Fetch student's CV data from API
   */
  async function loadData() {
    try {
      const res = await Api.get('/cv/me');
      if (!res) return;

      cvData = res;
      lockerItems = res.locker_items || [];
      selectedItems = new Set(res.selected_locker_items || []);

      renderLocker();
      renderCvPreview();
      populateFormInputs();
    } catch (err) {
      console.error('[CvBuilder] Load failed:', err);
      if (typeof UI !== 'undefined' && UI.toast) {
        UI.toast('Failed to load CV profile.', 'error');
      }
    }
  }

  /**
   * Populate form input fields with user's CV details
   */
  function populateFormInputs() {
    if (!cvData) return;

    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('cv-headline', cvData.headline);
    setVal('cv-summary', cvData.summary);
    setVal('cv-phone', cvData.contact_phone);
    setVal('cv-location', cvData.location);
    setVal('cv-linkedin', cvData.linkedin_url);
    setVal('cv-github', cvData.github_url);
    setVal('cv-portfolio', cvData.portfolio_url);
    setVal('cv-skills', (cvData.technical_skills || []).join(', '));
    setVal('cv-soft-skills', (cvData.soft_skills || []).join(', '));

    if (cvData.capstone_project) {
      setVal('cv-capstone-title', cvData.capstone_project.title);
      setVal('cv-capstone-abstract', cvData.capstone_project.abstract);
      setVal('cv-capstone-stack', cvData.capstone_project.tech_stack);
    }
  }

  /**
   * Render Achievement Locker items (Left Pane)
   */
  function renderLocker() {
    const container = document.getElementById('locker-items-container');
    if (!container) return;

    const filtered = lockerItems.filter(item => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'leadership') return item.type === 'leadership';
      if (activeFilter === 'seminar') return item.type === 'seminar';
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px; color: #64748b; font-size: 0.85rem;">
          <iconify-icon icon="solar:folder-open-linear" style="font-size: 2rem; margin-bottom: 6px;"></iconify-icon>
          <div>No items found in your Achievement Locker yet.</div>
          <div style="font-size: 0.75rem; margin-top: 4px;">Attend events or join orgs to earn verified badges!</div>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(item => {
      const isAdded = selectedItems.has(item.id);
      return `
        <div class="locker-card ${isAdded ? 'in-cart' : ''}" id="locker-card-${item.id}">
          <div class="locker-card-title">
            <span>${item.title}</span>
            <span class="badge-verified"><iconify-icon icon="solar:verified-check-bold"></iconify-icon> Verified</span>
          </div>
          <div class="locker-card-sub">${item.organization} • ${item.date_range}</div>
          <div class="locker-card-actions">
            <span style="font-size: 0.75rem; color: #64748b;">${item.description}</span>
            <button class="btn-add-cart ${isAdded ? 'added' : ''}" onclick="CvBuilder.toggleItem('${item.id}')">
              ${isAdded ? '✓ Added' : '+ Add to CV'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Toggle item in/out of CV Cart
   */
  function toggleItem(itemId) {
    if (selectedItems.has(itemId)) {
      selectedItems.delete(itemId);
    } else {
      selectedItems.add(itemId);
    }
    renderLocker();
    renderCvPreview();
    saveCvDebounced();
  }

  /**
   * Filter Locker items by type chip
   */
  function filterLocker(type) {
    activeFilter = type;
    document.querySelectorAll('.locker-chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.type === type);
    });
    renderLocker();
  }

  /**
   * Render Live Harvard CV Preview (Right Canvas)
   */
  function renderCvPreview() {
    const canvas = document.getElementById('harvard-cv-canvas');
    if (!canvas || !cvData) return;

    const getVal = (id, fallback) => {
      const el = document.getElementById(id);
      return el && el.value !== undefined ? el.value : (fallback || '');
    };

    const profile = cvData.profile || {};
    const name = profile.full_name || 'STUDENT NAME';
    const course = profile.course || 'Bachelor of Science in Engineering';
    const email = cvData.contact_email || profile.email || 'student@university.edu.ph';
    const phone = getVal('cv-phone', cvData.contact_phone);
    const location = getVal('cv-location', cvData.location || 'Manila, Philippines');
    const linkedinRaw = getVal('cv-linkedin', cvData.linkedin_url);
    const linkedin = linkedinRaw ? ` | LinkedIn: ${linkedinRaw}` : '';
    const portfolioRaw = getVal('cv-portfolio', cvData.portfolio_url);
    const portfolio = portfolioRaw ? ` | Portfolio: ${portfolioRaw}` : '';
    const shareToken = cvData.share_token || 'VERIFY-TOKEN';

    // Get selected locker items
    const selectedMilestones = lockerItems.filter(item => selectedItems.has(item.id));
    const leadershipItems = selectedMilestones.filter(i => i.type === 'leadership');
    const seminarItems = selectedMilestones.filter(i => i.type === 'seminar');

    // Parse skills
    const techSkillsStr = getVal('cv-skills', (cvData.technical_skills || []).join(', '));
    const techSkillsList = techSkillsStr.split(',').map(s => s.trim()).filter(Boolean);

    const capTitle = getVal('cv-capstone-title', cvData.capstone_project?.title);
    const capAbstract = getVal('cv-capstone-abstract', cvData.capstone_project?.abstract);

    // Generate QR Code image URL via server API
    const verifyUrl = `${window.location.origin}/cv-verify.html?token=${shareToken}`;
    const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}`;

    canvas.innerHTML = `
      <!-- Harvard Header -->
      <div class="harvard-header">
        <div class="harvard-name">${name}</div>
        <div class="harvard-contact-line">
          ${location}${phone ? ' • ' + phone : ''} • ${email}${linkedin}${portfolio}
        </div>
        <div class="harvard-qr-box">
          <img src="${qrApiUrl}" class="harvard-qr-img" alt="QR Verify" />
          <div class="harvard-qr-label">Scan to Verify Credentials</div>
        </div>
      </div>

      <!-- Education Section -->
      <div class="harvard-section">
        <div class="harvard-section-title">Education</div>
        <div class="harvard-row">
          <span class="harvard-title-left">${course}</span>
          <span class="harvard-date-right">Candidate ${profile.enrollment_year ? Number(profile.enrollment_year) + 4 : '2026'}</span>
        </div>
        <div class="harvard-sub-left">College of Engineering • Local Government Unit Partner University</div>
        <ul class="harvard-bullets">
          <li>Relevant Coursework: Engineering Management, Structural Analysis, Fluid Mechanics, CAD Design.</li>
          <li>Verified Enrolled Status in College of Engineering Database.</li>
        </ul>
      </div>

      <!-- Technical Skills Section -->
      ${techSkillsList.length > 0 ? `
      <div class="harvard-section">
        <div class="harvard-section-title">Technical Skills & Competencies</div>
        <ul class="harvard-bullets">
          <li><strong>Engineering Tools & Software:</strong> ${techSkillsList.join(', ')}</li>
        </ul>
      </div>
      ` : ''}

      <!-- Leadership & Verified Affiliations -->
      ${leadershipItems.length > 0 ? `
      <div class="harvard-section">
        <div class="harvard-section-title">Leadership & College Affiliations</div>
        ${leadershipItems.map(item => `
          <div class="harvard-row">
            <span class="harvard-title-left">${item.title} <span class="verified-inline-tag">✓ Verified</span></span>
            <span class="harvard-date-right">${item.date_range}</span>
          </div>
          <div class="harvard-sub-left">${item.organization}</div>
          <ul class="harvard-bullets">
            <li>${item.description}</li>
          </ul>
        `).join('')}
      </div>
      ` : ''}

      <!-- Capstone Project Section -->
      ${capTitle ? `
      <div class="harvard-section">
        <div class="harvard-section-title">Engineering Capstone Project</div>
        <div class="harvard-row">
          <span class="harvard-title-left">${capTitle}</span>
          <span class="harvard-date-right">Senior Design Project</span>
        </div>
        <ul class="harvard-bullets">
          <li>${capAbstract || 'Developed and executed engineering design prototype.'}</li>
        </ul>
      </div>
      ` : ''}

      <!-- Certifications & Seminars -->
      ${seminarItems.length > 0 ? `
      <div class="harvard-section">
        <div class="harvard-section-title">Certifications & Professional Workshops</div>
        ${seminarItems.map(item => `
          <div class="harvard-row">
            <span class="harvard-title-left">${item.title} <span class="verified-inline-tag">✓ Verified</span></span>
            <span class="harvard-date-right">${item.date_range}</span>
          </div>
          <div class="harvard-sub-left">${item.organization}</div>
        `).join('')}
      </div>
      ` : ''}
    `;
  }

  let saveTimer = null;
  function saveCvDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCv, 1000);
  }

  /**
   * Save CV data to API
   */
  async function saveCv() {
    if (!cvData) return;

    const payload = {
      headline: document.getElementById('cv-headline')?.value || '',
      summary: document.getElementById('cv-summary')?.value || '',
      contact_phone: document.getElementById('cv-phone')?.value || '',
      location: document.getElementById('cv-location')?.value || '',
      linkedin_url: document.getElementById('cv-linkedin')?.value || '',
      github_url: document.getElementById('cv-github')?.value || '',
      portfolio_url: document.getElementById('cv-portfolio')?.value || '',
      technical_skills: (document.getElementById('cv-skills')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
      soft_skills: (document.getElementById('cv-soft-skills')?.value || '').split(',').map(s => s.trim()).filter(Boolean),
      capstone_project: {
        title: document.getElementById('cv-capstone-title')?.value || '',
        abstract: document.getElementById('cv-capstone-abstract')?.value || '',
        tech_stack: document.getElementById('cv-capstone-stack')?.value || ''
      },
      selected_locker_items: Array.from(selectedItems),
      template_style: 'harvard'
    };

    try {
      const updated = await Api.put('/cv/me', payload);
      if (updated) {
        cvData = { ...cvData, ...updated, profile: cvData.profile, locker_items: lockerItems };
        renderCvPreview();
        alert('✅ CV Changes Saved Successfully!');
      }
    } catch (err) {
      console.error('[CvBuilder] Save failed:', err);
      alert('❌ Failed to save CV changes: ' + (err.message || 'Server error'));
    }
  }

  /**
   * Print / Download PDF
   */
  function exportPdf() {
    window.print();
  }

  return {
    loadData,
    toggleItem,
    filterLocker,
    renderCvPreview,
    saveCv,
    exportPdf
  };
})();
