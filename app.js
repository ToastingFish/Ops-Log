'use strict';

// =============================================
// ROTAS & APPLIANCES  localStorage management
// =============================================
const ROTAS_KEY      = 'opslog_rotas_v1';
const APPLIANCES_KEY = 'opslog_appliances_v1';

const ROTAS_TS_KEY      = 'opslog_rotas_ts_v1';
const APPLIANCES_TS_KEY = 'opslog_appliances_ts_v1';

function loadRotasFromStorage()      { try { return JSON.parse(localStorage.getItem(ROTAS_KEY))      || []; } catch { return []; } }
function saveRotasToStorage()        { localStorage.setItem(ROTAS_KEY, JSON.stringify(S.rotas)); localStorage.setItem(ROTAS_TS_KEY, String(Date.now())); }
function loadAppliancesFromStorage() { try { return JSON.parse(localStorage.getItem(APPLIANCES_KEY)) || []; } catch { return []; } }
function saveAppliancesToStorage()   { localStorage.setItem(APPLIANCES_KEY, JSON.stringify(S.appliances)); localStorage.setItem(APPLIANCES_TS_KEY, String(Date.now())); }

function timeAgo(ts) {
  if (!ts) return 'never';
  const d = Math.floor((Date.now() - Number(ts)) / 1000);
  if (d < 60)  return 'just now';
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

function rebuildRotaPeopleDB() {
  saveRotaPeopleDB({nextId:1, people:[]});
  S.rotas.forEach(p => findOrAddRotaPerson(p.rota, p.rank, p.name));
  S.currentRotaPersonId = null;
  S.incomingRotaPersonId = null;
  renderICButtons();
  updateValidation();
}

// ---- IC entry CRUD ----
function addRotaEntryFromUI() {
  const rota = S.settingsRotaTab || 'Rota 1';
  const rank = el('new-entry-rank').value.trim().toUpperCase();
  const name = el('new-entry-name').value.trim().toUpperCase();
  if (!name) return;
  if (!S.rotas.find(r => r.rota===rota && r.rank===rank && r.name===name))
    S.rotas.push({rota, rank, name});
  saveRotasToStorage();
  el('new-entry-rank').value = ''; el('new-entry-name').value = '';
  rebuildRotaPeopleDB(); renderRotaSettingsList();
  showToast(` ${name} added to ${rota}`);
}

function removeRotaEntry(idx) {
  S.rotas.splice(idx, 1);
  saveRotasToStorage();
  rebuildRotaPeopleDB(); renderRotaSettingsList();
}

function importRotaEntriesFromUI() {
  const text = el('rota-import-text').value.trim(); if (!text) return;
  const VALID_ROTAS = ['Rota 1','Rota 2','Rota 3'];
  const byRota = {};
  text.split(/\n/).forEach(line => {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length === 3) {
      const [rota, rank, name] = [parts[0], parts[1].toUpperCase(), parts[2].toUpperCase()];
      if (name && VALID_ROTAS.includes(rota)) {
        if (!byRota[rota]) byRota[rota] = [];
        byRota[rota].push({rota, rank, name});
      }
    }
  });
  const rotasFound = Object.keys(byRota);
  if (!rotasFound.length) { showToast('No valid entries found'); return; }
  // Force-overwrite: remove existing entries for each rota found in import
  S.rotas = S.rotas.filter(r => !rotasFound.includes(r.rota));
  rotasFound.forEach(rota => S.rotas.push(...byRota[rota]));
  const total = rotasFound.reduce((s, r) => s + byRota[r].length, 0);
  saveRotasToStorage(); rebuildRotaPeopleDB(); renderRotaSettingsList();
  showToast(` ${total} name${total>1?'s':''} imported (replaced existing)`);
  el('rota-import-text').value = '';
}

function setRotaTab(rota){ S.settingsRotaTab=rota; S.settingsEditIdx=null; S.settingsRotaAddingInline=null; renderRotaSettingsList(); }

function renderRotaSettingsList() {
  const wrap = el('rota-entries-list'); if (!wrap) return;
  const tab = S.settingsRotaTab || 'Rota 1';
  const tabsHTML = ['Rota 1','Rota 2','Rota 3'].map(r =>
    `<button class="settings-tab rota-tab-${rotaNum(r)}${r===tab?' active':''}" onclick="setRotaTab('${r}')">${r}</button>`
  ).join('');
  const filtered = S.rotas.map((r,i)=>({...r,i})).filter(r=>r.rota===tab);
  const ts = timeAgo(localStorage.getItem(ROTAS_TS_KEY));
  let listHTML;
  if (!filtered.length) {
    listHTML = `<div class="settings-empty-hint">No entries for ${tab}  add one below.</div>`;
  } else {
    const cls = {'Rota 1':'re-r1','Rota 2':'re-r2','Rota 3':'re-r3'};
    listHTML = filtered.map(({rota,rank,name,i}) => {
      const rn = rotaNum(rota);
      if (S.settingsEditIdx === i) {
        return `<div class="rota-entry-row" data-rota="${rn}">
          <span class="rota-entry-badge ${cls[rota]||''}">${rota}</span>
          <input class="text-input settings-sm" id="edit-rank-${i}" value="${esc(rank)}" placeholder="Rank">
          <input class="text-input settings-sm" id="edit-name-${i}" value="${esc(name)}" placeholder="Name"
                 onkeydown="if(event.key==='Enter')saveRotaEntryEdit(${i})">
          <button class="secondary-btn-sm" onclick="saveRotaEntryEdit(${i})">Save</button>
          <button class="entry-remove-btn" onclick="cancelRotaEntryEdit()" title="Cancel"></button>
        </div>`;
      }
      return `<div class="rota-entry-row" data-rota="${rn}" data-idx="${i}" draggable="true"
          ondragstart="rotaDragStart(event,${i})" ondragover="rotaDragOver(event)" ondrop="rotaDrop(event,${i})" ondragleave="rotaDragLeave(event)">
        <span class="drag-handle" title="Drag to reorder"></span>
        <span class="rota-entry-badge ${cls[rota]||''}">${rota}</span>
        <span class="rota-entry-rank">${esc(rank)||''}</span>
        <span class="rota-entry-name">${esc(name)}</span>
        <button class="entry-edit-btn" onclick="editRotaEntry(${i})" title="Edit"></button>
        <button class="entry-remove-btn" onclick="removeRotaEntry(${i})" title="Remove"></button>
      </div>`;
    }).join('');
  }
  const rotaIdx = ['Rota 1','Rota 2','Rota 3'].indexOf(tab);
  const posClass = rotaIdx === 0 ? 'tab-pos-first' : rotaIdx === 2 ? 'tab-pos-last' : 'tab-pos-mid';
  const isAddingInline = S.settingsRotaAddingInline === tab;
  const addSection = isAddingInline
    ? `<div class="add-personnel-inline">
        <input type="text" class="text-input settings-sm" id="inline-rota-rank" placeholder="Rank"
               onkeydown="if(event.key==='Enter')el('inline-rota-name').focus()">
        <input type="text" class="text-input settings-sm" id="inline-rota-name" placeholder="Name"
               onkeydown="if(event.key==='Enter')confirmRotaAddInline()">
        <button class="secondary-btn-sm" onclick="confirmRotaAddInline()">Add</button>
        <button class="entry-remove-btn" onclick="cancelRotaAddInline()"></button>
      </div>`
    : `<button class="add-personnel-btn" onclick="showRotaAddInline('${tab}')"> Click to add personnel</button>`;
  wrap.innerHTML = `<div class="settings-tabs">${tabsHTML}</div>
    <div class="settings-tab-content rc-${rotaNum(tab)} ${posClass}">
      <div class="rota-entries-body">${listHTML}</div>
      ${addSection}
      <span class="settings-ts" style="display:block;margin-top:4px">Last changed: ${ts}</span>
    </div>`;
  if (isAddingInline) setTimeout(() => { const f=el('inline-rota-rank'); if(f) f.focus(); }, 0);
}

function showRotaAddInline(tab) {
  S.settingsRotaAddingInline = tab;
  renderRotaSettingsList();
}
function cancelRotaAddInline() {
  S.settingsRotaAddingInline = null;
  renderRotaSettingsList();
}
function confirmRotaAddInline() {
  const rota = S.settingsRotaAddingInline || S.settingsRotaTab || 'Rota 1';
  const rank = (el('inline-rota-rank')?.value || '').trim().toUpperCase();
  const name = (el('inline-rota-name')?.value || '').trim().toUpperCase();
  if (!name) { el('inline-rota-name')?.focus(); return; }
  if (!S.rotas.find(r => r.rota===rota && r.rank===rank && r.name===name))
    S.rotas.push({rota, rank, name});
  saveRotasToStorage();
  S.settingsRotaAddingInline = null;
  rebuildRotaPeopleDB(); renderRotaSettingsList();
  showToast(` ${name} added to ${rota}`);
}

function editRotaEntry(idx){
  S.settingsEditIdx=idx; renderRotaSettingsList();
  setTimeout(()=>{ const f=el(`edit-name-${idx}`); if(f)f.focus(); },0);
}
function cancelRotaEntryEdit(){ S.settingsEditIdx=null; renderRotaSettingsList(); }

let _dragFromIdx=null;
function rotaDragStart(e,idx){ _dragFromIdx=idx; e.dataTransfer.effectAllowed='move'; e.currentTarget.classList.add('drag-active'); }
function rotaDragOver(e){ e.preventDefault(); e.dataTransfer.dropEffect='move'; e.currentTarget.classList.add('drag-over'); }
function rotaDragLeave(e){ e.currentTarget.classList.remove('drag-over'); }
function rotaDrop(e,toIdx){
  e.preventDefault(); e.currentTarget.classList.remove('drag-over');
  if(_dragFromIdx===null||_dragFromIdx===toIdx){_dragFromIdx=null;return;}
  const moved=S.rotas.splice(_dragFromIdx,1)[0];
  S.rotas.splice(toIdx,0,moved);
  _dragFromIdx=null;
  saveRotasToStorage(); rebuildRotaPeopleDB(); renderRotaSettingsList();
  showToast(' Order updated');
}
function saveRotaEntryEdit(idx){
  const rank=(el(`edit-rank-${idx}`)?.value||'').trim().toUpperCase();
  const name=(el(`edit-name-${idx}`)?.value||'').trim().toUpperCase();
  if(!name) return;
  S.rotas[idx].rank=rank; S.rotas[idx].name=name;
  S.settingsEditIdx=null;
  saveRotasToStorage(); rebuildRotaPeopleDB(); renderRotaSettingsList();
  showToast(` ${name} updated`);
}

// ---- Appliance CRUD ----
function addApplianceFromUI() {
  const code = el('new-appliance-code').value.trim().toUpperCase(); if (!code) return;
  if (!S.appliances.find(a => a.code === code)) { S.appliances.push({code, desc:''}); sortAppliances(); saveAppliancesToStorage(); renderApplianceSettingsList(); showToast(` ${code} added`); }
  el('new-appliance-code').value = '';
}

function removeAppliance(idx) {
  S.appliances.splice(idx, 1); saveAppliancesToStorage(); renderApplianceSettingsList();
}

