'use strict';

// =============================================
// CONFIG — persisted to localStorage
// =============================================
const CFG_KEY = 'opslog_config';

function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}
function saveConfig() {
  const cfg = {
    rotasUrl: el('cfg-rotas-url').value.trim(),
    appliancesUrl: el('cfg-appliances-url').value.trim(),
  };
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

// =============================================
// STATE
// =============================================
const S = {
  shiftMode: 'auto',           // 'auto' | 'override'
  overrideDate: null,          // Date object
  overrideShiftType: 'D',      // 'D' | 'N'

  detectedShiftLabel: '',      // 'Day' | 'Night'
  currentRota: '',
  incomingRota: '',

  currentIC: null,             // { rank, name }
  incomingIC: null,

  hasP3: false,
  p3Activator: null,           // { rank, name }
  p3Times: ['', '', '', '', ''],
  p3Overrides: [false, false, false, false, false],

  redconData: [],              // [{ code, rank, name }]

  rotas: [],                   // [{ rota, rank, name }] from Sheets
  appliances: [],              // [{ code }] from Sheets

  drumH: {},                   // { fieldId: selectedHour }
  drumM: {},                   // { fieldId: selectedMinute }
};

// =============================================
// ROTA CYCLE — mirrors VBA GetCurrentShiftInfo
// =============================================
const CYCLE_START = new Date(2026, 1, 17); // Feb 17 2026

const ROTA_MAP = {
  1: { day: ['Rota 1','Rota 2'], night: ['Rota 2','Rota 1'] },
  2: { day: ['Rota 1','Rota 2'], night: ['Rota 2','Rota 3'] },
  3: { day: ['Rota 3','Rota 1'], night: ['Rota 1','Rota 3'] },
  4: { day: ['Rota 3','Rota 1'], night: ['Rota 1','Rota 2'] },
  5: { day: ['Rota 2','Rota 3'], night: ['Rota 3','Rota 2'] },
  6: { day: ['Rota 2','Rota 3'], night: ['Rota 3','Rota 1'] },
};

function computeShift(refDate) {
  const h = refDate.getHours(), m = refDate.getMinutes();
  const totalMin = h * 60 + m;
  const isNight = totalMin >= 18 * 60 + 10 || totalMin < 8 * 60 + 10;

  const shiftDate = new Date(refDate);
  shiftDate.setHours(0, 0, 0, 0);
  if (isNight && totalMin < 8 * 60 + 10) shiftDate.setDate(shiftDate.getDate() - 1);

  const daysPassed = Math.floor((shiftDate - CYCLE_START) / 86400000);
  const cycleDay = ((daysPassed % 6) + 6) % 6 + 1;
  const key = isNight ? 'night' : 'day';
  const [cur, inc] = ROTA_MAP[cycleDay][key];

  return {
    shiftLabel: isNight ? 'Night' : 'Day',
    currentRota: cur,
    incomingRota: inc,
    shiftDate,
  };
}

function applyShiftResult(r) {
  S.detectedShiftLabel = r.shiftLabel;
  S.currentRota = r.currentRota;
  S.incomingRota = r.incomingRota;

  const badge = el('shift-badge');
  badge.textContent = r.shiftLabel + ' · ' + r.currentRota;
  badge.className = 'shift-badge ' + r.shiftLabel.toLowerCase();

  el('rota-display').innerHTML =
    `<span class="rota-chip">Current: <strong>${r.currentRota}</strong></span>` +
    `<span class="rota-chip">Incoming: <strong>${r.incomingRota}</strong></span>`;

  // Show/hide REDCON section
  if (r.shiftLabel === 'Night') {
    el('section-redcon').classList.remove('hidden');
  } else {
    el('section-redcon').classList.add('hidden');
    S.redconData = [];
  }

  renderICButtons();
  renderP3Activator();
  refreshDrums();
}

// =============================================
// SHIFT MODE
// =============================================
function setShiftMode(mode) {
  S.shiftMode = mode;
  toggle('btn-auto', mode === 'auto');
  toggle('btn-override', mode === 'override');
  el('override-panel').classList.toggle('hidden', mode === 'auto');

  if (mode === 'auto') {
    S.overrideDate = null;
    const r = computeShift(new Date());
    applyShiftResult(r);
  } else {
    if (!S.overrideDate) {
      S.overrideDate = new Date();
      S.overrideDate.setHours(0, 0, 0, 0);
    }
    applyOverrideShift();
  }
}

function setOverrideShiftType(t) {
  S.overrideShiftType = t;
  toggle('seg-day', t === 'D');
  toggle('seg-night', t === 'N');
  applyOverrideShift();
}

function applyOverrideShift() {
  if (!S.overrideDate) return;
  const ref = new Date(S.overrideDate);
  ref.setHours(S.overrideShiftType === 'D' ? 9 : 21, 0, 0, 0);
  const r = computeShift(ref);
  applyShiftResult(r);
}

// =============================================
// CALENDAR
// =============================================
let calViewYear, calViewMonth;

function initCalendar() {
  const now = new Date();
  calViewYear = now.getFullYear();
  calViewMonth = now.getMonth();
  renderCalendar();
}

function renderCalendar() {
  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const today = new Date(); today.setHours(0,0,0,0);
  const sel = S.overrideDate;

  const first = new Date(calViewYear, calViewMonth, 1);
  const startDow = first.getDay(); // 0=Sun
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  const dows = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html = `
    <div class="cal-header">
      <button class="cal-nav" onclick="calNav(-1)">‹</button>
      <span class="cal-month-label">${months[calViewMonth]} ${calViewYear}</span>
      <button class="cal-nav" onclick="calNav(1)">›</button>
    </div>
    <div class="cal-grid">
      ${dows.map(d => `<div class="cal-dow">${d}</div>`).join('')}
  `;

  for (let i = 0; i < startDow; i++) html += `<div class="cal-day empty"></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calViewYear, calViewMonth, d);
    let cls = 'cal-day';
    if (date.getTime() === today.getTime()) cls += ' today';
    if (sel && date.getTime() === sel.getTime()) cls += ' selected';
    html += `<div class="${cls}" onclick="selectCalDay(${calViewYear},${calViewMonth},${d})">${d}</div>`;
  }

  html += '</div>';
  el('calendar').innerHTML = html;
}

function calNav(dir) {
  calViewMonth += dir;
  if (calViewMonth < 0)  { calViewMonth = 11; calViewYear--; }
  if (calViewMonth > 11) { calViewMonth = 0;  calViewYear++; }
  renderCalendar();
}

function selectCalDay(y, m, d) {
  S.overrideDate = new Date(y, m, d);
  renderCalendar();
  applyOverrideShift();
}

// =============================================
// GOOGLE SHEETS — fetch CSV
// =============================================
function parseCSV(text) {
  return text.trim().split('\n').map(line => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());
    return cols;
  });
}

async function fetchSheet(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function loadFromSheets() {
  const cfg = loadConfig();

  if (cfg.rotasUrl) {
    try {
      const text = await fetchSheet(cfg.rotasUrl);
      const rows = parseCSV(text).slice(1); // skip header
      // Expected columns: RotaID, RotaName, Rank, Name
      S.rotas = rows.filter(r => r.length >= 4 && r[1]).map(r => ({
        rotaId: r[0].trim(),
        rota: r[1].trim(),
        rank: r[2].trim(),
        name: r[3].trim(),
      }));
    } catch (e) {
      console.warn('Could not load Rotas sheet:', e);
    }
  }

  if (cfg.appliancesUrl) {
    try {
      const text = await fetchSheet(cfg.appliancesUrl);
      const rows = parseCSV(text).slice(1);
      // Expected columns: Code, Description (optional)
      S.appliances = rows.filter(r => r.length >= 1 && r[0]).map(r => ({
        code: r[0].trim().toUpperCase(),
      }));
      renderApplianceList();
      const link = el('appliances-sheet-link');
      link.href = cfg.appliancesUrl;
      link.classList.remove('hidden');
    } catch (e) {
      console.warn('Could not load Appliances sheet:', e);
    }
  }

  renderICButtons();
  renderP3Activator();
}

async function reloadSheets() {
  saveConfig();
  await loadFromSheets();
}

function renderApplianceList() {
  const wrap = el('appliance-list');
  if (!S.appliances.length) {
    wrap.innerHTML = '<span class="no-names-hint">No appliances loaded.</span>';
    return;
  }
  wrap.innerHTML = S.appliances.map(a =>
    `<span class="appliance-chip">${a.code}</span>`
  ).join('');
}

// =============================================
// IC BUTTONS
// =============================================
function renderICButtons() {
  renderRotaButtons('current-ic-buttons', S.currentRota, 'currentIC');
  renderRotaButtons('incoming-ic-buttons', S.incomingRota, 'incomingIC');
}

function renderRotaButtons(containerId, rotaName, stateKey) {
  const container = el(containerId);
  const people = S.rotas.filter(r => r.rota === rotaName);

  if (!people.length) {
    container.innerHTML = `<span class="no-names-hint">No names loaded for ${rotaName}. Check Settings.</span>`;
    return;
  }

  container.innerHTML = people.map((p, i) =>
    `<button class="name-btn ${S[stateKey] && S[stateKey].rank === p.rank && S[stateKey].name === p.name ? 'selected' : ''}"
       onclick="selectIC('${stateKey}', '${esc(p.rank)}', '${esc(p.name)}')">
       <span class="rank-tag">${p.rank}</span>${p.name}
     </button>`
  ).join('');
}

function selectIC(stateKey, rank, name) {
  S[stateKey] = { rank, name };
  renderICButtons();
  if (S.hasP3) renderP3Activator();
}

// =============================================
// P3
// =============================================
function setP3(hasP3) {
  S.hasP3 = hasP3;
  toggle('btn-nop3', !hasP3);
  toggle('btn-yesp3', hasP3);
  el('p3-panel').classList.toggle('hidden', !hasP3);
}

function renderP3Activator() {
  const container = el('p3-activator-buttons');
  const allPeople = S.rotas.filter(r => r.rota === S.currentRota);

  if (!allPeople.length) {
    container.innerHTML = `<span class="no-names-hint">Load names in Settings first.</span>`;
    return;
  }

  container.innerHTML = allPeople.map(p =>
    `<button class="name-btn ${S.p3Activator && S.p3Activator.rank === p.rank && S.p3Activator.name === p.name ? 'selected' : ''}"
       onclick="selectP3Activator('${esc(p.rank)}', '${esc(p.name)}')">
       <span class="rank-tag">${p.rank}</span>${p.name}
     </button>`
  ).join('');
}

function selectP3Activator(rank, name) {
  S.p3Activator = { rank, name };
  renderP3Activator();
}

function toggleP3Override(idx) {
  S.p3Overrides[idx] = !S.p3Overrides[idx];
  const btn = el('ovr-' + idx);
  btn.classList.toggle('active', S.p3Overrides[idx]);
  rebuildDrum('p3-' + idx + '-h', idx);
  rebuildDrum('p3-' + idx + '-m', idx);
}

// =============================================
// DRUM PICKER
// =============================================
const ITEM_H = 44; // must match --drum-h in CSS

// Returns true if this HHMM value falls within the shift window.
function isHHMMAllowedInShift(h, m, shiftLabel, override) {
  if (override) return true;
  const hhmm = h * 100 + m;
  if (shiftLabel === 'Day') return hhmm >= 800 && hhmm <= 1800;
  // Night 1800–0800 inclusive; 0801–1759 are outside
  return hhmm >= 1800 || hhmm <= 800;
}

// Coarse hour check: is ANY minute at this hour allowed in the shift window?
function isHourAllowed(h, shiftLabel, override) {
  if (override) return true;
  if (shiftLabel === 'Day') return h >= 8 && h <= 18;
  // Night: hours 18-23 and 0-8 have at least one valid minute
  return h >= 18 || h <= 8;
}

function isTimeAllowed(h, m, shiftLabel, override, prevHHMM) {
  if (!isHHMMAllowedInShift(h, m, shiftLabel, override)) return false;
  if (prevHHMM === null) return true;
  const cur = nightOrder(h * 100 + m, shiftLabel);
  const prev = nightOrder(prevHHMM, shiftLabel);
  return cur > prev;
}

function nightOrder(hhmm, shiftLabel) {
  if (shiftLabel !== 'Night') return hhmm;
  return hhmm <= 810 ? hhmm + 2400 : hhmm;
}

function getPrevP3Time(idx) {
  if (idx === 0) return null;
  const t = S.p3Times[idx - 1];
  if (!t) return null;
  return parseInt(t, 10);
}

function buildDrumItems(type, drumIdx) {
  // type: 'h' or 'm'
  const override = S.p3Overrides[drumIdx];
  const shiftLabel = S.detectedShiftLabel;
  const prevHHMM = getPrevP3Time(drumIdx);

  const items = [];
  const count = type === 'h' ? 24 : 60;

  for (let v = 0; v < count; v++) {
    let allowed = true;
    if (type === 'h') {
      allowed = isHourAllowed(v, shiftLabel, override);
    } else {
      const curH = S.drumH['p3-' + drumIdx + '-h'] ?? (shiftLabel === 'Day' ? 8 : 18);
      allowed = isTimeAllowed(curH, v, shiftLabel, override, prevHHMM);
    }
    items.push({ v, allowed });
  }
  return items;
}

function rebuildDrum(fieldId, drumIdx) {
  const drumEl = el('drum-' + fieldId);
  if (!drumEl) return;

  const type = fieldId.endsWith('-h') ? 'h' : 'm';
  const items = buildDrumItems(type, drumIdx);

  // Build track: pad top and bottom with 1 empty item so first/last can center
  let html = '<div class="drum-track">';
  html += '<div class="drum-item" style="visibility:hidden">00</div>';
  items.forEach(({ v, allowed }) => {
    const label = String(v).padStart(2, '0');
    html += `<div class="drum-item${allowed ? '' : ' disabled'}" data-value="${v}">${label}</div>`;
  });
  html += '<div class="drum-item" style="visibility:hidden">00</div>';
  html += '</div>';
  html += '<div class="drum-selector"></div>';

  drumEl.innerHTML = html;

  const track = drumEl.querySelector('.drum-track');

  // Restore selected value (or snap to first allowed)
  const stateKey = type === 'h' ? 'drumH' : 'drumM';
  let curVal = S[stateKey][fieldId];
  if (curVal === undefined) {
    const firstAllowed = items.find(i => i.allowed);
    curVal = firstAllowed ? firstAllowed.v : 0;
    S[stateKey][fieldId] = curVal;
  }

  // If the saved value is now disabled (e.g. override toggled off), snap to first valid
  const savedItem = drumEl.querySelector(`.drum-item[data-value="${curVal}"]`);
  if (savedItem && savedItem.classList.contains('disabled')) {
    const firstAllowed = items.find(i => i.allowed);
    if (firstAllowed) {
      curVal = firstAllowed.v;
      S[stateKey][fieldId] = curVal;
      updateP3TimeFromDrums(drumIdx);
    }
  }

  scrollToValue(track, curVal, false);

  let scrollTimer = null;
  track.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => onDrumScrollEnd(track, fieldId, drumIdx, type, stateKey), 120);
  });
}

function scrollToValue(track, value, smooth) {
  // Items: index 0 is padding, so actual item at index (value + 1)
  const targetY = value * ITEM_H; // padding item scrolls it into center
  track.scrollTo({ top: targetY, behavior: smooth ? 'smooth' : 'instant' });
}

function onDrumScrollEnd(track, fieldId, drumIdx, type, stateKey) {
  const idx = Math.round(track.scrollTop / ITEM_H);
  // Use data-value attribute for unambiguous lookup (avoids padding sentinel items)
  const item = track.querySelector(`.drum-item[data-value="${idx}"]`);
  if (!item) return;

  const v = parseInt(item.dataset.value, 10);

  if (item.classList.contains('disabled')) {
    // Snap back to currently saved valid value
    const cur = S[stateKey][fieldId] ?? 0;
    scrollToValue(track, cur, true);
    return;
  }

  S[stateKey][fieldId] = v;
  updateP3TimeFromDrums(drumIdx);

  // Hour change may invalidate minutes for the same drum
  if (type === 'h') rebuildDrum('p3-' + drumIdx + '-m', drumIdx);

  // All subsequent drums may have new minimum constraints
  for (let i = drumIdx + 1; i < 5; i++) {
    rebuildDrum('p3-' + i + '-h', i);
    rebuildDrum('p3-' + i + '-m', i);
  }
}

function updateP3TimeFromDrums(drumIdx) {
  const h = S.drumH['p3-' + drumIdx + '-h'] ?? 0;
  const m = S.drumM['p3-' + drumIdx + '-m'] ?? 0;
  S.p3Times[drumIdx] = String(h).padStart(2, '0') + String(m).padStart(2, '0');
}

function refreshDrums() {
  // Reset all drum states when shift changes
  S.drumH = {};
  S.drumM = {};
  S.p3Times = ['', '', '', '', ''];
  for (let i = 0; i < 5; i++) {
    rebuildDrum('p3-' + i + '-h', i);
    rebuildDrum('p3-' + i + '-m', i);
  }
}

// =============================================
// REDCON PARSER
// =============================================
function parseRedcon() {
  const text = el('redcon-paste').value;
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const A4_RE = /^A4\d{2}$/i;
  const found = {};

  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].trim().toUpperCase();
    if (!A4_RE.test(code)) continue;

    let rank = '', name = '';
    for (let j = i + 1; j < lines.length && j <= i + 5; j++) {
      const t = lines[j].trim();
      if (!t) continue;
      if (!rank) { rank = t; continue; }
      if (!name) { name = t; break; }
    }
    found[code] = { rank, name };
  }

  // Merge with master appliance list
  const masterCodes = S.appliances.length
    ? S.appliances.map(a => a.code)
    : Object.keys(found);

  S.redconData = masterCodes.map(code => ({
    code,
    rank: found[code]?.rank || '',
    name: found[code]?.name || '',
    matched: !!found[code],
  }));

  // Also add any parsed codes not in master list
  Object.keys(found).forEach(code => {
    if (!S.redconData.find(r => r.code === code)) {
      S.redconData.push({ code, rank: found[code].rank, name: found[code].name, matched: true });
    }
  });

  renderRedconTable();
}

function renderRedconTable() {
  const wrap = el('redcon-results');
  if (!S.redconData.length) {
    wrap.classList.add('hidden');
    return;
  }

  const rows = S.redconData.map(r =>
    `<tr class="${r.matched ? 'matched' : 'unmatched'}">
       <td class="code">${r.code}</td>
       <td>${r.rank || '—'}</td>
       <td>${r.name || '—'}</td>
     </tr>`
  ).join('');

  wrap.innerHTML = `
    <table class="redcon-table">
      <thead><tr><th>Code</th><th>Rank</th><th>Name</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  wrap.classList.remove('hidden');
}

// =============================================
// GENERATE CLIPBOARD STRING
// =============================================
function generate() {
  const errors = validate();
  if (errors.length) {
    showMsg(errors.join('\n'), 'error');
    return;
  }

  const shiftType = S.shiftMode === 'auto' ? 'AUTO' : 'OVERRIDE';
  const shiftSpec = S.shiftMode === 'override'
    ? fmtDate(S.overrideDate) + '-' + S.overrideShiftType
    : '';

  const parts = [
    'OPSLOG',
    '1',
    shiftType,
    shiftSpec,
    S.currentIC.rank,
    S.currentIC.name,
    S.incomingIC.rank,
    S.incomingIC.name,
    S.hasP3 ? 'YES' : 'NO',
    S.hasP3 ? S.p3Activator.rank : '',
    S.hasP3 ? S.p3Activator.name : '',
    S.hasP3 ? S.p3Times[0] : '',
    S.hasP3 ? (S.p3Overrides[0] ? '1' : '0') : '',
    S.hasP3 ? S.p3Times[1] : '',
    S.hasP3 ? (S.p3Overrides[1] ? '1' : '0') : '',
    S.hasP3 ? S.p3Times[2] : '',
    S.hasP3 ? (S.p3Overrides[2] ? '1' : '0') : '',
    S.hasP3 ? S.p3Times[3] : '',
    S.hasP3 ? (S.p3Overrides[3] ? '1' : '0') : '',
    S.hasP3 ? S.p3Times[4] : '',
    S.hasP3 ? (S.p3Overrides[4] ? '1' : '0') : '',
  ];

  // REDCON
  const redconFiltered = S.redconData.filter(r => r.rank && r.name);
  parts.push(String(redconFiltered.length));
  redconFiltered.forEach(r => parts.push(r.code, r.rank, r.name));

  const code = parts.join('|');

  navigator.clipboard.writeText(code).then(() => {
    showMsg('✓ Code copied to clipboard.\n\nGo to Excel and run GenerateFromClipboard (Alt+F8).', 'success');
    el('generate-label').textContent = 'Copied!';
    setTimeout(() => { el('generate-label').textContent = 'Copy Code to Clipboard'; }, 3000);
  }).catch(() => {
    // Fallback for browsers that block clipboard API
    prompt('Copy this code manually (Ctrl+C):', code);
  });
}

function validate() {
  const errs = [];
  if (!S.currentIC)  errs.push('• Select the Current IC.');
  if (!S.incomingIC) errs.push('• Select the Incoming IC.');
  if (S.hasP3) {
    if (!S.p3Activator) errs.push('• Select who activated P3.');
    S.p3Times.forEach((t, i) => {
      if (!t) errs.push(`• Enter P3 timing ${i + 1}.`);
    });
  }
  if (S.detectedShiftLabel === 'Night') {
    const matched = S.redconData.filter(r => r.rank && r.name);
    if (!matched.length) errs.push('• Paste REDCON data for night shift.');
  }
  return errs;
}

// =============================================
// SETTINGS TOGGLE
// =============================================
function toggleSettings() {
  const panel = el('settings-panel');
  const chevron = el('settings-chevron');
  const open = panel.classList.toggle('hidden') === false;
  chevron.textContent = open ? '▾' : '▸';
}

// =============================================
// UTILS
// =============================================
function el(id) { return document.getElementById(id); }

function toggle(id, active) {
  el(id).classList.toggle('active', active);
}

function esc(s) { return s.replace(/'/g, "\\'"); }

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function showMsg(text, type) {
  const msg = el('generate-msg');
  msg.textContent = text;
  msg.className = 'generate-msg ' + type;
  msg.classList.remove('hidden');
}

// =============================================
// INIT
// =============================================
async function init() {
  // Load saved config into fields
  const cfg = loadConfig();
  if (cfg.rotasUrl)      el('cfg-rotas-url').value      = cfg.rotasUrl;
  if (cfg.appliancesUrl) el('cfg-appliances-url').value = cfg.appliancesUrl;

  // Detect shift
  const r = computeShift(new Date());
  applyShiftResult(r);

  // Init calendar (hidden until override selected)
  initCalendar();

  // Load sheets
  await loadFromSheets();

  // Build drums
  refreshDrums();
}

document.addEventListener('DOMContentLoaded', init);
