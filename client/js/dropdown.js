// =============================================
// dropdown.js - Custom animated dropdowns
//
// Shared by the main system and the Executive Portal so both open with the
// same staggered-menu animation. Replaces a native <select> with an animating
// listbox while keeping the original <select> in the DOM (hidden) as the
// single source of truth, so existing submit handlers, change listeners, and
// form resets keep working unchanged. The menu is rebuilt on every open, so
// selects whose options are populated dynamically (event pickers, transfer
// source/target) always show the current option set.
// =============================================

const Dropdowns = (() => {

  const bound = [];

  function bindDropdown(select) {
    if (!select || select.dataset.ddBound) return;
    select.dataset.ddBound = '1';

    const wrap = select.closest('.input-icon-wrap');
    const dd = document.createElement('div');
    dd.className = 'dd' + (wrap ? '' : ' dd-system');
    // Filter-bar selects size themselves via inline min-width; carry it over
    if (!wrap && select.style.minWidth) dd.style.minWidth = select.style.minWidth;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dd-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const label = document.createElement('span');
    label.className = 'dd-label';

    const chevron = document.createElement('i');
    chevron.innerHTML = '<iconify-icon icon="solar:alt-arrow-down-linear"></iconify-icon>';
    chevron.className = 'dd-chevron';

    trigger.append(label, chevron);

    const menu = document.createElement('ul');
    menu.className = 'dd-menu';
    menu.setAttribute('role', 'listbox');

    function buildMenu() {
      menu.innerHTML = '';
      [...select.options].forEach((opt, i) => {
        const li = document.createElement('li');
        li.textContent = opt.text;
        if (opt.style?.color) li.style.color = opt.style.color;
        li.dataset.index = i;
        li.setAttribute('role', 'option');
        li.addEventListener('click', () => {
          // Disabled placeholder option - clicking it just dismisses the menu
          if (opt.disabled) { close(); return; }
          select.selectedIndex = i;
          sync();
          markSelected();
          select.dispatchEvent(new Event('change', { bubbles: true }));
          close();
        });
        menu.appendChild(li);
      });
    }

    // Clicking the menu's empty padding dismisses it instead of reaching a
    // covered field below, so a stray click can't accidentally pick an option.
    menu.addEventListener('click', e => {
      if (e.target === menu) close();
    });

    function sync() {
      const opt = select.options[select.selectedIndex];
      const hasValue = opt && opt.value;
      // Empty selects (options populated later) just show a blank label
      label.textContent = hasValue ? opt.text : select.options[0]?.text ?? '';
      label.classList.toggle('dd-placeholder', !hasValue);
    }

    function markSelected() {
      menu.querySelectorAll('li').forEach(li => {
        li.classList.toggle('dd-selected', Number(li.dataset.index) === select.selectedIndex);
      });
    }

    // Tallest the menu may grow before it scrolls (about eight options), so
    // short lists never clip their last option behind a scrollbar.
    const MENU_MAX = 320;
    const GAP = 6;     // trigger-to-menu gap
    const EDGE = 8;    // minimum distance from any viewport edge

    // Fixed mobile bars sit over the viewport bottom; the menu must stop above
    // them. The bars auto-hide on scroll (slid off with a transform) and slide
    // back, so reserve their resting position, not their current animated one.
    function viewportBottom() {
      let bottom = window.innerHeight;
      document.querySelectorAll('#bottom-nav, #of-bottom-nav').forEach(nav => {
        const cs = getComputedStyle(nav);
        if (cs.display === 'none' || cs.position !== 'fixed' || !nav.offsetHeight) return;
        const restingTop = window.innerHeight - (parseFloat(cs.bottom) || 0) - nav.offsetHeight;
        if (restingTop > window.innerHeight / 2) bottom = Math.min(bottom, restingTop);
      });
      return bottom;
    }

    // position:fixed is relative to the viewport only when no ancestor has a
    // transform / will-change: transform / filter. The animated views do, so a
    // "fixed" menu is really positioned against the view box (shifted by the
    // sidebar and by the view's own offset). Measure that box's origin with a
    // zero-size fixed probe beside the menu and subtract it.
    function fixedOrigin() {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;';
      dd.appendChild(probe);
      const r = probe.getBoundingClientRect();
      probe.remove();
      return { x: r.left, y: r.top };
    }

    function positionMenu() {
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const origin = fixedOrigin();

      // Width: at least the trigger, wide enough for the longest option,
      // never wider than the viewport. Measured before placing.
      menu.style.position = 'fixed';
      menu.style.right = 'auto';
      menu.style.bottom = 'auto';
      menu.style.minWidth = `${Math.min(rect.width, viewportWidth - EDGE * 2)}px`;
      menu.style.maxWidth = `${viewportWidth - EDGE * 2}px`;
      menu.style.width = 'max-content';
      menu.style.maxHeight = 'none';
      // ceil: a sub-pixel shortfall would wrap the longest option
      const width = Math.min(Math.ceil(Math.max(menu.offsetWidth, rect.width)) + 1, viewportWidth - EDGE * 2);
      // Border-box sizing: max-height includes the borders, scrollHeight does not
      const contentHeight = menu.scrollHeight + (menu.offsetHeight - menu.clientHeight);

      let left = Math.max(EDGE, rect.left);
      if (left + width > viewportWidth - EDGE) left = Math.max(EDGE, viewportWidth - width - EDGE);
      menu.style.width = `${width}px`;
      menu.style.zIndex = '999999';

      // Height: open toward the side that fits the whole list; otherwise the
      // side with more room, capped so it never runs under a fixed bar.
      const desired = Math.min(contentHeight, MENU_MAX);
      const spaceBelow = viewportBottom() - rect.bottom - GAP - EDGE;
      const spaceAbove = rect.top - GAP - EDGE;
      const openUp = spaceBelow < desired && spaceAbove > spaceBelow;
      const height = Math.max(Math.min(desired, openUp ? spaceAbove : spaceBelow), 80);
      menu.style.maxHeight = `${height}px`;

      // Anchor by top in both directions (bottom would resolve against the
      // transformed ancestor's height, not the viewport).
      const top = openUp ? rect.top - GAP - height : rect.bottom + GAP;
      menu.style.left = `${left - origin.x}px`;
      menu.style.top = `${top - origin.y}px`;
      dd.classList.toggle('dd-up', openUp);
    }

    function open() {
      buildMenu(); // rebuild so dynamically-added options appear
      // Mark before measuring: the selected option is bold (wider), and
      // measuring first let it wrap to two lines and push the list into scroll.
      markSelected();
      positionMenu();
      dd.classList.add('dd-open');
      trigger.setAttribute('aria-expanded', 'true');
      // Long lists scroll: bring the current choice into view inside the menu
      const sel = menu.querySelector('.dd-selected');
      if (sel && menu.scrollHeight > menu.clientHeight) {
        menu.scrollTop = Math.max(0, sel.offsetTop - (menu.clientHeight - sel.offsetHeight) / 2);
      }
    }

    function close() {
      dd.classList.remove('dd-open');
      trigger.setAttribute('aria-expanded', 'false');
    }

    function pick(index) {
      if (index >= 0 && index < select.options.length) {
        select.selectedIndex = index;
        sync();
        markSelected();
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    trigger.addEventListener('click', e => {
      // No stopPropagation: letting this bubble to the document-level
      // listener closes any other open dropdown, so menus never overlap.
      if (dd.classList.contains('dd-open')) close();
      else open();
    });

    trigger.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); trigger.focus(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        pick(select.selectedIndex + (e.key === 'ArrowDown' ? 1 : -1));
      }
    });

    document.addEventListener('click', e => {
      if (!dd.contains(e.target) && !menu.contains(e.target)) close();
    });

    document.addEventListener('touchstart', e => {
      if (!dd.contains(e.target) && !menu.contains(e.target)) close();
    }, { passive: true });

    window.addEventListener('scroll', e => {
      if (!dd.classList.contains('dd-open')) return;
      // Do NOT close if scrolling inside the dropdown choices list itself!
      if (e.target === menu || (e.target && menu.contains(e.target))) return;
      positionMenu();
    }, { capture: true, passive: true });

    window.addEventListener('resize', () => {
      if (dd.classList.contains('dd-open')) positionMenu();
    }, { passive: true });

    dd.append(trigger, menu);
    if (wrap) wrap.insertBefore(dd, select);
    else select.parentNode.insertBefore(dd, select);
    select.style.display = 'none';
    wrap?.querySelector('.input-icon-right')?.remove();

    sync();
    // Keep the label truthful when a form reset clears the hidden select.
    const form = select.closest('form');
    if (form) form.addEventListener('reset', sync);

    bound.push({ sync });
  }

  function bindAll(rootSelector) {
    document.querySelectorAll(`${rootSelector} select`).forEach(bindDropdown);
  }

  function syncAll() {
    bound.forEach(d => d.sync());
  }

  return { bindDropdown, bindAll, syncAll };
})();

// Module build (Vite): the page scripts are ES modules, so this namespace is
// published on window for the other scripts and the HTML to reach it.
window.Dropdowns = Dropdowns;
