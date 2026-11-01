/* Australia in numbers — reads data/abs.json (collected daily from the ABS) and draws the site. */
(function () {
  'use strict';

  // ------------------------------------------------------------ helpers
  const $ = (sel) => document.querySelector(sel);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const QEND = { 1: 'Mar', 2: 'Jun', 3: 'Sep', 4: 'Dec' };

  const FONT = "'Atkinson Hyperlegible', 'Segoe UI', system-ui, sans-serif";
  let DATA = null;
  const rendered = new Set();
  const charts = [];

  const isQ = (p) => /^\d{4}-Q[1-4]$/.test(p);
  const isM = (p) => /^\d{4}-\d{2}$/.test(p);
  const prevYear = (p) => (Number(p.slice(0, 4)) - 1) + p.slice(4);
  function fmtPeriod(p) {
    if (isM(p)) return `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
    if (isQ(p)) return `${QEND[p.slice(-1)]} quarter ${p.slice(0, 4)}`;
    return p;
  }
  function shortPeriod(p) {
    if (isM(p)) return `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
    if (isQ(p)) return `${QEND[p.slice(-1)]} ${p.slice(0, 4)}`;
    return p;
  }
  const fmt = (v, dp = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp }));
  const pct = (v, dp = 1) => `${fmt(v, dp)}%`;
  const scale = (s) => Math.pow(10, s?.unitMult || 0);

  function ind(id) {
    const x = DATA?.indicators?.[id];
    return x && x.series && x.series.length ? x : null;
  }
  // First series, or the one whose name matches a pattern.
  function ser(id, pattern) {
    const x = ind(id);
    if (!x) return null;
    if (!pattern) return x.series[0];
    return x.series.find((s) => pattern.test(s.name || '')) || null;
  }
  const pts = (s) => (s ? s.points : []);
  const last = (points) => (points && points.length ? points[points.length - 1] : null);
  const since = (points, from) => points.filter(([p]) => p >= from);

  function yoy(points) {
    const map = new Map(points);
    const out = [];
    for (const [p, v] of points) {
      const prev = map.get(prevYear(p));
      if (prev) out.push([p, (v / prev - 1) * 100]);
    }
    return out;
  }
  function rolling(points, n, fn) {
    const out = [];
    for (let i = n - 1; i < points.length; i++) {
      const vals = points.slice(i - n + 1, i + 1).map((x) => x[1]);
      out.push([points[i][0], fn(vals)]);
    }
    return out;
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avg = (a) => sum(a) / a.length;
  const scaled = (s, divisor) => pts(s).map(([p, v]) => [p, (v * scale(s)) / divisor]);

  // ------------------------------------------------------------ charts
  function baseOptions(unit) {
    const ink = css('--muted');
    const grid = css('--grid');
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion ? false : { duration: 450 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: ink, boxWidth: 14, boxHeight: 3, font: { family: FONT, size: 13 } } },
        tooltip: {
          callbacks: {
            label: (c) => (c.parsed.y == null ? null : ` ${c.dataset.label}: ${fmt(c.parsed.y ?? c.parsed.x, unit.dp ?? 1)}${unit.suffix || ''}`),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: ink, maxRotation: 0, autoSkip: true, maxTicksLimit: 7, font: { family: FONT, size: 12 } },
          border: { color: grid },
        },
        y: {
          grid: { color: grid },
          ticks: { color: ink, font: { family: FONT, size: 12 }, precision: unit.tickDp ?? 0, callback: (v) => `${fmt(v, unit.tickDp ?? 0)}${unit.suffix || ''}` },
          border: { display: false },
        },
      },
    };
  }

  function emptyCanvas(canvas, msg) {
    const box = canvas.parentElement;
    box.innerHTML = `<div class="empty">${msg}</div>`;
  }

  // series: [{label, points, color, dashed, width, fill}]
  function lineChart(id, series, unit = {}, extra = {}) {
    const canvas = document.getElementById(id);
    const usable = series.filter((s) => s.points && s.points.length);
    if (!usable.length) return emptyCanvas(canvas, 'No figures yet for this chart.');
    const periods = [...new Set(usable.flatMap((s) => s.points.map((p) => p[0])))].sort();
    const datasets = usable.map((s) => {
      const m = new Map(s.points);
      return {
        label: s.label,
        data: periods.map((p) => (m.has(p) ? m.get(p) : null)),
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: s.width || 2.25,
        borderDash: s.dashed ? [5, 4] : [],
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.25,
        spanGaps: true,
      };
    });
    const options = baseOptions(unit);
    if (usable.length === 1) options.plugins.legend.display = false;
    if (unit.min != null) options.scales.y.min = unit.min;
    const chart = new Chart(canvas, {
      type: 'line',
      data: { labels: periods.map(shortPeriod), datasets },
      options,
      plugins: extra.plugins || [],
    });
    charts.push(chart);
    return chart;
  }

  function barChart(id, labels, datasets, unit = {}, opts = {}) {
    const canvas = document.getElementById(id);
    if (!labels.length) return emptyCanvas(canvas, 'No figures yet for this chart.');
    const options = baseOptions(unit);
    options.interaction = { mode: 'nearest', intersect: true, axis: opts.horizontal ? 'y' : 'x' };
    if (datasets.length === 1) options.plugins.legend.display = false;
    if (opts.horizontal) {
      options.indexAxis = 'y';
      const x = options.scales.x, y = options.scales.y;
      options.scales = { x: { ...y }, y: { ...x, ticks: { ...x.ticks, autoSkip: false, maxTicksLimit: undefined } } };
      options.plugins.tooltip.callbacks.label = (c) => ` ${c.dataset.label}: ${fmt(c.parsed.x, unit.dp ?? 1)}${unit.suffix || ''}`;
    }
    if (opts.stacked) { options.scales.x.stacked = true; options.scales.y.stacked = true; }
    const chart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: datasets.map((d) => ({ borderRadius: 2, maxBarThickness: 34, ...d })) },
      options,
    });
    charts.push(chart);
    return chart;
  }

  // Shaded horizontal band (e.g. the RBA's 2–3% target).
  const bandPlugin = (lo, hi) => ({
    id: 'band',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const top = scales.y.getPixelForValue(hi), bottom = scales.y.getPixelForValue(lo);
      ctx.save();
      ctx.fillStyle = css('--band');
      ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
      ctx.restore();
    },
  });

  // ------------------------------------------------------------ notes under charts
  function fillNotes(panel) {
    panel.querySelectorAll('.note[data-needs]').forEach((el) => {
      const ids = el.dataset.needs.split(/\s+/);
      const missing = ids.filter((id) => !ind(id));
      const stale = ids.map((id) => DATA.indicators[id]).filter((x) => x && x.stale);
      if (missing.length) {
        el.classList.add('warn');
        el.textContent = 'Some figures for this chart haven’t come through from the ABS yet. See “About the data” at the bottom of the page.';
      } else if (stale.length) {
        el.classList.add('warn');
        el.textContent = `Showing figures saved on ${new Date(stale[0].fetched).toLocaleDateString('en-AU', { day: 'numeric', month: 'long' })}. The most recent update didn’t come through.`;
      } else {
        const periods = ids.map((id) => last(ind(id).series[0].points)?.[0]).filter(Boolean).sort();
        el.textContent = periods.length ? `Latest figures: ${fmtPeriod(periods[periods.length - 1])}. Source: ABS, ${ind(ids[0]).release}.` : '';
      }
    });
  }

  // ------------------------------------------------------------ panels
  const C = () => ({ gum: css('--gum'), wattle: css('--wattle'), rose: css('--rose'), sky: css('--sky'), ink: css('--ink'), muted: css('--muted') });

  function popSeries() {
    return {
      erp: ser('population', /estimated resident population/i),
      ni: ser('population', /natural increase/i),
      nom: ser('population', /net overseas migration/i),
    };
  }

  function renderOverview() {
    const c = C();
    const cpiY = yoy(pts(ser('cpi_m')));
    const cpiQY = yoy(pts(ser('cpi_q')));
    const wpiY = yoy(pts(ser('wpi')));
    const unemp = pts(ser('unemp'));
    const { erp } = popSeries();
    const erpPts = scaled(erp, 1);
    const erpY = yoy(erpPts);

    // Plain-English summary
    const bits = [];
    const priceNow = last(cpiY) || last(cpiQY);
    const wageNow = last(wpiY);
    if (priceNow && wageNow) {
      bits.push(`Prices are <span class="num up">${pct(priceNow[1])}</span> higher than a year ago, and wages are up <span class="num good">${pct(wageNow[1])}</span>.`);
      const wq = new Map(wpiY);
      const aligned = [...cpiQY].reverse().find(([p]) => wq.has(p));
      if (aligned) {
        const gap = wq.get(aligned[0]) - aligned[1];
        bits.push(Math.abs(gap) < 0.1 ? 'Pay is roughly keeping pace with prices.' : gap > 0 ? 'Pay is rising faster than prices.' : 'Prices are rising faster than pay.');
      }
    } else if (priceNow) {
      bits.push(`Prices are <span class="num up">${pct(priceNow[1])}</span> higher than a year ago.`);
    }
    const u = last(unemp);
    if (u) bits.push(`<span class="num plain">${pct(u[1])}</span> of people who want a job can’t find one.`);
    const e = last(erpPts), g = last(erpY);
    if (e) bits.push(`Australia is home to <span class="num plain">${fmt(e[1] / 1e6, 1)} million</span> people${g ? `, <span class="num plain">${pct(g[1])}</span> more than a year earlier` : ''}.`);
    $('#lede').innerHTML = bits.length ? bits.join(' ') : 'The latest figures will appear here after the first daily update has run.';

    lineChart('ch-wages-prices', [
      { label: 'Wages', points: since(wpiY, '2000'), color: c.gum },
      { label: 'Prices', points: since(cpiQY, '2000'), color: c.wattle },
    ], { suffix: '%', tickDp: 0 });

    // Latest numbers table
    const rows = [];
    const change = (series, dp = 1, suffix = '%') => {
      if (!series || series.length < 2) return '';
      const [, a] = series[series.length - 2], [, b] = series[series.length - 1];
      const d = Number(b.toFixed(dp)) - Number(a.toFixed(dp));
      if (Math.abs(d) < Math.pow(10, -dp) / 2) return `same as ${shortPeriod(series[series.length - 2][0])}`;
      return `${d > 0 ? 'up' : 'down'} from ${fmt(a, dp)}${suffix}`;
    };
    const add = (what, sub, series, valueFmt, chg) => {
      const l = last(series);
      if (!l) return;
      rows.push(`<tr><td class="what">${what}<small>${sub}</small></td><td class="val">${valueFmt(l[1])}</td><td class="chg">${chg ?? ''}</td><td class="when">${fmtPeriod(l[0])}</td></tr>`);
    };
    add('Inflation', 'Rise in prices over 12 months', cpiY.length ? cpiY : cpiQY, (v) => pct(v), change(cpiY.length ? cpiY : cpiQY));
    add('Wage growth', 'Rise in hourly pay over 12 months', wpiY, (v) => pct(v), change(wpiY));
    add('Unemployment', 'Share of the workforce without a job', unemp, (v) => pct(v), change(unemp));
    const under = pts(ser('underemp'));
    add('Underemployment', 'Working, but want more hours', under, (v) => pct(v), change(under));
    const youth = pts(ser('unemp_youth'));
    add('Youth unemployment', '15 to 24 year olds', youth, (v) => pct(v), change(youth));
    const rentsY = yoy(pts(ser('rents_q')));
    add('Rents', 'Rise in rents over 12 months', rentsY, (v) => pct(v), change(rentsY));
    add('Population', 'People living in Australia', erpPts, (v) => `${fmt(v / 1e6, 2)}m`, g ? `up ${pct(g[1])} in a year` : '');
    const appr = pts(ser('approvals'));
    const appr12 = rolling(appr, 12, sum);
    add('New homes approved', 'Over the past 12 months', appr12, (v) => fmt(v, 0), '');
    const vac = scaled(ser('vacancies'), 1000);
    add('Job vacancies', 'Jobs employers are trying to fill', vac, (v) => `${fmt(v, 0)}k`, change(vac, 0, 'k'));

    $('#latest-table').innerHTML = rows.length
      ? `<thead><tr><th>Measure</th><th>Latest</th><th>Change</th><th>Period</th></tr></thead><tbody>${rows.join('')}</tbody>`
      : '<tbody><tr><td>No figures yet.</td></tr></tbody>';
  }

  function renderCost() {
    const c = C();
    const items = ind('cpi_items');
    const cpiMY = yoy(pts(ser('cpi_m')));
    const ranked = [];
    let period = null;
    if (items) {
      for (const s of items.series) {
        const l = last(yoy(s.points));
        if (l) { ranked.push({ name: s.name, v: l[1] }); period = period && period > l[0] ? period : l[0]; }
      }
    }
    const all = last(cpiMY);
    if (all) ranked.push({ name: 'All prices', v: all[1], all: true });
    ranked.sort((a, b) => b.v - a.v);
    if (period) $('#items-caption').textContent = `How much prices changed in the 12 months to ${fmtPeriod(period)}, by type of spending.`;
    barChart('ch-items', ranked.map((r) => r.name), [{
      label: 'Change over 12 months',
      data: ranked.map((r) => r.v),
      backgroundColor: ranked.map((r) => (r.all ? c.ink : r.v < 0 ? c.gum : c.wattle)),
    }], { suffix: '%', tickDp: 0 }, { horizontal: true });

    const cpiQY = yoy(pts(ser('cpi_q')));
    lineChart('ch-inflation', [{ label: 'Inflation', points: cpiQY, color: c.wattle }], { suffix: '%', tickDp: 0 }, { plugins: [bandPlugin(2, 3)] });

    const wq = new Map(yoy(pts(ser('wpi'))));
    const real = cpiQY.filter(([p]) => wq.has(p) && p >= '2000').map(([p, v]) => [p, wq.get(p) - v]);
    barChart('ch-real-wages', real.map(([p]) => shortPeriod(p)), [{
      label: 'Wages minus prices',
      data: real.map(([, v]) => v),
      backgroundColor: real.map(([, v]) => (v >= 0 ? c.gum : c.rose)),
      maxBarThickness: 8,
    }], { suffix: ' pts', tickDp: 0 });
  }

  function renderHousing() {
    const c = C();
    lineChart('ch-rents', [
      { label: 'Rents', points: since(yoy(pts(ser('rents_q'))), '2005'), color: c.sky },
      { label: 'All prices', points: since(yoy(pts(ser('cpi_q'))), '2005'), color: c.wattle, dashed: true, width: 1.75 },
    ], { suffix: '%', tickDp: 0 });

    const appr = pts(ser('approvals'));
    lineChart('ch-approvals', [
      { label: 'Each month', points: appr, color: c.gum + '66', width: 1.25 },
      { label: '12-month average', points: rolling(appr, 12, avg), color: c.gum, width: 2.5 },
    ], { dp: 0, tickDp: 0 });

    // Calendar-year comparison: people added vs homes approved.
    const { erp } = popSeries();
    const erpMap = new Map(pts(erp).map(([p, v]) => [p, v * scale(erp)]));
    const years = [];
    for (let y = 2005; y <= new Date().getFullYear(); y++) {
      const a = erpMap.get(`${y}-Q4`), b = erpMap.get(`${y - 1}-Q4`);
      const months = appr.filter(([p]) => p.startsWith(`${y}-`));
      if (a && b && months.length === 12) years.push({ y, people: a - b, homes: sum(months.map((m) => m[1])) });
    }
    barChart('ch-supply', years.map((r) => String(r.y)), [
      { label: 'People added', data: years.map((r) => r.people), backgroundColor: c.sky },
      { label: 'Homes approved', data: years.map((r) => r.homes), backgroundColor: c.gum },
    ], { dp: 0, tickDp: 0 });
  }

  function renderJobs() {
    const c = C();
    lineChart('ch-unemp', [
      { label: 'Unemployment', points: pts(ser('unemp')), color: c.rose },
      { label: 'Underemployment', points: pts(ser('underemp')), color: c.sky },
    ], { suffix: '%', tickDp: 0, min: 0 });
    lineChart('ch-youth', [
      { label: '15–24 year olds', points: pts(ser('unemp_youth')), color: c.wattle },
      { label: 'Everyone', points: pts(ser('unemp')), color: c.muted, dashed: true, width: 1.75 },
    ], { suffix: '%', tickDp: 0, min: 0 });
    const ft = ser('ft_pt', /full-time/i), pt = ser('ft_pt', /part-time/i);
    lineChart('ch-ftpt', [
      { label: 'Full-time', points: scaled(ft, 1e6), color: c.gum },
      { label: 'Part-time', points: scaled(pt, 1e6), color: c.sky },
    ], { suffix: 'm', dp: 2, tickDp: 0, min: 0 });
    lineChart('ch-participation', [{ label: 'Participation rate', points: pts(ser('participation')), color: c.gum }], { suffix: '%', tickDp: 0 });
    lineChart('ch-vacancies', [{ label: 'Job vacancies', points: scaled(ser('vacancies'), 1000), color: c.sky }], { suffix: 'k', dp: 0, tickDp: 0, min: 0 });
  }

  function renderPeople() {
    const c = C();
    const { erp, ni, nom } = popSeries();
    const erpPts = scaled(erp, 1);
    lineChart('ch-pop', [{ label: 'Population', points: erpPts.map(([p, v]) => [p, v / 1e6]), color: c.gum }], { suffix: 'm', dp: 2, tickDp: 0 });

    const yearly = (s) => {
      const m = new Map(pts(s).map(([p, v]) => [p, v * scale(s)]));
      const out = new Map();
      for (let y = 2000; y <= new Date().getFullYear(); y++) {
        const q = [1, 2, 3, 4].map((n) => m.get(`${y}-Q${n}`));
        if (q.every((v) => v != null)) out.set(String(y), sum(q));
      }
      return out;
    };
    const niY = yearly(ni), nomY = yearly(nom);
    const yrs = [...niY.keys()].filter((y) => nomY.has(y));
    barChart('ch-pop-sources', yrs, [
      { label: 'Natural increase', data: yrs.map((y) => niY.get(y)), backgroundColor: c.gum },
      { label: 'Net overseas migration', data: yrs.map((y) => nomY.get(y)), backgroundColor: c.sky },
    ], { dp: 0, tickDp: 0 }, { stacked: true });

    const e = last(erpPts), g = last(yoy(erpPts));
    const yLast = yrs[yrs.length - 1];
    const parts = [];
    if (e) parts.push(`About <span class="num plain">${fmt(e[1] / 1e6, 1)} million</span> people live in Australia.`);
    if (g) parts.push(`The population grew <span class="num plain">${pct(g[1])}</span> in the year to ${fmtPeriod(e[0]).replace('quarter ', '')}.`);
    if (yLast) {
      const total = niY.get(yLast) + nomY.get(yLast);
      if (total > 0) parts.push(`In ${yLast}, <span class="num plain">${fmt((nomY.get(yLast) / total) * 100, 0)}%</span> of growth came from migration.`);
    }
    $('#people-lede').innerHTML = parts.join(' ');
  }

  const ABBR = [
    [/new south wales|sydney/i, 'NSW'], [/victoria|melbourne/i, 'Vic'], [/queensland|brisbane/i, 'Qld'],
    [/south australia|adelaide/i, 'SA'], [/western australia|perth/i, 'WA'], [/tasmania|hobart/i, 'Tas'],
    [/northern territory|darwin/i, 'NT'], [/capital territory|canberra/i, 'ACT'],
  ];
  const abbr = (name) => (ABBR.find(([re]) => re.test(name)) || [null, name])[1];

  function stateBars(id, capId, indicatorId, valueFn, unit, labelFn = abbr) {
    const c = C();
    const x = ind(indicatorId);
    const rows = [];
    let period = null;
    if (x) {
      for (const s of x.series) {
        const l = last(valueFn(s));
        if (l) { rows.push({ name: labelFn(s.name || ''), raw: s.name || '', v: l[1] }); period = l[0]; }
      }
    }
    rows.sort((a, b) => b.v - a.v);
    if (period && capId) { const el = $(capId); el.textContent = `${el.textContent.replace(/\.$/, '')}, ${fmtPeriod(period)}.`; }
    barChart(id, rows.map((r) => r.name), [{
      label: unit.label,
      data: rows.map((r) => r.v),
      backgroundColor: rows.map((r) => (/victoria|melbourne/i.test(r.raw) ? c.wattle : c.gum + '99')),
    }], unit, { horizontal: true });
  }

  function renderStates() {
    stateBars('ch-st-unemp', '#cap-st-unemp', 'unemp_states', (s) => s.points, { label: 'Unemployment', suffix: '%', tickDp: 0 });
    stateBars('ch-st-wages', '#cap-st-wages', 'wpi_states', (s) => yoy(s.points), { label: 'Wage growth', suffix: '%', tickDp: 0 });
    stateBars('ch-st-cpi', '#cap-st-cpi', 'cpi_cities', (s) => yoy(s.points), { label: 'Inflation', suffix: '%', tickDp: 0 }, (n) => n);
    stateBars('ch-st-pop', '#cap-st-pop', 'population_states', (s) => yoy(s.points), { label: 'Population growth', suffix: '%', tickDp: 1 });
  }

  // The calculator itself lives in scenarios.js; this just hands it the latest ABS rates.
  function renderScenarios() {
    if (!window.Scenarios) return;
    window.Scenarios.mount({
      inflation: last(yoy(pts(ser('cpi_m')))) || last(yoy(pts(ser('cpi_q')))),
      wages: last(yoy(pts(ser('wpi')))),
      fmtPeriod,
    });
  }

  const RENDER = {
    overview: renderOverview,
    'cost-of-living': renderCost,
    housing: renderHousing,
    jobs: renderJobs,
    people: renderPeople,
    states: renderStates,
    scenarios: renderScenarios,
  };

  // ------------------------------------------------------------ tabs
  function show(tab) {
    if (!RENDER[tab]) tab = 'overview';
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
    document.querySelectorAll('[data-tab]').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (DATA && !rendered.has(tab)) {
      rendered.add(tab);
      const panel = document.querySelector(`[data-panel="${tab}"]`);
      try { RENDER[tab](); } catch (err) { console.error(err); }
      fillNotes(panel);
    }
  }
  const currentTab = () => decodeURIComponent(location.hash.slice(1)) || 'overview';
  window.addEventListener('hashchange', () => { show(currentTab()); window.scrollTo({ top: 0 }); });

  // ------------------------------------------------------------ data notes
  function renderDataNotes() {
    const items = Object.values(DATA.indicators || {}).map((x) => {
      const l = x.series?.length ? last(x.series[0].points) : null;
      let status = l ? `latest ${fmtPeriod(l[0])}` : 'no figures yet';
      let cls = '';
      if (x.error && !x.series?.length) { status = 'not available yet'; cls = 'bad'; }
      else if (x.stale) { status += ', using saved figures'; cls = 'bad'; }
      const err = x.error || x.lastError;
      return `<li><strong>${x.title}</strong> — <span class="${cls}">${status}</span>${err ? `<br><small>${err.replace(/</g, '&lt;')}</small>` : ''}</li>`;
    });
    $('#data-notes-body').innerHTML = `<p>Each figure below comes from an ABS release. Figures are checked every day and the site updates when the ABS publishes something new.</p><ul>${items.join('')}</ul>`;
  }

  // ------------------------------------------------------------ start
  async function start() {
    show(currentTab());
    try {
      const res = await fetch(`data/abs.json?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      DATA = await res.json();
    } catch (err) {
      $('#updated').textContent = 'No figures yet';
      $('#main').insertAdjacentHTML('afterbegin', '<div class="banner"><strong>Waiting for the first update.</strong> The figures are collected automatically from the ABS. If you’ve just set the site up, the first collection takes a few minutes. You can check its progress in the Actions tab of your GitHub project.</div>');
      return;
    }
    const when = new Date(DATA.generated);
    $('#updated').textContent = `Checked ${when.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}, ${when.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`;
    renderDataNotes();
    try { await document.fonts.ready; } catch (e) { /* fonts optional */ }
    const tab = currentTab();
    rendered.delete(tab);
    show(tab);
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());
  if (window.Chart) start();
  else window.addEventListener('load', start);
})();