function importAppliancesFromUI() {
  const text = el('appliance-import-text').value.trim(); if (!text) return;
  const codes = text.split(/[\n,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!codes.length) { showToast('No valid entries found'); return; }
  // Force-overwrite: replace all appliances
  S.appliances = codes.map(code => ({code, desc:''}));
  sortAppliances(); saveAppliancesToStorage(); renderApplianceSettingsList();
  showToast(` ${codes.length} appliance${codes.length>1?'s':''} imported (replaced existing)`);
  el('appliance-import-text').value = '';
}

function setStnTab(stn){ S.settingsStnTab=stn; renderApplianceSettingsList(); }

function renderApplianceSettingsList() {
  const wrap = el('appliance-settings-list'); if (!wrap) return;
  if (!S.appliances.length) {
    wrap.innerHTML = '<span class="no-names-hint">No appliances yet  add one below or use Quick Import.</span>';
    return;
  }
  const stns = [...new Set(S.appliances.map(a=>getStnFromCode(a.code)).filter(Boolean))].sort();
  if (!S.settingsStnTab || !stns.includes(S.settingsStnTab)) S.settingsStnTab = stns[0]||null;
  const tab = S.settingsStnTab;
  const tabsHTML = stns.map(stn => {
    const n=stn.replace('STN','');
    return `<button class="settings-tab stn-tab-${n}${stn===tab?' active':''}" onclick="setStnTab('${stn}')">${stn}</button>`;
  }).join('');
  const ts = timeAgo(localStorage.getItem(APPLIANCES_TS_KEY));
  const filtered = tab ? S.appliances.map((a,i)=>({...a,i})).filter(a=>getStnFromCode(a.code)===tab) : S.appliances.map((a,i)=>({...a,i}));
  const listHTML = filtered.length
    ? filtered.map(({code,i}) => `
        <div class="appliance-entry-row ${stnClass(code)}">
          <span class="appliance-code-tag">${esc(code)}</span>
          <button class="entry-remove-btn" onclick="removeAppliance(${i})" title="Remove"></button>
        </div>`).join('')
    : `<div class="settings-empty-hint">No appliances for ${tab}.</div>`;
  const stnIdx = stns.indexOf(tab);
  const stnPos = stnIdx === 0 ? 'tab-pos-first' : stnIdx === stns.length-1 ? 'tab-pos-last' : 'tab-pos-mid';
  const stnNum = tab ? tab.replace('STN','') : '';
  wrap.innerHTML = `<div class="settings-tabs">${tabsHTML}</div>
    <div class="settings-tab-content stn-content-${stnNum} ${stnPos}">
      <div class="appliance-entries-body">${listHTML}</div>
      <span class="settings-ts" style="display:block;margin-top:4px">Last changed: ${ts}</span>
    </div>`;
}

// =============================================
// ROTA PEOPLE DATABASE
// =============================================
const ROTA_PEOPLE_KEY = 'opslog_rota_people_v2';
function loadRotaPeopleDB() {
  try {
    const d = JSON.parse(localStorage.getItem(ROTA_PEOPLE_KEY));
    return (d && Array.isArray(d.people)) ? d : { nextId: 1, people: [] };
  } catch { return { nextId: 1, people: [] }; }
}
function saveRotaPeopleDB(db) { localStorage.setItem(ROTA_PEOPLE_KEY, JSON.stringify(db)); }
function findOrAddRotaPerson(rota, rank, name) {
  rota = (rota||'').trim(); rank = (rank||'').trim().toUpperCase(); name = (name||'').trim().toUpperCase();
  if (!name) return null;
  const db = loadRotaPeopleDB();
  const ex = db.people.find(p => p.rank === rank && p.name === name);
  if (ex) return ex.id;
  const np = { id: db.nextId++, rota, rank, name }; db.people.push(np); saveRotaPeopleDB(db); return np.id;
}
function getRotaPersonById(id) {
  if (id == null) return null; return loadRotaPeopleDB().people.find(p => p.id === id) || null;
}

// =============================================
// ALPHA MANNING PEOPLE DATABASE
// =============================================
const PEOPLE_KEY = 'opslog_people_v2';
function loadPeopleDB() {
  try {
    const d = JSON.parse(localStorage.getItem(PEOPLE_KEY));
    return (d && Array.isArray(d.people)) ? d : { nextId: 1, people: [] };
  } catch { return { nextId: 1, people: [] }; }
}
function savePeopleDB(db) { localStorage.setItem(PEOPLE_KEY, JSON.stringify(db)); }
function findOrAddPerson(rank, name) {
  rank = (rank||'').trim().toUpperCase(); name = (name||'').trim().toUpperCase();
  if (!rank && !name) return null;
  const db = loadPeopleDB();
  const ex = db.people.find(p => p.rank === rank && p.name === name);
  if (ex) return ex.id;
  const np = { id: db.nextId++, rank, name }; db.people.push(np); savePeopleDB(db); return np.id;
}
function getPersonById(id) {
  if (!id) return null; return loadPeopleDB().people.find(p => p.id === id) || null;
}

// =============================================
// STATE
// =============================================
const S = {
  shiftMode: 'auto', overrideDate: null, overrideShiftType: 'D',
  detectedShiftLabel: '', currentRota: '', incomingRota: '',
  currentRotaPersonId: null, incomingRotaPersonId: null,

  // Turnouts (replaces single hasP3 toggle)
  turnouts: [],
  activeTurnoutIdx: null,

  // Drum scratchpad  loaded from the active turnout when timing popup opens
  timeH:            [null,  null,  null,  null,  null],
  timeM:            [null,  null,  null,  null,  null],
  timeAutoSet:      [false, false, false, false, false],
  timeBlocked:      [false, false, false, false, false],
  timeGapDismissed: [false, false, false, false, false],
  p3Times:          ['', '', '', '', ''],
  timeSuggested:    [false, false, false, false, false],
  timeSuggestH:     [null,  null,  null,  null,  null],
  timeSuggestM:     [null,  null,  null,  null,  null],

  // REDCON
  redconData: [],
  redconCautionState: null,      // null | 'empty' | 'nonames'
  redconCautionDismissed: false,

  rotas: [], appliances: [],

  // Settings UI state
  settingsRotaTab: 'Rota 1',
  settingsStnTab:  null,
  settingsEditIdx: null,
  settingsRotaAddingInline: null,  // null | 'Rota 1' | 'Rota 2' | 'Rota 3'
  settingsOhTab: 'ops',
  settingsOhAddingInline: null,    // null | 'ops' | 'ems'
  settingsOhEditIdx: null,
};

// =============================================
// COLOUR HELPERS
// =============================================
function rotaNum(rotaName){ return (rotaName||'').replace('Rota ',''); }
function getStnFromCode(code){
  const m=String(code).match(/^[Aa](\d{2})/);
  return m?'STN'+m[1]:null;
}
function sortAppliances(){
  S.appliances.sort((a,b)=>{
    const sa=getStnFromCode(a.code)||'', sb=getStnFromCode(b.code)||'';
    if(sa!==sb) return sa.localeCompare(sb);
    return a.code.localeCompare(b.code, undefined, {numeric:true});
  });
}
function stnClass(code){
  const s=getStnFromCode(code); return s?'stn-'+s.replace('STN',''):'';
}

// =============================================
// ROTA CYCLE
// =============================================
const CYCLE_START = new Date(2026, 1, 17);
const ROTA_MAP = {
  1:{day:['Rota 1','Rota 2'],night:['Rota 2','Rota 1']},
  2:{day:['Rota 1','Rota 2'],night:['Rota 2','Rota 3']},
  3:{day:['Rota 3','Rota 1'],night:['Rota 1','Rota 3']},
  4:{day:['Rota 3','Rota 1'],night:['Rota 1','Rota 2']},
  5:{day:['Rota 2','Rota 3'],night:['Rota 3','Rota 2']},
  6:{day:['Rota 2','Rota 3'],night:['Rota 3','Rota 1']},
};
function computeShift(refDate) {
  const h = refDate.getHours(), m = refDate.getMinutes();
  const totalMin = h * 60 + m;
  const isNight = totalMin >= 18*60 || totalMin < 8*60;
  const sd = new Date(refDate); sd.setHours(0,0,0,0);
  if (isNight && totalMin < 8*60) sd.setDate(sd.getDate()-1);
  const dp = Math.floor((sd - CYCLE_START)/86400000);
  const cy = ((dp % 6)+6)%6+1;
  const [cur,inc] = ROTA_MAP[cy][isNight?'night':'day'];
  return { shiftLabel: isNight?'Night':'Day', currentRota: cur, incomingRota: inc };
}
function applyShiftResult(r) {
  S.detectedShiftLabel = r.shiftLabel; S.currentRota = r.currentRota; S.incomingRota = r.incomingRota;
  const icon = r.shiftLabel === 'Day' ? '☀️' : '🌙';
  const badge = el('shift-badge');
  badge.textContent = r.currentRota + ' ' + icon;
  badge.className = 'shift-badge rota-badge-' + rotaNum(r.currentRota);
  // Auto-detect display: show date + shift label
  const autoDisp = el('auto-detect-display');
  if (autoDisp && S.shiftMode !== 'override') {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    autoDisp.innerHTML = `<span class="auto-detect-date">${dateStr}</span><span class="auto-detect-shift">${r.shiftLabel} Shift ${icon}</span>`;
    autoDisp.classList.remove('hidden');
  } else if (autoDisp) {
    autoDisp.classList.add('hidden');
  }
  el('rota-display').innerHTML =
    `<span class="rota-chip rc-${rotaNum(r.currentRota)}">Current: <strong>${r.currentRota}</strong></span>` +
    `<span class="rota-chip rc-${rotaNum(r.incomingRota)}">Incoming: <strong>${r.incomingRota}</strong></span>`;
  // Update combined IC section chips and column tints
  const chipCur = el('ic-chip-current'), chipInc = el('ic-chip-incoming');
  const colCur = el('ic-col-current'), colInc = el('ic-col-incoming');
  if (chipCur) { chipCur.textContent = ''; chipCur.className = `ic-rota-chip rc-${rotaNum(r.currentRota)}`; chipCur.innerHTML = `Current: <strong>${r.currentRota}</strong>`; }
  if (chipInc) { chipInc.textContent = ''; chipInc.className = `ic-rota-chip rc-${rotaNum(r.incomingRota)}`; chipInc.innerHTML = `Incoming: <strong>${r.incomingRota}</strong>`; }
  if (colCur) colCur.dataset.rota = rotaNum(r.currentRota);
  if (colInc) colInc.dataset.rota = rotaNum(r.incomingRota);
  // Legacy tint (kept for any surviving selectors)
  const curSec = el('section-current-ic'), incSec = el('section-incoming-ic');
  if (curSec) curSec.dataset.rota = rotaNum(r.currentRota);
  if (incSec) incSec.dataset.rota = rotaNum(r.incomingRota);
  const isNight = r.shiftLabel === 'Night';
  el('section-redcon').classList.toggle('section-disabled', !isNight);
  if (isNight) {
    updateRedconCautionState();
    renderRedconTable();
  } else {
    // Don't wipe existing redcon data  just hide the caution if user was on night and switched to day override
    renderRedconCaution();
  }
  // Do NOT reset IC selections or turnouts  preserve all user-entered state across mode/date switches
  renderICButtons(); renderTurnoutList(); updateValidation();
}

// =============================================
// SHIFT MODE
// =============================================
function setShiftMode(mode) {
  S.shiftMode = mode;
  toggle('btn-auto', mode==='auto'); toggle('btn-override', mode==='override');
  el('override-panel').classList.toggle('hidden', mode==='auto');
  const autoDisp = el('auto-detect-display'); if(autoDisp) autoDisp.classList.toggle('hidden', mode==='override');
  if (mode==='auto') { S.overrideDate=null; applyShiftResult(computeShift(new Date())); }
  else { if (!S.overrideDate){S.overrideDate=new Date();S.overrideDate.setHours(0,0,0,0);} applyOverrideShift(); updateOverrideDateChip(); }
}
function setOverrideShiftType(t) {
  S.overrideShiftType=t; toggle('seg-day',t==='D'); toggle('seg-night',t==='N'); applyOverrideShift();
}
function applyOverrideShift() {
  if (!S.overrideDate) return;
  const ref = new Date(S.overrideDate);
  ref.setHours(S.overrideShiftType==='D'?9:21,0,0,0);
  applyShiftResult(computeShift(ref));
}

// =============================================
// CALENDAR
// =============================================
let calViewYear, calViewMonth;
let _calendarMode = 'opslog'; // 'opslog' | 'rdr'
function initCalendar() {
  const n = new Date(); calViewYear=n.getFullYear(); calViewMonth=n.getMonth(); renderCalendar();
}
function renderCalendar() {
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const today=new Date(); today.setHours(0,0,0,0);
  const sel = _calendarMode === 'rdr' ? rdrOverrideDate : S.overrideDate;
  const first=new Date(calViewYear,calViewMonth,1);
  const startDow=first.getDay(); const dim=new Date(calViewYear,calViewMonth+1,0).getDate();
  let html=`<div class="cal-header"><button class="cal-nav" onclick="calNav(-1)"></button>
    <span class="cal-month-label">${months[calViewMonth]} ${calViewYear}</span>
    <button class="cal-nav" onclick="calNav(1)"></button></div><div class="cal-grid">
    ${['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>`<div class="cal-dow">${d}</div>`).join('')}`;
  for(let i=0;i<startDow;i++) html+=`<div class="cal-day empty"></div>`;
  for(let d=1;d<=dim;d++){
    const date=new Date(calViewYear,calViewMonth,d);
    let cls='cal-day';
    if(date.getTime()===today.getTime()) cls+=' today';
    if(sel&&date.getTime()===sel.getTime()) cls+=' selected';
    html+=`<div class="${cls}" onclick="selectCalDay(${calViewYear},${calViewMonth},${d})">${d}</div>`;
  }
  el('calendar').innerHTML=html+'</div>';
}
function calNav(dir){
  calViewMonth+=dir;
  if(calViewMonth<0){calViewMonth=11;calViewYear--;} if(calViewMonth>11){calViewMonth=0;calViewYear++;}
  renderCalendar();
}
function selectCalDay(y,m,d){
  const date = new Date(y,m,d);
  if (_calendarMode === 'rdr') {
    rdrOverrideDate = date;
    rdrApplyShift();
    rdrUpdateDateChip();
  } else {
    S.overrideDate = date;
    applyOverrideShift();
    updateOverrideDateChip();
  }
  renderCalendar();
}

// =============================================
// =============================================
// IC BUTTONS
// =============================================
function renderICButtons(){
  renderRotaButtons('current-ic-buttons',S.currentRota,'currentRotaPersonId');
  renderRotaButtons('incoming-ic-buttons',S.incomingRota,'incomingRotaPersonId');
}
function renderRotaButtons(cid,rotaName,stateKey){
  const cont=el(cid); const people=S.rotas.filter(r=>r.rota===rotaName);
  if(!people.length){cont.innerHTML=`<span class="no-names-hint">No names loaded for ${rotaName}. Check Settings.</span>`;return;}
  cont.innerHTML=people.map(p=>{
    const pid=findOrAddRotaPerson(p.rota,p.rank,p.name); const sel=S[stateKey]===pid;
    return `<button class="name-btn ${sel?'selected':''}" onclick="selectIC('${stateKey}',${pid})"><span class="rank-tag">${p.rank}</span>${p.name}</button>`;
  }).join('');
}
function selectIC(stateKey,pid){
  S[stateKey]=pid; renderICButtons(); updateValidation();
  const rotaName=stateKey==='currentRotaPersonId'?S.currentRota:S.incomingRota;
  const entry=S.rotas.find(r=>{
    const eid=findOrAddRotaPerson(r.rota,r.rank,r.name);
    return eid===pid;
  });
  const label=stateKey==='currentRotaPersonId'?'Current IC':'Incoming IC';
  if(entry) showToast(` ${label}: ${entry.rank?entry.rank+' ':''}${entry.name}`);
}

// =============================================
// TURNOUTS
// =============================================
function createTurnoutObj(){
  return {
    type:'P3', activatorMode:null, personId:null, othersText:'',
    timeH:[null,null,null,null,null], timeM:[null,null,null,null,null],
    timeAutoSet:[false,false,false,false,false],
    timeBlocked:[false,false,false,false,false],
    timeGapDismissed:[false,false,false,false,false],
    p3Times:['','','','',''],
    timeSuggested:[false,false,false,false,false],
    timeSuggestH:[null,null,null,null,null],
    timeSuggestM:[null,null,null,null,null],
  };
}

function addTurnout(){
  S.turnouts.push(createTurnoutObj());
  renderTurnoutList(); updateValidation();
}

function removeTurnout(idx){
  S.turnouts.splice(idx,1);
  renderTurnoutList(); updateValidation();
}

function selectTurnoutType(idx, type){
  const t=S.turnouts[idx]; if(!t) return;
  if(type==='others'){
    // Clear built-in label; keep any previously typed custom value in t.type
    if(['P3','DSA-LITE','FCV'].includes(t.type)) t.type='';
  } else {
    t.type=type; // don't touch t.othersText  that belongs to activator
  }
  renderTurnoutList();
  if(type==='others') setTimeout(()=>{ const i=el(`turnout-type-custom-${idx}`); if(i)i.focus(); },0);
  updateValidation();
}

function onTurnoutTypeCustomInput(idx){
  const inp=el(`turnout-type-custom-${idx}`); if(!inp) return;
  const t=S.turnouts[idx]; if(!t) return;
  const val=inp.value.trim().toUpperCase();
  t.type=val||''; // only t.type, never t.othersText (that belongs to activator)
  const tick=el(`turnout-type-tick-${idx}`);
  if(tick) tick.textContent=val?` ${val}`:'';
  updateValidation();
}

function selectTurnoutActivator(idx, mode){
  const t=S.turnouts[idx]; if(!t) return;
  t.activatorMode=mode;
  if(mode==='others'){
    t.personId=t.othersText?findOrAddPerson('',t.othersText):null;
    renderTurnoutList();
    setTimeout(()=>{ const i=el(`turnout-activator-custom-${idx}`); if(i)i.focus(); },0);
  } else {
    t.personId=findOrAddPerson('',mode);
    renderTurnoutList();
  }
  updateValidation();
}

function onTurnoutActivatorCustomInput(idx){
  const inp=el(`turnout-activator-custom-${idx}`); if(!inp) return;
  const t=S.turnouts[idx]; if(!t) return;
  const val=inp.value.trim().toUpperCase();
  t.othersText=val; t.personId=val?findOrAddPerson('',val):null;
  const tick=el(`turnout-act-tick-${idx}`);
  if(tick){
    const p=t.personId?getPersonById(t.personId):null;
    tick.textContent=p?` ${p.rank?`${p.rank} ${p.name}`:p.name}`:'';
  }
  updateValidation();
}

function validateBlockPatternFor(t){
  const bi=t.timeBlocked.map((b,i)=>b?i:-1).filter(i=>i>=0);
  if(bi.length===0) return null;
  if(bi.length===5) return 'all';
  for(let i=1;i<bi.length;i++) if(bi[i]!==bi[i-1]+1) return 'noncontiguous';
  if(bi[0]!==0&&bi[bi.length-1]!==4) return 'middle';
  return null;
}

function getCautionForTurnoutSlot(t, idx){
  if(t.timeBlocked[idx]) return null;
  const h=t.timeH[idx], m=t.timeM[idx];
  if(h===null||m===null) return null;
  const sl=S.detectedShiftLabel;
  let prevHHMM=null;
  for(let i=idx-1;i>=0;i--){
    if(!t.timeBlocked[i]&&t.p3Times[i]&&t.p3Times[i].length===4){ prevHHMM=parseInt(t.p3Times[i],10); break; }
  }
  if(prevHHMM!==null){
    const tOrd=nightOrder(h*100+m,sl), pOrd=nightOrder(prevHHMM,sl);
    if(tOrd<=pOrd) return 'earlier';
  }
  if(!isInShiftBounds(h,m,sl)) return 'oob';
  if(prevHHMM!==null&&!t.timeGapDismissed[idx]){
    const tOrd=nightOrder(h*100+m,sl), pOrd=nightOrder(prevHHMM,sl);
    if(ordToMins(tOrd)-ordToMins(pOrd)>120) return 'gap';
  }
  return null;
}

function renderTurnoutList(){
  const container=el('turnout-list'); if(!container) return;
  container.innerHTML=S.turnouts.map((t,idx)=>renderTurnoutCardHTML(t,idx)).join('');
}

function renderTurnoutCardHTML(t, idx){
  const builtInTypes=['P3','DSA-LITE','FCV'];
  const isCustomType=!builtInTypes.includes(t.type);
  const typeButtonsHTML=builtInTypes.map(label=>{
    const sel=t.type===label;
    return `<button class="turnout-type-btn${sel?' selected':''}" onclick="selectTurnoutType(${idx},'${label}')">${label}</button>`;
  }).join('')+`<button class="turnout-type-btn${isCustomType?' selected':''}" onclick="selectTurnoutType(${idx},'others')">Others</button>`;

  const typeTickHTML=!isCustomType&&t.type?`<div class="p3-activator-current" style="margin-top:6px"> ${esc(t.type)}</div>`:'';
  const customTypeHTML=isCustomType?`<div style="margin-top:6px"><input type="text" class="text-input" id="turnout-type-custom-${idx}"
    value="${esc(t.type)}" placeholder="Enter type"
    oninput="onTurnoutTypeCustomInput(${idx})">
  <div id="turnout-type-tick-${idx}" class="p3-activator-current">${t.type?` ${esc(t.type)}`:''}</div></div>`:'';

  const activatorModes=['OPS CTR','HEAD OPS','others'];
  const isCustomAct=t.activatorMode==='others';
  const activatorHTML=activatorModes.map(mode=>{
    const sel=t.activatorMode===mode;
    const label=mode==='others'?'Others':mode;
    return `<button class="activator-btn${sel?' selected':''}" onclick="selectTurnoutActivator(${idx},'${mode}')">${label}</button>`;
  }).join('');

  const customActHTML=isCustomAct?`<div style="margin-top:6px"><input type="text" class="text-input" id="turnout-activator-custom-${idx}"
    value="${esc(t.othersText||'')}" placeholder="Enter name or rank+name"
    oninput="onTurnoutActivatorCustomInput(${idx})"></div>`:'';

  const p=t.personId?getPersonById(t.personId):null;
  const actCurrentHTML=`<div id="turnout-act-tick-${idx}" class="p3-activator-current">${p?` ${esc(p.rank?`${p.rank} ${p.name}`:p.name)}`:''}</div>`;

  const labels=['Activated','Left Div.','Arrived','Left Loc.','Reached'];
  const cellsHTML=labels.map((lbl,i)=>{
    const blocked=t.timeBlocked[i];
    const tm=t.p3Times[i];
    const hasSugg=!blocked&&!tm&&t.timeSuggested[i];
    let timeStr,cls,hint='',cautionIcon='';
    if(blocked){
      timeStr='Disabled'; cls='is-blocked';
    } else if(tm){
      timeStr=`${tm.slice(0,2)}:${tm.slice(2)}`; cls='';
      const caution=getCautionForTurnoutSlot(t,i);
      if(caution==='earlier'){cls='is-caution-err';cautionIcon='<span class="p3-sum-caution p3-sum-caution-err" title="Before previous event"></span>';}
      else if(caution){cls='is-caution';cautionIcon='<span class="p3-sum-caution" title="Timing warning"></span>';}
    } else if(hasSugg){
      timeStr=`${String(t.timeSuggestH[i]).padStart(2,'0')}:${String(t.timeSuggestM[i]).padStart(2,'0')}`;
      cls='is-suggested'; hint='<span class="p3-sum-hint">Suggested  tap to confirm</span>';
    } else {
      timeStr=''; cls='is-unset';
    }
    return `<div class="p3-summary-cell ${cls}" onclick="openTimingEditor(${idx},${i})" title="Click to edit">
      <span class="p3-sum-label">${lbl} </span>
      <span class="p3-sum-time">${timeStr}${cautionIcon}</span>${hint}</div>`;
  }).join('');

  return `<div class="turnout-card" id="turnout-card-${idx}">
    <div class="turnout-card-header">
      <span class="turnout-card-title">Turnout #${idx+1}</span>
      <button class="turnout-remove-btn" onclick="removeTurnout(${idx})" title="Remove"></button>
    </div>
    <div class="turnout-type-row">
      <label class="field-label" style="margin-bottom:4px">What turned out?</label>
      <div class="turnout-type-presets">${typeButtonsHTML}</div>${typeTickHTML}${customTypeHTML}
    </div>
    <div class="p3-activator-group" style="margin-top:12px">
      <label class="field-label">Activated by</label>
      <div class="p3-activator-presets">${activatorHTML}</div>${customActHTML}${actCurrentHTML}
    </div>
    <div class="p3-summary-grid" style="margin-top:14px">${cellsHTML}</div>
  </div>`;
}

// =============================================
// DRUM PICKER
// =============================================
function getAllowedHours(shiftLabel){
  if(!shiftLabel) return Array.from({length:24},(_,i)=>i);
  if(shiftLabel==='Day') return Array.from({length:11},(_,i)=>i+8);
  return [18,19,20,21,22,23,0,1,2,3,4,5,6,7,8];
}
function getDrumHourList(idx){
  return Array.from({length:24},(_,i)=>i);
}
const MINUTES=Array.from({length:60},(_,i)=>i);

function buildDrums(){
  for(let idx=0;idx<5;idx++){
    const c=el(`drum-${idx}`); if(!c) continue;
    c.innerHTML=`
      <div class="drum-row">
        <div class="drum-col">
          <button class="drum-btn" onclick="stepDrum(${idx},'h',-1)"></button>
          <div class="drum-face" id="df-${idx}-h">
            <div class="drum-slot ds-prev" id="ds-${idx}-h-prev"></div>
            <div class="drum-slot ds-cur placeholder" id="ds-${idx}-h-cur">--</div>
            <div class="drum-slot ds-next" id="ds-${idx}-h-next"></div>
          </div>
          <button class="drum-btn" onclick="stepDrum(${idx},'h',1)"></button>
        </div>
        <span class="drum-colon">:</span>
        <div class="drum-col">
          <button class="drum-btn" onclick="stepDrum(${idx},'m',-1)"></button>
          <div class="drum-face" id="df-${idx}-m">
            <div class="drum-slot ds-prev" id="ds-${idx}-m-prev"></div>
            <div class="drum-slot ds-cur placeholder" id="ds-${idx}-m-cur">--</div>
            <div class="drum-slot ds-next" id="ds-${idx}-m-next"></div>
          </div>
          <button class="drum-btn" onclick="stepDrum(${idx},'m',1)"></button>
        </div>
      </div>
      <button class="timing-disable-btn" id="tdb-${idx}" onclick="toggleBlock(${idx})"> Disable this event</button>`;
    for(const part of['h','m']){
      el(`df-${idx}-${part}`).addEventListener('wheel',e=>{
        e.preventDefault(); stepDrum(idx,part,e.deltaY>0?1:-1);
      },{passive:false});
    }
  }
}

function stepDrum(idx,part,dir){
  if(S.timeBlocked[idx]) return;
  S.timeAutoSet[idx]=false; S.timeGapDismissed[idx]=false;

  const isH=part==='h'; const list=isH?getDrumHourList(idx):MINUTES;
  let val=isH?S.timeH[idx]:S.timeM[idx];
  if(val===null) val=dir>0?list[0]:list[list.length-1];
  else{ const pos=list.indexOf(val); val=list[((pos<0?0:pos)+dir+list.length)%list.length]; }

  if(isH){S.timeH[idx]=val; if(S.timeM[idx]===null)S.timeM[idx]=0;}
  else{if(S.timeH[idx]===null)S.timeH[idx]=getDrumHourList(idx)[0]; S.timeM[idx]=val;}

  const face=el(`df-${idx}-${part}`);
  const ac=dir<0?'spin-up':'spin-down';
  face.classList.remove('spin-up','spin-down'); void face.offsetWidth;
  face.classList.add(ac); setTimeout(()=>face.classList.remove(ac),120);

  renderDrum(idx); tryCommitTime(idx);
}

function renderDrum(idx){
  const c=el(`drum-${idx}`);
  if(c) c.classList.toggle('is-blocked',!!S.timeBlocked[idx]);
  renderDrumPart(idx,'h');renderDrumPart(idx,'m');
}
function renderDrumPart(idx,part){
  const isH=part==='h'; const val=isH?S.timeH[idx]:S.timeM[idx];
  const list=isH?getDrumHourList(idx):MINUTES;
  const pE=el(`ds-${idx}-${part}-prev`),cE=el(`ds-${idx}-${part}-cur`),nE=el(`ds-${idx}-${part}-next`);
  if(!pE||!cE||!nE) return;
  if(val===null){pE.textContent='';cE.textContent='--';cE.classList.add('placeholder');nE.textContent='';}
  else{
    const pos=list.indexOf(val); const sp=pos<0?0:pos;
    pE.textContent=String(list[(sp-1+list.length)%list.length]).padStart(2,'0');
    cE.textContent=String(val).padStart(2,'0'); cE.classList.remove('placeholder');
    nE.textContent=String(list[(sp+1)%list.length]).padStart(2,'0');
  }
}

function refreshDrums(){
  S.timeH=            [null,  null,  null,  null,  null];
  S.timeM=            [null,  null,  null,  null,  null];
  S.timeAutoSet=      [false, false, false, false, false];
  S.timeBlocked=      [false, false, false, false, false];
  S.timeGapDismissed= [false, false, false, false, false];
  S.p3Times=          ['','','','',''];
  S.timeSuggested=    [false, false, false, false, false];
  S.timeSuggestH=     [null,  null,  null,  null,  null];
  S.timeSuggestM=     [null,  null,  null,  null,  null];
  S.turnouts=[];
  for(let i=0;i<5;i++){renderDrum(i);renderTimingFeedback(i);renderDisableButton(i);}
  renderTurnoutList();
}

// =============================================
// TIMING VALIDATION & COMMIT
// =============================================
function nightOrder(hhmm,shiftLabel){
  if(shiftLabel!=='Night') return hhmm; return hhmm<=810?hhmm+2400:hhmm;
}
function isInShiftBounds(h,m,shiftLabel){
  if(!shiftLabel) return true; const hhmm=h*100+m;
  if(shiftLabel==='Day') return hhmm>=800&&hhmm<=1800;
  return hhmm>=1800||hhmm<=800;
}
function getPrevP3Time(idx){
  for(let i=idx-1;i>=0;i--){
    if(!S.timeBlocked[i]&&S.p3Times[i]&&S.p3Times[i].length===4) return parseInt(S.p3Times[i],10);
  }
  return null;
}

function tryCommitTime(idx){
  const h=S.timeH[idx],m=S.timeM[idx];
  if(h===null||m===null||S.timeBlocked[idx]) return;
  commitTimeNow(idx); renderTimingFeedback(idx);
}

function commitTimeNow(idx){
  S.p3Times[idx]=String(S.timeH[idx]).padStart(2,'0')+String(S.timeM[idx]).padStart(2,'0');
  renderDrum(idx); autoAdvanceFrom(idx); updateValidation();
}

function autoAdvanceFrom(fromIdx){
  // Only populate suggestions  never commit. User must confirm each timing individually.
  let rH=S.timeH[fromIdx],rM=S.timeM[fromIdx];
  if(rH===null||rM===null) return;
  for(let i=fromIdx+1;i<5;i++){
    if(S.timeBlocked[i]) continue;
    if(S.timeH[i]!==null){
      // Already committed  use as cascade base, leave it alone
      rH=S.timeH[i]; rM=S.timeM[i]; continue;
    }
    let ah=rH,am=rM+1; if(am>=60){am=0;ah=(ah+1)%24;}
    S.timeSuggested[i]=true;
    S.timeSuggestH[i]=ah;
    S.timeSuggestM[i]=am;
    rH=ah; rM=am;
  }
}

function clearTimesFrom(idx){
  for(let i=idx;i<5;i++){
    S.timeH[i]=null;S.timeM[i]=null;S.timeAutoSet[i]=false;
    S.timeBlocked[i]=false;S.timeGapDismissed[i]=false;
    S.timeSuggested[i]=false;S.timeSuggestH[i]=null;S.timeSuggestM[i]=null;
    S.p3Times[i]=''; renderDrum(i); renderTimingFeedback(i); renderDisableButton(i);
  }
}

// ---- Inline timing feedback (right of drum) ----
function renderTimingFeedback(idx){
  const tf=el(`tf-${idx}`); if(!tf) return;
  if(S.timeBlocked[idx]||S.timeH[idx]===null||S.timeM[idx]===null){tf.innerHTML='';return;}
  const caution=getCautionForSlot(idx);
  if(!caution){tf.innerHTML='';return;}
  const slLabel=(S.detectedShiftLabel||'shift').toLowerCase();
  const win=slLabel==='night'?'18:00  08:00':'08:00  18:00';
  if(caution==='earlier'){
    tf.innerHTML=`<div class="tf-hard-err"><span class="tf-x"></span><div>This timing is before the previous P3 event. Scroll to a later time, or disable this event below if it did not occur during this shift.</div></div>`;
  }else if(caution==='oob'){
    tf.innerHTML=`<div class="caution-box">
      <span class="caution-icon"></span>
      <div class="caution-text">
        <span class="caution-msg">This timing falls outside the ${slLabel} shift window (${win}). If this event did not occur during this shift, you can disable it below.</span>
        <button class="caution-dismiss-btn" onclick="blockEvent(${idx})"> Disable this event</button>
      </div></div>`;
  }else if(caution==='gap'){
    tf.innerHTML=`<div class="caution-box">
      <span class="caution-icon"></span>
      <div class="caution-text">
        <span class="caution-msg">This timing is more than 2 hours after the previous P3 event. Is this correct?</span>
        <button class="caution-dismiss-btn" onclick="dismissGapCaution(${idx})">Yes, that's correct</button>
      </div></div>`;
  }
}
function dismissGapCaution(idx){
  S.timeGapDismissed[idx]=true; renderTimingFeedback(idx); updateValidation();
}

// =============================================
// CAUTION LOGIC
// =============================================
function ordToMins(ord){return Math.floor(ord/100)*60+ord%100;}

function getCautionForSlot(idx){
  if(S.timeBlocked[idx]) return null;
  const h=S.timeH[idx],m=S.timeM[idx];
  if(h===null||m===null) return null;
  const sl=S.detectedShiftLabel;
  const prevHHMM=getPrevP3Time(idx);

  // Priority 1  earlier than previous non-blocked event (non-dismissible)
  if(prevHHMM!==null){
    const tOrd=nightOrder(h*100+m,sl),pOrd=nightOrder(prevHHMM,sl);
    if(tOrd<=pOrd) return 'earlier';
  }

  // Priority 2  outside shift window (non-dismissible, "disable" shortcut only)
  if(!isInShiftBounds(h,m,sl)) return 'oob';

  // Priority 3  gap > 2 hours from previous (dismissible)
  if(prevHHMM!==null&&!S.timeGapDismissed[idx]){
    const tOrd=nightOrder(h*100+m,sl),pOrd=nightOrder(prevHHMM,sl);
    if(ordToMins(tOrd)-ordToMins(pOrd)>120) return 'gap';
  }

  return null;
}

// =============================================
// BLOCK / DISABLE EVENTS
// =============================================
function validateBlockPattern(){
  const bi=S.timeBlocked.map((b,i)=>b?i:-1).filter(i=>i>=0);
  if(bi.length===0) return null;
  if(bi.length===5) return 'all';
  // Must be contiguous
  for(let i=1;i<bi.length;i++) if(bi[i]!==bi[i-1]+1) return 'noncontiguous';
  // Must start at index 0 or end at index 4
  if(bi[0]!==0&&bi[bi.length-1]!==4) return 'middle';
  return null;
}

function recalcSuggestions(){
  // Clear all existing suggestions then re-derive from the last committed timing
  for(let i=0;i<5;i++){S.timeSuggested[i]=false;S.timeSuggestH[i]=null;S.timeSuggestM[i]=null;}
  for(let i=4;i>=0;i--){
    if(!S.timeBlocked[i]&&S.p3Times[i]){autoAdvanceFrom(i);break;}
  }
}

function blockEvent(idx){
  S.timeBlocked[idx]=true;
  S.timeH[idx]=null;S.timeM[idx]=null;S.p3Times[idx]='';
  S.timeAutoSet[idx]=false;S.timeGapDismissed[idx]=false;
  S.timeSuggested[idx]=false;S.timeSuggestH[idx]=null;S.timeSuggestM[idx]=null;
  renderDrum(idx);renderDisableButton(idx);renderTimingFeedback(idx);
  for(let i=0;i<5;i++) if(i!==idx) renderTimingFeedback(i);
  recalcSuggestions(); updateValidation();
}

function unblockEvent(idx){
  S.timeBlocked[idx]=false;
  renderDrum(idx);renderDisableButton(idx);renderTimingFeedback(idx);
  for(let i=0;i<5;i++) if(i!==idx) renderTimingFeedback(i);
  recalcSuggestions(); updateValidation();
}

function toggleBlock(idx){
  if(S.timeBlocked[idx]) unblockEvent(idx); else blockEvent(idx);
}

function renderDisableButton(idx){
  const btn=el(`tdb-${idx}`); if(!btn) return;
  if(S.timeBlocked[idx]){
    btn.textContent=' Re-enable this event';
    btn.classList.add('is-reenable');
  }else{
    btn.textContent=' Disable this event';
    btn.classList.remove('is-reenable');
  }
}

// =============================================
// REDCON PARSER & CAUTION
// =============================================
function parseRedcon(){
  const text=el('redcon-paste').value;
  S.redconCautionDismissed=false;

  if(!text.trim()){
    S.redconData=[]; S.redconCautionState='empty';
    renderRedconTable(); renderRedconCaution(); updateValidation(); return;
  }

  const lines=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  // Tab-separated (Outlook): "A411\tSGT\tName" all on one line
  const A4_TAB_RE=/^(A4\d{2})\t([^\t]+)\t(.+)$/i;
  // Multi-line: "A411" alone, then rank and name on following lines
  const A4_RE=/^A4\d{2}$/i;
  const found={};
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    const trimmed=line.trim();

    // Try tab-separated format first
    const tabMatch=trimmed.match(A4_TAB_RE);
    if(tabMatch){
      const code=tabMatch[1].toUpperCase();
      found[code]={rank:tabMatch[2].trim().toUpperCase(), name:tabMatch[3].trim().toUpperCase()};
      continue;
    }

    // Fall back to multi-line format
    const code=trimmed.toUpperCase(); if(!A4_RE.test(code)) continue;
    let rank='',name='';
    for(let j=i+1;j<lines.length&&j<=i+5;j++){
      const t=lines[j].trim(); if(!t) continue;
      if(!rank){rank=t.toUpperCase();continue;} if(!name){name=t.toUpperCase();break;}
    }
    found[code]={rank,name};
  }
  // Master list is always S.appliances (what the user configured in Settings).
  // If no appliances are configured yet, fall back to whatever codes the email contained.
  // Codes in the email that are NOT in S.appliances are silently ignored, so removing
  // an appliance from Settings always removes it from the generated report.
  const mc = S.appliances.length ? S.appliances.map(a => a.code) : Object.keys(found);
  S.redconData = mc.map(code => {
    const f = found[code];
    if (f && f.rank && f.name) return { code, personId: findOrAddPerson(f.rank, f.name), rank: f.rank, name: f.name, matched: true };
    return { code, personId: null, rank: '', name: '', matched: false };
  });
  const matched=S.redconData.filter(r=>r.matched&&r.name);
  const unmatched=S.redconData.filter(r=>!r.matched||!r.name);
  if(!matched.length) S.redconCautionState='nonames';
  else if(unmatched.length) S.redconCautionState='incomplete';
  else S.redconCautionState=null;
  renderRedconTable(); renderRedconCaution(); updateValidation();
  if(S.redconData.length) showToast(` ${matched.length}/${S.redconData.length} appliances parsed from REDCON`);
}

