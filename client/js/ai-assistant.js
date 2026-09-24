// =============================================
// ai-assistant.js - Grizz: COE Mascot AI Assistant
// Clickable-only intelligent academic & financial guide
// =============================================

const GrizzAI = (() => {

  let profile = null;
  let subjects = [];
  let myUnits = [];
  let requirements = [];
  let prereqRows = [];
  let isOpen = false;
  let activeTab = 'academic';
  let isInitialized = false;
  let isActionPending = false;

  const PROGRAM_NAMES = {
    BSCoE: 'BS Computer Engineering',
    BSCE:  'BS Civil Engineering',
    BSECE: 'BS Electronics Engineering',
  };

  // ---- Initialize ----
  async function init() {
    if (!isInitialized) {
      bindEvents();
      isInitialized = true;
    }
    loadData();
    renderDashboardWidget();
  }

  function setProfile(p) {
    if (p) {
      profile = p;
      updateInitialGreeting();
    }
  }

  function bindEvents() {
    // Draggable Launcher button
    const launcher = document.getElementById('ursa-launcher-btn');
    if (launcher) {
      bindDraggableLauncher(launcher);
    }

    // Close buttons & overlay
    const closeBtn = document.getElementById('ursa-close-btn');
    const overlay = document.getElementById('ursa-overlay');
    if (closeBtn) closeBtn.addEventListener('click', () => close());
    if (overlay) overlay.addEventListener('click', () => close());

    // Clear chat button
    const clearBtn = document.getElementById('ursa-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => resetChat());
    }

    // Category tabs
    const tabBtns = Array.from(document.querySelectorAll('.ursa-tab-btn'));
    tabBtns.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        activeTab = btn.dataset.tab || 'academic';
        renderPromptList();
      });

      btn.addEventListener('keydown', (e) => {
        let targetIdx = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          targetIdx = (idx + 1) % tabBtns.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          targetIdx = (idx - 1 + tabBtns.length) % tabBtns.length;
        } else if (e.key === 'Home') {
          targetIdx = 0;
        } else if (e.key === 'End') {
          targetIdx = tabBtns.length - 1;
        }

        if (targetIdx >= 0) {
          e.preventDefault();
          tabBtns[targetIdx].focus();
          tabBtns[targetIdx].click();
        }
      });
    });

    // Keyboard support: Escape closes drawer, Enter / Space activates cards
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        close();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const promptCard = document.activeElement?.closest('.ursa-prompt-card');
        if (promptCard && promptCard.dataset.action) {
          e.preventDefault();
          promptCard.click();
        }
      }
    });

    // Delegate clicks for prompt cards & dynamic follow-up chips
    document.addEventListener('click', (e) => {
      const promptCard = e.target.closest('.ursa-prompt-card');
      if (promptCard && promptCard.dataset.action) {
        promptCard.classList.add('is-activating');
        setTimeout(() => promptCard.classList.remove('is-activating'), 350);
        handleAction(promptCard.dataset.action, promptCard.dataset.title || promptCard.textContent.trim());
        return;
      }

      const chip = e.target.closest('.ursa-chip-action');
      if (chip && chip.dataset.action) {
        chip.classList.add('is-activating');
        setTimeout(() => chip.classList.remove('is-activating'), 350);
        handleAction(chip.dataset.action, chip.dataset.title || chip.textContent.trim());
        return;
      }

      const dashChip = e.target.closest('.ursa-dash-chip, .grizz-prompt-pill');
      if (dashChip && dashChip.dataset.action) {
        open();
        handleAction(dashChip.dataset.action, dashChip.dataset.title || dashChip.textContent.trim());
        return;
      }

      const openTrigger = e.target.closest('#grizz-open-trigger, .grizz-bar-identity, .ursa-dash-left');
      if (openTrigger) {
        open();
        return;
      }

      const navLink = e.target.closest('.ursa-nav-link');
      if (navLink && navLink.dataset.view) {
        close();
        const targetView = navLink.dataset.view;
        const navItem = document.querySelector(`.nav-item[data-view="${targetView}"]`) || document.querySelector(`.bottom-nav-item[data-view="${targetView}"]`);
        if (navItem) navItem.click();
      }
    });
  }

  // ---- Draggable Launcher Engine (Desktop & Mobile Touch) ----
  function bindDraggableLauncher(launcher) {
    if (!launcher) return;

    let isPointerDown = false;
    let hasMoved = false;
    let startX = 0;
    let startY = 0;
    let offsetX = 0;
    let offsetY = 0;
    let dragOccurred = false;

    launcher.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;

      const rect = launcher.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      isPointerDown = true;
      hasMoved = false;

      try {
        launcher.setPointerCapture(e.pointerId);
      } catch (err) {}
    });

    launcher.addEventListener('pointermove', (e) => {
      if (!isPointerDown) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!hasMoved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        hasMoved = true;
        dragOccurred = true;
        launcher.classList.add('is-dragging');
      }

      if (hasMoved) {
        const newLeft = e.clientX - offsetX;
        const newTop = e.clientY - offsetY;

        const pad = 8;
        const maxLeft = window.innerWidth - launcher.offsetWidth - pad;
        const bottomNav = document.querySelector('.bottom-nav') || document.querySelector('.of-bottom-nav');
        let bottomBarrier = pad;
        if (bottomNav) {
          const navStyle = window.getComputedStyle(bottomNav);
          if (navStyle.display !== 'none' && navStyle.visibility !== 'hidden' && navStyle.opacity !== '0') {
            const navRect = bottomNav.getBoundingClientRect();
            if (navRect.height > 0 && navRect.top < window.innerHeight) {
              bottomBarrier = Math.max(pad, window.innerHeight - navRect.top + 8);
            }
          }
        }

        const maxTop = window.innerHeight - launcher.offsetHeight - bottomBarrier;
        const clampedLeft = Math.max(pad, Math.min(maxLeft, newLeft));
        const clampedTop = Math.max(pad, Math.min(maxTop, newTop));

        launcher.style.left = `${clampedLeft}px`;
        launcher.style.top = `${clampedTop}px`;
        launcher.style.right = 'auto';
        launcher.style.bottom = 'auto';
      }
    });

    // Release behavior: settle the launcher against the nearest horizontal edge
    // so it never rests over mid-screen content (stat cards, lists).
    const snapToEdge = () => {
      const rect = launcher.getBoundingClientRect();
      const pad = 8;
      const maxLeft = window.innerWidth - launcher.offsetWidth - pad;
      const targetLeft = (rect.left + rect.width / 2) < (window.innerWidth / 2) ? pad : maxLeft;

      launcher.classList.add('is-snapping');
      launcher.style.left = `${targetLeft}px`;
      launcher.style.right = 'auto';
      launcher.style.bottom = 'auto';
      setTimeout(() => launcher.classList.remove('is-snapping'), 300);
    };

    const endDrag = (e) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      launcher.classList.remove('is-dragging');

      try {
        launcher.releasePointerCapture(e.pointerId);
      } catch (err) {}

      if (hasMoved) {
        snapToEdge();
        setTimeout(() => {
          dragOccurred = false;
        }, 150);
      }
    };

    launcher.addEventListener('pointerup', endDrag);
    launcher.addEventListener('pointercancel', endDrag);

    // Click handler to open assistant (only if not dragged)
    launcher.addEventListener('click', (e) => {
      if (dragOccurred || hasMoved) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      open();
    });

    // Re-clamp position on window resize with navigation bar barrier check
    window.addEventListener('resize', () => {
      if (launcher.style.left && launcher.style.left !== 'auto') {
        const rect = launcher.getBoundingClientRect();
        const pad = 8;
        const maxLeft = window.innerWidth - launcher.offsetWidth - pad;
        const bottomNav = document.querySelector('.bottom-nav') || document.querySelector('.of-bottom-nav');
        let bottomBarrier = pad;
        if (bottomNav) {
          const navStyle = window.getComputedStyle(bottomNav);
          if (navStyle.display !== 'none' && navStyle.visibility !== 'hidden' && navStyle.opacity !== '0') {
            const navRect = bottomNav.getBoundingClientRect();
            if (navRect.height > 0 && navRect.top < window.innerHeight) {
              bottomBarrier = Math.max(pad, window.innerHeight - navRect.top + 8);
            }
          }
        }

        const maxTop = window.innerHeight - launcher.offsetHeight - bottomBarrier;
        const clampedLeft = Math.max(pad, Math.min(maxLeft, rect.left));
        const clampedTop = Math.max(pad, Math.min(maxTop, rect.top));

        launcher.style.left = `${clampedLeft}px`;
        launcher.style.top = `${clampedTop}px`;
      }
    });
  }

  // ---- Open / Close Drawer ----
  async function open() {
    isOpen = true;
    const drawer = document.getElementById('ursa-drawer');
    const overlay = document.getElementById('ursa-overlay');
    const bottomNav = document.querySelector('.bottom-nav') || document.querySelector('.of-bottom-nav');

    // Dismiss mobile more sheet if currently open
    const moreClose = document.getElementById('mobile-sheet-close-btn') || document.getElementById('of-mobile-sheet-close-btn');
    const moreSheet = document.getElementById('mobile-more-sheet') || document.getElementById('of-mobile-more-sheet');
    if (moreClose && moreSheet && !moreSheet.classList.contains('hidden')) {
      moreClose.click();
    }

    if (drawer) drawer.classList.add('active');
    if (overlay) overlay.classList.add('active');
    document.body.classList.add('ursa-open');
    if (bottomNav) bottomNav.classList.add('nav-hidden');

    // Preload student profile & academic records
    await loadData();
    renderPromptList();
  }

  function close() {
    isOpen = false;
    const drawer = document.getElementById('ursa-drawer');
    const overlay = document.getElementById('ursa-overlay');
    const bottomNav = document.querySelector('.bottom-nav') || document.querySelector('.of-bottom-nav');
    if (drawer) drawer.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    document.body.classList.remove('ursa-open');
    if (bottomNav) bottomNav.classList.remove('nav-hidden');
  }

  // ---- Data Loader ----
  async function loadData() {
    try {
      profile = await Auth.getProfile().catch(() => null);
      const prog = profile?.course || 'BSCoE';
      const [checklistRes, unitsRes] = await Promise.all([
        Api.units.checklists(prog).catch(() => ({ subjects: [], requirements: [] })),
        Api.units.my().catch(() => []),
      ]);
      subjects = checklistRes.subjects || [];
      requirements = checklistRes.requirements || [];
      prereqRows = checklistRes.prerequisites || [];
      myUnits = unitsRes || [];
      updateInitialGreeting();
    } catch (err) {
      console.warn('Grizz data preload notice:', err);
    }
  }

  // ---- Render Dashboard Embedded Widget ----
  function renderDashboardWidget() {
    const container = document.getElementById('dashboard-ursa-container');
    if (!container) return;

    container.innerHTML = `
      <div class="grizz-dashboard-bar">
        <div class="grizz-bar-identity" id="grizz-open-trigger" role="button" tabindex="0" title="Open Grizz AI Assistant">
          <div class="grizz-avatar-wrap">
            <img src="assets/grizz.png" alt="Grizz" class="grizz-avatar-mini" />
          </div>
          <div class="grizz-identity-text">
            <span class="grizz-name">Grizz</span>
            <span class="grizz-role">· Your system navigator</span>
          </div>
        </div>

        <div class="grizz-bar-divider" aria-hidden="true"></div>

        <div class="grizz-chips-track">
          <button type="button" class="grizz-prompt-pill" data-action="next-sem" data-title="Next Sem Subject Recommendations">
            <iconify-icon icon="solar:diploma-verified-linear" class="pill-icon"></iconify-icon>
            <span>Next Sem Recommendations</span>
          </button>
          <button type="button" class="grizz-prompt-pill" data-action="current-subjects" data-title="Ask About Current Subjects">
            <iconify-icon icon="solar:book-bookmark-linear" class="pill-icon"></iconify-icon>
            <span>Current Subjects</span>
          </button>
          <button type="button" class="grizz-prompt-pill" data-action="financial-summary" data-title="Explain Financial Summary">
            <iconify-icon icon="solar:pie-chart-2-linear" class="pill-icon"></iconify-icon>
            <span>Explain Funds</span>
          </button>
        </div>
      </div>
    `;
  }

  // ---- Prompt List (Bottom Drawer) ----
  const PROMPT_DATABASE = {
    academic: [
      {
        action: 'next-sem',
        title: 'Next Sem Recommendations',
        icon: 'solar:diploma-verified-linear',
        text: 'View eligible subjects based on passed prerequisites',
      },
      {
        action: 'current-subjects',
        title: 'Current Subjects Overview',
        icon: 'solar:book-bookmark-linear',
        text: 'Review enrolled subjects and term load',
      },
      {
        action: 'academic-progress',
        title: 'Academic Progress Tally',
        icon: 'solar:chart-square-linear',
        text: 'Check completed units toward graduation',
      },
      {
        action: 'check-prereq',
        title: 'Prerequisites Check',
        icon: 'solar:branching-paths-down-linear',
        text: 'Verify subject standing and course chains',
      },
    ],
    financial: [
      {
        action: 'financial-summary',
        title: 'Financial Summary',
        icon: 'solar:pie-chart-2-linear',
        text: 'Overview of council funds, expenses & balance',
      },
      {
        action: 'upcoming-events',
        title: 'Events & Budgets',
        icon: 'solar:calendar-date-linear',
        text: 'Upcoming student activities and allocations',
      },
      {
        action: 'recent-spending',
        title: 'Recent Expenses',
        icon: 'solar:card-transfer-linear',
        text: 'Latest recorded expenditures from the ledger',
      },
      {
        action: 'collections-inflow',
        title: 'Collections & Inflow',
        icon: 'solar:wallet-money-linear',
        text: 'Incoming dues, donations & collection breakdown',
      },
    ],
    guide: [
      {
        action: 'guide-logging',
        title: 'How to Log Subjects',
        icon: 'solar:question-circle-linear',
        text: 'Instructions for recording grades & units',
      },
      {
        action: 'guide-transparency',
        title: 'Transparency Policy',
        icon: 'solar:shield-check-linear',
        text: 'How student council finances are audited',
      },
      {
        action: 'guide-curriculum',
        title: 'Curriculum & Standing',
        icon: 'solar:square-academic-cap-2-linear',
        text: 'Understanding prerequisite rules & standing',
      },
      {
        action: 'guide-reports',
        title: 'Reports & Exports',
        icon: 'solar:document-text-linear',
        text: 'How monthly statements & PDF exports work',
      },
    ],
  };

  function renderPromptList() {
    const listEl = document.getElementById('ursa-prompts-list');
    if (!listEl) return;

    const items = PROMPT_DATABASE[activeTab] || PROMPT_DATABASE.academic;
    listEl.innerHTML = items.map(item => `
      <div class="ursa-prompt-card ursa-cat-${activeTab}" data-action="${item.action}" data-title="${esc(item.title)}" role="button" tabindex="0" aria-label="${esc(item.title)}: ${esc(item.text)}">
        <div class="ursa-prompt-left">
          <div class="ursa-prompt-icon" aria-hidden="true"><iconify-icon icon="${item.icon}"></iconify-icon></div>
          <div class="ursa-prompt-info">
            <span class="ursa-prompt-text">${esc(item.title)}</span>
            <span class="ursa-prompt-desc">${esc(item.text)}</span>
          </div>
        </div>
        <div class="ursa-prompt-arrow" aria-hidden="true"><iconify-icon icon="solar:alt-arrow-right-linear"></iconify-icon></div>
      </div>
    `).join('');
  }

  // ---- Message Feed Controller ----
  function appendUserMessage(text) {
    const stream = document.getElementById('ursa-chat-stream');
    if (!stream) return;

    // Resolve avatar URL from profile, DOM sidebar/mobile avatar, or memory
    let avatarUrl = profile?.avatar_url || null;
    if (!avatarUrl) {
      const sidebarImg = document.querySelector('#user-avatar img, #mobile-user-avatar img');
      if (sidebarImg && sidebarImg.getAttribute('src')) {
        avatarUrl = sidebarImg.getAttribute('src');
      }
    }

    if (avatarUrl) {
      avatarUrl = avatarUrl.replace(/\.(jpg|jpeg|png)$/i, '.webp');
    }

    const userName = profile?.full_name || document.getElementById('user-name')?.textContent || 'User';
    const initial = (userName.trim() || 'U')[0].toUpperCase();

    const avatarHtml = avatarUrl
      ? `<img src="${avatarUrl}" alt="You" class="avatar-img" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\\'user-initial-fallback\\'>${initial}</span>';" />`
      : `<span class="user-initial-fallback">${initial}</span>`;

    const msg = document.createElement('div');
    msg.className = 'ursa-msg user';
    msg.innerHTML = `
      <div class="ursa-msg-avatar">
        ${avatarHtml}
      </div>
      <div class="ursa-msg-content">
        <div class="ursa-bubble">${esc(text)}</div>
      </div>
    `;
    stream.appendChild(msg);
    scrollToBottom();
  }

  function appendBotMessage(title, htmlContent, followUpChips = []) {
    const stream = document.getElementById('ursa-chat-stream');
    if (!stream) return;

    const msg = document.createElement('div');
    msg.className = 'ursa-msg bot';

    let chipsHtml = '';
    if (followUpChips.length > 0) {
      chipsHtml = `
        <div class="ursa-response-actions">
          ${followUpChips.map(c => `
            <button type="button" class="ursa-chip-action" data-action="${c.action}" data-title="${esc(c.title || c.label)}">
              ${c.icon ? `<iconify-icon icon="${c.icon}"></iconify-icon>` : ''} ${esc(c.label)}
            </button>
          `).join('')}
        </div>
      `;
    }

    msg.innerHTML = `
      <div class="ursa-msg-avatar">
        <img src="assets/grizz.png" alt="Grizz" />
      </div>
      <div class="ursa-msg-content">
        <div class="ursa-bubble">
          <h4>${esc(title)}</h4>
          ${htmlContent}
          ${chipsHtml}
        </div>
      </div>
    `;
    stream.appendChild(msg);
    scrollToBottom();
    return msg;
  }

  function scrollToBottom() {
    const body = document.getElementById('ursa-body');
    if (body) {
      setTimeout(() => {
        body.scrollTop = body.scrollHeight;
      }, 50);
    }
  }

  function getDynamicGreeting(name) {
    const hour = new Date().getHours();
    const displayName = (name && name !== 'Student' && name !== 'Engineer') ? name : 'engineer';

    // Morning: 5:00 AM - 11:59 AM
    const morningGreetings = [
      `Good morning, ${displayName}`,
      `Rise and shine, ${displayName}!`,
      `Morning, ${displayName}! Ready to debug today's challenges?`,
      `Good morning, ${displayName}! Let's build something great today.`,
      `Morning, ${displayName}. Coffee is brewing, and the advisor is online.`,
      `Good morning! Hope your coffee is strong and your code compiles on the first try, ${displayName}.`,
      `Rise and shine, engineer ${displayName}. Let's make today count!`
    ];

    // Afternoon: 12:00 PM - 5:59 PM
    const afternoonGreetings = [
      `Good afternoon, ${displayName}`,
      `Hope your afternoon is going well, ${displayName}.`,
      `Good afternoon, engineer ${displayName}! The system is fully operational.`,
      `Afternoon, ${displayName}! Let's optimize your study load.`,
      `Good afternoon, ${displayName}. Staying hydrated? Don't forget to take short breaks.`,
      `Hello, ${displayName}. Ready for some afternoon curriculum planning?`,
      `Maayong hapon, ${displayName}! Na-compute na ba ang imong remaining energy?`,
      `Good afternoon! Hapon na, pero ang deadline nagdali gihapon.`,
      `Maayong hapon! Ready na ba mo mag-engineer, or nag-loading pa ang brain?`,
      `Hapon na, ${displayName}. Ang adlaw init, ang workload mas init.`,
      `Good afternoon! May your coffee be strong and your calculations stronger.`,
      `Maayong hapon! Unsay atong i-solve karon — equation or existential crisis?`,
      `Hapon na! Time to convert caffeine into engineering solutions.`,
      `Maayong hapon, ${displayName}! Ayaw kabalaka, dili pa late… basin.`,
      `Good afternoon! Ang brain nimo naka-afternoon mode na, pero ang requirements naka-hard mode.`,
      `Maayong hapon! Let's make some questionable calculations with confidence.`
    ];

    // Evening: 6:00 PM - 9:59 PM
    const eveningGreetings = [
      `Good evening, ${displayName}`,
      `Maayong gabii diha, ${displayName}`,
      `Evening, ${displayName}! Let's wrap up today's calculations.`,
      `Good evening, engineer ${displayName}. How did the classes go?`,
      `Hope you're having a relaxing evening, ${displayName}.`,
      `Good evening, ${displayName}. Let's plan ahead for the next semester.`,
      `Evening, ${displayName}. What's on your mind tonight?`,
      `Good evening, ${displayName}! Buhi pa ba, or nag-surrender na sa computation?`,
      `Maayong gabii! Ready na ba ta mag-solve, or ready na maghilak?`,
      `Good evening, ${displayName}! Ang adlaw niundang na, pero ang requirements wala pa.`,
      `Maayong gabii! Unsa man, mag-engineer ta karon or mag-overthink sa life?`,
      `Gabii na, ${displayName}. Time to calculate… pila pa ka oras before deadline?`,
      `Maayong gabii! May your equations be correct and your professors merciful.`,
      `Good evening, ${displayName}! Ang stress nimo karon, linear ba or exponential?`,
      `Maayong gabii! Ayaw kabalaka, masolve ra nato ni… hopefully.`,
      `Gabii na! Perfect time para mag-design, mag-compute, ug mag-question sa life choices.`,
      `Maayong gabii, ${displayName}! Nakakaon na ka, or gi-feed na pud ka sa problem set?`
    ];

    // Late Night: 10:00 PM - 11:59 PM
    const lateGreetings = [
      'Gabie nmn diay, ting relapse?',
      `It's late already, engineer, you need to rest`,
      `It's late already, ${displayName}, you need to rest`,
      `It's late already, ${displayName}. Time to commit your work and get some sleep.`,
      `Working late, engineer ${displayName}? You need to rest.`,
      `It's late already, engineer. Those bugs can wait until tomorrow-go rest!`,
      `Still online, ${displayName}? The system recommends getting some sleep.`,
      `Late night session, ${displayName}? Don't forget to recharge your own batteries.`
    ];

    // Midnight / Past Midnight: 12:00 AM - 4:59 AM — extra chaotic hours
    const midnightGreetings = [
      `Maayong kadlawon, ${displayName}! Ngano gising pa man ta?`,
      `12 AM na, ${displayName}. Dili na ni study session. Survival mission na ni.`,
      `Maayong kadlawon! Ang uban nangatulog, ang engineers nag-debug gihapon.`,
      `Good midnight, ${displayName}! Your sleep schedule has officially been deprecated.`,
      `Kadlawn na, ${displayName}. Ang calculator awake, ikaw nalang kulang.`,
      `Maayong kadlawon! Naa pa kay energy, or imaginary nalang?`,
      `12:00 AM. Congratulations, ${displayName}! You have unlocked another level of academic suffering.`,
      `Kadlawn na! Perfect time to ask: 'Ngano man gud nag-engineering ko?'`,
      `Maayong kadlawon, ${displayName}. If you're still awake, either deadline ni or love life.`,
      `Pass midnight na, ${displayName}! Sleep is optional, apparently.`,
      `Kadlawn na. Ang problem wala pa na-solve, pero ang breakdown kay solved na.`,
      `Maayong kadlawon! Please remember: ang 2 AM confidence dili parehas sa 8 AM confidence.`,
      `${displayName}, kadlawn na. Even the calculator wants you to sleep.`,
      `12 AM na. Time to compute your remaining brain cells.`,
      'Hohhh, try lng natin, if it doesnt work, at least we tried.',
      `Maayong kadlawon! Deadline tomorrow? Ah, so technically today.`
    ];

    let list;
    if (hour >= 5 && hour < 12) {
      list = morningGreetings;
    } else if (hour >= 12 && hour < 18) {
      list = afternoonGreetings;
    } else if (hour >= 18 && hour < 22) {
      list = eveningGreetings;
    } else if (hour >= 22) {
      list = lateGreetings;
    } else {
      list = midnightGreetings;
    }

    const randomIndex = Math.floor(Math.random() * list.length);
    return list[randomIndex];
  }

  function getMotivationalQuote() {
    const quotes = [
      "Every bug you solve makes you a stronger developer. Keep building!",
      "Engineering is 10% design and 90% perseverance. You've got this!",
      "Great engineers aren't born; they are compiled through focus and patience.",
      "Every complex system is just simple parts built with care. Take it step-by-step!",
      "Keep pushing! Rome wasn't built in a day, and neither is a great engineer's career.",
      "Don't worry if it doesn't work right away. If it did, engineering wouldn't be this fun!",
      "Your code might fail, but your spirit shouldn't. Keep experimenting!",
      "Success is just a function of time, effort, and perseverance. Keep up the amazing work!",
      "Every line of code you write is a step closer to mastering your craft. Keep coding!",
      "Stay curious, stay persistent, and remember to smile - you're doing great!"
    ];
    const randomIndex = Math.floor(Math.random() * quotes.length);
    return quotes[randomIndex];
  }

  function renderWelcomeMessage() {
    const stream = document.getElementById('ursa-chat-stream');
    if (!stream) return;

    const studentName = profile?.full_name ? profile.full_name.split(' ')[0] : 'Engineer';
    const progName = PROGRAM_NAMES[profile?.course] || profile?.course || 'Engineering';

    const greeting = getDynamicGreeting(studentName);
    const motivationalQuote = getMotivationalQuote();

    stream.innerHTML = `
      <div class="ursa-msg bot">
        <div class="ursa-msg-avatar">
          <img src="assets/grizz.png" alt="Grizz" />
        </div>
        <div class="ursa-msg-content">
          <div class="ursa-bubble">
            <h4>${esc(greeting)}</h4>
            <p>I am <strong>Grizz</strong>, your official College of Engineering advisor for <strong>${esc(progName)}</strong>. Select any inquiry below to explore your subjects or council funds.</p>
            <p style="color:var(--text-secondary);font-size:0.75rem;margin-bottom:0.5rem;">Zero typing required - simply click what you need.</p>
            <div class="ursa-motivational-box" style="border-top:1px dashed var(--border);margin-top:0.75rem;padding-top:0.65rem;font-size:0.78rem;color:var(--primary);font-style:italic;line-height:1.4;display:flex;align-items:flex-start;gap:0.35rem;">
              <iconify-icon icon="solar:lightbulb-bolt-linear" style="font-size:0.95rem;flex-shrink:0;margin-top:1px;"></iconify-icon>
              <span>Grizz says: "${esc(motivationalQuote)}"</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function updateInitialGreeting() {
    const stream = document.getElementById('ursa-chat-stream');
    if (!stream) return;

    if (stream.children.length <= 1) {
      renderWelcomeMessage();
    }
  }

  function resetChat() {
    renderWelcomeMessage();
    scrollToBottom();
  }

  // ---- Query Handlers (Zero Typing / 100% Deterministic) ----
  async function handleAction(action, userLabel) {
    if (isActionPending) return;
    isActionPending = true;
    setTimeout(() => { isActionPending = false; }, 350);

    appendUserMessage(userLabel || action);
    await loadData();

    switch (action) {
      case 'next-sem':
        handleNextSemRecommendations();
        break;
      case 'current-subjects':
        handleCurrentSubjects();
        break;
      case 'academic-progress':
        handleAcademicProgress();
        break;
      case 'check-prereq':
        handleCheckPrerequisites();
        break;
      case 'financial-summary':
        await handleFinancialSummary();
        break;
      case 'upcoming-events':
        await handleUpcomingEvents();
        break;
      case 'recent-spending':
        await handleRecentSpending();
        break;
      case 'collections-inflow':
        await handleCollectionsInflow();
        break;
      case 'guide-logging':
        handleGuideLogging();
        break;
      case 'guide-transparency':
        handleGuideTransparency();
        break;
      case 'guide-curriculum':
        handleGuideCurriculum();
        break;
      case 'guide-reports':
        handleGuideReports();
        break;
      default:
        appendBotMessage('Grizz Navigator', `<p>Information is ready for this topic.</p>`);
        break;
    }
  }

  // Lecture/lab-aware unit label for recommendation cards ("3+1 units" when lab > 0).
  function unitsLabel(s) {
    return Number(s.lab_units) > 0 ? `${s.lec_units}+${s.lab_units} units` : `${s.units} unit${s.units === 1 ? "" : "s"}`;
  }

  // Component-aware pass classification (spec addendum 2026-09-08).
  // Only a FULL pass - overall 'passed', or both lec+lab components
  // 'passed' - satisfies a prerequisite. A record with exactly one passed
  // component is a partial pass: the passed component's units bank, but the
  // subject surfaces in the Component Backlog (retake the failed part only).
  // Records are classified newest-first per subject code, so retakes never
  // resurrect an older outcome.
  function classifyPasses(records) {
    const passedCodes = new Set();
    const enrolledCodes = new Set();
    const partialPasses = new Map(); // subject code -> passed component ('lecture' | 'laboratory')
    const seen = new Set();
    records.forEach(u => {
      const code = (u.subjects?.code || '').trim().toUpperCase();
      if (!code || seen.has(code)) return; // newest record per subject wins
      seen.add(code);
      const lecPassed = u.lec_status === 'passed';
      const labPassed = u.lab_status === 'passed';
      if (u.status === 'passed' || (lecPassed && labPassed)) {
        passedCodes.add(code);
      } else if (u.status !== 'enrolled' && lecPassed !== labPassed) {
        // exactly one component passed on a settled (non-current-term) record
        partialPasses.set(code, lecPassed ? 'lecture' : 'laboratory');
      }
      if (u.status === 'enrolled') enrolledCodes.add(code);
    });
    return { passedCodes, enrolledCodes, partialPasses };
  }

  // 1. Next Semester Subject Recommendations
  // Curriculum logic now lives in the tested engine grizz-recommend.js: term
  // resolution, term-scoped candidates (target slot + backlog), prereq/co-req
  // gates, and the 5-subject / 24-unit load cap.
  async function handleNextSemRecommendations() {
    const plan = window.GrizzRecommend.buildRecommendations({
      subjects,
      prereqRows,
      myUnits,
      profileYear: Number(profile?.year_level) || 1,
      activeTerm: window.Enrollment?.activeTerm?.() || null,
    });

    const recommended = plan.recommended.map(c => Object.assign({}, c.subject, {
      kind: c.kind,
      retake: c.retake,
      prereqNotes: (c.notes || []).concat(c.retake ? ['Retake: you attempted this before.'] : []),
    }));
    const totalUnits = plan.totalUnits;
    const blocked = plan.blocked || [];
    const remainder = plan.remainder || [];
    const standing = plan.standing;
    const ord = (y) => y + (y === 1 ? 'st' : y === 2 ? 'nd' : y === 3 ? 'rd' : 'th');

    if (recommended.length === 0) {
      const blockedNote = blocked.length
        ? `<p>${blocked.length} course${blocked.length === 1 ? ' is' : 's are'} still locked by prerequisites: ${esc(blocked.slice(0, 5).map(b => b.subject.code).join(', '))}${blocked.length > 5 ? '…' : ''}.</p>`
        : '';
      appendBotMessage(
        'Curriculum Recommendations',
        `<p>No open courses can be added right now: every course within your <strong>${ord(standing.yearLevel)} Year standing</strong> is cleared or currently being taken${standing.basis === 'records' ? ` (${standing.completedUnits} of ${standing.totalUnits} units completed)` : ''}.</p>${blockedNote}`,
        [
          { action: 'academic-progress', label: 'View Academic Progress', icon: 'solar:diploma-verified-linear' },
          blocked.length ? { action: 'check-prereq', label: 'Check Prerequisites', icon: 'solar:branching-paths-down-linear' } : null,
        ].filter(Boolean)
      );
      return;
    }

    // Phase C: pilot accounts can push recommendations into their Load
    // Verification draft. Non-pilots get today's cards with no add UI.
    const pilot = window.isEnrollmentPilot?.(profile?.email);
    let canEdit = false;
    let lockNote = '';
    let inLoad = new Set();
    if (pilot && window.Enrollment?.ensureReady) {
      try { await window.Enrollment?.ensureReady(); } catch { /* state stays null → rendered as locked */ }
      canEdit = !!window.Enrollment.canEdit?.();
      lockNote = window.Enrollment.lockedReason?.() || '';
      inLoad = window.Enrollment.draftSubjectIds?.() || new Set();
    }

    const addButtonFor = (s) => inLoad.has(s.id)
      ? '<span class="ursa-subject-tag active"><iconify-icon icon="solar:check-circle-bold"></iconify-icon> In your load</span>'
      : `<button type="button" class="ursa-add-btn"${canEdit ? '' : ' disabled'} data-grizz-add="${esc(s.id)}"><iconify-icon icon="solar:add-circle-linear"></iconify-icon> Add to Load</button>`;

    const cardsHtml = recommended.map(s => `
      <div class="ursa-subject-item">
        <div class="ursa-subject-header">
          <div class="ursa-subject-code-group">
            <span class="ursa-subject-code">${esc(s.code)}</span>
            <span class="ursa-units-badge">${unitsLabel(s)}</span>
          </div>
          <span class="ursa-subject-term-tag">
            <iconify-icon icon="solar:calendar-linear"></iconify-icon> Yr ${s.year_level} • Sem ${s.semester}
          </span>
        </div>
        <div class="ursa-subject-title" title="${esc(s.title)}">${esc(s.title)}</div>
        ${(s.prereqNotes || []).length ? `
          <div class="ursa-subject-note">
            <iconify-icon icon="solar:info-circle-linear"></iconify-icon> ${esc(s.prereqNotes.join(', '))}
          </div>` : ''}
        ${pilot ? `
          <div class="ursa-subject-footer">
            ${addButtonFor(s)}
          </div>` : ''}
      </div>
    `).join('');

    const addAllHtml = pilot ? `
      <div class="ursa-response-actions" style="margin-top:0.75rem;">
        <button type="button" class="ursa-chip-action" data-grizz-add-all
          ${(!canEdit || !recommended.some(s => !inLoad.has(s.id))) ? 'disabled' : ''}>
          <iconify-icon icon="solar:cart-plus-linear"></iconify-icon> Add all recommended
        </button>
      </div>
      <p class="ursa-note-text" data-grizz-lock ${canEdit ? 'hidden' : ''}>
        <iconify-icon icon="solar:lock-keyhole-linear"></iconify-icon> Your load is ${esc(lockNote || 'not editable right now')}: you can add subjects only while you're still building it.
      </p>` : '';

    const jumpHtml = pilot ? `
      <p style="margin:0.75rem 0 0;">
        <a href="#" class="ursa-nav-link" data-view="enrollment" style="color:var(--primary);font-weight:600;display:inline-flex;align-items:center;gap:0.3rem;">
          <span>Open Enrollment Verification</span>
          <iconify-icon icon="solar:alt-arrow-right-linear"></iconify-icon>
        </a>
      </p>` : '';

    const retakesInLoad = recommended.filter(r => r.kind === 'retake').length;
    const openNote = plan.openCount
      ? ` · ${plan.openCount} course${plan.openCount === 1 ? '' : 's'} still open`
      : '';
    const ctxHtml = standing.basis === 'records'
      ? `<p class="grizz-term-ctx"><iconify-icon icon="solar:calendar-linear"></iconify-icon> Based on your records · <strong>${ord(standing.yearLevel)} Year standing</strong> · ${standing.completedUnits} of ${standing.totalUnits} units${openNote}${retakesInLoad ? ` · ${retakesInLoad} retake${retakesInLoad === 1 ? '' : 's'}` : ''}</p>`
      : `<p class="grizz-term-ctx"><iconify-icon icon="solar:calendar-linear"></iconify-icon> Nothing on record yet: starting with your earliest open courses.</p>`;
    const remUnits = remainder.reduce((sum, c) => sum + (Number(c.subject.units) || 0), 0);
    const overflowHtml = remainder.length
      ? `<p class="ursa-note-text">+ ${remainder.length} more cleared course${remainder.length === 1 ? '' : 's'} (${remUnits} units) can be added if your office allows a heavier load (Grizz already includes your earliest required courses in full).</p>`
      : '';
    const blockedHtml = blocked.length
      ? `<div class="grizz-locked">
           <p class="grizz-locked-head">Locked by prerequisites (${blocked.length})</p>
           ${blocked.slice(0, 6).map(b => `
             <div class="grizz-locked-row">
               <span class="ursa-subject-code">${esc(b.subject.code)}</span>
               <span class="grizz-locked-reason">${esc(b.reason)}</span>
             </div>`).join('')}
         </div>`
      : '';

    const html = `
      ${ctxHtml}
      <div class="ursa-summary-bar">
        <div class="ursa-summary-item">
          <span class="ursa-summary-val"><iconify-icon icon="solar:book-bookmark-linear" style="color:var(--primary);margin-right:0.3rem;vertical-align:middle;"></iconify-icon>${recommended.length} Subjects</span>
          <span class="ursa-summary-label">Recommended</span>
        </div>
        <div class="ursa-summary-divider"></div>
        <div class="ursa-summary-item">
          <span class="ursa-summary-val"><iconify-icon icon="solar:diploma-linear" style="color:var(--primary);margin-right:0.3rem;vertical-align:middle;"></iconify-icon>${totalUnits} Units</span>
          <span class="ursa-summary-label">Total Load</span>
        </div>
      </div>

      <div class="ursa-card-list">
        ${cardsHtml}
      </div>

      ${overflowHtml}
      ${blockedHtml}
      ${addAllHtml}
      ${jumpHtml}
      <p class="ursa-note-text" data-grizz-result hidden></p>
      <p class="ursa-note-text">
        Grades can be updated directly in the Academic Progress tab.
      </p>
    `;

    const msg = appendBotMessage('Recommended Subject Load', html, [
      { action: 'academic-progress', label: 'Academic Progress Tally', icon: 'solar:diploma-verified-linear' },
      { action: 'check-prereq', label: 'Check Prerequisites', icon: 'solar:branching-paths-down-linear' },
    ]);
    if (!pilot || !msg) return;

    const resultEl = msg.querySelector('[data-grizz-result]');
    const showResult = (text) => { if (resultEl) { resultEl.hidden = false; resultEl.textContent = text; } };
    const loadIds = () => window.Enrollment.draftSubjectIds?.() || new Set();

    const syncButtons = () => {
      const ids = loadIds();
      const editable = !!window.Enrollment.canEdit?.();
      msg.querySelectorAll('[data-grizz-add]').forEach(b => {
        const done = ids.has(b.dataset.grizzAdd);
        b.disabled = done || !editable;
        b.classList.toggle('added', done);
        b.innerHTML = done ? '<iconify-icon icon="solar:check-circle-bold"></iconify-icon> Added' : '<iconify-icon icon="solar:add-circle-linear"></iconify-icon> Add to Load';
      });
      const allBtn = msg.querySelector('[data-grizz-add-all]');
      if (allBtn) allBtn.disabled = !editable || recommended.every(s => ids.has(s.id));
    };

    const addOne = async (btn, subject) => {
      btn.disabled = true;
      const res = await window.Enrollment.addFromGrizz(subject, 'Recommended by Grizz')
        .catch(err => ({ ok: false, error: err.message }));
      showResult(res?.ok ? `Added ${subject.code} to your proposed load.` : (res?.error || 'Could not add the subject.'));
      syncButtons();
    };

    msg.querySelectorAll('[data-grizz-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const subject = recommended.find(s => String(s.id) === btn.dataset.grizzAdd);
        if (subject) addOne(btn, subject);
      });
    });

    msg.querySelector('[data-grizz-add-all]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const ids = loadIds();
      const pending = recommended.filter(s => !ids.has(s.id));
      let added = 0;
      let lastErr = '';
      for (const s of pending) {
        const res = await window.Enrollment.addFromGrizz(s, 'Recommended by Grizz')
          .catch(err => ({ ok: false, error: err.message }));
        if (res?.ok) added++; else lastErr = res?.error || 'request failed';
      }
      showResult(added
        ? `✓ Added ${added} subject${added === 1 ? '' : 's'} to your proposed load.` + (lastErr ? ` (${pending.length - added} failed: ${lastErr})` : '')
        : (lastErr || 'Nothing to add.'));
      syncButtons();
    });
  }

  // 2. Ask About Current Subjects
  function handleCurrentSubjects() {
    const enrolled = myUnits.filter(u => u.status === 'enrolled');

    if (enrolled.length === 0) {
      appendBotMessage(
        'Current Subjects',
        `
          <p>No subjects are currently recorded as <strong>Enrolled</strong>.</p>
          <p>Go to the <a href="#" class="ursa-nav-link" data-view="units" style="color:var(--primary);font-weight:600;">Academic Progress tab</a> to log your enrolled courses.</p>
        `,
        [
          { action: 'next-sem', label: 'View Recommendations', icon: 'solar:diploma-verified-linear' },
          { action: 'guide-logging', label: 'How to Log Subjects', icon: 'solar:question-circle-linear' },
        ]
      );
      return;
    }

    const totalUnits = enrolled.reduce((acc, u) => acc + (Number(u.subjects?.units) || 0), 0);

    const cardsHtml = enrolled.map(u => `
      <div class="ursa-subject-item">
        <div class="ursa-subject-meta">
          <span class="ursa-subject-code">${esc(u.subjects?.code || 'Subject')} <span class="ursa-units-badge">${u.subjects?.units || 0} Units</span></span>
          <span class="ursa-subject-title">${esc(u.subjects?.title || '')}</span>
        </div>
        <span class="ursa-subject-tag active">SY ${esc(u.school_year)}</span>
      </div>
    `).join('');

    const html = `
      <div class="ursa-summary-bar">
        <div class="ursa-summary-item">
          <span class="ursa-summary-val">${enrolled.length} Subjects</span>
          <span class="ursa-summary-label">Active Term</span>
        </div>
        <div class="ursa-summary-divider"></div>
        <div class="ursa-summary-item">
          <span class="ursa-summary-val">${totalUnits} Units</span>
          <span class="ursa-summary-label">Current Load</span>
        </div>
      </div>

      <div class="ursa-card-list">
        ${cardsHtml}
      </div>

      <p class="ursa-note-text">
        Passing these courses unlocks future prerequisite-dependent subjects.
      </p>
    `;

    appendBotMessage('Current Enrolled Subjects', html, [
      { action: 'next-sem', label: 'Next Sem Recommendations', icon: 'solar:diploma-verified-linear' },
      { action: 'academic-progress', label: 'Degree Progress Tally', icon: 'solar:diploma-verified-linear' },
    ]);
  }

  // 3. Academic Progress & Units
  function handleAcademicProgress() {
    const prog = profile?.course || 'BSCoE';
    const progTitle = PROGRAM_NAMES[prog] || prog;

    const req = requirements.find(r => r.program === prog) || { total_units: 189, total_subjects: 67 };
    const passed = myUnits.filter(u => u.status === 'passed');
    const passedUnits = passed.reduce((acc, u) => acc + (Number(u.subjects?.units) || 0), 0);
    const pct = Math.min(100, Math.round((passedUnits / (req.total_units || 1)) * 100));

    const failedAll = myUnits.filter(u => u.status === 'failed' || u.status === 'dropped');

    // Component Backlog (spec addendum 2026-09-08): a partial pass banks the
    // passed component's units, but the subject is not done - Grizz points
    // at the exact component to retake instead of the generic backlog line.
    const { partialPasses } = classifyPasses(myUnits);
    const partialCodes = new Set(partialPasses.keys());
    const failed = failedAll.filter(u => !partialCodes.has((u.subjects?.code || '').trim().toUpperCase()));

    let backlogNote = '';
    if (partialPasses.size > 0) {
      const componentNotes = [...partialPasses.entries()].map(([code, component]) =>
        component === 'lecture'
          ? `You passed <strong>${esc(code)}</strong> lecture — retake the lab only.`
          : `You passed <strong>${esc(code)}</strong> lab — retake the lecture only.`
      );
      backlogNote += `
        <div class="ursa-alert-box">
          <strong>Component Backlog:</strong> ${componentNotes.join(' ')}
        </div>
      `;
    }
    if (failed.length > 0) {
      backlogNote += `
        <div class="ursa-alert-box">
          <strong>Backlog Notice:</strong> You have ${failed.length} subject(s) marked as Failed or Dropped. Check your prerequisites to retake them.
        </div>
      `;
    }

    const html = `
      <div class="ursa-summary-bar">
        <div class="ursa-summary-item">
          <span class="ursa-summary-val">${passedUnits} / ${req.total_units}</span>
          <span class="ursa-summary-label">Units Passed</span>
        </div>
        <div class="ursa-summary-divider"></div>
        <div class="ursa-summary-item">
          <span class="ursa-summary-val" style="color:var(--success);">${pct}%</span>
          <span class="ursa-summary-label">Completed</span>
        </div>
      </div>

      <div class="ursa-progress-track">
        <div class="ursa-progress-fill" style="width:${pct}%;"></div>
      </div>

      ${backlogNote}
    `;

    appendBotMessage('Academic Progress Summary', html, [
      { action: 'next-sem', label: 'Recommended Load', icon: 'solar:diploma-verified-linear' },
      { action: 'current-subjects', label: 'Enrolled Subjects', icon: 'solar:book-bookmark-linear' },
    ]);
  }

  // 4. Prerequisite Checker
  function handleCheckPrerequisites() {
    const prog = profile?.course || 'BSCoE';
    const withPrereqs = subjects.filter(s => s.prerequisites && s.prerequisites !== 'None' && s.prerequisites !== '-');
    const sample = withPrereqs.slice(0, 5);

    const cardsHtml = sample.map(s => `
      <div class="ursa-subject-item">
        <div class="ursa-subject-meta">
          <span class="ursa-subject-code">${esc(s.code)} <span class="ursa-units-badge">${s.units} Units</span></span>
          <span class="ursa-subject-title">${esc(s.title)}</span>
        </div>
        <span class="ursa-subject-tag req" title="${esc(s.prerequisites)}">
          Req: ${esc(s.prerequisites)}
        </span>
      </div>
    `).join('');

    const html = `
      <p style="margin-bottom:0.65rem;color:var(--text-secondary);font-size:0.8rem;">
        Key prerequisite requirements in your curriculum:
      </p>
      
      <div class="ursa-card-list">
        ${cardsHtml}
      </div>

      <p class="ursa-note-text">
        Prerequisites are automatically evaluated when generating your recommendations.
      </p>
    `;

    appendBotMessage('Curriculum Prerequisites', html, [
      { action: 'next-sem', label: 'Get Recommendations', icon: 'solar:diploma-verified-linear' },
      { action: 'academic-progress', label: 'View Passed Units', icon: 'solar:diploma-verified-linear' },
    ]);
  }

  // 5. Financial Summary Explainer
  async function handleFinancialSummary() {
    try {
      const summary = await Api.reports.summary();
      const incomeStr = UI.currency(summary.totalIncome);
      const expenseStr = UI.currency(summary.totalExpense);
      const balanceStr = UI.currency(summary.remainingBalance);
      const reservedStr = UI.currency(summary.breakdown.reserved_envelopes);

      const html = `
        <div class="ursa-summary-bar">
          <div class="ursa-summary-item">
            <span class="ursa-summary-val" style="color:var(--success);">${incomeStr}</span>
            <span class="ursa-summary-label">Total Inflow</span>
          </div>
          <div class="ursa-summary-divider"></div>
          <div class="ursa-summary-item">
            <span class="ursa-summary-val" style="color:var(--error);">${expenseStr}</span>
            <span class="ursa-summary-label">Total Outflow</span>
          </div>
        </div>

        <div class="ursa-data-box">
          <div class="ursa-data-row">
            <span>Available Unreserved Cash:</span>
            <strong style="color:var(--primary);">${balanceStr}</strong>
          </div>
          <div class="ursa-data-row muted">
            <span>Reserved for Events:</span>
            <span>${reservedStr}</span>
          </div>
        </div>

        <p class="ursa-note-text">
          All financial figures reflect live council ledger entries.
        </p>
      `;

      appendBotMessage('COE Financial Summary', html, [
        { action: 'upcoming-events', label: 'Event Budgets', icon: 'solar:calendar-date-linear' },
        { action: 'recent-spending', label: 'Recent Expenses', icon: 'solar:card-transfer-linear' },
      ]);
    } catch (err) {
      appendBotMessage('Financial Overview', `<p>Could not fetch financial records at this time.</p>`);
    }
  }

  // 6. Upcoming Events & Budgets
  async function handleUpcomingEvents() {
    try {
      const events = await Api.events.list();
      const active = (events || []).filter(e => !e.is_archived).slice(0, 4);

      if (active.length === 0) {
        appendBotMessage('Upcoming Events', `<p>There are no active upcoming events scheduled right now.</p>`);
        return;
      }

      const cardsHtml = active.map(e => `
        <div class="ursa-subject-item">
          <div class="ursa-subject-meta">
            <span class="ursa-subject-code">${esc(e.title)}</span>
            <span class="ursa-subject-title">${UI.dateStr(e.event_date || e.created_at)}</span>
          </div>
          <span class="ursa-subject-tag active">${UI.currency(e.allocated_budget || 0)}</span>
        </div>
      `).join('');

      const html = `
        <p style="margin-bottom:0.65rem;color:var(--text-secondary);font-size:0.8rem;">
          Upcoming student activities and budget allocations:
        </p>
        <div class="ursa-card-list">
          ${cardsHtml}
        </div>
      `;

      appendBotMessage('Events & Budgets', html, [
        { action: 'financial-summary', label: 'Financial Summary', icon: 'solar:pie-chart-2-linear' },
        { action: 'recent-spending', label: 'Recent Spending', icon: 'solar:card-transfer-linear' },
      ]);
    } catch (err) {
      appendBotMessage('Upcoming Events', `<p>Could not load events list.</p>`);
    }
  }

  // 7. Recent Spending Recap
  async function handleRecentSpending() {
    try {
      const txs = await Api.transactions.list({ limit: 4 });
      const expenses = (txs || []).filter(t => t.type === 'expense');

      if (expenses.length === 0) {
        appendBotMessage('Recent Spending', `<p>No recent expense transactions found.</p>`);
        return;
      }

      const cardsHtml = expenses.map(t => `
        <div class="ursa-subject-item">
          <div class="ursa-subject-meta">
            <span class="ursa-subject-code">${esc(t.description || 'Expense')}</span>
            <span class="ursa-subject-title">${UI.dateStr(t.transaction_date)}</span>
          </div>
          <span class="ursa-subject-tag req" style="color:#F87171;">
            -${UI.currency(t.amount)}
          </span>
        </div>
      `).join('');

      const html = `
        <p style="margin-bottom:0.65rem;color:var(--text-secondary);font-size:0.8rem;">
          Latest recorded expenditures from the official ledger:
        </p>
        <div class="ursa-card-list">
          ${cardsHtml}
        </div>
      `;

      appendBotMessage('Recent Expenditures', html, [
        { action: 'financial-summary', label: 'Financial Overview', icon: 'solar:pie-chart-2-linear' },
        { action: 'upcoming-events', label: 'Upcoming Events', icon: 'solar:calendar-date-linear' },
      ]);
    } catch (err) {
      appendBotMessage('Recent Spending', `<p>Could not load recent transactions.</p>`);
    }
  }

  // 8. Guide - How to Log Units
  function handleGuideLogging() {
    const html = `
      <p style="margin-bottom:0.5rem;font-size:0.82rem;">Recording subjects in the portal:</p>
      <ol style="padding-left:1.15rem;font-size:0.8rem;line-height:1.6;margin:0 0 0.65rem 0;color:var(--text-secondary);">
        <li>Go to the <strong>Academic Progress</strong> tab.</li>
        <li>Click <strong>+ Log Subject</strong> to select a course from your curriculum.</li>
        <li>Set the <strong>School Year</strong>, <strong>Semester</strong>, and status to <strong>Passed</strong> with your grade.</li>
      </ol>
      <p class="ursa-note-text">
        Logged grades automatically update your graduation progress and recommendations.
      </p>
    `;

    appendBotMessage('Subject Logging Guide', html, [
      { action: 'next-sem', label: 'View Recommendations', icon: 'solar:diploma-verified-linear' },
      { action: 'academic-progress', label: 'Academic Progress', icon: 'solar:diploma-verified-linear' },
    ]);
  }

  // 9. Guide - Transparency & Auditing
  function handleGuideTransparency() {
    const html = `
      <ul style="padding-left:1.15rem;font-size:0.8rem;line-height:1.6;margin:0 0 0.65rem 0;color:var(--text-secondary);">
        <li><strong>Real-time Ledger:</strong> All collections, donations, and expenses are tracked with official receipt references.</li>
        <li><strong>Financial Reports:</strong> Monthly statements and activity breakdowns are accessible in the Reports tab.</li>
        <li><strong>Audit Logging:</strong> All budget transfers and modifications are logged securely.</li>
      </ul>
    `;

    appendBotMessage('Financial Transparency', html, [
      { action: 'financial-summary', label: 'Check Funds', icon: 'solar:pie-chart-2-linear' },
      { action: 'upcoming-events', label: 'Event Budgets', icon: 'solar:calendar-date-linear' },
    ]);
  }

  // 10. Financials - Collections & Inflow Breakdown
  async function handleCollectionsInflow() {
    try {
      const txs = await Api.transactions.list({ limit: 6 });
      const inflows = (txs || []).filter(t => t.type === 'collection' || t.type === 'donation' || t.type === 'income');

      if (inflows.length === 0) {
        appendBotMessage('Collections & Inflow', `<p>No recent collection or donation entries recorded in the ledger.</p>`);
        return;
      }

      const cardsHtml = inflows.slice(0, 4).map(t => `
        <div class="ursa-subject-item">
          <div class="ursa-subject-meta">
            <span class="ursa-subject-code">${esc(t.description || 'Collection')}</span>
            <span class="ursa-subject-title">${UI.dateStr(t.transaction_date)} · ${esc(t.type || 'Inflow')}</span>
          </div>
          <span class="ursa-subject-tag active" style="color:#4ADE80;">
            +${UI.currency(t.amount)}
          </span>
        </div>
      `).join('');

      const html = `
        <p style="margin-bottom:0.65rem;color:var(--text-secondary);font-size:0.8rem;">
          Latest recorded student dues, donations & incoming funds:
        </p>
        <div class="ursa-card-list">
          ${cardsHtml}
        </div>
      `;

      appendBotMessage('Collections & Inflow', html, [
        { action: 'financial-summary', label: 'Financial Summary', icon: 'solar:pie-chart-2-linear' },
        { action: 'recent-spending', label: 'Recent Expenses', icon: 'solar:card-transfer-linear' },
      ]);
    } catch (err) {
      appendBotMessage('Collections & Inflow', `<p>Could not load collection records.</p>`);
    }
  }

  // 11. Guide - Curriculum & Prerequisites Standing
  function handleGuideCurriculum() {
    const html = `
      <p style="margin-bottom:0.5rem;font-size:0.82rem;">Understanding prerequisite rules & standing:</p>
      <ul style="padding-left:1.15rem;font-size:0.8rem;line-height:1.6;margin:0 0 0.65rem 0;color:var(--text-secondary);">
        <li><strong>Prerequisites:</strong> Must be marked as <em>Passed</em> or currently <em>Enrolled</em> before taking advanced subjects.</li>
        <li><strong>Year Standing:</strong> Requires passing a specific proportion of prior year units (e.g. 3rd Year Standing).</li>
        <li><strong>Automated Audit:</strong> Grizz checks your passed grades to unlock only valid next-term subjects.</li>
      </ul>
      <p class="ursa-note-text">
        Keep your Academic Progress tracker updated each term for accurate course recommendations.
      </p>
    `;

    appendBotMessage('Curriculum & Prerequisites Guide', html, [
      { action: 'next-sem', label: 'View Recommendations', icon: 'solar:diploma-verified-linear' },
      { action: 'check-prereq', label: 'Prerequisites Check', icon: 'solar:branching-paths-down-linear' },
    ]);
  }

  // 12. Guide - Financial Reports & PDF Exporting
  function handleGuideReports() {
    const html = `
      <p style="margin-bottom:0.5rem;font-size:0.82rem;">Accessing transparency reports & exports:</p>
      <ul style="padding-left:1.15rem;font-size:0.8rem;line-height:1.6;margin:0 0 0.65rem 0;color:var(--text-secondary);">
        <li><strong>Monthly Summaries:</strong> View month-by-month inflows, expenses, and remaining balances in the <em>Reports</em> tab.</li>
        <li><strong>PDF & Excel Exports:</strong> Export certified audit sheets and expense breakdowns anytime.</li>
        <li><strong>Receipt Verification:</strong> Every transaction is backed by reference codes and official vouchers.</li>
      </ul>
    `;

    appendBotMessage('Financial Reports & Exports Guide', html, [
      { action: 'financial-summary', label: 'View Funds', icon: 'solar:pie-chart-2-linear' },
      { action: 'guide-transparency', label: 'Transparency Policy', icon: 'solar:shield-check-linear' },
    ]);
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  return {
    init,
    open,
    close,
    handleAction,
    renderDashboardWidget,
    setProfile,
    loadData,
  };
})();

// Provide aliases for global access
window.GrizzAI = GrizzAI;
window.UrsaAI = GrizzAI;
