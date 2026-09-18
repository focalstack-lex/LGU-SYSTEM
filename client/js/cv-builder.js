// ==========================================================================
// cv-builder.js - College of Engineering · Career Passport & Harvard CV Engine
// ==========================================================================

const CvBuilder = (() => {
  let cvData = null;
  let lockerItems = [];
  let selectedItems = new Set();
  let activeFilter = 'all';

  // CV fields are user-controlled - escape before any innerHTML insertion.
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  // Engineering Discipline Presets for College of Engineering programs (CpE, ECE, CE)
  const ENGINEERING_PRESETS = {
    cpe: {
      name: 'Computer Engineering (BSCPE)',
      course: 'Bachelor of Science in Computer Engineering',
      headline: 'Graduating Computer Engineering Student | Embedded Systems & Full-Stack Development',
      summary: 'Diligent computer engineering student with demonstrated leadership in student council governance and practical experience in IoT architectures, real-time data telemetry, and modern web application development. Seeking engineering internships and technical associate roles.',
      coursework: 'Object-Oriented Programming, Computer Architecture, Embedded Systems, Data Structures & Algorithms, Computer Networks, Operating Systems',
      technical_skills: ['C / C++', 'Python', 'Embedded Systems (ARM/ESP32)', 'Linux / Bash', 'Git / GitHub', 'AutoCAD', 'I2C / SPI Protocols', 'PostgreSQL'],
      soft_skills: ['Team Leadership', 'Technical Documentation', 'Agile Project Tracking', 'Project Budgeting', 'Critical Problem Solving'],
      capstone_title: 'Smart Campus Environmental Telemetry & Structural Health Monitor',
      capstone_abstract: 'Engineered a low-power wireless sensor network utilizing microcontroller nodes to track real-time ambient parameters and structural vibration data across campus engineering facilities, with an interactive web dashboard for facility administrators.'
    },
    ece: {
      name: 'Electronics Engineering (BSECE)',
      course: 'Bachelor of Science in Electronics Engineering',
      headline: 'Electronics Engineering Student | Embedded Systems, RF Communications & Signal Processing',
      summary: 'Analytical electronics engineering student experienced in circuit schematic capture, RF signal propagation modeling, and embedded firmware design. Focused on telecommunications infrastructure and IoT devices.',
      coursework: 'Signals & Systems, Digital Signal Processing (DSP), Electronic Circuit Analysis, Telecommunications, Electromagnetics, Microprocessor Systems',
      technical_skills: ['MATLAB', 'Proteus Design Suite', 'KiCAD / Eagle', 'Multisim', 'C/C++ for Embedded (STM32/ESP32)', 'RF Spectrum Analysis', 'Oscilloscope & Logic Analyzer'],
      soft_skills: ['Hardware Debugging', 'Technical Presentation', 'Component Sourcing & BOM', 'System Integration', 'Collaborative Design'],
      capstone_title: 'LoRaWAN-Based Wireless Early Warning Network for Environmental Hazard Telemetry',
      capstone_abstract: 'Engineered a long-range, battery-efficient telemetry node deployment capable of transmitting real-time vibration and water-level telemetry across remote terrain to a centralized emergency gateway.'
    },
    ce: {
      name: 'Civil Engineering (BSCE)',
      course: 'Bachelor of Science in Civil Engineering',
      headline: 'Civil Engineering Student | Structural Analysis, Geomatics & Construction Management',
      summary: 'Focused civil engineering student with practical background in structural modeling, surveying data reduction, and site safety management. Experienced in parametric design and quantity takeoffs for infrastructure projects.',
      coursework: 'Theory of Structures, Surveying & Geomatics, Fluid Mechanics, Geotechnical Engineering, Reinforced Concrete Design, Construction Estimation & Cost Engineering',
      technical_skills: ['AutoCAD Civil 3D', 'ETABS', 'SAP2000', 'STAAD.Pro', 'Total Station & Levelling', 'Quantity Takeoff / BOQ', 'National Building Code (PD 1096)', 'DOLE BOSH Safety'],
      soft_skills: ['Site Inspection & Coordination', 'Construction Project Scheduling', 'Technical Reporting', 'Team Leadership', 'Contractor Relations'],
      capstone_title: 'Seismic Vulnerability Assessment & Structural Retrofit Scheme for Educational Buildings',
      capstone_abstract: 'Conducted structural load and seismic analysis using 3D finite element simulation, proposing cost-effective structural member reinforcements conforming to national structural codes.'
    }
  };

  // Default dataset — starts blank so students fill their own details
  const defaultSampleData = {
    discipline: 'cpe',
    profile: {
      full_name: '',
      course: 'Bachelor of Science in Computer Engineering',
      enrollment_year: '2028',
      email: ''
    },
    headline: '',
    summary: '',
    contact_phone: '',
    location: '',
    linkedin_url: '',
    github_url: '',
    portfolio_url: '',
    coursework: 'Object-Oriented Programming, Computer Architecture, Embedded Systems, Data Structures & Algorithms, Computer Networks, Operating Systems',
    technical_skills: ['C / C++', 'Python', 'Embedded Systems (ARM/ESP32)', 'Linux / Bash', 'Git / GitHub', 'AutoCAD', 'I2C / SPI Protocols', 'PostgreSQL'],
    soft_skills: ['Team Leadership', 'Technical Documentation', 'Agile Project Tracking', 'Project Budgeting', 'Critical Problem Solving'],
    capstone_project: {
      title: '',
      abstract: ''
    },
    locker_items: [],
    selected_locker_items: []
  };

  /**
   * Helper: Show toast notification
   */
  function showToast(message, type = 'info') {
    const toast = document.getElementById('cv-toast') || document.getElementById('toast');
    const msgEl = document.getElementById('cv-toast-message') || document.getElementById('toast-message');
    const iconEl = document.getElementById('cv-toast-icon') || document.getElementById('toast-icon');

    if (!toast) return;

    if (msgEl) msgEl.textContent = message;
    if (iconEl) {
      iconEl.innerHTML = type === 'success'
        ? '<iconify-icon icon="solar:check-circle-bold" style="color:#22C55E;font-size:1.1rem;"></iconify-icon>'
        : '<iconify-icon icon="solar:info-circle-bold" style="color:var(--primary);font-size:1.1rem;"></iconify-icon>';
    }

    toast.classList.remove('hidden');
    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  /**
   * Fetch student's CV data from API or localStorage fallback
   */
  async function loadData() {
    try {
      let remoteData = null;

      // Try API if user is authenticated
      if (typeof Api !== 'undefined' && Api.get) {
        try {
          remoteData = await Api.get('/cv/me');
        } catch (apiErr) {
          console.debug('[CvBuilder] Remote API unavailable, using local cache or defaults:', apiErr?.message);
        }
      }

      if (remoteData && remoteData.profile) {
        cvData = remoteData;
      } else {
        // Check localStorage cache
        const cached = localStorage.getItem('coe_cv_draft');
        if (cached) {
          try {
            cvData = JSON.parse(cached);
          } catch (e) {
            cvData = { ...defaultSampleData };
          }
        } else {
          cvData = { ...defaultSampleData };
        }
      }

      lockerItems = cvData.locker_items || defaultSampleData.locker_items;
      selectedItems = new Set(cvData.selected_locker_items || ['item-1', 'item-3']);

      populateFormInputs();
      renderLocker();
      renderCvPreview();
    } catch (err) {
      console.error('[CvBuilder] Load failed:', err);
      cvData = { ...defaultSampleData };
      lockerItems = defaultSampleData.locker_items;
      selectedItems = new Set(defaultSampleData.selected_locker_items);
      populateFormInputs();
      renderLocker();
      renderCvPreview();
    }
  }

  /**
   * Populate form input fields with user's CV details
   */
  function populateFormInputs() {
    if (!cvData) return;

    const setVal = (id, val) => {
      const els = document.querySelectorAll(`#${id}`);
      els.forEach(el => { el.value = val || ''; });
    };

    const prof = cvData.profile || defaultSampleData.profile;
    const initialDiscipline = ENGINEERING_PRESETS[cvData.discipline] ? cvData.discipline : 'cpe';
    setVal('cv-discipline', initialDiscipline);
    setVal('cv-name', prof.full_name);
    setVal('cv-course', prof.course);
    setVal('cv-grad-year', prof.enrollment_year || '2028');
    setVal('cv-email', cvData.contact_email || prof.email);

    setVal('cv-headline', cvData.headline);
    setVal('cv-summary', cvData.summary);
    setVal('cv-phone', cvData.contact_phone);
    setVal('cv-location', cvData.location);
    setVal('cv-linkedin', cvData.linkedin_url);
    setVal('cv-github', cvData.github_url);
    setVal('cv-portfolio', cvData.portfolio_url);
    setVal('cv-coursework', cvData.coursework || defaultSampleData.coursework);
    setVal('cv-skills', Array.isArray(cvData.technical_skills) ? cvData.technical_skills.join(', ') : (cvData.technical_skills || ''));
    setVal('cv-soft-skills', Array.isArray(cvData.soft_skills) ? cvData.soft_skills.join(', ') : (cvData.soft_skills || ''));

    if (cvData.capstone_project) {
      setVal('cv-capstone-title', cvData.capstone_project.title);
      setVal('cv-capstone-abstract', cvData.capstone_project.abstract);
    }

    renderSkillSuggestions();
    renderCourseworkSuggestions();
  }

  /**
   * Apply engineering major preset template
   */
  function applyDisciplinePreset(disciplineKey) {
    const preset = ENGINEERING_PRESETS[disciplineKey] || ENGINEERING_PRESETS.cpe;

    const setVal = (id, val) => {
      const els = document.querySelectorAll(`#${id}`);
      els.forEach(el => { el.value = val || ''; });
    };

    setVal('cv-discipline', disciplineKey);
    setVal('cv-course', preset.course);
    setVal('cv-headline', preset.headline);
    setVal('cv-summary', preset.summary);
    setVal('cv-coursework', preset.coursework);
    setVal('cv-skills', preset.technical_skills.join(', '));
    setVal('cv-soft-skills', preset.soft_skills.join(', '));
    setVal('cv-capstone-title', preset.capstone_title);
    setVal('cv-capstone-abstract', preset.capstone_abstract);

    renderSkillSuggestions();
    renderCourseworkSuggestions();
    renderCvPreview();
    saveToLocal();
    showToast(`Applied ${preset.name} preset template!`, 'success');
  }

  /**
   * Render clickable suggestion chips for technical skills
   */
  function renderSkillSuggestions() {
    const container = document.getElementById('skill-suggestions-container');
    if (!container) return;

    const currentDiscipline = document.getElementById('cv-discipline')?.value || 'cpe';
    const preset = ENGINEERING_PRESETS[currentDiscipline] || ENGINEERING_PRESETS.cpe;

    const currentSkillsStr = document.getElementById('cv-skills')?.value || '';
    const currentSkills = currentSkillsStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    // Common versatile pool plus discipline-specific
    const skillsToSuggest = Array.from(new Set([
      ...preset.technical_skills,
      'AutoCAD', 'MATLAB', 'MS Excel (Modeling)', 'Technical Drafting', 'DOLE BOSH Safety', 'QA/QC Inspection'
    ]));

    container.innerHTML = skillsToSuggest.map(skill => {
      const isSelected = currentSkills.includes(skill.toLowerCase());
      return `
        <button type="button" class="suggestion-chip ${isSelected ? 'active' : ''}" onclick="CvBuilder.toggleSkillChip('${esc(skill)}')">
          ${isSelected ? '✓ ' : '+ '}${esc(skill)}
        </button>
      `;
    }).join('');
  }

  /**
   * Render clickable suggestion chips for relevant coursework
   */
  function renderCourseworkSuggestions() {
    const container = document.getElementById('coursework-suggestions-container');
    if (!container) return;

    const currentDiscipline = document.getElementById('cv-discipline')?.value || 'cpe';
    const preset = ENGINEERING_PRESETS[currentDiscipline] || ENGINEERING_PRESETS.cpe;

    const currentCoursesStr = document.getElementById('cv-coursework')?.value || '';
    const currentCourses = currentCoursesStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

    const coursesToSuggest = preset.coursework.split(',').map(s => s.trim()).filter(Boolean);

    container.innerHTML = coursesToSuggest.map(course => {
      const isSelected = currentCourses.includes(course.toLowerCase());
      return `
        <button type="button" class="suggestion-chip ${isSelected ? 'active' : ''}" onclick="CvBuilder.toggleCourseworkChip('${esc(course)}')">
          ${isSelected ? '✓ ' : '+ '}${esc(course)}
        </button>
      `;
    }).join('');
  }

  /**
   * Toggle a skill chip in the Technical Skills input
   */
  function toggleSkillChip(skill) {
    const input = document.getElementById('cv-skills');
    if (!input) return;

    let skills = input.value.split(',').map(s => s.trim()).filter(Boolean);
    const idx = skills.findIndex(s => s.toLowerCase() === skill.toLowerCase());

    if (idx >= 0) {
      skills.splice(idx, 1);
    } else {
      skills.push(skill);
    }

    input.value = skills.join(', ');
    handleInputChange();
    renderSkillSuggestions();
  }

  /**
   * Toggle a coursework chip in the Relevant Coursework input
   */
  function toggleCourseworkChip(course) {
    const input = document.getElementById('cv-coursework');
    if (!input) return;

    let courses = input.value.split(',').map(s => s.trim()).filter(Boolean);
    const idx = courses.findIndex(s => s.toLowerCase() === course.toLowerCase());

    if (idx >= 0) {
      courses.splice(idx, 1);
    } else {
      courses.push(course);
    }

    input.value = courses.join(', ');
    handleInputChange();
    renderCourseworkSuggestions();
  }

  let editingItemId = null;
  let draggedItemId = null;

  /**
   * Render Achievement Locker items (Left Pane) with Drag-and-Drop & Inline Editing
   */
  function renderLocker() {
    const containers = document.querySelectorAll('#locker-items-container');
    if (!containers || containers.length === 0) return;

    const filtered = lockerItems.filter(item => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'leadership') return item.type === 'leadership';
      if (activeFilter === 'seminar') return item.type === 'seminar';
      return true;
    });

    containers.forEach(container => {
      if (filtered.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:18px; color:var(--text-secondary); font-size:0.82rem;">
            <iconify-icon icon="solar:folder-open-linear" style="font-size:1.6rem; margin-bottom:6px; color:var(--text-tertiary);"></iconify-icon>
            <div>No items in this category yet.</div>
            <div style="font-size:0.74rem; margin-top:3px; color:var(--text-tertiary);">Attend verified COE seminars or add custom items below!</div>
          </div>
        `;
        return;
      }

      container.innerHTML = filtered.map((item, filteredIndex) => {
        const isAdded = selectedItems.has(item.id);
        const isCustom = item.is_custom;
        const isEditing = editingItemId === item.id;

        if (isEditing) {
          return `
            <div class="locker-card in-cart" id="locker-card-${esc(item.id)}">
              <div class="locker-card-edit-form">
                <div class="edit-field-group">
                  <label>Title / Role / Activity</label>
                  <input type="text" id="edit-title-${esc(item.id)}" class="cv-mini-input" value="${esc(item.title)}" placeholder="Role or Achievement Title" />
                </div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px;">
                  <div class="edit-field-group">
                    <label>Organization / Issuer</label>
                    <input type="text" id="edit-org-${esc(item.id)}" class="cv-mini-input" value="${esc(item.organization)}" placeholder="e.g. COE Council" />
                  </div>
                  <div class="edit-field-group">
                    <label>Date / AY</label>
                    <input type="text" id="edit-date-${esc(item.id)}" class="cv-mini-input" value="${esc(item.date_range)}" placeholder="e.g. AY 2025-2026" />
                  </div>
                </div>
                <div class="edit-field-group">
                  <label>Category</label>
                  <select id="edit-type-${esc(item.id)}" class="cv-mini-select">
                    <option value="leadership" ${item.type === 'leadership' ? 'selected' : ''}>Leadership & Campus Affiliations</option>
                    <option value="seminar" ${item.type === 'seminar' ? 'selected' : ''}>Certifications & Professional Workshops</option>
                  </select>
                </div>
                <div class="edit-field-group">
                  <label>Description / Responsibilities</label>
                  <textarea id="edit-desc-${esc(item.id)}" class="cv-mini-textarea" placeholder="Key responsibilities and engineering achievements...">${esc(item.description)}</textarea>
                </div>
                <div class="edit-form-btns">
                  <button type="button" class="btn-mini-cancel" onclick="CvBuilder.cancelEditingItem()">Cancel</button>
                  <button type="button" class="btn-mini-save" onclick="CvBuilder.saveEditingItem('${esc(item.id)}')">Save Changes</button>
                </div>
              </div>
            </div>
          `;
        }

        return `
          <div class="locker-card ${isAdded ? 'in-cart' : ''}" 
               id="locker-card-${esc(item.id)}"
               draggable="true"
               ondragstart="CvBuilder.handleDragStart(event, '${esc(item.id)}')"
               ondragover="CvBuilder.handleDragOver(event, '${esc(item.id)}')"
               ondragleave="CvBuilder.handleDragLeave(event, '${esc(item.id)}')"
               ondrop="CvBuilder.handleDrop(event, '${esc(item.id)}')"
               ondragend="CvBuilder.handleDragEnd(event, '${esc(item.id)}')">
            <div class="locker-card-title">
              <div style="display:flex; align-items:center; gap:6px; flex:1; min-width:0;">
                <span class="locker-drag-handle" title="Drag to reorder"><iconify-icon icon="solar:menu-dots-bold"></iconify-icon></span>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600;" title="${esc(item.title)}">${esc(item.title)}</span>
              </div>
              <div class="locker-card-header-actions">
                <span class="badge-verified">${isCustom ? 'Custom' : 'COE'}</span>
                <button type="button" class="btn-card-icon btn-edit-item" onclick="CvBuilder.startEditingItem('${esc(item.id)}')" title="Edit this entry">
                  <iconify-icon icon="solar:pen-linear"></iconify-icon>
                </button>
                <button type="button" class="btn-card-icon" onclick="CvBuilder.moveItem('${esc(item.id)}', -1)" title="Move Up" ${filteredIndex === 0 ? 'disabled' : ''}>
                  <iconify-icon icon="solar:arrow-up-linear"></iconify-icon>
                </button>
                <button type="button" class="btn-card-icon" onclick="CvBuilder.moveItem('${esc(item.id)}', 1)" title="Move Down" ${filteredIndex === filtered.length - 1 ? 'disabled' : ''}>
                  <iconify-icon icon="solar:arrow-down-linear"></iconify-icon>
                </button>
                <button type="button" class="btn-card-icon btn-delete-item" onclick="CvBuilder.deleteItem('${esc(item.id)}')" title="Delete Entry">
                  <iconify-icon icon="solar:trash-bin-trash-linear"></iconify-icon>
                </button>
              </div>
            </div>
            <div class="locker-card-sub">${esc(item.organization)} &bull; ${esc(item.date_range)}</div>
            <div class="locker-card-actions">
              <span style="font-size:0.73rem; color:var(--text-secondary); line-height:1.35; flex:1;">${esc(item.description)}</span>
              <button type="button" class="btn-add-cart ${isAdded ? 'added' : ''}" onclick="CvBuilder.toggleItem('${esc(item.id)}')">
                ${isAdded ? '✓ Added' : '+ Add to CV'}
              </button>
            </div>
          </div>
        `;
      }).join('');
    });
  }

  /**
   * Start editing a locker item
   */
  function startEditingItem(itemId) {
    editingItemId = itemId;
    renderLocker();
  }

  /**
   * Cancel editing a locker item
   */
  function cancelEditingItem() {
    editingItemId = null;
    renderLocker();
  }

  /**
   * Save changes to an edited locker item
   */
  function saveEditingItem(itemId) {
    const item = lockerItems.find(i => i.id === itemId);
    if (!item) return;

    const getVal = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };

    const title = getVal(`edit-title-${itemId}`);
    if (!title) {
      showToast('Title cannot be empty.', 'error');
      return;
    }

    item.title = title;
    item.organization = getVal(`edit-org-${itemId}`) || item.organization;
    item.date_range = getVal(`edit-date-${itemId}`) || item.date_range;
    item.type = getVal(`edit-type-${itemId}`) || item.type;
    item.description = getVal(`edit-desc-${itemId}`) || item.description;

    editingItemId = null;
    renderLocker();
    renderCvPreview();
    saveToLocal();
    showToast('Entry updated successfully!', 'success');
  }

  /**
   * Move locker item up or down
   */
  function moveItem(itemId, direction) {
    const index = lockerItems.findIndex(i => i.id === itemId);
    if (index === -1) return;

    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= lockerItems.length) return;

    const [moved] = lockerItems.splice(index, 1);
    lockerItems.splice(targetIndex, 0, moved);

    renderLocker();
    renderCvPreview();
    saveToLocal();
    showToast('Item moved!', 'info');
  }

  /**
   * Drag & Drop event handlers
   */
  function handleDragStart(e, itemId) {
    draggedItemId = itemId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', itemId);
      } catch (_) {}
    }
    const card = document.getElementById(`locker-card-${itemId}`);
    if (card) {
      setTimeout(() => card.classList.add('dragging'), 0);
    }
  }

  function handleDragOver(e, targetId) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    if (!draggedItemId || draggedItemId === targetId) return;
    const card = document.getElementById(`locker-card-${targetId}`);
    if (card) {
      card.classList.add('drag-over');
    }
  }

  function handleDragLeave(e, targetId) {
    const card = document.getElementById(`locker-card-${targetId}`);
    if (card) {
      card.classList.remove('drag-over');
    }
  }

  function handleDrop(e, targetId) {
    e.preventDefault();
    e.stopPropagation();
    const targetCard = document.getElementById(`locker-card-${targetId}`);
    if (targetCard) targetCard.classList.remove('drag-over');

    if (!draggedItemId || draggedItemId === targetId) return;

    const fromIndex = lockerItems.findIndex(i => i.id === draggedItemId);
    const toIndex = lockerItems.findIndex(i => i.id === targetId);

    if (fromIndex !== -1 && toIndex !== -1) {
      const [moved] = lockerItems.splice(fromIndex, 1);
      lockerItems.splice(toIndex, 0, moved);
      renderLocker();
      renderCvPreview();
      saveToLocal();
      showToast('Items reordered successfully!', 'success');
    }
    draggedItemId = null;
  }

  function handleDragEnd(e, itemId) {
    const card = document.getElementById(`locker-card-${itemId}`);
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.locker-card').forEach(c => c.classList.remove('drag-over', 'dragging'));
    draggedItemId = null;
  }

  /**
   * Toggle item in/out of CV
   */
  function toggleItem(itemId) {
    if (selectedItems.has(itemId)) {
      selectedItems.delete(itemId);
    } else {
      selectedItems.add(itemId);
    }
    renderLocker();
    renderCvPreview();
    saveToLocal();
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
   * Add a custom experience or certification manually
   */
  function addCustomEntry() {
    const getVal = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };

    const title = getVal('custom-entry-title');
    const org = getVal('custom-entry-org') || 'College of Engineering';
    const date = getVal('custom-entry-date') || '2025';
    const type = getVal('custom-entry-type') || 'leadership';
    const desc = getVal('custom-entry-desc') || 'Participated actively and fulfilled engineering responsibilities.';

    if (!title) {
      showToast('Please enter a Title for your custom entry.', 'error');
      return;
    }

    const newId = 'custom-' + Date.now();
    const newItem = {
      id: newId,
      title,
      organization: org,
      date_range: date,
      type,
      description: desc,
      is_custom: true
    };

    lockerItems.unshift(newItem);
    selectedItems.add(newId);

    // Clear inputs
    ['custom-entry-title', 'custom-entry-org', 'custom-entry-date', 'custom-entry-desc'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    renderLocker();
    renderCvPreview();
    saveToLocal();
    showToast(`Added "${title}" to your CV!`, 'success');
  }

  /**
   * Delete an entry (custom or default)
   */
  function deleteItem(itemId) {
    lockerItems = lockerItems.filter(i => i.id !== itemId);
    selectedItems.delete(itemId);
    if (editingItemId === itemId) editingItemId = null;
    renderLocker();
    renderCvPreview();
    saveToLocal();
    showToast('Item removed.', 'info');
  }

  const deleteCustomEntry = deleteItem;

  /**
   * Handle real-time input change from form fields
   */
  let debounceTimer = null;
  function handleInputChange() {
    renderCvPreview();
    renderSkillSuggestions();
    renderCourseworkSuggestions();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      saveToLocal();
      document.querySelectorAll('#cv-autosave-hint').forEach(hint => {
        hint.textContent = 'Auto-saved to browser';
        hint.style.color = '#22C55E';
        setTimeout(() => { hint.style.color = ''; }, 2000);
      });
    }, 500);
  }

  /**
   * Build the current CV data object from the form inputs
   */
  function buildPayload() {
    const getVal = (id, fallback = '') => {
      const el = document.getElementById(id);
      return el && el.value !== undefined ? el.value.trim() : fallback;
    };

    const techSkillsStr = getVal('cv-skills', '');
    const softSkillsStr = getVal('cv-soft-skills', '');

    return {
      discipline: getVal('cv-discipline', cvData?.discipline || 'cpe'),
      profile: {
        full_name: getVal('cv-name', cvData?.profile?.full_name || defaultSampleData.profile.full_name),
        course: getVal('cv-course', cvData?.profile?.course || defaultSampleData.profile.course),
        enrollment_year: getVal('cv-grad-year', cvData?.profile?.enrollment_year || defaultSampleData.profile.enrollment_year),
        email: getVal('cv-email', cvData?.contact_email || cvData?.profile?.email || defaultSampleData.profile.email)
      },
      headline: getVal('cv-headline', cvData?.headline || ''),
      summary: getVal('cv-summary', cvData?.summary || ''),
      contact_phone: getVal('cv-phone', cvData?.contact_phone || ''),
      contact_email: getVal('cv-email', cvData?.contact_email || ''),
      location: getVal('cv-location', cvData?.location || ''),
      linkedin_url: getVal('cv-linkedin', cvData?.linkedin_url || ''),
      github_url: getVal('cv-github', cvData?.github_url || ''),
      portfolio_url: getVal('cv-portfolio', cvData?.portfolio_url || ''),
      coursework: getVal('cv-coursework', cvData?.coursework || defaultSampleData.coursework),
      technical_skills: techSkillsStr.split(',').map(s => s.trim()).filter(Boolean),
      soft_skills: softSkillsStr.split(',').map(s => s.trim()).filter(Boolean),
      capstone_project: {
        title: getVal('cv-capstone-title', cvData?.capstone_project?.title || ''),
        abstract: getVal('cv-capstone-abstract', cvData?.capstone_project?.abstract || '')
      },
      selected_locker_items: Array.from(selectedItems),
      locker_items: lockerItems,
      share_token: cvData?.share_token || 'VERIFY-COE-OFFICIAL'
    };
  }

  /**
   * Save draft to localStorage
   */
  function saveToLocal() {
    const payload = buildPayload();
    cvData = payload;
    try {
      localStorage.setItem('coe_cv_draft', JSON.stringify(payload));
    } catch (e) {
      console.warn('[CvBuilder] LocalStorage save warning:', e);
    }
  }

  /**
   * Render Live Harvard CV Preview (Right Canvas) with WYSIWYG direct editing.
   * Every field is contenteditable — edits on the paper sync back to the form inputs.
   */
  function renderCvPreview() {
    const canvases = document.querySelectorAll('#harvard-cv-canvas');
    if (!canvases || canvases.length === 0) return;

    const getVal = (id, fallback) => {
      const el = document.getElementById(id);
      return el && el.value !== undefined && el.value.trim() !== '' ? el.value.trim() : (fallback || '');
    };

    const currentProfile = cvData?.profile || defaultSampleData.profile;
    const name      = getVal('cv-name',    currentProfile.full_name || '');
    const course    = getVal('cv-course',  currentProfile.course || 'Bachelor of Science in Engineering');
    const gradYear  = getVal('cv-grad-year', currentProfile.enrollment_year || '2028');
    const email     = getVal('cv-email',   cvData?.contact_email || currentProfile.email || '');
    const phone     = getVal('cv-phone',   cvData?.contact_phone || '');
    const location  = getVal('cv-location', cvData?.location || '');
    const linkedin  = getVal('cv-linkedin', cvData?.linkedin_url || '');
    const github    = getVal('cv-github',  cvData?.github_url || '');
    const portfolio = getVal('cv-portfolio', cvData?.portfolio_url || '');
    const coursework = getVal('cv-coursework', cvData?.coursework || defaultSampleData.coursework);
    const summary    = getVal('cv-summary', cvData?.summary || '');
    const shareToken = cvData?.share_token || 'VERIFY-COE';

    const selectedMilestones = lockerItems.filter(item => selectedItems.has(item.id));
    const leadershipItems = selectedMilestones.filter(i => i.type === 'leadership');
    const seminarItems    = selectedMilestones.filter(i => i.type === 'seminar');

    const techSkillsStr  = getVal('cv-skills',      (cvData?.technical_skills || []).join(', '));
    const techSkillsList = techSkillsStr.split(',').map(s => s.trim()).filter(Boolean);
    const softSkillsStr  = getVal('cv-soft-skills', (cvData?.soft_skills || []).join(', '));
    const softSkillsList = softSkillsStr.split(',').map(s => s.trim()).filter(Boolean);
    const capTitle    = getVal('cv-capstone-title',    cvData?.capstone_project?.title    || '');
    const capAbstract = getVal('cv-capstone-abstract', cvData?.capstone_project?.abstract || '');

    const verifyUrl = `${window.location.origin}/cv-verify.html?token=${encodeURIComponent(shareToken)}`;
    const qrApiUrl  = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(verifyUrl)}`;

    // Shorthand: inline contenteditable span that syncs to a form input
    const ce = (fieldId, val, placeholder) =>
      `<span contenteditable="true" data-field="${esc(fieldId)}" data-placeholder="${esc(placeholder)}" class="cv-paper-field">${esc(val)}</span>`;

    const htmlContent = `
      <!-- Harvard Header -->
      <div class="harvard-header">
        <div class="harvard-name cv-paper-field"
             contenteditable="true"
             data-field="cv-name"
             data-placeholder="YOUR FULL NAME">${esc(name)}</div>
        <div class="harvard-contact-line">
          <div class="harvard-contact-row">
            ${ce('cv-location', location, 'City, Region')}
            <span class="sep"> &bull; </span>
            ${ce('cv-phone', phone, '+63 912 000 0000')}
            <span class="sep"> &bull; </span>
            ${ce('cv-email', email, 'you@school.edu.ph')}
          </div>
          <div class="harvard-contact-row">
            LinkedIn:&nbsp;${ce('cv-linkedin', linkedin, 'linkedin.com/in/username')}
            <span class="sep"> &bull; </span>
            GitHub:&nbsp;${ce('cv-github', github, 'github.com/username')}
            ${portfolio ? `<span class="sep"> &bull; </span>Portfolio:&nbsp;${ce('cv-portfolio', portfolio, 'your-portfolio.dev')}` : ''}
          </div>
        </div>
        <div class="harvard-qr-box">
          <img src="${qrApiUrl}" class="harvard-qr-img" alt="QR Verify" />
          <div class="harvard-qr-label">Credential Verification</div>
        </div>
      </div>

      <!-- Education -->
      <div class="harvard-section">
        <div class="harvard-section-title">Education</div>
        <div class="harvard-row">
          <span class="harvard-title-left cv-paper-field"
                contenteditable="true"
                data-field="cv-course"
                data-placeholder="Degree &amp; Major">${esc(course)}</span>
          <span class="harvard-date-right">Candidate&nbsp;<span class="cv-paper-field"
                contenteditable="true"
                data-field="cv-grad-year"
                data-placeholder="2028">${esc(gradYear)}</span></span>
        </div>
        <div class="harvard-sub-left">College of Engineering &bull; Official Student Portal Partner Institution</div>
        <ul class="harvard-bullets">
          <li>Verified Enrolled Engineering Student in Official College Registry.</li>
          <li><strong>Relevant Coursework:</strong> ${ce('cv-coursework', coursework, 'e.g. Calculus, Fluid Mechanics, CAD')}</li>
        </ul>
      </div>

      <!-- Professional Summary -->
      <div class="harvard-section">
        <div class="harvard-section-title">Professional Summary</div>
        <ul class="harvard-bullets">
          <li>${ce('cv-summary', summary, 'Click here to write your professional summary \u2014 describe your engineering focus, key strengths, and career goals...')}</li>
        </ul>
      </div>

      <!-- Technical Skills -->
      <div class="harvard-section">
        <div class="harvard-section-title">Technical Skills &amp; Competencies</div>
        <ul class="harvard-bullets">
          <li><strong>Engineering Software &amp; Tools:</strong>&nbsp;${ce('cv-skills', techSkillsList.join(', '), 'AutoCAD, MATLAB, Python, SolidWorks...')}</li>
          <li><strong>Core Competencies:</strong>&nbsp;${ce('cv-soft-skills', softSkillsList.join(', '), 'Team Leadership, Technical Writing, Project Management...')}</li>
        </ul>
      </div>

      <!-- Leadership & Campus Affiliations -->
      ${leadershipItems.length > 0 ? `
      <div class="harvard-section">
        <div class="harvard-section-title">Leadership &amp; Campus Affiliations</div>
        ${leadershipItems.map(item => `
          <div class="harvard-row">
            <span class="harvard-title-left">${esc(item.title)}</span>
            <span class="harvard-date-right">${esc(item.date_range)}</span>
          </div>
          <div class="harvard-sub-left">${esc(item.organization)}</div>
          <ul class="harvard-bullets"><li>${esc(item.description)}</li></ul>
        `).join('')}
      </div>` : ''}

      <!-- Capstone Project -->
      <div class="harvard-section">
        <div class="harvard-section-title">Engineering Capstone Design Project</div>
        <div class="harvard-row">
          <span class="harvard-title-left cv-paper-field"
                contenteditable="true"
                data-field="cv-capstone-title"
                data-placeholder="Click to enter your capstone project title...">${esc(capTitle)}</span>
          <span class="harvard-date-right">Design Project</span>
        </div>
        <ul class="harvard-bullets">
          <li>${ce('cv-capstone-abstract', capAbstract, 'Describe your capstone project \u2014 problem statement, methods, and outcomes...')}</li>
        </ul>
      </div>

      <!-- Certifications & Seminars -->
      ${seminarItems.length > 0 ? `
      <div class="harvard-section">
        <div class="harvard-section-title">Certifications &amp; Professional Workshops</div>
        ${seminarItems.map(item => `
          <div class="harvard-row">
            <span class="harvard-title-left">${esc(item.title)}</span>
            <span class="harvard-date-right">${esc(item.date_range)}</span>
          </div>
          <div class="harvard-sub-left">${esc(item.organization)}</div>
          <ul class="harvard-bullets"><li>${esc(item.description)}</li></ul>
        `).join('')}
      </div>` : ''}
    `;

    canvases.forEach(canvas => {
      canvas.innerHTML = htmlContent;
      // Wire up each contenteditable field to sync back to its form input
      canvas.querySelectorAll('[contenteditable="true"][data-field]').forEach(el => {
        el.addEventListener('input', () => {
          const formEl = document.getElementById(el.dataset.field);
          if (formEl) formEl.value = el.innerText.trim();
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => saveToLocal(), 600);
        });
        // Prevent Enter from inserting block elements — keep fields single-line
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            document.execCommand('insertText', false, ' ');
          }
        });
      });
    });
  }

  /**
   * Save CV data to API and local storage
   */
  async function saveCv() {
    saveToLocal();
    const payload = buildPayload();

    const saveBtns = document.querySelectorAll('#cv-save-btn');
    const saveTexts = document.querySelectorAll('#cv-save-text');

    saveBtns.forEach(b => { b.disabled = true; });
    saveTexts.forEach(t => { t.textContent = 'Saving...'; });

    try {
      if (typeof Api !== 'undefined' && Api.put) {
        try {
          const updated = await Api.put('/cv/me', payload);
          if (updated) {
            cvData = { ...cvData, ...updated };
          }
        } catch (apiErr) {
          console.debug('[CvBuilder] Remote save skipped (using local cache):', apiErr?.message);
        }
      }

      showToast('CV draft and preferences saved successfully!', 'success');
    } catch (err) {
      console.error('[CvBuilder] Save error:', err);
      showToast('Saved to browser cache.', 'info');
    } finally {
      saveBtns.forEach(b => { b.disabled = false; });
      saveTexts.forEach(t => { t.textContent = 'Save Changes'; });
      renderCvPreview();
    }
  }

  /**
   * Reset form and preview to a blank template
   */
  function resetToSample() {
    cvData = { ...defaultSampleData };
    lockerItems = [];
    selectedItems = new Set();
    localStorage.removeItem('coe_cv_draft');
    populateFormInputs();
    renderLocker();
    renderCvPreview();
    showToast('CV cleared — start fresh with your own details!', 'info');
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
    addCustomEntry,
    deleteCustomEntry,
    deleteItem,
    startEditingItem,
    cancelEditingItem,
    saveEditingItem,
    moveItem,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleInputChange,
    renderCvPreview,
    applyDisciplinePreset,
    toggleSkillChip,
    toggleCourseworkChip,
    saveCv,
    resetToSample,
    exportPdf
  };
})();
