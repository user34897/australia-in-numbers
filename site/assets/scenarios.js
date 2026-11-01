/* Scenarios tab — "what if" calculations from the latest ABS rates.
   Nothing here is sent anywhere: the unlock and saved scenarios live in this browser's localStorage. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------ access code
  // Only a salted PBKDF2-SHA256 hash of the code is stored, never the code itself.
  // Codes are checked lowercase with spaces trimmed, so "Food2323 " still works.
  // To change the code, generate a new salt and hash with the same settings and paste them here.
  const LOCK = {
    salt: 'fd4304c74cd9069aac114ae66d9fe4be',
    hash: '85040fd885467e3ee0b6132a1e294783fb6b0614438f987a27ee67beaefa66a4',
    iterations: 200000,
  };
  const KEYS = { unlock: 'absScenarios.unlock', saved: 'absScenarios.saved' };

  // localStorage can be switched off (private windows, blocked site data); never let that break the page.
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  };

  // ------------------------------------------------------------ formatting
  const num = (v, dp = 1) => v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const pct = (v) => `${num(v)}%`;
  const money = (v) => v.toLocaleString('en-AU', {
    style: 'currency', currency: 'AUD',
    minimumFractionDigits: Math.abs(v) >= 100 ? 0 : 2, maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2,
  });
  const cents = (v) => (v < 1 ? `${Math.round(v * 100)}c` : money(v));
  const yrs = (n) => `${n} year${n === 1 ? '' : 's'}`;
  const moves = (rate, what) => (rate < 0 ? `${what} fell ${pct(-rate)} a year` : `${what} rose ${pct(rate)} a year`);
  const grow = (rate, years) => Math.pow(1 + rate / 100, years); // compounding, once a year

  // ------------------------------------------------------------ settings
  // Add an entry here to add a new control. `abs` names a latest-ABS rate to start from;
  // results read the settings by `id`.
  const FALLBACK = { inflation: 3, wages: 3 };
  const INPUTS = [
    { id: 'years', type: 'range', label: 'Years ahead', min: 1, max: 20, step: 1, initial: () => 10, show: yrs },
    { id: 'inflation', type: 'range', label: 'Inflation per year', hint: 'How fast prices rise each year', min: -2, max: 12, step: 0.1, abs: 'inflation', show: pct },
    { id: 'wages', type: 'range', label: 'Pay rise per year', hint: 'How fast pay rises each year', min: -2, max: 12, step: 0.1, abs: 'wages', show: pct },
    { id: 'amount', type: 'money', label: 'A weekly amount', hint: 'For example shopping, rent or pay', min: 0, max: 1000000, step: 1, initial: () => 200 },
  ];

  // ------------------------------------------------------------ results
  // Add an entry here to add a new what-if result. calc(settings) returns
  // { big, text, tone } where tone is 'good', 'bad' or ''.
  const RESULTS = [
    {
      id: 'cost',
      title: 'What that weekly amount would cost',
      calc(s) {
        const later = s.amount * grow(s.inflation, s.years);
        const diff = (later - s.amount) * 52;
        return {
          big: `${money(later)} a week`,
          text: `If ${moves(s.inflation, 'prices')}, what costs ${money(s.amount)} a week today would cost about ${money(later)} a week in ${yrs(s.years)}. That’s ${money(Math.abs(diff))} a year ${diff >= 0 ? 'more' : 'less'}.`,
          tone: '',
        };
      },
    },
    {
      id: 'pay',
      title: 'Does pay keep up with prices?',
      calc(s) {
        const p = grow(s.inflation, s.years), w = grow(s.wages, s.years);
        const same = Math.abs(s.wages - s.inflation) < 0.05;
        return {
          big: same ? 'Pay just keeps up' : s.wages > s.inflation ? 'Yes, pay gets ahead' : 'No, pay falls behind',
          text: `Over ${yrs(s.years)}, pay would change ${pct((w - 1) * 100)} and prices ${pct((p - 1) * 100)}. If ${money(s.amount)} a week were your pay, it would become ${money(s.amount * w)}, which would buy what ${money((s.amount * w) / p)} buys today.`,
          tone: same ? '' : s.wages > s.inflation ? 'good' : 'bad',
        };
      },
    },
    {
      id: 'savings',
      title: 'What $1 of savings would really be worth',
      calc(s) {
        const real = 1 / grow(s.inflation, s.years);
        return {
          big: `$1 → ${cents(real)}`,
          text: `$1 kept for ${yrs(s.years)} without earning interest would buy what ${cents(real)} buys today, if ${moves(s.inflation, 'prices')}. ${money(s.amount)} would buy what ${money(s.amount * real)} buys today.`,
          tone: real < 1 ? 'bad' : 'good',
        };
      },
    },
  ];

  // ------------------------------------------------------------ state
  let ABS = { inflation: null, wages: null };
  let settings = {};
  let currentId = null;      // saved scenario currently showing, if unchanged
  let renamingId = null;
  let confirmingId = null;
  const controls = {};
  const resultEls = {};

  const absValue = (key) => {
    const v = ABS[key]?.[1];
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : FALLBACK[key];
  };
  const initialFor = (inp) => (inp.abs ? absValue(inp.abs) : inp.initial());
  const defaults = () => Object.fromEntries(INPUTS.map((inp) => [inp.id, initialFor(inp)]));

  // Fills any missing or bad values (for example from an older saved scenario) with defaults.
  function clean(raw) {
    const out = defaults();
    for (const inp of INPUTS) {
      const v = Number(raw?.[inp.id]);
      if (Number.isFinite(v)) out[inp.id] = Math.min(Math.max(v, inp.min), inp.max);
    }
    return out;
  }

  // ------------------------------------------------------------ saved scenarios (this device only)
  function loadSaved() {
    try {
      const x = JSON.parse(store.get(KEYS.saved));
      return Array.isArray(x?.items) ? x.items.filter((i) => i && i.id && typeof i.name === 'string') : [];
    } catch (e) { return []; }
  }
  const writeSaved = (items) => store.set(KEYS.saved, JSON.stringify({ v: 1, items }));
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const summary = (s) => `${yrs(s.years)} · prices ${pct(s.inflation)} · pay ${pct(s.wages)} · ${money(s.amount)} a week`;

  // ------------------------------------------------------------ building the controls
  function buildInputs() {
    const box = $('#scn-inputs');
    box.textContent = '';
    for (const inp of INPUTS) {
      const field = document.createElement('div');
      field.className = 'scn-field';
      const head = document.createElement('div');
      head.className = 'scn-field-head';
      const label = document.createElement('label');
      label.htmlFor = `scn-in-${inp.id}`;
      label.textContent = inp.label;
      head.append(label);
      const input = document.createElement('input');
      input.id = `scn-in-${inp.id}`;
      input.min = inp.min; input.max = inp.max; input.step = inp.step;
      let output = null;
      if (inp.type === 'range') {
        input.type = 'range';
        // Make sure the ABS starting value always fits on the slider.
        const start = initialFor(inp);
        if (start < inp.min) input.min = Math.floor(start);
        if (start > inp.max) input.max = Math.ceil(start);
        output = document.createElement('output');
        output.htmlFor = input.id;
        head.append(output);
        field.append(head, input);
      } else {
        input.type = 'number';
        input.inputMode = 'decimal';
        input.className = 'scn-input';
        const row = document.createElement('div');
        row.className = 'scn-money';
        row.append('$', input, ' a week');
        field.append(head, row);
      }
      if (inp.hint) {
        const hint = document.createElement('small');
        hint.textContent = inp.hint;
        field.append(hint);
      }
      input.addEventListener('input', () => {
        const v = Number(input.value);
        settings[inp.id] = input.value === '' || !Number.isFinite(v) ? 0 : Math.max(v, Number(input.min));
        if (output) output.textContent = inp.show(settings[inp.id]);
        changed();
      });
      controls[inp.id] = { inp, input, output };
      box.append(field);
    }
  }

  function buildResults() {
    const box = $('#scn-results');
    box.textContent = '';
    for (const r of RESULTS) {
      const el = document.createElement('section');
      el.className = 'scn-result';
      const h = document.createElement('h3');
      h.textContent = r.title;
      const big = document.createElement('p');
      big.className = 'scn-big';
      const text = document.createElement('p');
      el.append(h, big, text);
      resultEls[r.id] = { big, text };
      box.append(el);
    }
  }

  // ------------------------------------------------------------ updating
  function updateResults() {
    for (const r of RESULTS) {
      const out = r.calc(settings);
      const el = resultEls[r.id];
      el.big.textContent = out.big;
      el.big.className = `scn-big${out.tone ? ` ${out.tone}` : ''}`;
      el.text.textContent = out.text;
    }
  }

  function setSettings(s) {
    settings = clean(s);
    for (const { inp, input, output } of Object.values(controls)) {
      input.value = settings[inp.id];
      if (output) output.textContent = inp.show(settings[inp.id]);
    }
    updateResults();
  }

  function changed() {
    currentId = null;
    updateResults();
    $('#scn-save').hidden = false;
    renderList();
  }

  // ------------------------------------------------------------ saved list
  function button(text, onClick, extra = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `scn-btn scn-btn-quiet scn-btn-small ${extra}`.trim();
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderList() {
    const list = $('#scn-list');
    const items = loadSaved();
    list.textContent = '';
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'scn-empty';
      li.textContent = 'Nothing saved yet. Change a setting above, then save it.';
      list.append(li);
      return;
    }
    for (const item of items) {
      const li = document.createElement('li');
      const s = clean(item.settings);
      if (item.id === renamingId) {
        const form = document.createElement('form');
        form.className = 'scn-row scn-name';
        const input = document.createElement('input');
        input.className = 'scn-input';
        input.maxLength = 60;
        input.value = item.name;
        input.setAttribute('aria-label', 'New name');
        const save = document.createElement('button');
        save.type = 'submit';
        save.className = 'scn-btn scn-btn-small';
        save.textContent = 'Save name';
        form.append(input, save, button('Cancel', () => { renamingId = null; renderList(); }));
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const name = input.value.trim();
          if (name) writeSaved(loadSaved().map((x) => (x.id === item.id ? { ...x, name } : x)));
          renamingId = null;
          renderList();
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { renamingId = null; renderList(); } });
        li.append(form);
        list.append(li);
        input.focus();
        input.select(); // typing replaces the old name
        continue;
      }
      const name = document.createElement('div');
      name.className = `scn-name${item.id === currentId ? ' scn-current' : ''}`;
      const strong = document.createElement('strong');
      strong.textContent = item.name;
      const small = document.createElement('small');
      small.textContent = summary(s);
      name.append(strong, small);
      li.append(name);
      if (item.id === confirmingId) {
        li.append(
          button('Yes, delete', () => {
            writeSaved(loadSaved().filter((x) => x.id !== item.id));
            if (currentId === item.id) currentId = null;
            confirmingId = null;
            renderList();
          }, 'scn-btn-danger'),
          button('Keep', () => { confirmingId = null; renderList(); }),
        );
      } else {
        li.append(
          button('Load', () => {
            setSettings(item.settings);
            currentId = item.id;
            $('#scn-save').hidden = true;
            renderList();
          }),
          button('Rename', () => { renamingId = item.id; confirmingId = null; renderList(); }),
          button('Delete', () => { confirmingId = item.id; renamingId = null; renderList(); }),
        );
      }
      list.append(li);
    }
  }

  function onSave(e) {
    e.preventDefault();
    const items = loadSaved();
    const field = $('#scn-save-name');
    const name = field.value.trim() || `Scenario ${items.length + 1}`;
    const item = { id: newId(), name, settings: { ...settings }, savedAt: new Date().toISOString() };
    if (!writeSaved([item, ...items])) {
      field.setCustomValidity('This browser has saving turned off, so the scenario couldn’t be saved.');
      field.reportValidity();
      field.setCustomValidity('');
      return;
    }
    field.value = '';
    currentId = item.id;
    $('#scn-save').hidden = true;
    renderList();
  }

  // ------------------------------------------------------------ mount (called by app.js with the latest ABS rates)
  let mounted = false;
  function mount(info) {
    ABS = { inflation: info?.inflation || null, wages: info?.wages || null };
    const fp = info?.fmtPeriod || ((p) => p);
    const parts = [];
    if (ABS.inflation) parts.push(`inflation starts at the latest ABS figure (${pct(absValue('inflation'))} in the year to ${fp(ABS.inflation[0])})`);
    if (ABS.wages) parts.push(`pay rise starts at the latest ABS wage growth (${pct(absValue('wages'))} in the year to ${fp(ABS.wages[0])})`);
    $('#scn-source').textContent = parts.length
      ? `${parts.join(', and ').replace(/^./, (c) => c.toUpperCase())}. Change them to try your own.`
      : `The ABS figures haven’t loaded, so these start at ${pct(FALLBACK.inflation)}. Change them to try your own.`;
    if (mounted) return;
    mounted = true;
    buildInputs();
    buildResults();
    setSettings(defaults());
    renderList();
    $('#scn-reset').addEventListener('click', () => {
      setSettings({ ...settings, inflation: absValue('inflation'), wages: absValue('wages') });
      changed();
    });
    $('#scn-save').addEventListener('submit', onSave);
  }

  // ------------------------------------------------------------ lock
  const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));

  async function hashCode(code) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(LOCK.salt), iterations: LOCK.iterations }, key, 256);
    return toHex(bits);
  }

  function unlock() {
    $('#scn-lock').hidden = true;
    $('#scn-app').hidden = false;
  }

  function initLock() {
    // The saved hash ties the unlock to this code: if the code changes, devices are asked again.
    if (store.get(KEYS.unlock) === LOCK.hash) return unlock();
    const form = $('#scn-lock-form'), field = $('#scn-code'), msg = $('#scn-lock-msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = field.value.trim().toLowerCase().normalize('NFC');
      if (!code) { msg.textContent = 'Type the access code, then press Unlock.'; return; }
      if (!window.crypto?.subtle) { msg.textContent = 'This browser can’t check the code on this page. Try opening the site’s https:// address.'; return; }
      msg.classList.remove('warn');
      msg.textContent = 'Checking…';
      if (await hashCode(code) === LOCK.hash) {
        store.set(KEYS.unlock, LOCK.hash);
        msg.textContent = '';
        field.value = '';
        unlock();
      } else {
        msg.classList.add('warn');
        msg.textContent = 'That code isn’t right. Please try again.';
        field.select();
      }
    });
  }

  initLock();
  window.Scenarios = { mount };
})();