function updateRedconCautionState(){
  if(S.detectedShiftLabel!=='Night'){S.redconCautionState=null;}
  else if(!el('redcon-paste').value.trim()){S.redconCautionState='empty';}
  renderRedconCaution();
}

function renderRedconCaution(){
  const eEl=el('redcon-caution-empty'), nEl=el('redcon-caution-nonames'), iEl=el('redcon-caution-incomplete');
  if(!eEl||!nEl||!iEl) return;
  eEl.classList.toggle('hidden', !(S.redconCautionState==='empty'      &&!S.redconCautionDismissed));
  nEl.classList.toggle('hidden', !(S.redconCautionState==='nonames'    &&!S.redconCautionDismissed));
  iEl.classList.toggle('hidden', !(S.redconCautionState==='incomplete' &&!S.redconCautionDismissed));
  if(S.redconCautionState==='incomplete'&&!S.redconCautionDismissed){
    const unmatched=S.redconData.filter(r=>!r.matched||!r.name).map(r=>r.code).join(', ');
    const msg=el('redcon-incomplete-msg');
    if(msg) msg.textContent=`Incomplete manning data  no names found for: ${unmatched}. Their IC names will be blank.`;
  }
}

function dismissRedconCaution(){
  S.redconCautionDismissed=true; renderRedconCaution(); updateValidation();
}

function renderRedconTable(){
  const wrap=el('redcon-results');
  if(!S.redconData.length){wrap.classList.add('hidden');return;}
  const sorted=[...S.redconData].sort((a,b)=>{
    const sa=getStnFromCode(a.code)||'', sb=getStnFromCode(b.code)||'';
    if(sa!==sb) return sa.localeCompare(sb);
    return a.code.localeCompare(b.code,undefined,{numeric:true});
  });
  wrap.innerHTML=`<table class="redcon-table"><thead><tr><th>Callsign</th><th>Rank</th><th>Name</th></tr></thead><tbody>
    ${sorted.map(r=>`<tr class="${r.matched?'matched':'unmatched'} ${stnClass(r.code)}">
      <td class="code">${r.code}</td><td>${r.rank||''}</td><td>${r.name||''}</td></tr>`).join('')}
  </tbody></table>`;
  wrap.classList.remove('hidden');
}

// =============================================
// VALIDATION
// =============================================
const TIMING_LABELS=['Activated','Left Division','Arrived','Left Location','Reached Div.'];

