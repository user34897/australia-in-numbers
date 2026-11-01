// Downloads the latest figures from the ABS Data API and saves them to
// site/data/abs.json for the website to read.
//
// Run by GitHub Actions once a day (see the workflow file). Uses only
// built-in Node features, so there's nothing to install.
//
// If an indicator fails (the ABS is down, or a dataset changed), the last good
// copy from the previous run is kept and flagged as stale, so the site keeps
// working. Every failure is printed in the run log with the reason.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDICATORS } from './indicators.mjs';

const BASE = 'https://data.api.abs.gov.au/rest';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'site', 'data', 'abs.json');
const UA = 'family-abs-dashboard/1.0 (GitHub Actions; personal, non-commercial)';
const CSV_ACCEPT = 'application/vnd.sdmx.data+csv;labels=both';
const PAUSE_MS = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '')
  .toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();

class AbsError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

// ---------------------------------------------------------------- HTTP

async function get(url, accept) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: accept, 'User-Agent': UA },
        signal: AbortSignal.timeout(90_000),
      });
      const text = await res.text();
      if (res.ok) return text;
      const body = text.trim().slice(0, 300);
      // 4xx other than rate limiting won't fix themselves on retry.
      if (res.status !== 429 && res.status < 500) {
        throw new AbsError(`HTTP ${res.status}: ${body}`, res.status, body);
      }
      lastErr = new AbsError(`HTTP ${res.status}: ${body}`, res.status, body);
    } catch (err) {
      if (err instanceof AbsError && err.status < 500 && err.status !== 429) throw err;
      lastErr = err;
    }
    await sleep(attempt * 5000);
  }
  throw lastErr;
}

// ---------------------------------------------------------------- CSV

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const codeOf = (cell) => String(cell).split(':')[0].trim();
const labelOf = (cell) => {
  const s = String(cell);
  const i = s.indexOf(': ');
  return i >= 0 ? s.slice(i + 2).trim() : s.trim();
};

// Turns an SDMX-CSV (labels=both) response into a list of series.
function parseData(text) {
  if (text.trimStart().startsWith('<')) {
    throw new Error('The ABS sent back a web page instead of CSV data.');
  }
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('The ABS response was empty.');
  const cols = header.map(codeOf);
  const col = (name) => cols.indexOf(name);
  const iTime = col('TIME_PERIOD'), iVal = col('OBS_VALUE');
  if (iTime < 0 || iVal < 0) throw new Error(`Unexpected columns in ABS response: ${cols.join(', ')}`);
  const dimIdx = [];
  for (let i = col('DATAFLOW') + 1; i < iTime; i++) dimIdx.push(i);
  const iUnit = col('UNIT_MEASURE'), iMult = col('UNIT_MULT');

  const byKey = new Map();
  for (const r of rows) {
    if (r.length < cols.length || r[iVal] === '') continue;
    const value = Number(r[iVal]);
    if (!Number.isFinite(value)) continue;
    const key = dimIdx.map((i) => codeOf(r[i])).join('.');
    if (!byKey.has(key)) {
      const dims = {};
      for (const i of dimIdx) dims[cols[i]] = { code: codeOf(r[i]), label: labelOf(r[i]) };
      byKey.set(key, {
        key, dims,
        unit: iUnit >= 0 ? labelOf(r[iUnit]) : '',
        unitMult: iMult >= 0 ? Number(codeOf(r[iMult])) || 0 : 0,
        points: [],
      });
    }
    byKey.get(key).points.push([r[iTime], value]);
  }
  const series = [...byKey.values()];
  for (const s of series) s.points.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return series;
}

// ---------------------------------------------------------------- Structure

const structureCache = new Map();

function decodeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
}
const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];

