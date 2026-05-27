// Skybox Global client shim. Injected into every cloned page.
// - Makes the homepage Flights/Hotels/Cars tabs navigate (they're
//   search-form-mode toggles in the original).
// - Cookie consent banner (essential-only by default).
// - Initial reroute: if we landed on a /transport/flights/... URL we don't
//   actually mirror, send to the flights landing page.

(function () {
  'use strict';
  if (window.__skyboxAppLoaded) return;
  window.__skyboxAppLoaded = true;

  // Hide Stays/Hotels and Cars tabs across the cloned UI. CSS-only — does
  // not touch any captured HTML. Targets the BPK tab list buttons by their
  // accessible title attribute.
  (function injectHideCSS() {
    const css = [
      'button[role="tab"][title="Stays"],',
      'button[role="tab"][title="Hotels"],',
      'button[role="tab"][title="Cars"],',
      'a[href="/hotels"][class*="tab"],',
      'a[href="/car-rental"][class*="tab"],',
      'a[href="/carhire"][class*="tab"]',
      '{ display: none !important; }',
    ].join(' ');
    const tag = document.createElement('style');
    tag.id = 'sb-hide-verticals';
    tag.textContent = css;
    (document.head || document.documentElement).appendChild(tag);
  })();

  function log() {
    try { console.log.apply(console, ['[skybox]'].concat([].slice.call(arguments))); } catch (_) {}
  }

  // Homepage tabs: navigate to vertical landing pages.
  const HOMEPAGE_TAB_TARGETS = { Flights: '/flights', Hotels: '/hotels', Cars: '/car-rental' };
  document.addEventListener('click', function (ev) {
    if (location.pathname !== '/') return;
    const btn = ev.target.closest && ev.target.closest('button[role="tab"][title]');
    if (!btn) return;
    const target = HOMEPAGE_TAB_TARGETS[btn.getAttribute('title')];
    if (!target) return;
    if (btn.getAttribute('aria-selected') === 'true') return;
    log('homepage tab nav', btn.getAttribute('title'), '->', target);
    setTimeout(() => { location.href = target; }, 0);
  }, true);

  // Modal close button fallback. The captured React handler doesn't always
  // fire in the static clone, so we manually find the closest modal
  // container and hide it. Also wires Escape and backdrop click.
  function closestModal(el) {
    // Walk all ancestors and pick the OUTERMOST one matching a modal pattern
    // so nested dialog wrappers all collapse together.
    let outer = null;
    for (let n = el; n; n = n.parentElement) {
      if (!(n instanceof Element)) continue;
      const role = n.getAttribute && n.getAttribute('role');
      const cls = (n.className && typeof n.className === 'string') ? n.className : '';
      if (role === 'dialog' || /bpk-modal|\bModal\b|\bmodal\b/.test(cls)) outer = n;
    }
    return outer;
  }
  function dismissModal(_anchor) {
    // The captured app renders modals as a stack of sibling elements
    // (overlay + backdrop + scroll container + dialog). Hide every
    // currently-visible modal-ish element in one pass.
    const sel = [
      '[role="dialog"]',
      '[class*="bpk-modal"]',
      '[class*="Modal"]',
      '[class*="backdrop"]', '[class*="Backdrop"]',
      '[class*="overlay"]', '[class*="Overlay"]',
      '[class*="scrim"]', '[class*="Scrim"]',
    ].join(',');
    let hidden = 0;
    document.querySelectorAll(sel).forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      // Only target absolutely/fixed positioned overlays so we don't hide
      // inline page content that happens to match "modal" in a class name.
      const isOverlayPositioned = cs.position === 'fixed' || cs.position === 'absolute';
      const isDialog = el.getAttribute('role') === 'dialog' || /bpk-modal|\bModal\b/.test(el.className || '');
      if (!isDialog && !isOverlayPositioned) return;
      el.style.setProperty('display', 'none', 'important');
      el.setAttribute('aria-hidden', 'true');
      hidden++;
    });
    // Restore body scroll if React locked it.
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.documentElement.classList.remove('bpk-no-scroll', 'bpk-scrollable-bg');
    document.body.classList.remove('bpk-no-scroll', 'bpk-scrollable-bg');
    return hidden > 0;
  }
  document.addEventListener('click', function (ev) {
    const closeBtn = ev.target.closest && ev.target.closest(
      'button[aria-label="Close modal" i], button[aria-label="Close" i], button[title="Close" i], ' +
      'button[aria-label*="close" i], [data-testid*="close" i], [class*="navigation-button--close"] button'
    );
    if (closeBtn) {
      const modal = closestModal(closeBtn);
      if (modal && dismissModal(modal)) {
        ev.preventDefault();
        ev.stopPropagation();
        log('modal closed via X button');
      }
      return;
    }
    // Backdrop click: clicking on the dialog overlay (not its inner content) closes.
    const t = ev.target;
    if (t && t.matches && t.matches('[role="dialog"]')) {
      // Only dismiss when clicking the dialog *itself*, not its descendants.
      if (ev.target === ev.currentTarget || ev.target === t) {
        dismissModal(t);
      }
    }
  }, true);
  // Escape key closes the topmost modal.
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    const modals = Array.from(document.querySelectorAll('[role="dialog"]:not([aria-hidden="true"]), [class*="bpk-modal"]'));
    const visible = modals.filter((m) => {
      const cs = getComputedStyle(m);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    });
    if (visible.length) {
      dismissModal(visible[visible.length - 1]);
      log('modal closed via Escape');
    }
  });

  // Cookie consent.
  function readConsent() { try { return JSON.parse(localStorage.getItem('sb_consent') || 'null'); } catch { return null; } }
  function writeConsent(v) { try { localStorage.setItem('sb_consent', JSON.stringify(v)); } catch {} }
  if (!readConsent()) {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.getElementById('sb-consent')) return;
      const el = document.createElement('div');
      el.id = 'sb-consent';
      el.setAttribute('role', 'dialog');
      el.innerHTML = [
        '<style>',
        '#sb-consent{position:fixed;bottom:16px;left:16px;right:16px;max-width:560px;margin:0 auto;',
        'background:#05203c;color:#fff;padding:14px 18px;border-radius:8px;',
        'box-shadow:0 6px 24px rgba(0,0,0,.25);font-family:"Skyscanner Relative",-apple-system,sans-serif;',
        'font-size:13px;z-index:2147483600;display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
        '#sb-consent .copy{flex:1;min-width:200px;line-height:1.5}',
        '#sb-consent a{color:#7ec1ff}',
        '#sb-consent button{padding:8px 14px;border-radius:18px;border:0;cursor:pointer;font:inherit;font-weight:700;font-size:12px}',
        '#sb-consent .accept{background:#fff;color:#05203c}',
        '#sb-consent .reject{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4)}',
        '</style>',
        '<div class="copy">We use a sign-in cookie (required). Optional analytics help us improve Skybox Global — your choice.</div>',
        '<button class="reject" data-v="essential">Essential only</button>',
        '<button class="accept" data-v="all">Accept all</button>',
      ].join('');
      document.body.appendChild(el);
      el.addEventListener('click', (ev) => {
        const b = ev.target.closest && ev.target.closest('button[data-v]');
        if (!b) return;
        writeConsent({ analytics: b.dataset.v === 'all', at: new Date().toISOString() });
        el.remove();
      });
    });
  }

  // Initial reroute for unmirrored /transport/flights/... paths.
  (function checkInitial() {
    if (/^\/transport\/flights\//.test(location.pathname)) {
      location.replace('/flights');
    }
  })();

  // ----------- Flight search interceptor -----------
  // Read the captured Skyscanner form's DOM values, resolve airports via
  // /skybox-api/places (Duffel suggestions), then navigate to our Duffel-
  // backed /flights/search results page.
  async function resolveToIata(value) {
    if (!value) return null;
    const v = value.trim();
    if (/^[A-Z]{3}$/.test(v.toUpperCase()) && v.length === 3) return v.toUpperCase();
    try {
      const r = await fetch('/skybox-api/places?q=' + encodeURIComponent(v));
      const j = await r.json();
      const places = j.places || [];
      const ap = places.find((p) => p.type === 'airport' && p.iata) || places.find((p) => p.iata);
      return ap ? ap.iata : null;
    } catch { return null; }
  }
  function readDate(btn) {
    if (!btn) return null;
    const v = btn.querySelector('[class*="_value_"]')?.textContent?.trim() || '';
    const m = v.match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  function readTravellers(btn) {
    if (!btn) return { adults: 1, children: 0, infants: 0, cabin: 'economy' };
    const v = btn.querySelector('[class*="_value_"]')?.textContent?.trim() || '';
    const adults = parseInt((v.match(/(\d+)\s*Adult/i) || [, '1'])[1], 10) || 1;
    const children = parseInt((v.match(/(\d+)\s*Child/i) || [, '0'])[1], 10) || 0;
    const infants = parseInt((v.match(/(\d+)\s*Infant/i) || [, '0'])[1], 10) || 0;
    let cabin = 'economy';
    if (/business/i.test(v)) cabin = 'business';
    else if (/first/i.test(v)) cabin = 'first';
    else if (/premium/i.test(v)) cabin = 'premium_economy';
    return { adults, children, infants, cabin };
  }
  function isOneWay() {
    const tt = document.querySelector('[aria-label*="Select trip type"]');
    if (!tt) return false;
    return /one[\s-]?way/i.test(tt.textContent || '');
  }
  // (Old search-click handler removed — superseded by the state-driven
  // handler defined later in this file, which reads from Skybox state and
  // doesn't trip on labeled values like "YOW — Ottawa".)

  // ----------- Origin / destination autocomplete -----------
  function attachAutocomplete(inputSel, menuSel) {
    const input = document.querySelector(inputSel);
    const menu = document.querySelector(menuSel);
    if (!input || !menu) return false;
    let lastQuery = '';
    let items = [];
    async function fetchSuggestions(q) {
      if (q.length < 2 || q === lastQuery) return;
      lastQuery = q;
      try {
        const r = await fetch('/skybox-api/places?q=' + encodeURIComponent(q));
        const j = await r.json();
        items = (j.places || []).filter((p) => p.iata).slice(0, 8);
        render();
      } catch {}
    }
    function render() {
      menu.innerHTML = items.map((p) => `<li role="option" data-iata="${p.iata}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #eef0f3"><div style="font-weight:600;color:#05203c;font-size:14px">${(p.name || '').replace(/</g,'&lt;')} <span style="color:#545860;font-weight:400">(${p.iata})</span></div><div style="color:#545860;font-size:12px">${[p.city, p.country].filter(Boolean).join(' · ')} · ${p.type || ''}</div></li>`).join('');
      menu.style.cssText = items.length ? 'background:#fff;border:1px solid #dadce0;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.08);max-height:320px;overflow-y:auto;z-index:1000;position:absolute;width:' + (input.offsetWidth + 'px') + ';list-style:none;padding:4px 0;margin:4px 0 0' : '';
    }
    function select(p) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, p.iata + ' — ' + (p.name || p.city || ''));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      items = []; render();
    }
    input.addEventListener('input', () => fetchSuggestions(input.value.trim()));
    menu.addEventListener('mousedown', (e) => { const li = e.target.closest && e.target.closest('li[data-iata]'); if (li) { e.preventDefault(); const p = items.find((x) => x.iata === li.dataset.iata); if (p) select(p); } });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== input) { items = []; render(); } });
    return true;
  }
  let acTries = 0;
  const acInt = setInterval(() => {
    acTries++;
    const ok = attachAutocomplete('#originInput-input', '#originInput-menu') && attachAutocomplete('#destinationInput-input', '#destinationInput-menu');
    if (ok || acTries > 40) clearInterval(acInt);
  }, 300);

  // ===================================================================
  // Skybox state machine + popovers — bypass React handlers entirely.
  // Keeps the captured UI visually unchanged; intercepts every form
  // interaction and routes it through our own logic + Duffel.
  // ===================================================================
  const SB = window.__SB_STATE = {
    from: '', fromLabel: '',
    to: '', toLabel: '',
    depart: '', ret: '',
    tripType: 'return',
    adults: 1, children: 0, infants: 0,
    cabin: 'economy',
  };

  // Stylesheet for our popovers (Skybox-native, BPK-styled).
  (function injectPopoverCSS() {
    if (document.getElementById('sb-popover-css')) return;
    const s = document.createElement('style');
    s.id = 'sb-popover-css';
    s.textContent = `
      .sb-pop { position: absolute; z-index: 2147483600; background: #fff; border: 1px solid #dadce0;
        border-radius: 8px; box-shadow: 0 8px 28px rgba(0,0,0,.18); padding: 16px; min-width: 280px;
        font-family: "Skyscanner Relative",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        color: #05203c; font-size: 14px; }
      .sb-pop h4 { margin: 0 0 10px; font-size: 13px; text-transform: uppercase; color: #545860; letter-spacing: .5px; }
      .sb-pop label { display:block; font-size:12px; color:#545860; margin-bottom:4px; }
      .sb-pop input[type="date"], .sb-pop select { width: 100%; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 4px; font: inherit; box-sizing: border-box; }
      .sb-pop .row { display:flex; justify-content:space-between; align-items:center; padding:6px 0; }
      .sb-pop .stepper { display:inline-flex; align-items:center; gap:8px; }
      .sb-pop .stepper button { width: 28px; height: 28px; border-radius: 50%; border: 1px solid #0062e3; background: #fff; color: #0062e3; cursor: pointer; font-size: 16px; font-weight: 700; line-height: 1; }
      .sb-pop .stepper button[disabled] { color: #a3b1c4; border-color: #dadce0; cursor: not-allowed; }
      .sb-pop .stepper .val { min-width: 18px; text-align: center; font-weight: 700; }
      .sb-pop .footer { display:flex; gap:8px; margin-top:12px; justify-content:flex-end; }
      .sb-pop .btn { padding: 6px 16px; border: 0; border-radius: 16px; background: #0062e3; color: #fff; font-weight: 700; cursor: pointer; font-size: 13px; }
      .sb-pop .btn.ghost { background: transparent; color: #0062e3; border: 1px solid #dadce0; }
    `;
    document.head.appendChild(s);
  })();

  function dismissPopovers(except) {
    document.querySelectorAll('.sb-pop').forEach((p) => { if (p !== except) p.remove(); });
  }
  function placePopover(pop, anchor) {
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const top = window.scrollY + r.bottom + 6;
    let left = window.scrollX + r.left;
    const popW = Math.min(pop.offsetWidth || 320, window.innerWidth - 24);
    if (left + popW > window.scrollX + window.innerWidth - 12) left = window.scrollX + window.innerWidth - popW - 12;
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest || !ev.target.closest('.sb-pop')) dismissPopovers();
  }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') dismissPopovers(); });

  // ---------------- Calendar date popover ----------------
  // Renders two months side-by-side. First click picks depart, second click
  // (after depart) picks return. One-way checkbox hides the return field.
  const SB_DOW = ['Mo','Tu','We','Th','Fr','Sa','Su'];
  const SB_MONTH = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  function isoDate(d) { return d.toISOString().slice(0,10); }
  function parseIso(s) { if (!s) return null; const [y,m,d] = s.split('-').map(Number); return new Date(Date.UTC(y, m-1, d)); }
  function startOfMonthUTC(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
  function addMonthsUTC(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); }

  function renderMonth(monthDate, state) {
    const y = monthDate.getUTCFullYear(), m = monthDate.getUTCMonth();
    const firstDay = new Date(Date.UTC(y, m, 1));
    // Convert JS Sun=0..Sat=6 → Mo=0..Su=6.
    const startCol = (firstDay.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const today = isoDate(new Date());
    let cells = '';
    for (let i = 0; i < startCol; i++) cells += '<div class="sb-cal-cell"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoDate(new Date(Date.UTC(y, m, d)));
      const past = iso < today;
      const isDep = iso === state.depart;
      const isRet = iso === state.ret;
      const inRange = state.depart && state.ret && iso > state.depart && iso < state.ret;
      const classes = ['sb-cal-cell','sb-cal-day'];
      if (past) classes.push('past');
      if (isDep) classes.push('selected sb-dep');
      if (isRet) classes.push('selected sb-ret');
      if (inRange) classes.push('inrange');
      cells += `<div class="${classes.join(' ')}" ${past ? '' : `data-iso="${iso}"`}>${d}</div>`;
    }
    return `<div class="sb-cal-month"><div class="sb-cal-header">${SB_MONTH[m]} ${y}</div>
      <div class="sb-cal-grid sb-cal-dow">${SB_DOW.map(d => `<div class="sb-cal-cell sb-cal-dow-cell">${d}</div>`).join('')}</div>
      <div class="sb-cal-grid">${cells}</div></div>`;
  }

  function openDatePopover(anchor, which /* 'depart' | 'ret' */) {
    dismissPopovers();
    // Inject calendar styles once.
    if (!document.getElementById('sb-cal-css')) {
      const s = document.createElement('style');
      s.id = 'sb-cal-css';
      s.textContent = `
        .sb-cal-pop { min-width: 660px; max-width: 95vw; }
        @media (max-width: 720px) { .sb-cal-pop { min-width: 320px; } .sb-cal-months { grid-template-columns: 1fr !important; } }
        .sb-cal-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .sb-cal-nav button { width: 32px; height: 32px; border-radius: 50%; border: 1px solid #dadce0; background: #fff; cursor: pointer; font-size: 16px; line-height: 1; }
        .sb-cal-nav button[disabled] { color: #c2c9cd; border-color: #eef0f3; cursor: not-allowed; }
        .sb-cal-months { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        .sb-cal-month .sb-cal-header { text-align: center; font-weight: 700; margin-bottom: 8px; }
        .sb-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); }
        .sb-cal-cell { aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 14px; }
        .sb-cal-dow-cell { font-size: 11px; color: #545860; font-weight: 700; text-transform: uppercase; aspect-ratio: auto; padding: 4px 0; }
        .sb-cal-day { cursor: pointer; border-radius: 50%; transition: background .08s; }
        .sb-cal-day:hover { background: #eef5ff; }
        .sb-cal-day.past { color: #c2c9cd; cursor: not-allowed; }
        .sb-cal-day.past:hover { background: transparent; }
        .sb-cal-day.selected { background: #0062e3 !important; color: #fff; font-weight: 700; }
        .sb-cal-day.inrange { background: #eef5ff; border-radius: 0; }
        .sb-cal-footer { display:flex; align-items:center; gap:10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid #eef0f3; }
        .sb-cal-footer .sb-cal-status { color: #545860; font-size: 13px; flex: 1; }
        .sb-cal-footer label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
      `;
      document.head.appendChild(s);
    }
    const pop = document.createElement('div');
    pop.className = 'sb-pop sb-cal-pop';
    // Working copy of state — only commits on Apply.
    const cal = {
      cursor: startOfMonthUTC(SB.depart ? parseIso(SB.depart) : new Date()),
      depart: SB.depart || '',
      ret: SB.ret || '',
      oneway: SB.tripType === 'oneway',
    };
    function paint() {
      const second = addMonthsUTC(cal.cursor, 1);
      const todayMonth = startOfMonthUTC(new Date());
      const prevDisabled = cal.cursor.getTime() <= todayMonth.getTime();
      pop.innerHTML = `
        <div class="sb-cal-nav">
          <button type="button" id="sb-cal-prev" ${prevDisabled ? 'disabled' : ''}>‹</button>
          <div style="font-weight:700">Pick your dates</div>
          <button type="button" id="sb-cal-next">›</button>
        </div>
        <div class="sb-cal-months">${renderMonth(cal.cursor, cal)}${cal.oneway ? '' : renderMonth(second, cal)}</div>
        <div class="sb-cal-footer">
          <label><input type="checkbox" id="sb-cal-oneway" ${cal.oneway ? 'checked' : ''}> One way</label>
          <div class="sb-cal-status" id="sb-cal-status"></div>
          <button type="button" class="btn ghost" id="sb-cal-cancel">Cancel</button>
          <button type="button" class="btn" id="sb-cal-apply">Apply</button>
        </div>`;
      // Status line.
      const fmt = (d) => { if (!d) return ''; const x = parseIso(d); return x.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }); };
      const status = pop.querySelector('#sb-cal-status');
      if (cal.oneway) status.textContent = cal.depart ? 'Depart: ' + fmt(cal.depart) : 'Pick a departure date';
      else if (!cal.depart) status.textContent = 'Pick your departure date';
      else if (!cal.ret) status.textContent = 'Depart: ' + fmt(cal.depart) + ' · Pick your return date';
      else status.textContent = fmt(cal.depart) + '  →  ' + fmt(cal.ret);
      // Wire interactions
      pop.querySelector('#sb-cal-prev').addEventListener('click', () => { if (!prevDisabled) { cal.cursor = addMonthsUTC(cal.cursor, -1); paint(); } });
      pop.querySelector('#sb-cal-next').addEventListener('click', () => { cal.cursor = addMonthsUTC(cal.cursor, 1); paint(); });
      pop.querySelector('#sb-cal-oneway').addEventListener('change', (e) => { cal.oneway = e.target.checked; if (cal.oneway) cal.ret = ''; paint(); });
      pop.querySelector('#sb-cal-cancel').addEventListener('click', () => pop.remove());
      pop.querySelector('#sb-cal-apply').addEventListener('click', () => {
        if (!cal.depart) { alert('Please pick a departure date.'); return; }
        SB.depart = cal.depart;
        if (cal.oneway) { SB.tripType = 'oneway'; SB.ret = ''; }
        else { SB.tripType = 'return'; SB.ret = cal.ret || ''; }
        writeBackDateButtons();
        writeBackTripChip();
        pop.remove();
      });
      pop.querySelectorAll('.sb-cal-day[data-iso]').forEach((cell) => {
        cell.addEventListener('click', () => {
          const iso = cell.dataset.iso;
          if (cal.oneway) { cal.depart = iso; paint(); return; }
          // Two-stage: depart not set → set depart; depart set + click before depart → reset; click ≥ depart → set return.
          if (!cal.depart || iso < cal.depart || (cal.depart && cal.ret)) {
            cal.depart = iso; cal.ret = '';
          } else if (iso >= cal.depart) {
            cal.ret = iso;
          }
          paint();
        });
      });
    }
    document.body.appendChild(pop); // placePopover needs it in DOM for width
    placePopover(pop, anchor);
    paint();
  }
  function writeBackDateButtons() {
    const fmt = (d) => { if (!d) return ''; const x = parseIso(d); return x.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }); };
    function setBtnText(btn, label, value) {
      if (!btn) return;
      // The captured button has either a _value_ or _placeholder_ span. Swap
      // placeholder out for a value span so the date renders in primary text.
      let v = btn.querySelector('[class*="_value_"]');
      const ph = btn.querySelector('[class*="_placeholder_"]');
      if (value && !v && ph) {
        v = document.createElement('span');
        v.className = 'BpkText_bpk-text BpkText_bpk-text--body-default _value_4usaq_222';
        v.style.cssText = 'color:#05203c;font-weight:600';
        ph.replaceWith(v);
      }
      if (v) v.textContent = value || '';
      else if (ph) ph.textContent = value || label;
    }
    const dB = document.querySelector('[data-testid="depart-btn"]');
    const rB = document.querySelector('[data-testid="return-btn"]');
    setBtnText(dB, 'Add date', SB.depart ? fmt(SB.depart) : '');
    setBtnText(rB, 'Add date', SB.tripType === 'oneway' ? 'One way' : (SB.ret ? fmt(SB.ret) : ''));
  }

  // ---------------- Traveller picker popover ----------------
  function openTravellerPopover(anchor) {
    dismissPopovers();
    const pop = document.createElement('div');
    pop.className = 'sb-pop';
    pop.style.minWidth = '320px';
    function row(label, sub, key, min, max) {
      return `<div class="row">
        <div><div style="font-weight:600">${label}</div><div style="font-size:12px;color:#545860">${sub}</div></div>
        <div class="stepper">
          <button type="button" data-action="dec" data-key="${key}" ${SB[key] <= min ? 'disabled' : ''}>−</button>
          <span class="val" data-val="${key}">${SB[key]}</span>
          <button type="button" data-action="inc" data-key="${key}" ${SB[key] >= max ? 'disabled' : ''}>+</button>
        </div>
      </div>`;
    }
    pop.innerHTML = `
      <h4>Travellers &amp; cabin</h4>
      ${row('Adults', '16+ years', 'adults', 1, 9)}
      ${row('Children', '2–15 years', 'children', 0, 8)}
      ${row('Infants', 'Under 2', 'infants', 0, 4)}
      <div style="margin-top:10px">
        <label>Cabin class</label>
        <select id="sb-cabin">
          <option value="economy">Economy</option>
          <option value="premium_economy">Premium economy</option>
          <option value="business">Business</option>
          <option value="first">First</option>
        </select>
      </div>
      <div class="footer">
        <button type="button" class="btn ghost" id="sb-cancel">Cancel</button>
        <button type="button" class="btn" id="sb-apply">Done</button>
      </div>`;
    placePopover(pop, anchor);
    pop.querySelector('#sb-cabin').value = SB.cabin;
    pop.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button[data-action]');
      if (!b) return;
      const key = b.dataset.key;
      const delta = b.dataset.action === 'inc' ? 1 : -1;
      const limits = { adults: [1, 9], children: [0, 8], infants: [0, 4] };
      const [min, max] = limits[key];
      SB[key] = Math.max(min, Math.min(max, SB[key] + delta));
      const val = pop.querySelector(`[data-val="${key}"]`);
      if (val) val.textContent = SB[key];
      pop.querySelector(`button[data-action="dec"][data-key="${key}"]`).disabled = SB[key] <= min;
      pop.querySelector(`button[data-action="inc"][data-key="${key}"]`).disabled = SB[key] >= max;
    });
    pop.querySelector('#sb-cancel').addEventListener('click', () => pop.remove());
    pop.querySelector('#sb-apply').addEventListener('click', () => {
      SB.cabin = pop.querySelector('#sb-cabin').value;
      writeBackTravellerButton();
      pop.remove();
    });
  }
  function writeBackTravellerButton() {
    const v = document.querySelector('[data-testid="traveller-button"] [class*="_value_"]');
    if (!v) return;
    const parts = [`${SB.adults} Adult${SB.adults !== 1 ? 's' : ''}`];
    if (SB.children) parts.push(`${SB.children} Child${SB.children !== 1 ? 'ren' : ''}`);
    if (SB.infants) parts.push(`${SB.infants} Infant${SB.infants !== 1 ? 's' : ''}`);
    const cabinLabel = { economy:'Economy', premium_economy:'Premium economy', business:'Business', first:'First' }[SB.cabin];
    v.textContent = parts.join(', ') + ', ' + cabinLabel;
  }

  // ---------------- Origin / destination overlay popover ----------------
  // The captured React input often resets the typed value. We open our own
  // input overlay positioned over the original so the user types into ours
  // and we control the autocomplete dropdown.
  function openPlacePopover(anchor, which /* 'from' | 'to' */) {
    dismissPopovers();
    const pop = document.createElement('div');
    pop.className = 'sb-pop';
    pop.style.minWidth = Math.max(anchor.offsetWidth, 320) + 'px';
    pop.innerHTML = `
      <h4>${which === 'from' ? 'From' : 'To'}</h4>
      <input type="text" id="sb-place-input" value="${SB[which + 'Label'] || ''}" placeholder="City or airport" autocomplete="off"
             style="width:100%;padding:10px 12px;border:1px solid #dadce0;border-radius:6px;font:inherit;box-sizing:border-box">
      <ul id="sb-place-list" style="list-style:none;padding:0;margin:6px 0 0;max-height:260px;overflow-y:auto"></ul>`;
    placePopover(pop, anchor);
    const input = pop.querySelector('#sb-place-input');
    const list = pop.querySelector('#sb-place-list');
    setTimeout(() => input.focus(), 50);
    let lastQuery = '', items = [];
    async function fetchPlaces(q) {
      if (q.length < 2 || q === lastQuery) return;
      lastQuery = q;
      try {
        const r = await fetch('/skybox-api/places?q=' + encodeURIComponent(q));
        const j = await r.json();
        items = (j.places || []).filter((p) => p.iata).slice(0, 10);
        render();
      } catch {}
    }
    function render() {
      list.innerHTML = items.map((p) => `<li data-iata="${p.iata}" data-name="${(p.name || '').replace(/"/g, '&quot;')}"
        style="padding:10px 12px;cursor:pointer;border-bottom:1px solid #eef0f3;border-radius:4px">
        <div style="font-weight:600">${p.name || ''} <span style="color:#545860;font-weight:400">(${p.iata})</span></div>
        <div style="color:#545860;font-size:12px">${[p.city, p.country].filter(Boolean).join(' · ')} · ${p.type || ''}</div>
      </li>`).join('');
    }
    input.addEventListener('input', () => fetchPlaces(input.value.trim()));
    list.addEventListener('mousedown', (e) => {
      const li = e.target.closest && e.target.closest('li[data-iata]');
      if (!li) return;
      e.preventDefault();
      const iata = li.dataset.iata, name = li.dataset.name;
      SB[which] = iata;
      SB[which + 'Label'] = iata + ' — ' + name;
      // Write back to the captured input so it looks correct visually.
      const target = document.querySelector(which === 'from' ? '#originInput-input' : '#destinationInput-input');
      if (target) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(target, SB[which + 'Label']);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
      pop.remove();
    });
  }

  // ---------------- Trip-type popover ----------------
  function openTripTypePopover(anchor) {
    dismissPopovers();
    const pop = document.createElement('div');
    pop.className = 'sb-pop';
    pop.innerHTML = `
      <h4>Trip type</h4>
      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer;padding:8px;border-radius:6px;border:1px solid #dadce0">
          <input type="radio" name="sb-trip" value="return" ${SB.tripType === 'return' ? 'checked' : ''}>
          <span><b>Return</b><div style="font-size:12px;color:#545860">Outbound and return flights</div></span>
        </label>
        <label style="display:flex;gap:8px;align-items:center;cursor:pointer;padding:8px;border-radius:6px;border:1px solid #dadce0">
          <input type="radio" name="sb-trip" value="oneway" ${SB.tripType === 'oneway' ? 'checked' : ''}>
          <span><b>One way</b><div style="font-size:12px;color:#545860">No return flight</div></span>
        </label>
      </div>
      <div class="footer">
        <button type="button" class="btn ghost" id="sb-cancel">Cancel</button>
        <button type="button" class="btn" id="sb-apply">Apply</button>
      </div>`;
    placePopover(pop, anchor);
    pop.querySelector('#sb-cancel').addEventListener('click', () => pop.remove());
    pop.querySelector('#sb-apply').addEventListener('click', () => {
      const v = pop.querySelector('input[name="sb-trip"]:checked')?.value || 'return';
      SB.tripType = v;
      if (v === 'oneway') SB.ret = '';
      writeBackTripChip();
      writeBackDateButtons();
      pop.remove();
    });
  }
  function writeBackTripChip() {
    const chip = document.querySelector('[aria-label*="Select trip type"]');
    if (!chip) return;
    const label = SB.tripType === 'oneway' ? 'One way' : 'Return';
    chip.setAttribute('aria-label', 'Select trip type, ' + label + ' selected');
    const text = chip.querySelector('[class*="bpk-text--footnote"]') || chip.querySelector('span');
    if (text) text.textContent = label;
    // Hide / show the return date button container.
    const retBtn = document.querySelector('[data-testid="return-btn"]');
    if (retBtn) {
      const container = retBtn.closest('div[class*="DatesContainer"]') || retBtn;
      container.style.display = SB.tripType === 'oneway' ? 'none' : '';
    }
    // Live-region announcement.
    const live = chip.parentElement?.querySelector('[aria-live]');
    if (live) live.textContent = label + ' selected';
  }

  // ---------------- Hook every form field ----------------
  document.addEventListener('click', (ev) => {
    if (ev.target.closest && ev.target.closest('.sb-pop')) return;
    const origin = ev.target.closest && ev.target.closest('#originInput-input, [for="originInput-input"], legend');
    if (origin && ev.target.closest('#originInput-input, [for="originInput-input"]')) {
      ev.preventDefault(); ev.stopPropagation();
      openPlacePopover(ev.target.closest('fieldset, [class*="_origin"]') || ev.target, 'from');
      return;
    }
    const dest = ev.target.closest && ev.target.closest('#destinationInput-input, [for="destinationInput-input"]');
    if (dest) {
      ev.preventDefault(); ev.stopPropagation();
      openPlacePopover(ev.target.closest('fieldset, [class*="_DestinationInput"]') || ev.target, 'to');
      return;
    }
    const departBtn = ev.target.closest && ev.target.closest('[data-testid="depart-btn"]');
    if (departBtn) { ev.preventDefault(); ev.stopPropagation(); openDatePopover(departBtn, 'depart'); return; }
    const retBtn = ev.target.closest && ev.target.closest('[data-testid="return-btn"]');
    if (retBtn) { ev.preventDefault(); ev.stopPropagation(); openDatePopover(retBtn, 'ret'); return; }
    const travBtn = ev.target.closest && ev.target.closest('[data-testid="traveller-button"]');
    if (travBtn) { ev.preventDefault(); ev.stopPropagation(); openTravellerPopover(travBtn); return; }
    // Trip type chip: aria-label starts with "Select trip type" OR title.
    const tripBtn = ev.target.closest && ev.target.closest('[aria-label*="Select trip type"], [title="Select trip type"]');
    if (tripBtn) { ev.preventDefault(); ev.stopPropagation(); openTripTypePopover(tripBtn); return; }
  }, true);

  // Replace the previous search-submit listener so we read from Skybox state
  // (the captured DOM may revert values mid-click). Registered with capture
  // priority so it fires before any React handler.
  document.addEventListener('click', async (ev) => {
    if (ev.target.closest && ev.target.closest('.sb-pop')) return;
    const btn = ev.target.closest && ev.target.closest('[data-testid="desktop-cta"], [data-testid="mobile-cta"]');
    if (!btn) return;
    if (!document.querySelector('#originInput-input')) return;
    ev.preventDefault(); ev.stopPropagation();

    // Required: origin + destination + depart. Optional: return (only when
    // not one-way). Validate each separately so the user sees exactly what
    // they missed.
    const missing = [];
    let from = SB.from, to = SB.to;
    // If user typed directly into the captured input instead of using the
    // popover, fall back to a /places lookup.
    if (!from) {
      const oi = document.querySelector('#originInput-input');
      const ov = (oi && oi.value || '').trim();
      if (ov) try { const r = await fetch('/skybox-api/places?q=' + encodeURIComponent(ov)); const j = await r.json(); from = (j.places || []).find((p) => p.iata)?.iata || null; } catch {}
    }
    if (!to) {
      const di = document.querySelector('#destinationInput-input');
      const dv = (di && di.value || '').trim();
      if (dv) try { const r = await fetch('/skybox-api/places?q=' + encodeURIComponent(dv)); const j = await r.json(); to = (j.places || []).find((p) => p.iata)?.iata || null; } catch {}
    }
    if (!from) missing.push('origin city');
    if (!to) missing.push('destination city');
    if (!SB.depart) missing.push('departure date');
    if (SB.tripType !== 'oneway' && !SB.ret) missing.push('return date (or pick One way)');

    if (missing.length) {
      alert('Please fill in: ' + missing.join(', '));
      // Auto-open the first missing field's popover.
      if (!from) document.querySelector('#originInput-input')?.click();
      else if (!to) document.querySelector('#destinationInput-input')?.click();
      else if (!SB.depart) document.querySelector('[data-testid="depart-btn"]')?.click();
      return;
    }

    const params = new URLSearchParams();
    params.set('from', from); params.set('to', to); params.set('depart', SB.depart);
    if (SB.tripType !== 'oneway' && SB.ret) params.set('ret', SB.ret);
    params.set('adults', String(SB.adults || 1));
    if (SB.children) params.set('children', String(SB.children));
    if (SB.infants) params.set('infants', String(SB.infants));
    params.set('cabin', SB.cabin || 'economy');
    log('search submit', from, '->', to, SB.depart, SB.ret || '(one-way)', SB);
    location.href = '/flights/search?' + params.toString();
  }, true);

  // (No seeded defaults — search must fail loudly until the user picks dates.)
})();