function validate(){
  const errs=[];
  if(!S.currentRotaPersonId)  errs.push({section:'current-ic', msg:'Select the Current IC.'});
  if(!S.incomingRotaPersonId) errs.push({section:'incoming-ic',msg:'Select the Incoming IC.'});
  S.turnouts.forEach((t,ti)=>{
    const num=ti+1;
    if(!t.personId) errs.push({section:'p3',msg:`Turnout #${num}: Select who activated it.`});
    const bp=validateBlockPatternFor(t);
    if(bp==='all')
      errs.push({section:'p3',msg:`Turnout #${num}: All events disabled  re-enable at least one or remove this turnout.`});
    else if(bp)
      errs.push({section:'p3',msg:`Turnout #${num}: Invalid disable pattern  disabled events must be consecutive from start or end.`});
    for(let i=0;i<5;i++){
      if(t.timeBlocked[i]) continue;
      const lbl=`"${TIMING_LABELS[i]}"`;
      if(!t.p3Times[i])
        errs.push({section:'p3',msg:`Turnout #${num} ${lbl}: not set yet.`});
      else{
        const c=getCautionForTurnoutSlot(t,i);
        if(c==='earlier') errs.push({section:'p3',msg:`Turnout #${num} ${lbl}: must be after the previous timing.`});
        else if(c==='oob') errs.push({section:'p3',msg:`Turnout #${num} ${lbl}: outside shift window  disable if it did not occur this shift.`});
        else if(c==='gap') errs.push({section:'p3',msg:`Turnout #${num} ${lbl}: gap over 2 hours  confirm or dismiss.`});
      }
    }
  });
  if(S.detectedShiftLabel==='Night'&&S.redconCautionState!==null&&!S.redconCautionDismissed)
    errs.push({section:'redcon',msg:'REDCON: '+(S.redconCautionState==='empty'?'no data entered  paste the REDCON email or click "Yes, proceed".':'no alpha names found  paste valid data or click "Yes, proceed".')});
  return errs;
}

function updateValidation(){
  const errs=validate();
  ['current-ic','incoming-ic','p3'].forEach(sec=>{
    const has=errs.some(e=>e.section===sec);
    el('err-'+sec)?.classList.toggle('hidden',!has);
    el('section-'+sec)?.classList.toggle('has-error',has);
  });
  if(S.detectedShiftLabel==='Night'){
    const has=errs.some(e=>e.section==='redcon');
    el('err-redcon')?.classList.toggle('hidden',!has);
    el('section-redcon')?.classList.toggle('has-error',has);
  }else{el('err-redcon')?.classList.add('hidden');el('section-redcon')?.classList.remove('has-error');}
  // Button: visually greyed but always clickable
  el('generate-btn').classList.toggle('has-errors',errs.length>0);
}

// =============================================
// ALERT SYSTEM
// =============================================
function showAlert({type='error',title,bodyHTML,buttons=[],dismissAnywhere=false,resetOnClose=false,dismissHint=null,nonDismissible=false}){
  el('modal-box').className='modal-box alert-'+type;
  el('modal-title').innerHTML=title; el('modal-body').innerHTML=bodyHTML;
  const acts=el('modal-actions'); acts.innerHTML='';
  buttons.forEach(btn=>{
    const b=document.createElement('button'); b.textContent=btn.label;
    if(btn.danger) b.classList.add('danger');
    b.onclick=()=>{closeModal();if(btn.cb)btn.cb();}; acts.appendChild(b);
  });
  const hint=el('modal-dismiss-hint');
  if(dismissHint){hint.textContent=dismissHint;hint.classList.remove('hidden');}
  else hint.classList.add('hidden');
  const ov=el('modal-overlay');
  if(dismissAnywhere)   ov.dataset.dismissAnywhere='1';   else delete ov.dataset.dismissAnywhere;
  if(resetOnClose)      ov.dataset.resetOnClose='1';      else delete ov.dataset.resetOnClose;
  if(nonDismissible)    ov.dataset.nonDismissible='1';    else delete ov.dataset.nonDismissible;
  ov.classList.remove('hidden');
}

function closeModal(){
  const ov=el('modal-overlay'); ov.classList.add('hidden');
  el('modal-dismiss-hint').classList.add('hidden');
  el('modal-box').className='modal-box';
  const sr=ov.dataset.resetOnClose==='1';
  delete ov.dataset.dismissAnywhere; delete ov.dataset.resetOnClose; delete ov.dataset.nonDismissible;
  if(sr) resetAllState();
}

function resetAllState(){
  S.turnouts=[];S.activeTurnoutIdx=null;
  S.currentRotaPersonId=null;S.incomingRotaPersonId=null;
  S.redconData=[];S.redconCautionState=null;S.redconCautionDismissed=false;
  el('redcon-paste').value='';
  renderRedconTable(); renderRedconCaution(); renderTurnoutList(); refreshDrums();
  setShiftMode('auto');
}

document.addEventListener('DOMContentLoaded',()=>{
  el('modal-overlay').addEventListener('click',e=>{
    const ov=el('modal-overlay');
    if(ov.dataset.nonDismissible==='1') return;
    if(e.target===ov||ov.dataset.dismissAnywhere==='1') closeModal();
  });
});

// =============================================
// GENERATE
// =============================================
function generate(){
  const errs=validate();
  if(errs.length>0){
    showAlert({
      type:'error',
      title:'<span class="alert-err-heading"> Missing or invalid fields</span>',
      bodyHTML:'<ul class="alert-err-list">'+errs.map(e=>`<li>${e.msg}</li>`).join('')+'</ul>',
      buttons:[{label:'Edit',cb:null}],
    });
    return;
  }
  proceedGenerate();
}

function proceedGenerate(){
  const code=buildClipboardString();
  navigator.clipboard.writeText(code).then(()=>{
    showAlert({
      type:'success',
      title:' Code Copied!',
      bodyHTML:'Open Excel and run <strong>GenerateFromClipboard</strong> via <strong>Alt+F8</strong>.',
      buttons:[],dismissAnywhere:true,
      dismissHint:'Click anywhere to dismiss',
    });
  }).catch(()=>{
    prompt('Copy this code manually (Ctrl+C):',code);
    showAlert({
      type:'success',
      title:' Code Ready',
      bodyHTML:'Copy the code from the prompt, then open Excel and run <strong>GenerateFromClipboard</strong> via <strong>Alt+F8</strong>.',
      buttons:[],dismissAnywhere:true,
      dismissHint:'Click anywhere to dismiss',
    });
  });
}

function buildClipboardString(){
  const st=S.shiftMode==='auto'?'AUTO':'OVERRIDE';
  const ss=S.shiftMode==='override'?fmtDate(S.overrideDate)+'-'+S.overrideShiftType:'';
  const parts=['OPSLOG','3',st,ss,String(S.currentRotaPersonId),String(S.incomingRotaPersonId)];

  // TURNOUTS section
  parts.push('TURNOUTS',String(S.turnouts.length));
  S.turnouts.forEach(t=>{
    parts.push(t.type||'P3', String(t.personId!=null?t.personId:''));
    for(let i=0;i<5;i++) parts.push(t.timeBlocked[i]?'BLOCKED':(t.p3Times[i]||''));
  });

  // REDCON section
  const rf=S.appliances
    .map(a=>{ const rd=S.redconData.find(r=>r.code===a.code); return {code:a.code,personId:(rd&&rd.personId)?rd.personId:0}; })
    .sort((a,b)=>{ const sa=getStnFromCode(a.code)||'',sb=getStnFromCode(b.code)||''; return sa!==sb?sa.localeCompare(sb):a.code.localeCompare(b.code,undefined,{numeric:true}); });
  parts.push(String(rf.length)); rf.forEach(r=>parts.push(r.code,String(r.personId)));

  // PEOPLE section
  const uPIds=new Set();
  S.turnouts.forEach(t=>{ if(t.personId!=null) uPIds.add(t.personId); });
  rf.forEach(r=>{ if(r.personId) uPIds.add(r.personId); });
  const pDB=loadPeopleDB(); const uP=[...uPIds].map(id=>pDB.people.find(p=>p.id===id)).filter(Boolean);
  parts.push('PEOPLE',String(uP.length)); uP.forEach(p=>parts.push(String(p.id),p.rank||'',p.name||''));

  // ROTA_PEOPLE section
  const uRIds=new Set([S.currentRotaPersonId,S.incomingRotaPersonId].filter(id=>id!=null));
  const rDB=loadRotaPeopleDB(); const uRP=[...uRIds].map(id=>rDB.people.find(p=>p.id===id)).filter(Boolean);
  parts.push('ROTA_PEOPLE',String(uRP.length)); uRP.forEach(p=>parts.push(String(p.id),p.rota||'',p.rank||'',p.name||''));
  return parts.join('|');
}

// =============================================
// SETTINGS
// =============================================
// =============================================
// TOAST NOTIFICATION
// =============================================
function showToast(message){
  const t=document.createElement('div');
  t.className='toast-notification';
  t.textContent=message;
  document.body.appendChild(t);
  requestAnimationFrame(()=>requestAnimationFrame(()=>t.classList.add('toast-visible')));
  setTimeout(()=>{
    t.classList.remove('toast-visible');
    setTimeout(()=>t.remove(),420);
  },1800);
}

// =============================================
// PER-TIMING POPUP
// =============================================
function captureTimingState(){
  return {
    timeH:[...S.timeH], timeM:[...S.timeM],
    timeAutoSet:[...S.timeAutoSet], timeBlocked:[...S.timeBlocked],
    timeGapDismissed:[...S.timeGapDismissed], p3Times:[...S.p3Times],
    timeSuggested:[...S.timeSuggested],
    timeSuggestH:[...S.timeSuggestH], timeSuggestM:[...S.timeSuggestM],
  };
}
function restoreTimingState(snap){
  S.timeH=snap.timeH; S.timeM=snap.timeM;
  S.timeAutoSet=snap.timeAutoSet; S.timeBlocked=snap.timeBlocked;
  S.timeGapDismissed=snap.timeGapDismissed; S.p3Times=snap.p3Times;
  S.timeSuggested=snap.timeSuggested||[false,false,false,false,false];
  S.timeSuggestH=snap.timeSuggestH||[null,null,null,null,null];
  S.timeSuggestM=snap.timeSuggestM||[null,null,null,null,null];
  for(let i=0;i<5;i++){renderDrum(i);renderTimingFeedback(i);renderDisableButton(i);}
  updateValidation();
}