function structureFromJson(json) {
  const data = json.data ?? json;
  const dsd = (data.dataStructures ?? [])[0];
  if (!dsd) throw new Error('No data structure in JSON');
  const dims = dsd.dataStructureComponents.dimensionList.dimensions
    .slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const lists = new Map();
  for (const cl of data.codelists ?? []) {
    lists.set(cl.id, (cl.codes ?? []).map((c) => ({
      code: c.id, label: c.name ?? c.names?.en ?? c.id,
    })));
  }
  return dims.map((d) => {
    const urn = d.localRepresentation?.enumeration ?? '';
    const clId = (urn.match(/Codelist=[^:]+:([^(]+)\(/) || [])[1];
    return { id: d.id, codes: lists.get(clId) ?? [] };
  });
}

function structureFromXml(xml) {
  const lists = new Map();
  const clRe = /<(?:\w+:)?Codelist\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Codelist>/g;
  for (const [, attrs, body] of xml.matchAll(clRe)) {
    const codes = [];
    const codeRe = /<(?:\w+:)?Code\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Code>/g;
    for (const [, cAttrs, cBody] of body.matchAll(codeRe)) {
      const name = (cBody.match(/<(?:\w+:)?Name\b[^>]*xml:lang="en"[^>]*>([\s\S]*?)<\//) ||
        cBody.match(/<(?:\w+:)?Name\b[^>]*>([\s\S]*?)<\//) || [])[1];
      codes.push({ code: attr(cAttrs, 'id'), label: decodeXml(name ?? attr(cAttrs, 'id')) });
    }
    lists.set(attr(attrs, 'id'), codes);
  }
  const dims = [];
  const dimRe = /<(?:\w+:)?Dimension\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?Dimension>/g;
  for (const [, dAttrs, dBody] of xml.matchAll(dimRe)) {
    const enumBlock = (dBody.match(/<(?:\w+:)?Enumeration>([\s\S]*?)<\/(?:\w+:)?Enumeration>/) || [])[1] ?? '';
    const refTag = (enumBlock.match(/<Ref\b[^>]*>/) || [])[0] ?? '';
    dims.push({
      id: attr(dAttrs, 'id'),
      position: Number(attr(dAttrs, 'position') ?? dims.length + 1),
      codes: lists.get(attr(refTag, 'id')) ?? [],
    });
  }
  if (!dims.length) throw new Error('No dimensions found in structure XML');
  return dims.sort((a, b) => a.position - b.position);
}

async function getStructure(flow) {
  if (structureCache.has(flow)) return structureCache.get(flow);
  const url = `${BASE}/dataflow/ABS/${flow}?references=all`;
  let dims;
  try {
    const text = await get(url, 'application/vnd.sdmx.structure+json;version=1.0');
    dims = structureFromJson(JSON.parse(text));
  } catch (err) {
    console.log(`    structure JSON unavailable for ${flow} (${err.message.slice(0, 80)}); trying XML`);
    await sleep(PAUSE_MS);
    dims = structureFromXml(await get(url, 'application/xml'));
  }
  structureCache.set(flow, dims);
  return dims;
}

let flowList;
async function findFlow(pattern) {
  if (!flowList) {
    const text = await get(`${BASE}/dataflow/ABS?detail=allstubs`, 'application/vnd.sdmx.structure+json;version=1.0');
    const json = JSON.parse(text);
    flowList = (json.data?.dataflows ?? []).map((f) => ({ id: f.id, name: f.name ?? f.names?.en ?? '' }));
  }
  const hit = flowList.find((f) => pattern.test(norm(f.name)));
  if (!hit) throw new Error(`No ABS dataflow name matches ${pattern}`);
  return hit.id;
}

// ---------------------------------------------------------------- Selection

const PREFERRED = [/^total/, /^all /, /^all$/, /^persons$/, /^australia$/, /^total australia$/];

function matchCodes(codes, labels, many) {
  const out = [];
  for (const re of labels) {
    const hit = codes.find((c) => re.test(norm(c.label)) && !out.includes(c.code));
    if (hit) { out.push(hit.code); if (!many) break; }
  }
  return out;
}

// Build a series key from labels. Returns { key, wildcarded }.
function buildKey(dims, select, seriesBy) {
  const anyCrit = select['*'];
  const parts = dims.map((d) => {
    const crit = select[d.id];
    if (crit?.codes) return crit.codes;
    if (crit?.labels) {
      const found = matchCodes(d.codes, crit.labels, d.id === seriesBy);
      if (!found.length) {
        const sample = d.codes.slice(0, 12).map((c) => c.label).join(' | ');
        throw new Error(`No ${d.id} label matched ${crit.labels.join(', ')}. Some options: ${sample}`);
      }
      return found;
    }
    if (anyCrit) {
      const found = matchCodes(d.codes, anyCrit.labels, false);
      if (found.length) return found;
    }
    return null; // decide later
  });
  const strict = parts.map((p, i) => {
    if (p) return p.join('+');
    const pref = matchCodes(dims[i].codes, PREFERRED, false);
    return pref.length ? pref[0] : '';
  });
  const loose = parts.map((p) => (p ? p.join('+') : ''));
  return { strict: strict.join('.'), loose: loose.join('.'), freeDims: dims.filter((_, i) => !parts[i]).map((d) => d.id) };
}

// When a query returns several series per line, keep the most "total-like" one.
function pickSeries(series, seriesBy, preferTsest) {
  const score = (s) => {
    let n = 0;
    for (const [id, v] of Object.entries(s.dims)) {
      if (id === seriesBy) continue;
      if (PREFERRED.some((re) => re.test(norm(v.label)))) n += 2;
      if (id === 'TSEST' && preferTsest && preferTsest.test(norm(v.label))) n += 3;
    }
    return n * 100000 + s.points.length;
  };
  const groups = new Map();
  for (const s of series) {
    const g = seriesBy ? s.dims[seriesBy]?.code ?? '' : '';
    const best = groups.get(g);
    if (!best || score(s) > score(best)) groups.set(g, s);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------- Fetch one

async function fetchData(flow, key, start) {
  const url = `${BASE}/data/ABS,${flow}/${key}?startPeriod=${encodeURIComponent(start)}`;
  const text = await get(url, CSV_ACCEPT);
  await sleep(PAUSE_MS);
  return parseData(text);
}

async function fetchIndicator(ind) {
  let flow = ind.flow;
  const attempts = [];

  if (ind.key) {
    try {
      const series = await fetchData(flow, ind.key, ind.start);
      if (series.length) return { flow, key: ind.key, series };
      attempts.push(`key ${ind.key}: no data`);
    } catch (err) {
      attempts.push(`key ${ind.key}: ${err.message}`);
      if (!ind.select) throw new Error(attempts.join(' / '));
    }
  }

  if (ind.select) {
    let dims;
    try {
      dims = await getStructure(flow);
    } catch (err) {
      if (!ind.flowSearch) throw new Error([...attempts, `structure: ${err.message}`].join(' / '));
      flow = await findFlow(ind.flowSearch);
      console.log(`    using dataflow ${flow} found by name`);
      dims = await getStructure(flow);
    }
    const { strict, loose, freeDims } = buildKey(dims, ind.select, ind.seriesBy);
    for (const key of [...new Set([strict, loose])]) {
      try {
        let series = await fetchData(flow, key, ind.start);
        if (!series.length) { attempts.push(`key ${key}: no data`); continue; }
        series = pickSeries(series, ind.seriesBy, /seasonally adjusted/);
        if (freeDims.length) console.log(`    resolved ${flow}/${key} (open dimensions: ${freeDims.join(', ')})`);
        return { flow, key, series };
      } catch (err) {
        attempts.push(`key ${key}: ${err.message}`);
      }
    }
  }
  throw new Error(attempts.join(' / ') || 'No key or selection defined');
}

// ---------------------------------------------------------------- Main

async function main() {
  let previous = { indicators: {} };
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* first run */ }

  const out = { generated: new Date().toISOString(), indicators: {} };
  let ok = 0, failed = 0;

  for (const ind of INDICATORS) {
    process.stdout.write(`• ${ind.id} … `);
    try {
      const { flow, key, series } = await fetchIndicator(ind);
      out.indicators[ind.id] = {
        id: ind.id, title: ind.title, release: ind.release, flow, key,
        seriesBy: ind.seriesBy ?? null,
        fetched: out.generated, stale: false,
        series: series.map((s) => ({
          code: ind.seriesBy ? s.dims[ind.seriesBy]?.code : s.key,
          name: ind.seriesBy ? s.dims[ind.seriesBy]?.label : ind.title,
          unit: s.unit, unitMult: s.unitMult, points: s.points,
        })),
      };
      const last = series[0].points.at(-1);
      console.log(`ok (${series.length} series, latest ${last?.[0]})`);
      ok++;
    } catch (err) {
      failed++;
      console.log(`FAILED\n    ${err.message}`);
      const prev = previous.indicators?.[ind.id];
      if (prev) {
        out.indicators[ind.id] = { ...prev, stale: true, lastError: err.message.slice(0, 500) };
        console.log(`    kept previous data from ${prev.fetched}`);
      } else {
        out.indicators[ind.id] = { id: ind.id, title: ind.title, release: ind.release, error: err.message.slice(0, 500), series: [] };
      }
    }
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(`\nDone: ${ok} updated, ${failed} failed. Saved ${OUT}`);
}

export { parseCsv, parseData, structureFromJson, structureFromXml, buildKey, pickSeries };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
