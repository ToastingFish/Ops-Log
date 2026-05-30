'use strict';

// =============================================
// FILE LOADER
// Replaces fetch-based CSV loading with the
// browser FileReader API so that local CSV
// files work even when the page is hosted
// remotely (e.g. GitHub Pages).
//
// Loaded after app.js — overrides loadFromCSV
// and reloadData so the fetch path is never hit.
// =============================================

const FL_META_KEY = 'opslog_fl_meta_v1';

function flLoadMeta() {
  try { return JSON.parse(localStorage.getItem(FL_META_KEY)) || {}; } catch { return {}; }
}
function flSaveMeta(meta) {
  localStorage.setItem(FL_META_KEY, JSON.stringify(meta));
}
function flFmtDate(ts) {
  if (!ts) return 'Never loaded';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day:'2-digit', month:'short', year:'numeric' }) +
         ' ' + d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
}

// ---- Render last-loaded timestamps in UI ----
function renderFileLoaderStatus() {
  const meta = flLoadMeta();
  ['rotas','appliances','people'].forEach(key => {
    const el2 = document.getElementById(`fl-status-${key}`);
    if (el2) el2.textContent = flFmtDate(meta[key] || 0);
  });
}

// ---- FileReader entry point ----
function handleFileUpload(type, file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    processUploadedCSV(type, e.target.result);
    const meta = flLoadMeta();
    meta[type] = Date.now();
    flSaveMeta(meta);
    renderFileLoaderStatus();
  };
  reader.onerror = () => {
    alert(`Could not read the file. Please try again.`);
  };
  reader.readAsText(file);
}

// ---- Parse and store each CSV type ----
function processUploadedCSV(type, text) {
  if (type === 'rotas') {
    const rows = parseCSV(text).slice(1);
    S.rotas = rows
      .filter(r => r.length >= 4 && r[1])
      .map(r => ({ rota: r[1].trim(), rank: r[2].trim().toUpperCase(), name: r[3].trim().toUpperCase() }));
    S.rotas.forEach(p => findOrAddRotaPerson(p.rota, p.rank, p.name));
    renderICButtons();
    renderRotaPeopleList();

  } else if (type === 'appliances') {
    const rows = parseCSV(text).slice(1);
    S.appliances = rows
      .filter(r => r.length >= 1 && r[0])
      .map(r => ({ code: r[0].trim().toUpperCase(), desc: (r[1] || '').trim() }));
    renderApplianceList();

  } else if (type === 'people') {
    const rows = parseCSV(text).slice(1);
    const db = loadPeopleDB();
    let changed = false;
    rows.forEach(r => {
      if (r.length >= 3 && r[0] && !isNaN(parseInt(r[0], 10))) {
        const id = parseInt(r[0], 10);
        if (!db.people.find(p => p.id === id)) {
          db.people.push({ id, rank: r[1].trim().toUpperCase(), name: r[2].trim().toUpperCase() });
          if (id >= db.nextId) db.nextId = id + 1;
          changed = true;
        }
      }
    });
    if (changed) savePeopleDB(db);
    renderPeopleList();
  }

  updateValidation();
}

// ---- Override app.js functions that use fetch ----

// Silence the fetch-based loader — CSVs come from file picker now.
async function loadFromCSV() {}

// Reload button is no longer needed for CSV fetch; keep as UI refresh.
async function reloadData() {
  renderICButtons();
  renderApplianceList();
  renderPeopleList();
  renderRotaPeopleList();
  updateValidation();
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  // Give app.js init() a tick to finish, then render timestamps.
  setTimeout(renderFileLoaderStatus, 0);
});