function openTimingEditor(turnoutIdx, slotIdx){
  const t=S.turnouts[turnoutIdx]; if(!t) return;
  S.activeTurnoutIdx=turnoutIdx; S.activeTimingIdx=slotIdx;

  // Load turnout state into global scratchpad
  S.timeH=[...t.timeH]; S.timeM=[...t.timeM];
  S.timeAutoSet=[...t.timeAutoSet]; S.timeBlocked=[...t.timeBlocked];
  S.timeGapDismissed=[...t.timeGapDismissed]; S.p3Times=[...t.p3Times];
  S.timeSuggested=[...t.timeSuggested];
  S.timeSuggestH=[...t.timeSuggestH]; S.timeSuggestM=[...t.timeSuggestM];

  S._timingSnapshot=captureTimingState();

  // Pre-load suggestion if slot is unset
  if(S.timeSuggested[slotIdx]&&S.timeH[slotIdx]===null){
    S.timeH[slotIdx]=S.timeSuggestH[slotIdx];
    S.timeM[slotIdx]=S.timeSuggestM[slotIdx];
  }

  // Show only the active timing cell; render all drums from loaded state
  for(let i=0;i<5;i++){
    const c=el(`timing-cell-${i}`); if(c) c.style.display=i===slotIdx?'':'none';
    renderDrum(i); renderTimingFeedback(i); renderDisableButton(i);
  }

  el('timing-popup-title').textContent=`${t.type||'Turnout'}  ${TIMING_LABELS[slotIdx]}`;
  el('p3-editor-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}
function closeTimingPopupBackdrop(e){
  if(e&&e.target===el('p3-editor-overlay')) cancelTimingEditor();
}
function cancelTimingEditor(){
  if(S._timingSnapshot) restoreTimingState(S._timingSnapshot);
  S._timingSnapshot=null;
  el('p3-editor-overlay').classList.add('hidden');
  document.body.style.overflow='';
}
function confirmTimingEditor(){
  const idx=S.activeTimingIdx;
  const turnoutIdx=S.activeTurnoutIdx;
  const t=S.turnouts[turnoutIdx]; if(!t) return;

  // Commit the time if user accepted the pre-loaded suggestion without touching the drum
  // (stepDrum would have committed it; if not touched, p3Times is still '' even though H/M are set)
  if(!S.timeBlocked[idx] && S.timeH[idx]!==null && S.timeM[idx]!==null && !S.p3Times[idx]){
    S.p3Times[idx]=String(S.timeH[idx]).padStart(2,'0')+String(S.timeM[idx]).padStart(2,'0');
  }

  // Clear the suggestion for this slot (now committed)
  S.timeSuggested[idx]=false; S.timeSuggestH[idx]=null; S.timeSuggestM[idx]=null;

  // Re-derive suggestions for subsequent slots
  recalcSuggestions();

  // Copy scratchpad back to turnout
  t.timeH=[...S.timeH]; t.timeM=[...S.timeM];
  t.timeAutoSet=[...S.timeAutoSet]; t.timeBlocked=[...S.timeBlocked];
  t.timeGapDismissed=[...S.timeGapDismissed]; t.p3Times=[...S.p3Times];
  t.timeSuggested=[...S.timeSuggested];
  t.timeSuggestH=[...S.timeSuggestH]; t.timeSuggestM=[...S.timeSuggestM];

  S._timingSnapshot=null;
  el('p3-editor-overlay').classList.add('hidden');
  document.body.style.overflow='';
  renderTurnoutList(); updateValidation();
  showToast(` ${t.type||'Turnout'} "${TIMING_LABELS[idx]}" updated`);
}

// =============================================
// CALENDAR POPUP
// =============================================
function openCalendarPopup(){
  el('calendar-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}
function closeCalendarPopup(e){
  if(e&&e.target!==el('calendar-overlay')) return;
  el('calendar-overlay').classList.add('hidden');
  document.body.style.overflow='';
}
function confirmCalendarDate(){
  el('calendar-overlay').classList.add('hidden');
  document.body.style.overflow='';
  if (_calendarMode === 'rdr') {
    rdrUpdateDateChip();
  } else {
    updateOverrideDateChip();
  }
  showToast(' Override date updated');
}
function updateOverrideDateChip(){
  const chip=el('override-date-chip'); if(!chip) return;
  if(S.overrideDate){
    const m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    chip.textContent=`${S.overrideDate.getDate()} ${m[S.overrideDate.getMonth()]} ${S.overrideDate.getFullYear()}`;
  } else {
    chip.textContent='Select date';
  }
}

// =============================================
// OH PERSONNEL SETTINGS (OPS OH / EMS OH tabs)
// =============================================
function setOhTab(tab) {
  S.settingsOhTab = tab;
  S.settingsOhAddingInline = null;
  S.settingsOhEditIdx = null;
  renderOhSettingsList();
}

function renderOhSettingsList() {
  const wrap = el('oh-entries-list'); if (!wrap) return;
  const tab = S.settingsOhTab || 'ops';
  const list = rdrLists[tab] || [];

  const tabsHTML = [
    {key:'ops', label:'OPS OH'},
    {key:'ems', label:'EMS OH'}
  ].map(({key, label}) =>
    `<button class="settings-tab oh-tab-${key}${key===tab?' active':''}" onclick="setOhTab('${key}')">${label}</button>`
  ).join('');

  let listHTML;
  if (!list.length) {
    listHTML = `<div class="settings-empty-hint">No entries yet  click below to add.</div>`;
  } else {
    listHTML = list.map((p, i) => {
      if (S.settingsOhAddingInline === tab && S.settingsOhEditIdx === i) {
        return `<div class="rota-entry-row">
          <input class="text-input settings-sm" id="oh-inline-edit-rank-${i}" value="${esc(p.rank||'')}" placeholder="Rank">
          <input class="text-input settings-sm" id="oh-inline-edit-name-${i}" value="${esc(p.name)}" placeholder="Name"
                 onkeydown="if(event.key==='Enter')confirmOhEditInline(${i})">
          <button class="secondary-btn-sm" onclick="confirmOhEditInline(${i})">Save</button>
          <button class="entry-remove-btn" onclick="cancelOhAddInline()"></button>
        </div>`;
      }
      return `<div class="rota-entry-row" data-oh="${tab}" data-idx="${i}" draggable="true">
        <span class="drag-handle" title="Drag to reorder"></span>
        <span class="rota-entry-rank">${esc(p.rank||'')}</span>
        <span class="rota-entry-name">${esc(p.name)}</span>
        <button class="entry-edit-btn" onclick="showOhEditInline('${tab}',${i})" title="Edit"></button>
        <button class="entry-remove-btn" onclick="rdrRemoveEntry('${tab}',${i})" title="Remove"></button>
      </div>`;
    }).join('');
  }

  const isAdding = S.settingsOhAddingInline === tab && S.settingsOhEditIdx === null;
  const addSection = isAdding
    ? `<div class="add-personnel-inline">
        <input type="text" class="text-input settings-sm" id="oh-inline-rank" placeholder="Rank"
               onkeydown="if(event.key==='Enter')el('oh-inline-name').focus()">
        <input type="text" class="text-input settings-sm" id="oh-inline-name" placeholder="Name"
               onkeydown="if(event.key==='Enter')confirmOhAddInline()">
        <button class="secondary-btn-sm" onclick="confirmOhAddInline()">Add</button>
        <button class="entry-remove-btn" onclick="cancelOhAddInline()"></button>
      </div>`
    : `<button class="add-personnel-btn oh-tab-${tab}" onclick="showOhAddInline('${tab}')"> Click to add personnel</button>`;

  wrap.innerHTML = `<div class="settings-tabs" style="margin-top:10px">${tabsHTML}</div>
    <div class="settings-tab-content oh-content-${tab}">
      <div class="rota-entries-body" id="oh-body-${tab}">${listHTML}</div>
      ${addSection}
    </div>`;

  if (isAdding) setTimeout(() => { const f=el('oh-inline-rank'); if(f) f.focus(); }, 0);
  if (S.settingsOhEditIdx !== null) setTimeout(() => {
    const f=el(`oh-inline-edit-name-${S.settingsOhEditIdx}`); if(f) f.focus();
  }, 0);

  const body = el(`oh-body-${tab}`);
  if (body) _rdrInitDrag(body, tab);
}

function showOhAddInline(tab) {
  S.settingsOhTab = tab;
  S.settingsOhAddingInline = tab;
  S.settingsOhEditIdx = null;
  renderOhSettingsList();
}
function cancelOhAddInline() {
  S.settingsOhAddingInline = null;
  S.settingsOhEditIdx = null;
  renderOhSettingsList();
}
function confirmOhAddInline() {
  const tab = S.settingsOhTab;
  const rank = (el('oh-inline-rank')?.value || '').trim().toUpperCase();
  const name = (el('oh-inline-name')?.value || '').trim().toUpperCase();
  if (!name) { el('oh-inline-name')?.focus(); return; }
  rdrLists[tab].push({rank, name});
  rdrSaveLists(tab);
  S.settingsOhAddingInline = null;
  S.settingsOhEditIdx = null;
  renderOhSettingsList();
  showToast(` ${name} added to ${tab.toUpperCase()} OH`);
}
function showOhEditInline(tab, i) {
  S.settingsOhTab = tab;
  S.settingsOhAddingInline = tab;
  S.settingsOhEditIdx = i;
  renderOhSettingsList();
}
function confirmOhEditInline(i) {
  const tab = S.settingsOhTab;
  const rank = (el(`oh-inline-edit-rank-${i}`)?.value || '').trim().toUpperCase();
  const name = (el(`oh-inline-edit-name-${i}`)?.value || '').trim().toUpperCase();
  if (!name) return;
  rdrLists[tab][i] = {rank, name};
  rdrSaveLists(tab);
  S.settingsOhAddingInline = null;
  S.settingsOhEditIdx = null;
  renderOhSettingsList();
  showToast(` ${name} updated`);
}

function openSettings(){
  el('settings-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
  renderRotaSettingsList();
  renderOhSettingsList();
  renderApplianceSettingsList();
}
function closeSettings(e){
  if(e&&e.target!==el('settings-overlay')) return;
  el('settings-overlay').classList.add('hidden');
  document.body.style.overflow='';
  // Rebuild RDR grid in case rota entries changed
  if (typeof rdrBuildAttGrid === 'function') rdrBuildAttGrid();
}

function openHelp(){
  el('help-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}
function closeHelp(e){
  if(e&&e.target!==el('help-overlay')) return;
  el('help-overlay').classList.add('hidden');
  document.body.style.overflow='';
}
// Legacy alias
function toggleSettings(){ openSettings(); }

// =============================================
// UTILS
// =============================================
function el(id){return document.getElementById(id);}
function toggle(id,active){el(id).classList.toggle('active',active);}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}

// =============================================
// INIT
// =============================================
function init(){
  // Load rotas & appliances from localStorage
  S.rotas      = loadRotasFromStorage();
  S.appliances = loadAppliancesFromStorage();
  // Rebuild rota people ID DB from stored entries
  saveRotaPeopleDB({nextId:1, people:[]});
  S.rotas.forEach(p => findOrAddRotaPerson(p.rota, p.rank, p.name));

  // Seed the shift-change tracker so first clock tick doesn't fire a false popup
  const now = new Date();
  const totalMin = now.getHours() * 60 + now.getMinutes();
  _lastKnownShiftLabel = (totalMin >= 18*60 || totalMin < 8*60) ? 'Night' : 'Day';

  buildDrums();
  applyShiftResult(computeShift(new Date()));
  initCalendar();
  renderRotaSettingsList();
  renderApplianceSettingsList();
  updateValidation();
  // RDR grid is rebuilt in initRdr() which also runs on DOMContentLoaded
}
document.addEventListener('DOMContentLoaded',init);

// =============================================
// THEME (light / dark)
// =============================================
let _manualTheme = false;  // true once user has toggled manually

function applyTheme(theme){
  document.documentElement.dataset.theme = theme;
  const btn = el('theme-toggle-btn');
  if(btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
}

function autoTheme(hour){
  if(_manualTheme) return;
  applyTheme(hour >= 7 && hour < 19 ? 'light' : 'dark');
}

function toggleTheme(){
  _manualTheme = true;
  const current = document.documentElement.dataset.theme;
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// =============================================
// SHIFT-CHANGE POPUP
// =============================================
let _lastKnownShiftLabel = null;  // initialised in init()
let _shiftChangePopupActive = false;

function _checkShiftChange(now) {
  if (_shiftChangePopupActive) return;
  const totalMin = now.getHours() * 60 + now.getMinutes();
  const currentLabel = (totalMin >= 18*60 || totalMin < 8*60) ? 'Night' : 'Day';
  if (_lastKnownShiftLabel !== null && _lastKnownShiftLabel !== currentLabel) {
    // Shift just flipped  check if there's meaningful state worth prompting about
    const hasState = S.currentRotaPersonId !== null || S.incomingRotaPersonId !== null ||
                     S.turnouts.length > 0 || (el('redcon-paste') && el('redcon-paste').value.trim());
    if (hasState) {
      _shiftChangePopupActive = true;
      _showShiftChangePopup(_lastKnownShiftLabel);
    }
  }
  _lastKnownShiftLabel = currentLabel;
}

function _showShiftChangePopup(oldShiftLabel) {
  // Work out the override target for "Keep"  the shift that just ended
  const now = new Date();
  let oldDate = new Date(now); oldDate.setHours(0,0,0,0);
  let oldShiftType;
  if (oldShiftLabel === 'Day') {
    // Day just ended  night started: old date = today, old type = D
    oldShiftType = 'D';
  } else {
    // Night just ended  day started: night shift started yesterday
    oldDate.setDate(oldDate.getDate() - 1);
    oldShiftType = 'N';
  }
  const shiftIcon = oldShiftLabel === 'Day' ? '' : '';
  showAlert({
    type: 'error',
    title: ` ${oldShiftLabel} Shift Has Ended`,
    bodyHTML: `The ${shiftIcon} <strong>${oldShiftLabel} shift</strong> has ended. Would you like to reset all fields for the new shift, or keep the current session?
      <br><br><span style="font-size:13px;color:var(--text-2)">
      <strong>Reset</strong>  clear everything and start fresh.<br>
      <strong>Keep Session</strong>  retain all fields; the panel will switch to Override so your previous shift is preserved.
      </span>`,
    nonDismissible: true,
    buttons: [
      { label: 'Reset', danger: true, cb: () => {
        _shiftChangePopupActive = false;
        resetAllState();
      }},
      { label: 'Keep Session', cb: () => {
        _shiftChangePopupActive = false;
        // If currently in auto, lock to the old shift via override so IC rotas stay correct
        if (S.shiftMode === 'auto') {
          S.overrideDate = oldDate;
          S.overrideShiftType = oldShiftType;
          setShiftMode('override');
        }
        // If already on override, user has manually chosen a date+shift  leave it untouched
      }},
    ],
  });
}

// Live clock with per-digit drum roll
(function tickClock(){
  const pad = n => String(n).padStart(2,'0');
  let prevDigits = [];

  function buildClock(container, digits){
    // digits: array of chars e.g. ['2','2',':','5','4',':','0','9']
    container.innerHTML = digits.map((ch, i) => {
      if(ch === ':') return `<span class="clock-colon">:</span>`;
      return `<span class="clock-digit" data-i="${i}"><span class="clock-digit-inner">${ch}</span></span>`;
    }).join('');
  }

  function update(){
    const now = new Date();
    autoTheme(now.getHours());
    _checkShiftChange(now);
    const s = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    const digits = s.split('');
    const c = el('live-clock'); if(!c) return;

    if(prevDigits.length === 0){
      buildClock(c, digits);
    } else {
      const spans = c.querySelectorAll('.clock-digit');
      let spanIdx = 0;
      digits.forEach((ch, i) => {
        if(ch === ':') return;
        const span = spans[spanIdx++];
        if(!span) return;
        if(prevDigits[i] !== ch){
          span.querySelector('.clock-digit-inner').textContent = ch;
          span.classList.remove('rolling');
          void span.offsetWidth; // reflow to restart animation
          span.classList.add('rolling');
        }
      });
    }
    prevDigits = digits;
  }

  update();
  setInterval(update, 1000);
})();

// =============================================
// MAIN TAB SWITCHING
// =============================================
let _activeMainTab = 'opslog';

function switchMainTab(tab) {
  _activeMainTab = tab;
  ['opslog', 'rdr'].forEach(t => {
    el(`tab-btn-${t}`)?.classList.toggle('active', t === tab);
    el(`view-${t}`)?.classList.toggle('hidden', t !== tab);
  });
  if (tab === 'rdr') {
    rdrApplyShift();
  }
}

// =============================================
// RDR  STATE
// =============================================
const RDR_RANKS = ['PTE','LCP','CPL','SGT','SSG','WO','MWO','SWO','CWO',
                   'ME4','ME5','2LT','LTA','CPT','MAJ','LTC','COL','BG','MG'];
const RDR_REASONS = ['RS','MC','VL','OVL','HL','BTO']; // default fallback
const RDR_REASONS_SK = 'rdr_reasons_v1';
let rdrUserReasons = null; // null = not yet loaded
const RDR_SK = { OPS:'rdr2_ops', EMS:'rdr2_ems' };

function rdrGetReasons() { return rdrUserReasons || RDR_REASONS; }
function rdrLoadReasons() {
  try { rdrUserReasons = JSON.parse(localStorage.getItem(RDR_REASONS_SK)) || [...RDR_REASONS]; }
  catch { rdrUserReasons = [...RDR_REASONS]; }
}
function rdrSaveReasons() { localStorage.setItem(RDR_REASONS_SK, JSON.stringify(rdrUserReasons)); }
function rdrAddReason() {
  const inp = el('new-reason-input'); if (!inp) return;
  const v = inp.value.trim().toUpperCase(); if (!v) return;
  if (!rdrUserReasons.includes(v)) { rdrUserReasons.push(v); rdrSaveReasons(); }
  inp.value = ''; renderRdrReasonsList();
}
function rdrRemoveReason(r) {
  rdrUserReasons = rdrUserReasons.filter(x => x !== r);
  rdrSaveReasons(); renderRdrReasonsList();
}
function renderRdrReasonsList() {
  const wrap = el('rdr-reasons-list'); if (!wrap) return;
  wrap.innerHTML = '';
  (rdrUserReasons || RDR_REASONS).forEach(r => {
    const chip = document.createElement('span');
    chip.className = 'reason-chip';
    chip.innerHTML = `${esc(r)}<button class="reason-chip-del" onclick="rdrRemoveReason('${esc(r)}')" title="Remove">&times;</button>`;
    wrap.appendChild(chip);
  });
  if (!wrap.children.length) wrap.innerHTML = '<span style="color:var(--text-3);font-size:11px">No reasons set — nothing will match as OUT/OFF DUTY</span>';
}

let rdrLists = { ops:[], ems:[] };

// RDR shift mode state (separate from ops log)
let rdrShiftMode      = 'auto';   // 'auto' | 'override'
let rdrOverrideDate   = null;     // Date | null
let rdrOverrideShift  = 'AM';     // 'AM' | 'PM'
let rdrDetectedShift  = 'AM';     // 'AM' | 'PM'
let rdrSelectedDay    = 'WEEKDAY';// 'WEEKDAY' | 'WEEKEND'
let rdrDayManual      = false;    // true once user manually picks day type

// Attendance data: keyed by 'key_idx' e.g. 'ops_0', 'am_1'
// Each entry: { stype: string, reason: string, mcdate: string }
let rdrAttendance = {};
function rdrImportEntriesCombined() {
  const text = el('rdr-import-combined')?.value.trim(); if (!text) return;
  const ops = [], ems = [];
  text.split(/\n/).forEach(line => {
    const parts = line.split(',').map(s => s.trim());
    if (parts.length >= 2) {
      const type = parts[0].toUpperCase();
      if (type === 'OPS' || type === 'EMS') {
        const rank = (parts.length >= 3 ? parts[1] : '').toUpperCase();
        const name = (parts.length >= 3 ? parts[2] : parts[1]).toUpperCase();
        if (name) { (type === 'OPS' ? ops : ems).push({rank, name}); }
      }
    }
  });
  if (!ops.length && !ems.length) {
    showToast('No valid entries  use format OPS,RANK,NAME or EMS,RANK,NAME'); return;
  }
  if (ops.length) { rdrLists.ops = ops; rdrSaveLists('ops'); }
  if (ems.length) { rdrLists.ems = ems; rdrSaveLists('ems'); }
  const combined = el('rdr-import-combined'); if (combined) combined.value = '';
  renderOhSettingsList();
  showToast(` Imported: ${ops.length} OPS, ${ems.length} EMS (replaced existing)`);
}

//  Persistence 
function rdrLoadLists() {
  for (const key of ['ops','ems']) {
    const raw = localStorage.getItem(RDR_SK[key.toUpperCase()]);
    rdrLists[key] = raw ? JSON.parse(raw) : [];
  }
}
function rdrSaveLists(key) {
  localStorage.setItem(RDR_SK[key.toUpperCase()], JSON.stringify(rdrLists[key]));
}

//  Shift detection 
function rdrGetReportDate() {
  if (rdrShiftMode === 'override' && rdrOverrideDate) return rdrOverrideDate;
  const now = new Date();
  // Hours 00:00–07:59 belong to the night shift that started the previous evening
  if (now.getHours() < 8) {
    const prev = new Date(now);
    prev.setDate(prev.getDate() - 1);
    return prev;
  }
  return now;
}

function rdrAutoDetectShift() {
  const result = computeShift(new Date());
  return result.shiftLabel === 'Day' ? 'AM' : 'PM';
}

function rdrSetShiftMode(mode) {
  rdrShiftMode = mode;
  const btnAuto = el('rdr-btn-auto'), btnOvr = el('rdr-btn-override');
  if (btnAuto) btnAuto.classList.toggle('active', mode === 'auto');
  if (btnOvr)  btnOvr.classList.toggle('active',  mode === 'override');
  const ovrPanel = el('rdr-override-panel');
  if (ovrPanel) ovrPanel.classList.toggle('hidden', mode !== 'override');
  if (mode === 'auto') { rdrOverrideDate = null; }
  else if (!rdrOverrideDate) { rdrOverrideDate = new Date(); rdrOverrideDate.setHours(0,0,0,0); }
  rdrApplyShift();
}

function rdrSetOverrideShift(shift) {
  rdrOverrideShift = shift;
  el('rdr-seg-am')?.classList.toggle('active', shift === 'AM');
  el('rdr-seg-pm')?.classList.toggle('active', shift === 'PM');
  rdrApplyShift();
}

function rdrOpenCalendar() {
  _calendarMode = 'rdr';
  const d = rdrOverrideDate || new Date();
  calViewYear = d.getFullYear(); calViewMonth = d.getMonth();
  renderCalendar();
  el('calendar-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function rdrUpdateDateChip() {
  const chip = el('rdr-override-date-chip'); if (!chip) return;
  if (rdrOverrideDate) {
    const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    chip.textContent = `${rdrOverrideDate.getDate()} ${M[rdrOverrideDate.getMonth()]} ${rdrOverrideDate.getFullYear()}`;
  } else {
    chip.textContent = 'Select date';
  }
}

function rdrUpdateOhPasteState() {
  const isWeekend = rdrSelectedDay === 'WEEKEND';
  const group = el('rollcall-paste-group-oh');
  if (group) group.classList.toggle('oh-weekend-disabled', isWeekend);
  const ta = el('rollcall-paste-oh');
  if (ta) ta.disabled = isWeekend;
  el('rollcall-results-oh')?.classList.add('hidden');
}

function rdrSetDay(day) {
  rdrSelectedDay = day;
  rdrDayManual = true;
  el('rdr-day-auto-badge')?.classList.add('hidden');
  el('rdr-day-btns')?.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.day === day));
  rdrUpdateSubjectPreview();
  rdrUpdateOhPasteState();
}

function rdrApplyShift() {
  // Determine current shift
  if (rdrShiftMode === 'auto') {
    rdrDetectedShift = rdrAutoDetectShift();
    // Update auto-detect display — use report date (night shift 00-07 belongs to previous day)
    const dateStr = rdrGetReportDate().toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const icon = rdrDetectedShift === 'AM' ? '☀️' : '🌙';
    const disp = el('rdr-auto-detect-display');
    if (disp) {
      disp.innerHTML = `<span class="auto-detect-date">${dateStr}</span><span class="auto-detect-shift">${rdrDetectedShift} Shift ${icon}</span>`;
      disp.classList.remove('hidden');
    }
  } else {
    rdrDetectedShift = rdrOverrideShift;
    el('rdr-auto-detect-display')?.classList.add('hidden');
    rdrUpdateDateChip();
  }

  // Auto day type (unless user overrode)
  if (!rdrDayManual) {
    const reportDate = rdrGetReportDate();
    const dow = reportDate.getDay();
    rdrSelectedDay = (dow === 0 || dow === 6) ? 'WEEKEND' : 'WEEKDAY';
    el('rdr-day-btns')?.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.day === rdrSelectedDay));
    const badge = el('rdr-day-auto-badge');
    if (badge) badge.classList.remove('hidden');
  }

  // PM group grayout for AM shifts
  const isAM = rdrDetectedShift === 'AM';
  const pmGroup = el('rdr-pm-group');
  if (pmGroup) pmGroup.classList.toggle('rdr-pm-disabled', isAM);
  el('rdr-pm-notice')?.classList.toggle('hidden', !isAM);
  const pmTA = el('rollcall-paste-pm');
  if (pmTA) pmTA.disabled = isAM;

  rdrUpdateRotaInfo();
  rdrUpdateSubjectPreview();
  rdrUpdateOhPasteState();
  rdrBuildAttGrid();
}

//  Rota info from report date 
function getRdrRotaInfo() {
  const reportDate = rdrGetReportDate();
  const d = reportDate;
  const dayRef   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9,  0, 0);
  const nightRef = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 21, 0, 0);
  const dayInfo   = computeShift(dayRef);
  const nightInfo = computeShift(nightRef);
  const amRota  = dayInfo.currentRota;
  const pmRota  = nightInfo.currentRota;
  const amPeople = S.rotas.filter(r => r.rota === amRota);
  const pmPeople = S.rotas.filter(r => r.rota === pmRota);
  return { amRota, pmRota, amPeople, pmPeople };
}

function rdrUpdateRotaInfo() {
  const { amRota, pmRota } = getRdrRotaInfo();
  const infoEl = el('rdr-rota-info');
  if (!infoEl) return;
  if (!amRota && !pmRota) { infoEl.classList.add('hidden'); return; }
  infoEl.classList.remove('hidden');
  const mkChip = rota => `<span class="rota-chip rc-${rotaNum(rota)}">${rota}</span>`;
  const mkSmall = rota => `<span class="rota-chip rc-${rotaNum(rota)}" style="font-size:10px;padding:1px 7px">${rota}</span>`;
  const amChip = el('rdr-am-rota-chip'); if (amChip) amChip.innerHTML = amRota ? mkChip(amRota) : '';
  const pmChip = el('rdr-pm-rota-chip'); if (pmChip) pmChip.innerHTML = pmRota ? mkChip(pmRota) : '';
  const lam = el('rdr-label-am');
  const lpm = el('rdr-label-pm');
  if (lam) lam.innerHTML = `AM Rota${amRota ? ' '+mkSmall(amRota) : ''}`;
  if (lpm) lpm.innerHTML = `PM Rota${pmRota ? ' '+mkSmall(pmRota) : ''}`;
}

//  Date / subject 
function rdrGetDateStr() {
  const d = rdrGetReportDate();
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function rdrGetDateLong() {
  return rdrGetReportDate().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
}

function rdrUpdateSubjectPreview() {
  const label = rdrDetectedShift === 'AM' ? 'AM' : 'PM';
  const prev = el('rdr-subject-preview');
  if (prev) prev.textContent = `Subject: RDR REPORT FOR ${rdrGetDateStr()} ${label}`;
}

//  Attendance state 
function rdrGetAtt(key, idx) {
  return rdrAttendance[`${key}_${idx}`] || { stype:'', reason:'', mcdate:'' };
}
function rdrSetAtt(key, idx, att) {
  rdrAttendance[`${key}_${idx}`] = att;
  rdrUpdateGenerateBtn();
}

function rdrAttToText(att) {
  if (!att.stype) return '';
  if (!att.reason) return att.stype;
  if (att.stype === 'OFF DUTY' || att.stype === 'OUT') {
    const inner = att.mcdate ? `${att.reason} ${att.mcdate}` : att.reason;
    return `${att.stype} (${inner})`;
  }
  return att.mcdate ? `${att.stype} ${att.reason} ${att.mcdate}` : `${att.stype} ${att.reason}`;
}

// Row badge: only shows for a field that is COMPLETELY EMPTY (nothing entered/parsed yet)
function rdrIsEmpty(key, idx) {
  return !rdrGetAtt(key, idx).stype;
}

// Generate button blocker: empty OR rota OFF DUTY missing required reason
function rdrIsBlocker(key, idx, personType) {
  const att = rdrGetAtt(key, idx);
  if (!att.stype) return true;
  if (personType === 'rota' && att.stype === 'OFF DUTY' && !att.reason) return true;
  return false;
}

// Keep rdrIsError as alias for row-level badge (empty only)
function rdrIsError(key, idx) { return rdrIsEmpty(key, idx); }

function rdrUpdateGenerateBtn() {
  const btn = el('rdr-generate-btn'); if (!btn) return;
  const errBadge = el('rdr-att-err-badge');
  const { amPeople, pmPeople } = getRdrRotaInfo();
  const isAM = rdrDetectedShift === 'AM';

  let hasBlocker = false;
  rdrLists.ops.forEach((_,i) => { if (rdrIsBlocker('ops',i,'oh'))   hasBlocker=true; });
  rdrLists.ems.forEach((_,i) => { if (rdrIsBlocker('ems',i,'oh'))   hasBlocker=true; });
  amPeople.forEach((_,i)     => { if (rdrIsBlocker('am',i,'rota'))  hasBlocker=true; });
  if (!isAM) {
    pmPeople.forEach((_,i)   => { if (rdrIsBlocker('pm',i,'rota'))  hasBlocker=true; });
  }

  btn.classList.toggle('has-errors', hasBlocker);
  if (errBadge) errBadge.classList.toggle('hidden', !hasBlocker);
}

//  Attendance grid builder 
function rdrAddCell(parent, className, html) {
  const d = document.createElement('div');
  d.className = className; d.innerHTML = html;
  parent.appendChild(d); return d;
}

function rdrMakeStatusCell(key, idx, personType, readOnly) {
  const cell = document.createElement('div');
  cell.className = 'att-status-cell' + (readOnly === 'empty' ? ' empty' : '');

  if (readOnly === 'empty') return cell;

  const wrap = document.createElement('div');
  wrap.className = 'att-status-wrap';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'att-status-input';
  input.id = `rsi_${key}_${idx}`;
  input.placeholder = personType === 'rota' ? 'ON DUTY / OFF DUTY ' : 'IN / OUT  / AM / PM';

  function attachLiveEdit() {
    input.readOnly = false;
    input.classList.remove('status-ok');
    rdrStyleStatusInput(input, personType);
    input.addEventListener('input', () => {
      const sel = input.selectionStart;
      input.value = input.value.toUpperCase();
      input.setSelectionRange(sel, sel);
      const att = rdrParseStatusText(input.value, personType);
      rdrSetAtt(key, idx, att);
      rdrStyleStatusInput(input, personType);
      const errEl = document.getElementById(`rsiErr_${key}_${idx}`);
      if (errEl) errEl.classList.toggle('hidden', !rdrIsEmpty(key, idx));
    });
  }

  if (readOnly === true) {
    // AM shift: PM rota locked as ON DUTY
    input.value = 'ON DUTY';
    input.readOnly = true;
    input.className += ' status-ok';
  } else if (readOnly === 'weekend-default') {
    input.value = 'OUT';
    input.readOnly = true;
    input.className += ' status-out';
  } else {
    const existing = rdrAttToText(rdrGetAtt(key, idx));
    input.value = existing;
    attachLiveEdit();
  }

  const errBadge = document.createElement('span');
  errBadge.className = 'att-row-err' + ((readOnly === true || readOnly === 'weekend-default') ? ' hidden' : (rdrIsEmpty(key,idx) ? '' : ' hidden'));
  errBadge.id = `rsiErr_${key}_${idx}`;
  errBadge.textContent = '!';

  wrap.appendChild(input);
  wrap.appendChild(errBadge);
  cell.appendChild(wrap);
  return cell;
}

function rdrStyleStatusInput(input, personType) {
  const v = input.value.trim().toUpperCase();
  input.classList.remove('status-ok','status-out','status-err','status-warn');
  if (!v) { input.classList.add('status-err'); return; }
  if (v === 'IN' || v === 'ON DUTY' || v === 'AM' || v === 'PM' || v.startsWith('AM ') || v.startsWith('PM ')) {
    input.classList.add('status-ok');
  } else if (v.startsWith('OUT') || v.startsWith('OFF DUTY')) {
    // Rota OFF DUTY without a reason is a blocker  show warning (amber) so user knows to add reason
    const needsReason = personType === 'rota' && v === 'OFF DUTY';
    input.classList.add(needsReason ? 'status-warn' : 'status-out');
    if (needsReason) input.title = 'Add reason: e.g. "OFF DUTY MC 13 Jun"';
    else input.title = '';
  }
}

function rdrBuildAttGrid() {
  const grid = el('rdr-att-grid'); if (!grid) return;
  grid.innerHTML = '';
  const { amRota, pmRota, amPeople, pmPeople } = getRdrRotaInfo();
  const isAM      = rdrDetectedShift === 'AM';
  const isWeekend = rdrSelectedDay === 'WEEKEND';

  // On weekends, pre-populate all OH entries as OUT (if not already set)
  if (isWeekend) {
    rdrLists.ops.forEach((_,i) => { if (!rdrAttendance[`ops_${i}`]?.stype) rdrAttendance[`ops_${i}`]={stype:'OUT',reason:'',mcdate:''}; });
    rdrLists.ems.forEach((_,i) => { if (!rdrAttendance[`ems_${i}`]?.stype) rdrAttendance[`ems_${i}`]={stype:'OUT',reason:'',mcdate:''}; });
  }

  const mkRotaChip = rota => rota
    ? `<span class="rota-mini-chip rc-${rotaNum(rota)}" style="background:var(--rota-${rotaNum(rota)}-bg);color:var(--rota-${rotaNum(rota)})">${rota}</span>`
    : '';

  const ohWeekendNote = isWeekend
    ? ` <span style="color:var(--warn);font-size:10px;font-weight:600">(WEEKEND  ALL OUT by default)</span>`
    : '';

  // Column headers
  rdrAddCell(grid,'att-col-hdr span-2', `OFFICE HOURS${ohWeekendNote}`);
  rdrAddCell(grid,'att-col-hdr span-2','RDR ROTA SHIFTS');

  //  Upper half: OPS + AM rota 
  const opsHdr = rdrAddCell(grid,'att-section-hdr','');
  opsHdr.innerHTML = `OPS READINESS &amp; PLANNING TEAM`;
  const amHdr = rdrAddCell(grid,'att-section-hdr','');
  amHdr.innerHTML = `AM SHIFT ${mkRotaChip(amRota)}`;

  const upperLen = Math.max(rdrLists.ops.length, amPeople.length);
  if (!upperLen) {
    rdrAddCell(grid,'att-empty-row','No names in settings  add OPS and Rota names in Settings.');
  } else {
    for (let i = 0; i < upperLen; i++) {
      const lP = rdrLists.ops[i], rP = amPeople[i];
      const lName = document.createElement('div');
      lName.className = 'att-name-cell' + (lP ? '' : ' empty');
      lName.textContent = lP ? `${lP.rank} ${lP.name}` : '';
      grid.appendChild(lName);
      // On weekends, OH status cells are read-only OUT unless individually overridden
      grid.appendChild(lP ? rdrMakeStatusCell('ops',i,'oh', isWeekend ? 'weekend-default' : false) : rdrMakeStatusCell('ops',i,'oh','empty'));
      const rName = document.createElement('div');
      rName.className = 'att-name-cell' + (rP ? '' : ' empty');
      rName.textContent = rP ? `${rP.rank} ${rP.name}` : '';
      grid.appendChild(rName);
      grid.appendChild(rP ? rdrMakeStatusCell('am',i,'rota',false) : rdrMakeStatusCell('am',i,'rota','empty'));
    }
  }

  //  Lower half: EMS + PM rota 
  const emsHdr = rdrAddCell(grid,'att-section-hdr','');
  emsHdr.innerHTML = `EMS TEAM`;
  const pmHdr = rdrAddCell(grid,'att-section-hdr','');
  pmHdr.innerHTML = `PM SHIFT ${mkRotaChip(pmRota)}`;

  const lowerLen = Math.max(rdrLists.ems.length, pmPeople.length);
  if (!lowerLen) {
    rdrAddCell(grid,'att-empty-row','No names in settings  add EMS and Rota names in Settings.');
  } else {
    for (let i = 0; i < lowerLen; i++) {
      const lP = rdrLists.ems[i], rP = pmPeople[i];
      const lName = document.createElement('div');
      lName.className = 'att-name-cell' + (lP ? '' : ' empty');
      lName.textContent = lP ? `${lP.rank} ${lP.name}` : '';
      grid.appendChild(lName);
      grid.appendChild(lP ? rdrMakeStatusCell('ems',i,'oh', isWeekend ? 'weekend-default' : false) : rdrMakeStatusCell('ems',i,'oh','empty'));
      const rName = document.createElement('div');
      rName.className = 'att-name-cell' + (rP ? '' : ' empty');
      rName.textContent = rP ? `${rP.rank} ${rP.name}` : '';
      grid.appendChild(rName);
      grid.appendChild(rP ? rdrMakeStatusCell('pm',i,'rota', isAM ? true : false) : rdrMakeStatusCell('pm',i,'rota','empty'));
    }
  }

  rdrUpdateGenerateBtn();
}

//  Rollcall parser 
function rdrStripEmoji(str) {
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu,'').replace(/[\u{2600}-\u{27BF}]/gu,'')
    .replace(/[‐-―→-⇿…]/g,'').replace(/[^\x09\x0A\x0D\x20-\x7E]/g,'');
}

function rdrStartsWithRank(name) {
  return RDR_RANKS.some(r => name === r || name.startsWith(r+' '));
}

function rdrMatchInList(rcName, list) {
  const rc = rcName.toUpperCase().trim();
  // 1. Exact rank+name match
  for (let i=0;i<list.length;i++) {
    const full = ((list[i].rank?list[i].rank+' ':'')+list[i].name).toUpperCase().trim();
    if (full === rc) return i;
  }
  // 2. Prefix match (rank+name)
  for (let i=0;i<list.length;i++) {
    const full = ((list[i].rank?list[i].rank+' ':'')+list[i].name).toUpperCase().trim();
    if (full.startsWith(rc)||rc.startsWith(full)) return i;
  }
  // 3. Name-only match (rollcall may omit rank)
  for (let i=0;i<list.length;i++) {
    if (list[i].name.toUpperCase().trim() === rc) return i;
  }
  // 4. Name-only prefix match
  for (let i=0;i<list.length;i++) {
    const n = list[i].name.toUpperCase().trim();
    if (n.startsWith(rc)||rc.startsWith(n)) return i;
  }
  return -1;
}

// Parse a date fragment like "13/6", "13/6/26"  "13 Jun"
function rdrParseMcDate(s) {
  const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return s.trim();
  const day=parseInt(m[1]), mon=parseInt(m[2]);
  return (mon>=1&&mon<=12) ? `${day} ${M[mon-1]}` : s.trim();
}

// Parse status text from after the dash in a roll call line
// personType: 'oh' | 'rota'
function rdrParseStatusText(raw, personType) {
  const t = rdrStripEmoji(raw).replace(/\s+/g,' ').trim().toUpperCase();
  if (!t) return { stype:'', reason:'', mcdate:'' };

  if (personType === 'rota') {
    if (t.startsWith('ON DUTY')) return { stype:'ON DUTY', reason:'', mcdate:'' };
    if (t.startsWith('OFF DUTY')) {
      const rest = t.slice(8).trim();
      return _parseReason(rest, 'OFF DUTY');
    }
    return { stype:'', reason:'', mcdate:'' }; // unrecognised
  }

  // OH
  // IN — allow trailing notes like "IN (HTTC)", "IN (Raining)", "IN✅"
  if (t.startsWith('IN')) return { stype:'IN', reason:'', mcdate:'' };

  // Explicit OUT
  if (t.startsWith('OUT')) return _parseReason(t.slice(3).trim(), 'OUT');

  // OFF DUTY keyword → treat as OUT for OH
  if (t.startsWith('OFF DUTY')) return _parseReason(t.slice(8).trim(), 'OUT');

  // Bare reason code → OUT (e.g. "RS", "VL", "OVL 10/6-15/6", "MC 10/6 TO 11/6", "MC(10/6-11/6)")
  for (const r of rdrGetReasons()) {
    if (t === r || t.startsWith(r + ' ') || t.startsWith(r + '(')) {
      const after = t.slice(r.length).trim();
      return { stype:'OUT', reason:r, mcdate:_cleanPeriod(after) };
    }
  }

  // "NO STATUS" or similar freeform → mirror as-is
  if (t.includes('NO STATUS') || t === 'NIL') return { stype: t, reason:'', mcdate:'' };

  // AM/PM compound (e.g. "AM IN PM TO", "AM VL PM IN") → mirror
  if (/^(AM|PM)\s/.test(t)) return { stype:t.replace(/\s+/g,' '), reason:'', mcdate:'' };

  return { stype:'', reason:'', mcdate:'' };
}

// Normalise a period/date string: strip brackets, normalise "TO" separator
function _cleanPeriod(s) {
  if (!s) return '';
  let p = s.replace(/^\(|\)$/g, '').trim();   // strip outer parens
  p = p.replace(/\s+TO\s+/gi, ' - ');          // "10/6 TO 11/6" → "10/6 - 11/6"
  p = p.replace(/\/{2,}/g, '/');               // "15//6" → "15/6"
  return p.trim();
}

function _parseReason(rest, base) {
  // Strip surrounding parentheses: "(HL 10/6 - 14/6)" → "HL 10/6 - 14/6"
  const inner = rest.replace(/^\(|\)$/g, '').trim();
  for (const r of rdrGetReasons()) {
    if (inner === r || inner.startsWith(r + ' ') || inner.startsWith(r + '(')) {
      const after = inner.slice(r.length).trim();
      return { stype:base, reason:r, mcdate:_cleanPeriod(after) };
    }
  }
  // No recognised reason
  return { stype:base, reason:'', mcdate:'' };
}

// Track which attendance keys were set by each paste box (for real-time clear-on-edit)
const _pasteSourced = { oh: new Set(), am: new Set(), pm: new Set() };

function rdrOnRollcallInput(target) {
  // On weekends, OH is disabled — ignore any content
  if (target === 'oh' && rdrSelectedDay === 'WEEKEND') return;

  const textEl = el(`rollcall-paste-${target}`);
  const resEl  = el(`rollcall-results-${target}`);

  // Clear previously paste-sourced statuses so edits to the box are truly real-time
  const personType = target === 'oh' ? 'oh' : 'rota';
  for (const k of (_pasteSourced[target] || [])) {
    rdrAttendance[k] = { stype:'', reason:'', mcdate:'' };
    const [key, idx] = k.split('_');
    const inp = el(`rsi_${key}_${idx}`);
    if (inp && !inp.readOnly) {
      inp.value = '';
      rdrStyleStatusInput(inp, personType);
      el(`rsiErr_${key}_${idx}`)?.classList.remove('hidden');
    }
  }
  _pasteSourced[target] = new Set();

  const text = textEl?.value;
  if (!text?.trim()) { resEl?.classList.add('hidden'); rdrUpdateGenerateBtn(); return; }
  rdrParseAndApply(text, target, resEl);
}

function rdrParseAndApply(text, target, resEl) {
  const lines = text.split('\n');

  // Auto-detect date from roll call header (DD/MM/YYYY or DD/MM/YY)
  if (rdrShiftMode === 'override') {
    for (const line of lines) {
      const m = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
      if (m) {
        let y = parseInt(m[3]);
        if (y < 100) y += 2000; // "26"  2026
        const mo = parseInt(m[2])-1, d = parseInt(m[1]);
        rdrOverrideDate = new Date(y,mo,d);
        rdrUpdateDateChip();
        rdrApplyShift();
        break;
      }
    }
  }

  const { amPeople, pmPeople } = getRdrRotaInfo();
  const personType = (target === 'oh') ? 'oh' : 'rota';
  const searches = target === 'oh'
    ? [{ key:'ops', list:rdrLists.ops }, { key:'ems', list:rdrLists.ems }]
    : target === 'am' ? [{ key:'am', list:amPeople }]
    : [{ key:'pm', list:pmPeople }];

  const matched = [], unmatched = [];
  for (const rawLine of lines) {
    const line = rdrStripEmoji(rawLine).replace(/[]/g,'-').trim();
    if (!line) continue;
    const dm = line.match(/^(.+?)\s*-+\s*(.+)$/);
    if (!dm) continue;
    const namePart   = dm[1].trim().toUpperCase();
    const statusPart = dm[2].trim();
    // For OH, require a known rank prefix to avoid false positives.
    // For rota paste boxes (am/pm), names may appear without rank.
    if (target === 'oh' && !rdrStartsWithRank(namePart)) continue;

    const att = rdrParseStatusText(statusPart, personType);
    if (!att.stype) { unmatched.push({ name:namePart, raw:statusPart }); continue; }

    let found = false;
    for (const { key, list } of searches) {
      const idx = rdrMatchInList(namePart, list);
      if (idx >= 0) {
        rdrSetAtt(key, idx, att);
        _pasteSourced[target]?.add(`${key}_${idx}`);
        // Update input in grid if visible
        const inp = el(`rsi_${key}_${idx}`);
        if (inp) { inp.value = rdrAttToText(att); rdrStyleStatusInput(inp, personType);
          const errEl = el(`rsiErr_${key}_${idx}`);
          if (errEl) errEl.classList.toggle('hidden', !rdrIsError(key,idx,personType)); }
        matched.push({ name:namePart, status:rdrAttToText(att) });
        found = true; break;
      }
    }
    if (!found) unmatched.push({ name:namePart, raw:statusPart });
  }
  rdrRenderResults(matched, unmatched, resEl);
}

function rdrRenderResults(matched, unmatched, container) {
  if (!container) return;
  container.innerHTML = ''; container.classList.remove('hidden');
  if (!matched.length && !unmatched.length) {
    container.innerHTML = '<div class="rollcall-no-match">No recognisable entries found.</div>'; return;
  }
  if (matched.length) {
    const t = document.createElement('div');
    t.className = 'rollcall-result-title matched-title';
    t.textContent = ` ${matched.length} matched`;
    container.appendChild(t);
    const ul = document.createElement('div'); ul.className = 'rollcall-result-list';
    matched.forEach(m => {
      const row = document.createElement('div'); row.className = 'rollcall-match-row';
      row.innerHTML = `<span class="rollcall-match-name">${esc(m.name)}</span><span class="rollcall-match-status" style="color:var(--success)">${esc(m.status)}</span>`;
      ul.appendChild(row);
    });
    container.appendChild(ul);
  }
  if (unmatched.length) {
    const t = document.createElement('div');
    t.className = 'rollcall-result-title unmatched-title';
    t.textContent = ` ${unmatched.length} not in list / unrecognised`;
    container.appendChild(t);
    const ul = document.createElement('div'); ul.className = 'rollcall-result-list';
    unmatched.forEach(u => {
      const row = document.createElement('div'); row.className = 'rollcall-unmatch-row';
      row.textContent = u.name + (u.raw ? `  ${u.raw}` : '');
      ul.appendChild(row);
    });
    container.appendChild(ul);
  }
}

//  .msg file generation 
function rdrGenerate() {
  if (!S.currentRotaPersonId) {
    showAlert({ type:'error', title:'No IC Selected',
      bodyHTML:'Please select the <b>Current IC</b> in the Ops Log section before generating the RDR report.',
      buttons:[{label:'OK'}] });
    return;
  }
  const errBadge = el('rdr-att-err-badge');
  if (errBadge && !errBadge.classList.contains('hidden')) {
    showAlert({ type:'error', title:'Incomplete Attendance',
      bodyHTML:'Some attendance entries are flagged (<span style="color:var(--danger)">!</span>). Please fill in all required fields before generating.',
      buttons:[{label:'OK'}] });
    return;
  }
  try {
    const subject = `RDR REPORT FOR ${rdrGetDateStr()} ${rdrDetectedShift === 'AM' ? 'AM' : 'PM'}`;
    const html    = rdrBuildEmailHtml();
    const circ    = rdrGetCirc();
    const bytes   = rdrBuildMsgBuffer(subject, html, circ.to, circ.cc);
    const blob    = new Blob([bytes], { type:'application/vnd.ms-outlook' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href = url;
    a.download = `RDR ${rdrGetDateStr().replace(/\//g,'-')} ${rdrDetectedShift}.msg`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
    showToast(' .msg file downloaded!');
  } catch(e) {
    showAlert({ type:'error', title:'Generation Failed', bodyHTML:`Could not create .msg file: ${e.message}`, buttons:[{label:'OK'}] });
  }
}

// Build the HTML email body
function rdrBuildEmailHtml() {
  const { amRota, pmRota, amPeople, pmPeople } = getRdrRotaInfo();
  const isAM      = rdrDetectedShift === 'AM';
  const isWeekend = rdrSelectedDay === 'WEEKEND';
  const dateStr   = rdrGetDateLong();
  const shiftStr  = isAM ? 'AM Shift' : 'PM Shift';

  // ── shared style tokens ──────────────────────────────────────────────────
  const F   = 'font-family:Calibri,Arial,sans-serif;font-size:11pt';
  const BDR = 'border:1pt solid #AAAAAA';
  const hd  = `${F};${BDR};background:#0070C0;color:#FFFFFF;font-weight:bold;padding:5px 8px;vertical-align:middle`;
  const hd2 = `${F};${BDR};background:#BDD7EE;color:#1F3864;font-weight:bold;padding:5px 8px;vertical-align:middle`;
  const td  = `${F};${BDR};padding:5px 8px;vertical-align:middle`;
  const tbl = 'border-collapse:collapse;width:100%';

  // ── status: IN/ON DUTY plain black; others = status black + (reason) red ──
  function fmtAtt(att) {
    if (!att || !att.stype) return '';
    const isNormal = att.stype === 'IN' || att.stype === 'ON DUTY';
    if (isNormal) return `<span style="color:#000000">${esc(att.stype)}</span>`;
    let html = `<span style="color:#000000">${esc(att.stype)}</span>`;
    if (att.reason) {
      const bracket = ' (' + att.reason + (att.mcdate ? ' ' + att.mcdate : '') + ')';
      html += `<span style="color:#FF0000">${esc(bracket)}</span>`;
    }
    return html;
  }

  // ── generic left/right pair row builder ──────────────────────────────────
  function pairRows(leftList, leftKey, rightList, rightKey, rightAutoOnDuty) {
    const len = Math.max(leftList.length, rightList.length);
    if (!len) return `<tr><td style="${td}" colspan="4"><i>No personnel configured</i></td></tr>`;
    return Array.from({length: len}, (_, i) => {
      const lP   = leftList[i];
      const rP   = rightList[i];
      const lAtt = lP ? rdrGetAtt(leftKey, i) : null;
      const rAtt = rP ? (rightAutoOnDuty ? {stype:'ON DUTY',reason:'',mcdate:''} : rdrGetAtt(rightKey, i)) : null;
      const lName = lP ? esc((lP.rank ? lP.rank + ' ' : '') + lP.name) : '';
      const rName = rP ? esc((rP.rank ? rP.rank + ' ' : '') + rP.name) : '';
      return `<tr>
        <td style="${td};text-align:right;width:24%">${lName}</td>
        <td style="${td};width:26%">${fmtAtt(lAtt)}</td>
        <td style="${td};text-align:right;width:24%">${rName}</td>
        <td style="${td};width:26%">${fmtAtt(rAtt)}</td>
      </tr>`;
    }).join('');
  }

  const amRLabel = `AM SHIFT${amRota ? ' ' + amRota.toUpperCase() : ''}`;
  const pmRLabel = `PM SHIFT${pmRota ? ' ' + pmRota.toUpperCase() : ''}`;

  // ── checklist content (static, per reference template) ───────────────────
  const olS    = 'margin:2px 0 2px 16px;padding:0;font-size:10pt';
  const clAMwd = `<ol style="${olS}"><li>OPS EQUIPMENT CHECKLIST</li></ol>`;
  const clAMwk = `<ol style="${olS}"><li>OPS EQUIPMENT CHECKLIST</li><li>FCV CHECKLIST (SIGNED)</li></ol>`;
  const clPM   = `<ol style="${olS}"><li>OPS EQUIPMENT CHECKLIST</li><li>FCV CHECKLIST (SIGNED)</li><li><b style="color:#FF0000">FIRE POST AUDIT</b></li></ol>`;

  // ── circulation list display ─────────────────────────────────────────────
  const circNames = rdrGetCircNames();
  const circToStr = circNames.to.join(', ');
  const circCcStr = circNames.cc.join(', ');
  const circSection = (circToStr || circCcStr) ? `
  <tr>
    <td style="${td};background:#EEF4FB;text-align:center" colspan="4">
      <b>CIRCULATION LIST</b><br>
      ${circToStr ? `${esc(circToStr)}<br>` : ''}
      ${circCcStr ? `<br><b>CC:</b> ${esc(circCcStr)}` : ''}
    </td>
  </tr>` : '';

  // ── sign-off IC from ops log current rota ────────────────────────────────
  const icEntry = S.currentRotaPersonId ? S.rotas.find(r => {
    try { return findOrAddRotaPerson(r.rota, r.rank, r.name) === S.currentRotaPersonId; } catch { return false; }
  }) : null;
  const icName = icEntry ? ((icEntry.rank ? icEntry.rank + ' ' : '') + icEntry.name) : '_______________';
  const icRota = S.currentRota || '___';

  const stnHdStyle = `${F};${BDR};background:#BDD7EE;color:#1F3864;font-weight:bold;padding:5px 8px;text-align:center`;

  return `<html><head><meta charset="utf-8"></head>
<body style="${F};margin:0;padding:8px">
<table style="${tbl}">

  <!-- TITLE BANNER -->
  <tr>
    <td style="${hd};font-size:20pt;text-align:center;padding:10px;letter-spacing:1px" colspan="4">RDR REPORT</td>
  </tr>

  <!-- DATE / SHIFT -->
  <tr>
    <td style="${td};text-align:center;background:#EEF4FB" colspan="4">
      <b>${esc(dateStr)}</b> &nbsp;&nbsp;|&nbsp;&nbsp; <b>${esc(shiftStr)}</b>
    </td>
  </tr>

  <!-- CIRCULATION LIST -->
  ${circSection}

  <!-- CHECKLIST -->
  <tr><td style="${hd};text-align:center" colspan="4">CHECKLIST</td></tr>
  <tr>
    <td style="${td};padding:0" colspan="4">
      <table style="${tbl}">
        <tr>
          <td style="${hd2};text-align:center;width:25%"></td>
          <td style="${hd2};text-align:center;width:37.5%">WEEKDAYS</td>
          <td style="${hd2};text-align:center;width:37.5%">WEEKENDS / PH</td>
        </tr>
        <tr>
          <td style="${hd2};text-align:center;font-size:10pt">AM SHIFT</td>
          <td style="${td};vertical-align:top">${clAMwd}</td>
          <td style="${td};vertical-align:top">${clAMwk}</td>
        </tr>
        <tr>
          <td style="${hd2};text-align:center;font-size:10pt">PM SHIFT</td>
          <td style="${td};vertical-align:top">${clPM}</td>
          <td style="${td};vertical-align:top">${clPM}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- KEYPRESS RECORD -->
  <tr><td style="${hd};text-align:center" colspan="4">KEYPRESS RECORD</td></tr>
  <tr><td style="${td};color:#FF0000;text-align:center" colspan="4">NO KEYPRESS RECORDS</td></tr>

  <!-- ATTENDANCE BANNER -->
  <tr>
    <td style="${hd};font-size:13pt;text-align:center;padding:8px" colspan="4">OPS BRANCH NSF ATTENDANCE</td>
  </tr>

  <!-- AM SHIFT | PM SHIFT (rota people) -->
  <tr>
    <td style="${hd};text-align:center" colspan="2">${amRLabel}</td>
    <td style="${hd};text-align:center" colspan="2">${pmRLabel}</td>
  </tr>
  ${pairRows(amPeople, 'am', pmPeople, 'pm', isAM)}

  <!-- OFFICE HOURS | EMS OH (weekday only) -->
  ${!isWeekend ? `<tr>
    <td style="${hd};text-align:center" colspan="2">OPS READINESS &amp; PLANNING TEAM</td>
    <td style="${hd};text-align:center" colspan="2">EMS TEAM</td>
  </tr>
  ${pairRows(rdrLists.ops, 'ops', rdrLists.ems, 'ems', false)}` : ''}

  <!-- OPS LOG BANNER + EMPTY PASTE ROW -->
  <tr>
    <td style="${hd};font-size:10pt;padding:6px 8px" colspan="4">
      OPS LOG &mdash; INCLUDES OPS LOG, REPORT SICK LOG AND ALL FAXES / INSTRUCTIONS COMING IN (End of Each Shift)
    </td>
  </tr>
  <tr><td style="${td}" colspan="4">&nbsp;</td></tr>

  <!-- FIRE REPORTS -->
  <tr><td style="${hd};text-align:center" colspan="4">FIRE REPORTS</td></tr>

  <!-- STN 41–45 -->
  ${['41','42','43','44','45'].map(n =>
    `<tr><td style="${stnHdStyle}" colspan="4">STN ${n}</td></tr>
  <tr><td style="${td}" colspan="4">&nbsp;</td></tr>`
  ).join('\n  ')}


</table>

<table style="border-collapse:collapse;margin-top:16px;font-family:'Century Gothic',Arial,sans-serif">
  <tr>
    <td style="padding:0 8px 0 0;vertical-align:middle">
      <img src="${typeof SIG_LOGO!=='undefined'?SIG_LOGO:''}" width="80" height="80" style="display:block">
    </td>
    <td style="padding:0 8px;vertical-align:middle;border-left:1px solid #cccccc">
      <img src="${typeof SIG_SEP!=='undefined'?SIG_SEP:''}" width="2" height="80" style="display:block">
    </td>
    <td style="padding:0 0 0 8px;vertical-align:top">
      <b style="font-size:11pt;color:#0E2841">${esc(icName)}</b><br>
      <span style="font-size:10pt;color:#0E2841">INFOCOMMS OPERATOR <b>(${esc(icRota)})</b></span><br>
      <span style="font-size:10pt;color:#0E2841">Operations Branch | 4<sup>th</sup> SCDF Division</span><br>
      <span style="font-size:10pt;color:#0E2841">DID: 6314 6907 | 6314 6906</span>
    </td>
  </tr>
</table>
<table style="border-collapse:collapse;margin-top:6px;font-family:'Century Gothic',Arial,sans-serif;border-top:1.5pt solid #001F5F;padding-top:4px;width:100%">
  <tr>
    <td style="padding:4px 0;vertical-align:middle">
      <b style="font-size:10pt;color:#001F5F">Singapore Civil Defence Force</b>
      <span style="font-size:10pt;color:#001F5F">&nbsp;&nbsp;Visit us at </span><a href="https://www.scdf.gov.sg/" style="font-size:10pt;color:#4472C4;text-decoration:none">scdf.gov.sg</a>
      <span style="font-size:10pt;color:#001F5F">&nbsp;|&nbsp;Follow us on&nbsp;</span>
      ${[
        typeof SIG_FB!=='undefined'?SIG_FB:'',
        typeof SIG_X!=='undefined'?SIG_X:'',
        typeof SIG_INSTA!=='undefined'?SIG_INSTA:'',
        typeof SIG_YOUTUBE!=='undefined'?SIG_YOUTUBE:'',
        typeof SIG_TIKTOK!=='undefined'?SIG_TIKTOK:'',
        typeof SIG_LINKEDIN!=='undefined'?SIG_LINKEDIN:'',
        typeof SIG_THREADS!=='undefined'?SIG_THREADS:''
      ].map(src => src ? `<img src="${src}" width="20" height="20" style="vertical-align:middle;margin:0 1px">` : '').join('')}
    </td>
  </tr>
  <tr>
    <td style="padding:6px 0 0 0">
      <img src="${rdrSignOffDataUrl||(typeof SIG_BANNER!=='undefined'?SIG_BANNER:'')}" style="display:block;width:100%">
    </td>
  </tr>
  <tr>
    <td style="padding:8px 0 4px 0;font-size:8pt;color:#7F7F7F;text-align:justify">
      <b style="color:red">WARNING</b>: &ldquo;Privileged/Confidential information may be contained in this message. If you are not the intended addressee, you must not copy, distribute or take any action in reliance thereon. Communication of any information in this email to any unauthorised person is an offence under Official Secrets Act 1935. Please notify the sender immediately if you receive this in error.&rdquo;
    </td>
  </tr>
  <tr>
    <td style="padding:4px 0">
      <b><i style="font-size:8pt;color:#538135">Go green. Think before you print.</i></b>
    </td>
  </tr>
</table>

</body></html>`;
}

// OLE2 MSG writer using SheetJS CFB library (loaded via CDN)
function rdrBuildMsgBuffer(subject, htmlBodyStr, toAddrs, ccAddrs) {
  if (typeof CFB === 'undefined') throw new Error('CFB library not loaded  check internet connection');

  const enc = new TextEncoder();
  function u16(str) {
    const b = new Uint8Array((str.length + 1) * 2);
    for (let i = 0; i < str.length; i++) {
      b[i*2]   = str.charCodeAt(i) & 0xFF;
      b[i*2+1] = str.charCodeAt(i) >> 8;
    }
    return b;
  }

  const allRecips = [
    ...(toAddrs||[]).map(e => ({ email:e.trim(), type:1 })),
    ...(ccAddrs||[]).map(e => ({ email:e.trim(), type:2 })),
  ].filter(r => r.email);
  const recipCount = allRecips.length;

  const htmlBytes    = enc.encode(htmlBodyStr);
  const subjectBytes = u16(subject);
  const msgClsBytes  = u16('IPM.Note');
  const displayTo    = (toAddrs||[]).filter(Boolean).join('; ');
  const displayCc    = (ccAddrs||[]).filter(Boolean).join('; ');

  const fixedProps = [
    [0x0E07, 0x0003, 0x0008],
    [0x0017, 0x0003, 1],
    [0x0023, 0x0003, 0],
    [0x0036, 0x0003, 1],
  ];
  const varProps = [
    [0x001A, 0x001F, msgClsBytes.length],
    [0x0037, 0x001F, subjectBytes.length],
    [0x1013, 0x0102, htmlBytes.length],
  ];
  const displayToBytes = displayTo ? u16(displayTo) : null;
  const displayCcBytes = displayCc ? u16(displayCc) : null;
  if (displayToBytes) varProps.push([0x0E04, 0x001F, displayToBytes.length]);
  if (displayCcBytes) varProps.push([0x0E03, 0x001F, displayCcBytes.length]);

  const propStream = new Uint8Array(32 + (fixedProps.length + varProps.length) * 16);
  const dv = new DataView(propStream.buffer);
  dv.setUint32(8,  recipCount, true);
  dv.setUint32(16, recipCount, true);
  let off = 32;
  for (const [id, type, val] of fixedProps) {
    dv.setUint16(off, type, true); dv.setUint16(off+2, id, true);
    dv.setUint32(off+8, val, true); off += 16;
  }
  for (const [id, type, size] of varProps) {
    dv.setUint16(off, type, true); dv.setUint16(off+2, id, true);
    dv.setUint32(off+8, size, true); off += 16;
  }

  const cfb = CFB.utils.cfb_new({ root: 'Root Entry' });
  function addStream(path, data) {
    CFB.utils.cfb_add(cfb, path, data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  addStream('/__properties_version1.0', propStream);
  addStream('/__substg1.0_001A001F',    msgClsBytes);
  addStream('/__substg1.0_0037001F',    subjectBytes);
  addStream('/__substg1.0_10130102',    htmlBytes);
  if (displayToBytes) addStream('/__substg1.0_0E04001F', displayToBytes);
  if (displayCcBytes) addStream('/__substg1.0_0E03001F', displayCcBytes);
  const smtpBytes = u16('SMTP');
  allRecips.forEach((r, i) => {
    const base   = `/__recip_version1.0_#${String(i).padStart(8, '0')}`;
    const emailB = u16(r.email);
    const rFixed = [
      [0x0FFE, 0x0003, 6],
      [0x0C15, 0x0003, r.type],
    ];
    const rVar = [
      [0x3002, 0x001F, smtpBytes.length],
      [0x0076, 0x001F, emailB.length],
      [0x3001, 0x001F, emailB.length],
    ];
    const rps = new Uint8Array(8 + (rFixed.length + rVar.length) * 16);
    const rdv = new DataView(rps.buffer);
    let ro = 8;
    for (const [id, type, val] of rFixed) {
      rdv.setUint16(ro, type, true); rdv.setUint16(ro+2, id, true);
      rdv.setUint32(ro+8, val, true); ro += 16;
    }
    for (const [id, type, size] of rVar) {
      rdv.setUint16(ro, type, true); rdv.setUint16(ro+2, id, true);
      rdv.setUint32(ro+8, size, true); ro += 16;
    }
    addStream(`${base}/__properties_version1.0`, rps);
    addStream(`${base}/__substg1.0_3002001F`,    smtpBytes);
    addStream(`${base}/__substg1.0_0076001F`,    emailB);
    addStream(`${base}/__substg1.0_3001001F`,    emailB);
  });

  try { CFB.utils.cfb_del(cfb, '/\x01Sh33tJ5'); CFB.utils.cfb_gc(cfb); } catch(_) {}

  const rootEntry = cfb.FileIndex[0];
  if (rootEntry) rootEntry.clsid = '0B0D020000000000C000000000000046';

  const raw = CFB.write(cfb, { type: 'array' });
  return new Uint8Array(raw);
}

//  OH Settings drag-drop 
let _rdrDragSrc=null,_rdrDragTab=null;

function rdrRemoveEntry(tab, i) {
  showAlert({type:'info',title:'Confirm',bodyHTML:`Remove "${(rdrLists[tab][i].rank?rdrLists[tab][i].rank+' ':'')}${rdrLists[tab][i].name}"?`,
    buttons:[{label:'Cancel'},{label:'Remove',cb:()=>{rdrLists[tab].splice(i,1);rdrSaveLists(tab);renderOhSettingsList();}}]});
}

function _rdrInitDrag(container, tab) {
  container.addEventListener('dragstart',e=>{const row=e.target.closest('.rota-entry-row');if(!row)return;_rdrDragSrc=row;_rdrDragTab=tab;setTimeout(()=>row.classList.add('drag-active'),0);});
  container.addEventListener('dragend',()=>{if(_rdrDragSrc)_rdrDragSrc.classList.remove('drag-active');container.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));_rdrDragSrc=null;});
  container.addEventListener('dragover',e=>{e.preventDefault();const row=e.target.closest('.rota-entry-row');if(!row||row===_rdrDragSrc)return;container.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));row.classList.add('drag-over');});
  container.addEventListener('drop',e=>{e.preventDefault();const row=e.target.closest('.rota-entry-row');if(!row||row===_rdrDragSrc||_rdrDragTab!==tab)return;const si=parseInt(_rdrDragSrc.dataset.idx),di=parseInt(row.dataset.idx);const item=rdrLists[tab].splice(si,1)[0];rdrLists[tab].splice(di,0,item);rdrSaveLists(tab);renderOhSettingsList();});
}

//  Email Recipients (settings)
const RDR_RECIP_SK = 'rdr_email_recipients_v1';
let rdrEmailRecipients = [];

function rdrLoadRecipients() {
  try { rdrEmailRecipients = JSON.parse(localStorage.getItem(RDR_RECIP_SK)) || []; }
  catch { rdrEmailRecipients = []; }
}
function rdrSaveRecipients() {
  localStorage.setItem(RDR_RECIP_SK, JSON.stringify(rdrEmailRecipients));
}
function rdrImportRecipients() {
  const raw = el('recip-import-text')?.value || '';
  let added = 0;
  raw.split('\n').forEach(line => {
    const parts = line.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return;
    // Detect if first part is an email (no rank/name before it)
    let rank = '', name = '', email = '';
    const last = parts[parts.length - 1];
    if (!last.includes('@')) return; // last field must be email
    email = last;
    if (parts.length === 2) {
      name = parts[0];
    } else {
      // 3+ parts: first = rank, second = name (join remaining non-email as name)
      rank = parts[0];
      name = parts.slice(1, parts.length - 1).join(' ');
    }
    if (!name || !email) return;
    if (rdrEmailRecipients.some(r => r.email.toLowerCase() === email.toLowerCase())) return;
    rdrEmailRecipients.push({ rank: rank.toUpperCase(), name: name.toUpperCase(), email });
    added++;
  });
  if (added) { rdrSaveRecipients(); renderRdrRecipientsList(); }
  const ta = el('recip-import-text'); if (ta) ta.value = '';
  showToast(added ? `${added} recipient${added>1?'s':''} imported` : 'No new recipients found');
}
let rdrRecipAdding = false;

//  Sign-off image
const RDR_SIGNOFF_SK = 'rdr_signoff_image_v1';
let rdrSignOffDataUrl = null;

function rdrSignOffApply(dataUrl) {
  rdrSignOffDataUrl = dataUrl;
  const preview = el('rdr-signoff-preview');
  if (preview) preview.innerHTML = `<img src="${rdrSignOffDataUrl}" alt="Sign off">`;
  const clr = el('rdr-signoff-clear');
  if (clr) clr.style.display = '';
}
function rdrLoadSignOff() {
  const stored = localStorage.getItem(RDR_SIGNOFF_SK);
  if (stored) rdrSignOffApply(stored);
}
function rdrSignOffDrop(e) {
  e.preventDefault();
  el('rdr-signoff-drop')?.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    localStorage.setItem(RDR_SIGNOFF_SK, ev.target.result);
    rdrSignOffApply(ev.target.result);
  };
  reader.readAsDataURL(file);
}
function rdrSignOffClear() {
  rdrSignOffDataUrl = null;
  localStorage.removeItem(RDR_SIGNOFF_SK);
  const preview = el('rdr-signoff-preview');
  if (preview) preview.innerHTML = '<span class="rdr-signoff-hint">Drag &amp; drop sign-off image here</span>';
  const clr = el('rdr-signoff-clear');
  if (clr) clr.style.display = 'none';
}

function rdrShowRecipAdd() {
  rdrRecipAdding = true;
  renderRdrRecipientsList();
  setTimeout(() => el('new-recip-rank')?.focus(), 0);
}
function rdrCancelRecipAdd() {
  rdrRecipAdding = false;
  renderRdrRecipientsList();
}
function rdrAddRecipient() {
  const rank  = (el('new-recip-rank')?.value.trim()  || '').toUpperCase();
  const name  = (el('new-recip-name')?.value.trim()  || '').toUpperCase();
  const email = el('new-recip-email')?.value.trim() || '';
  if (!name || !email) return;
  rdrEmailRecipients.push({ rank, name, email });
  rdrSaveRecipients();
  rdrRecipAdding = false;
  renderRdrRecipientsList();
}
function rdrRemoveRecipient(idx) {
  rdrEmailRecipients.splice(idx, 1);
  rdrSaveRecipients();
  renderRdrRecipientsList();
}
let rdrRecipEditIdx = null;
function rdrStartEditRecipient(idx) {
  rdrRecipEditIdx = idx;
  rdrRecipAdding = false;
  renderRdrRecipientsList();
  setTimeout(() => el(`edit-recip-rank-${idx}`)?.focus(), 0);
}
function rdrSaveEditRecipient(idx) {
  const rank  = (el(`edit-recip-rank-${idx}`)?.value.trim()  || '').toUpperCase();
  const name  = (el(`edit-recip-name-${idx}`)?.value.trim()  || '').toUpperCase();
  const email =  el(`edit-recip-email-${idx}`)?.value.trim() || '';
  if (!name) return;
  rdrEmailRecipients[idx] = { rank, name, email };
  rdrSaveRecipients();
  rdrRecipEditIdx = null;
  renderRdrRecipientsList();
}
function rdrCancelEditRecipient() {
  rdrRecipEditIdx = null;
  renderRdrRecipientsList();
}
function renderRdrRecipientsList() {
  const wrap    = el('rdr-recipients-list');
  const addArea = el('rdr-recipients-add-area');
  if (!wrap) return;

  wrap.innerHTML = '';
  if (!rdrEmailRecipients.length) {
    wrap.innerHTML = '<span style="color:var(--text-3);font-size:11px;padding:4px 0;display:block">No recipients added yet</span>';
  } else {
    rdrEmailRecipients.forEach((r, i) => {
      const row = document.createElement('div');
      if (rdrRecipEditIdx === i) {
        row.className = 'recip-row';
        row.innerHTML = `<div class="add-personnel-inline" style="margin:2px 0">
          <input type="text" class="text-input settings-sm" id="edit-recip-rank-${i}" value="${esc(r.rank)}" placeholder="Rank" style="width:64px;text-transform:uppercase"
                 oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')el('edit-recip-name-${i}').focus()">
          <input type="text" class="text-input settings-sm" id="edit-recip-name-${i}" value="${esc(r.name)}" placeholder="Name" style="width:110px;text-transform:uppercase"
                 oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')el('edit-recip-email-${i}').focus()">
          <input type="text" class="text-input settings-sm" id="edit-recip-email-${i}" value="${esc(r.email)}" placeholder="email@example.com" style="flex:1;min-width:120px"
                 onkeydown="if(event.key==='Enter')rdrSaveEditRecipient(${i})">
          <button class="secondary-btn-sm" onclick="rdrSaveEditRecipient(${i})">Save</button>
          <button class="entry-remove-btn" onclick="rdrCancelEditRecipient()" title="Cancel"></button>
        </div>`;
      } else {
        row.className = 'rota-entry-row recip-row';
        row.innerHTML = (r.rank ? `<span class="rota-entry-badge recip-badge">${esc(r.rank)}</span>` : '')
                      + `<span class="rota-entry-name">${esc(r.name)}</span>`
                      + `<span class="recip-email">${esc(r.email)}</span>`
                      + `<button class="entry-edit-btn" onclick="rdrStartEditRecipient(${i})" title="Edit"></button>`
                      + `<button class="entry-remove-btn" onclick="rdrRemoveRecipient(${i})" title="Remove"></button>`;
      }
      wrap.appendChild(row);
    });
  }

  if (!addArea) return;
  if (rdrRecipAdding) {
    addArea.innerHTML = `<div class="add-personnel-inline" style="margin-top:6px">
      <input type="text" class="text-input settings-sm" id="new-recip-rank" placeholder="Rank" style="width:64px;text-transform:uppercase"
             oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')el('new-recip-name').focus()">
      <input type="text" class="text-input settings-sm" id="new-recip-name" placeholder="Name" style="width:110px;text-transform:uppercase"
             oninput="this.value=this.value.toUpperCase()" onkeydown="if(event.key==='Enter')el('new-recip-email').focus()">
      <input type="text" class="text-input settings-sm" id="new-recip-email" placeholder="email@example.com" style="flex:1;min-width:120px"
             onkeydown="if(event.key==='Enter')rdrAddRecipient()">
      <button class="secondary-btn-sm" onclick="rdrAddRecipient()">Add</button>
      <button class="entry-remove-btn" onclick="rdrCancelRecipAdd()" title="Cancel"></button>
    </div>`;
  } else {
    addArea.innerHTML = `<button class="add-personnel-btn" onclick="rdrShowRecipAdd()" style="margin-top:6px">+ Click to add recipient</button>`;
  }
}

//  Circulation List (name-based with autocomplete)
const RDR_CIRC_SK = { TO:'rdr_circ_to_v2', CC:'rdr_circ_cc_v2' };
// Stored as JSON arrays of {rank,name,email} objects (snapshotted from recipients at selection time)
let rdrCircTo = [];
let rdrCircCc = [];

function rdrLoadCirc() {
  try { rdrCircTo = JSON.parse(localStorage.getItem(RDR_CIRC_SK.TO)) || []; } catch { rdrCircTo = []; }
  try { rdrCircCc = JSON.parse(localStorage.getItem(RDR_CIRC_SK.CC)) || []; } catch { rdrCircCc = []; }
  renderCircTags('to'); renderCircTags('cc');
}
function rdrSaveCirc() {
  localStorage.setItem(RDR_CIRC_SK.TO, JSON.stringify(rdrCircTo));
  localStorage.setItem(RDR_CIRC_SK.CC, JSON.stringify(rdrCircCc));
}
function rdrGetCirc() {
  const emails = arr => arr.map(r => r.email).filter(Boolean);
  return { to: emails(rdrCircTo), cc: emails(rdrCircCc) };
}
function rdrGetCircNames() {
  const fmt = arr => arr.map(r => (r.rank ? r.rank + ' ' : '') + r.name).filter(Boolean);
  return { to: fmt(rdrCircTo), cc: fmt(rdrCircCc) };
}

function renderCircTags(field) {
  const arr  = field === 'to' ? rdrCircTo : rdrCircCc;
  const wrap = el(`rdr-circ-${field}-tags`); if (!wrap) return;
  wrap.innerHTML = '';
  arr.forEach((r, i) => {
    const chip = document.createElement('span');
    chip.className = 'circ-tag';
    const label = (r.rank ? r.rank + ' ' : '') + r.name;
    chip.innerHTML = `${esc(label)}<button class="circ-tag-del" onclick="rdrCircRemove('${field}',${i})">&times;</button>`;
    wrap.appendChild(chip);
  });
}
function rdrCircRemove(field, idx) {
  if (field === 'to') rdrCircTo.splice(idx, 1);
  else                rdrCircCc.splice(idx, 1);
  rdrSaveCirc(); renderCircTags(field);
}
function rdrCircSelect(field, recip) {
  const arr = field === 'to' ? rdrCircTo : rdrCircCc;
  const already = arr.some(r => r.email === recip.email);
  if (!already) { arr.push(recip); rdrSaveCirc(); renderCircTags(field); }
  const inp = el(`rdr-circ-${field}-input`); if (inp) inp.value = '';
  el(`rdr-circ-${field}-dropdown`)?.classList.add('hidden');
}
function rdrCircInput(field) {
  const inp  = el(`rdr-circ-${field}-input`); if (!inp) return;
  const q    = inp.value.trim().toLowerCase();
  const drop = el(`rdr-circ-${field}-dropdown`); if (!drop) return;
  const already = field === 'to' ? rdrCircTo : rdrCircCc;
  const matches = rdrEmailRecipients.filter(r => {
    const label = ((r.rank ? r.rank + ' ' : '') + r.name).toLowerCase();
    return (label.includes(q) || r.email.toLowerCase().includes(q))
        && !already.some(a => a.email === r.email);
  });
  if (!matches.length || !q) { drop.classList.add('hidden'); return; }
  drop.innerHTML = '';
  matches.slice(0, 8).forEach(r => {
    const item = document.createElement('div');
    item.className = 'circ-dropdown-item';
    const label = (r.rank ? r.rank + ' ' : '') + r.name;
    item.innerHTML = `<span class="circ-di-name">${esc(label)}</span><span class="circ-di-email">${esc(r.email)}</span>`;
    item.onmousedown = e => { e.preventDefault(); rdrCircSelect(field, r); };
    drop.appendChild(item);
  });
  drop.classList.remove('hidden');
}
function rdrCircKeydown(e, field) {
  if (e.key === 'Escape') { el(`rdr-circ-${field}-dropdown`)?.classList.add('hidden'); }
}
function rdrCircBlur(field) {
  setTimeout(() => el(`rdr-circ-${field}-dropdown`)?.classList.add('hidden'), 150);
}

function initRdr() {
  rdrLoadLists();
  rdrLoadReasons();
  rdrLoadRecipients();
  rdrLoadCirc();
  rdrLoadSignOff();
  rdrSetShiftMode('auto');
  renderOhSettingsList();
  renderRdrReasonsList();
  renderRdrRecipientsList();
}

document.addEventListener('DOMContentLoaded', initRdr);

