'use strict';

// =============================================
// ROTAS & APPLIANCES — localStorage management
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
  showToast(`✓ ${name} added to ${rota}`);
}

function removeRotaEntry(idx) {
  S.rotas.splice(idx, 1);
  saveRotasToStorage();
  rebuildRotaPeopleDB(); renderRotaSettingsList();
}

function importRotaEntriesFromUI() {
  const text = el('rota-import-text').value.trim(); if (!text) return;
  const VALID_ROTAS = ['Rota 1','Rota 2','Rota 3'];
  // Split on newlines; each line may itself be comma-separated entries
  const tokens = text.split(/\n/).flatMap(line => line.split(','));
  let added = 0;
  tokens.forEach(tok => {
    const parts = tok.trim().split('|').map(s => s.trim());
    if (parts.length === 3) {
      const [rota, rank, name] = [parts[0], parts[1].toUpperCase(), parts[2].toUpperCase()];
      if (name && VALID_ROTAS.includes(rota) && !S.rotas.find(r=>r.rota===rota&&r.rank===rank&&r.name===name)) {
        S.rotas.push({rota, rank, name}); added++;
      }
    }
  });
  if (added) { saveRotasToStorage(); rebuildRotaPeopleDB(); renderRotaSettingsList(); showToast(`✓ ${added} name${added>1?'s':''} imported`); }
  else { showToast('No new names to import'); }
  el('rota-import-text').value = '';
}

function setRotaTab(rota){ S.settingsRotaTab=rota; S.settingsEditIdx=null; renderRotaSettingsList(); }

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
    listHTML = `<div class="settings-empty-hint">No entries for ${tab} — add one below.</div>`;
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
          <button class="entry-remove-btn" onclick="cancelRotaEntryEdit()" title="Cancel">✕</button>
        </div>`;
      }
      return `<div class="rota-entry-row" data-rota="${rn}" data-idx="${i}" draggable="true"
          ondragstart="rotaDragStart(event,${i})" ondragover="rotaDragOver(event)" ondrop="rotaDrop(event,${i})" ondragleave="rotaDragLeave(event)">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="rota-entry-badge ${cls[rota]||''}">${rota}</span>
        <span class="rota-entry-rank">${esc(rank)||'—'}</span>
        <span class="rota-entry-name">${esc(name)}</span>
        <button class="entry-edit-btn" onclick="editRotaEntry(${i})" title="Edit">✎</button>
        <button class="entry-remove-btn" onclick="removeRotaEntry(${i})" title="Remove">✕</button>
      </div>`;
    }).join('');
  }
  const rotaIdx = ['Rota 1','Rota 2','Rota 3'].indexOf(tab);
  const posClass = rotaIdx === 0 ? 'tab-pos-first' : rotaIdx === 2 ? 'tab-pos-last' : 'tab-pos-mid';
  wrap.innerHTML = `<div class="settings-tabs">${tabsHTML}</div>
    <div class="settings-tab-content rc-${rotaNum(tab)} ${posClass}">
      <div class="rota-entries-body">${listHTML}</div>
      <span class="settings-ts" style="display:block;margin-top:4px">Last changed: ${ts}</span>
    </div>`;
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
  showToast('✓ Order updated');
}
function saveRotaEntryEdit(idx){
  const rank=(el(`edit-rank-${idx}`)?.value||'').trim().toUpperCase();
  const name=(el(`edit-name-${idx}`)?.value||'').trim().toUpperCase();
  if(!name) return;
  S.rotas[idx].rank=rank; S.rotas[idx].name=name;
  S.settingsEditIdx=null;
  saveRotasToStorage(); rebuildRotaPeopleDB(); renderRotaSettingsList();
  showToast(`✓ ${name} updated`);
}

// ---- Appliance CRUD ----
function addApplianceFromUI() {
  const code = el('new-appliance-code').value.trim().toUpperCase(); if (!code) return;
  if (!S.appliances.find(a => a.code === code)) { S.appliances.push({code, desc:''}); sortAppliances(); saveAppliancesToStorage(); renderApplianceSettingsList(); showToast(`✓ ${code} added`); }
  el('new-appliance-code').value = '';
}

function removeAppliance(idx) {
  S.appliances.splice(idx, 1); saveAppliancesToStorage(); renderApplianceSettingsList();
}

function importAppliancesFromUI() {
  const text = el('appliance-import-text').value.trim(); if (!text) return;
  const codes = text.split(/[\n,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  let added = 0;
  codes.forEach(code => { if (!S.appliances.find(a=>a.code===code)) { S.appliances.push({code,desc:''}); added++; } });
  if (added) { sortAppliances(); saveAppliancesToStorage(); renderApplianceSettingsList(); showToast(`✓ ${added} appliance${added>1?'s':''} imported`); }
  else { showToast('No new appliances to import'); }
  el('appliance-import-text').value = '';
}

function setStnTab(stn){ S.settingsStnTab=stn; renderApplianceSettingsList(); }

function renderApplianceSettingsList() {
  const wrap = el('appliance-settings-list'); if (!wrap) return;
  if (!S.appliances.length) {
    wrap.innerHTML = '<span class="no-names-hint">No appliances yet — add one below or use Quick Import.</span>';
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
          <button class="entry-remove-btn" onclick="removeAppliance(${i})" title="Remove">✕</button>
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
  hasP3: false, p3PersonId: null, p3ActivatorMode: null,

  // Drum
  timeH:            [null,  null,  null,  null,  null],
  timeM:            [null,  null,  null,  null,  null],
  timeAutoSet:      [false, false, false, false, false],
  timeBlocked:      [false, false, false, false, false],
  timeGapDismissed: [false, false, false, false, false],
  p3Times:          ['', '', '', '', ''],
  // Suggestion state — auto-computed from previous timing, not committed until user confirms
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
  const isNight = totalMin >= 18*60+10 || totalMin < 8*60+10;
  const sd = new Date(refDate); sd.setHours(0,0,0,0);
  if (isNight && totalMin < 8*60+10) sd.setDate(sd.getDate()-1);
  const dp = Math.floor((sd - CYCLE_START)/86400000);
  const cy = ((dp % 6)+6)%6+1;
  const [cur,inc] = ROTA_MAP[cy][isNight?'night':'day'];
  return { shiftLabel: isNight?'Night':'Day', currentRota: cur, incomingRota: inc };
}
function applyShiftResult(r) {
  S.detectedShiftLabel = r.shiftLabel; S.currentRota = r.currentRota; S.incomingRota = r.incomingRota;
  const icon = r.shiftLabel === 'Day' ? '🌤️' : '🌙';
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
    S.redconData = []; S.redconCautionState = null; S.redconCautionDismissed = false;
    renderRedconCaution();
  }
  S.currentRotaPersonId = null; S.incomingRotaPersonId = null;
  renderICButtons(); renderP3Activator(); refreshDrums(); updateValidation();
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
function initCalendar() {
  const n = new Date(); calViewYear=n.getFullYear(); calViewMonth=n.getMonth(); renderCalendar();
}
function renderCalendar() {
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const today=new Date(); today.setHours(0,0,0,0);
  const sel=S.overrideDate; const first=new Date(calViewYear,calViewMonth,1);
  const startDow=first.getDay(); const dim=new Date(calViewYear,calViewMonth+1,0).getDate();
  let html=`<div class="cal-header"><button class="cal-nav" onclick="calNav(-1)">‹</button>
    <span class="cal-month-label">${months[calViewMonth]} ${calViewYear}</span>
    <button class="cal-nav" onclick="calNav(1)">›</button></div><div class="cal-grid">
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
function selectCalDay(y,m,d){ S.overrideDate=new Date(y,m,d); renderCalendar(); applyOverrideShift(); updateOverrideDateChip(); }

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
  if(entry) showToast(`✓ ${label}: ${entry.rank?entry.rank+' ':''}${entry.name}`);
}

// =============================================
// P3
// =============================================
function setP3(hasP3){
  S.hasP3=hasP3; toggle('btn-nop3',!hasP3); toggle('btn-yesp3',hasP3);
  el('p3-summary-panel').classList.toggle('hidden',!hasP3);
  if(!hasP3) closeP3Editor();
  renderP3Summary(); updateValidation();
}

function openP3Editor(){
  if(!S.hasP3) return;
  el('p3-editor-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}
function closeP3Editor(e){
  if(e&&e.target!==el('p3-editor-overlay')) return;
  el('p3-editor-overlay').classList.add('hidden');
  document.body.style.overflow='';
  renderP3Summary();
}

function renderP3Summary(){
  const content=el('p3-summary-content'); if(!content) return;
  if(!S.hasP3){content.innerHTML='';return;}

  const p=S.p3PersonId?getPersonById(S.p3PersonId):null;
  const activatorText=p?(p.rank?`${p.rank} ${p.name}`:p.name):'<em>not set</em>';

  const labels=['Activated','Left Div.','Arrived','Left Loc.','Reached'];
  const cellsHTML=labels.map((lbl,i)=>{
    const blocked=S.timeBlocked[i];
    const t=S.p3Times[i];
    const hasSugg=!blocked&&!t&&S.timeSuggested[i];
    let timeStr,cls,hint='';
    let cautionIcon='';
    if(blocked){
      timeStr='Disabled'; cls='is-blocked';
    } else if(t){
      timeStr=`${t.slice(0,2)}:${t.slice(2)}`; cls='';
      const caution=getCautionForSlot(i);
      if(caution==='earlier') { cls='is-caution-err'; cautionIcon='<span class="p3-sum-caution p3-sum-caution-err" title="Timing is before a previous event">✕</span>'; }
      else if(caution) { cls='is-caution'; cautionIcon='<span class="p3-sum-caution" title="Timing has a warning — tap to review">⚠</span>'; }
    } else if(hasSugg){
      timeStr=`${String(S.timeSuggestH[i]).padStart(2,'0')}:${String(S.timeSuggestM[i]).padStart(2,'0')}`;
      cls='is-suggested';
      hint='<span class="p3-sum-hint">Suggested — tap to confirm</span>';
    } else {
      timeStr='—'; cls='is-unset';
    }
    return `<div class="p3-summary-cell ${cls}" onclick="openTimingEditor(${i})" title="Click to edit">
      <span class="p3-sum-label">${lbl} ✎</span>
      <span class="p3-sum-time">${timeStr}${cautionIcon}</span>
      ${hint}
    </div>`;
  }).join('');

  content.innerHTML=`
    <div class="p3-summary-activator">Activated by: <strong>${activatorText}</strong></div>
    <div class="p3-summary-grid">${cellsHTML}</div>`;
}
function selectP3Preset(mode){
  el('abtn-opsctr').classList.toggle('selected',mode==='OPS CTR');
  el('abtn-headops').classList.toggle('selected',mode==='HEAD OPS');
  el('abtn-others').classList.toggle('selected',mode==='others');
  if(mode==='others'){
    el('p3-others-wrap').classList.remove('hidden'); S.p3ActivatorMode='others';
    const val=el('p3-others-input').value.trim();
    S.p3PersonId=val?findOrAddPerson('',val):null; el('p3-others-input').focus();
  }else{
    el('p3-others-wrap').classList.add('hidden'); S.p3ActivatorMode=mode;
    S.p3PersonId=findOrAddPerson('',mode);
  }
  renderP3ActivatorDisplay(); updateValidation();
}
function onP3OthersInput(){
  const val=el('p3-others-input').value.trim().toUpperCase();
  S.p3PersonId=val?findOrAddPerson('',val):null; renderP3ActivatorDisplay(); updateValidation();
}
function renderP3Activator(){
  ['abtn-opsctr','abtn-headops','abtn-others'].forEach(id=>el(id).classList.remove('selected'));
  el('p3-others-wrap').classList.add('hidden'); el('p3-others-input').value='';
  el('p3-activator-current').classList.add('hidden');
  S.p3ActivatorMode=null; S.p3PersonId=null;
}
function renderP3ActivatorDisplay(){
  const disp=el('p3-activator-current'); const p=getPersonById(S.p3PersonId);
  if(p){disp.textContent='✓ '+(p.rank?`${p.rank} ${p.name}`:p.name);disp.classList.remove('hidden');}
  else disp.classList.add('hidden');
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
          <button class="drum-btn" onclick="stepDrum(${idx},'h',-1)">▲</button>
          <div class="drum-face" id="df-${idx}-h">
            <div class="drum-slot ds-prev" id="ds-${idx}-h-prev"></div>
            <div class="drum-slot ds-cur placeholder" id="ds-${idx}-h-cur">--</div>
            <div class="drum-slot ds-next" id="ds-${idx}-h-next"></div>
          </div>
          <button class="drum-btn" onclick="stepDrum(${idx},'h',1)">▼</button>
        </div>
        <span class="drum-colon">:</span>
        <div class="drum-col">
          <button class="drum-btn" onclick="stepDrum(${idx},'m',-1)">▲</button>
          <div class="drum-face" id="df-${idx}-m">
            <div class="drum-slot ds-prev" id="ds-${idx}-m-prev"></div>
            <div class="drum-slot ds-cur placeholder" id="ds-${idx}-m-cur">--</div>
            <div class="drum-slot ds-next" id="ds-${idx}-m-next"></div>
          </div>
          <button class="drum-btn" onclick="stepDrum(${idx},'m',1)">▼</button>
        </div>
      </div>
      <button class="timing-disable-btn" id="tdb-${idx}" onclick="toggleBlock(${idx})">🚫 Disable this event</button>`;
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
  for(let i=0;i<5;i++){renderDrum(i);renderTimingFeedback(i);renderDisableButton(i);}
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
  // Only populate suggestions — never commit. User must confirm each timing individually.
  let rH=S.timeH[fromIdx],rM=S.timeM[fromIdx];
  if(rH===null||rM===null) return;
  for(let i=fromIdx+1;i<5;i++){
    if(S.timeBlocked[i]) continue;
    if(S.timeH[i]!==null){
      // Already committed — use as cascade base, leave it alone
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
  const win=slLabel==='night'?'18:00 – 08:00':'08:00 – 18:00';
  if(caution==='earlier'){
    tf.innerHTML=`<div class="tf-hard-err"><span class="tf-x">✕</span><div>This timing is before the previous P3 event. Scroll to a later time, or disable this event below if it did not occur during this shift.</div></div>`;
  }else if(caution==='oob'){
    tf.innerHTML=`<div class="caution-box">
      <span class="caution-icon">⚠</span>
      <div class="caution-text">
        <span class="caution-msg">This timing falls outside the ${slLabel} shift window (${win}). If this event did not occur during this shift, you can disable it below.</span>
        <button class="caution-dismiss-btn" onclick="blockEvent(${idx})">🚫 Disable this event</button>
      </div></div>`;
  }else if(caution==='gap'){
    tf.innerHTML=`<div class="caution-box">
      <span class="caution-icon">⚠</span>
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

  // Priority 1 — earlier than previous non-blocked event (non-dismissible)
  if(prevHHMM!==null){
    const tOrd=nightOrder(h*100+m,sl),pOrd=nightOrder(prevHHMM,sl);
    if(tOrd<=pOrd) return 'earlier';
  }

  // Priority 2 — outside shift window (non-dismissible, "disable" shortcut only)
  if(!isInShiftBounds(h,m,sl)) return 'oob';

  // Priority 3 — gap > 2 hours from previous (dismissible)
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
  recalcSuggestions(); renderP3Summary(); updateValidation();
}

function unblockEvent(idx){
  S.timeBlocked[idx]=false;
  renderDrum(idx);renderDisableButton(idx);renderTimingFeedback(idx);
  for(let i=0;i<5;i++) if(i!==idx) renderTimingFeedback(i);
  recalcSuggestions(); renderP3Summary(); updateValidation();
}

function toggleBlock(idx){
  if(S.timeBlocked[idx]) unblockEvent(idx); else blockEvent(idx);
}

function renderDisableButton(idx){
  const btn=el(`tdb-${idx}`); if(!btn) return;
  if(S.timeBlocked[idx]){
    btn.textContent='↩ Re-enable this event';
    btn.classList.add('is-reenable');
  }else{
    btn.textContent='🚫 Disable this event';
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
  const mc=S.appliances.length?S.appliances.map(a=>a.code):Object.keys(found);
  S.redconData=mc.map(code=>{
    const f=found[code];
    if(f&&f.rank&&f.name) return{code,personId:findOrAddPerson(f.rank,f.name),rank:f.rank,name:f.name,matched:true};
    return{code,personId:null,rank:'',name:'',matched:false};
  });
  Object.keys(found).forEach(code=>{
    if(!S.redconData.find(r=>r.code===code)){
      const f=found[code];
      S.redconData.push({code,personId:(f.rank&&f.name)?findOrAddPerson(f.rank,f.name):null,rank:f.rank,name:f.name,matched:true});
    }
  });
  const matched=S.redconData.filter(r=>r.matched&&r.name);
  const unmatched=S.redconData.filter(r=>!r.matched||!r.name);
  if(!matched.length) S.redconCautionState='nonames';
  else if(unmatched.length) S.redconCautionState='incomplete';
  else S.redconCautionState=null;
  renderRedconTable(); renderRedconCaution(); updateValidation();
  if(S.redconData.length) showToast(`✓ ${matched.length}/${S.redconData.length} appliances parsed from REDCON`);
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
    if(msg) msg.textContent=`Incomplete manning data — no names found for: ${unmatched}. Their IC names will be blank.`;
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
      <td class="code">${r.code}</td><td>${r.rank||'—'}</td><td>${r.name||'—'}</td></tr>`).join('')}
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
  if(S.hasP3){
    if(!S.p3PersonId) errs.push({section:'p3',msg:'Select who activated P3.'});
    const bp=validateBlockPattern();
    if(bp==='all')
      errs.push({section:'p3',msg:'All P3 events are disabled. Re-enable at least one, or turn off P3 Turnout.'});
    else if(bp)
      errs.push({section:'p3',msg:'Invalid disable pattern — disabled events must be consecutive and start from the first timing or end at the last.'});
    for(let i=0;i<5;i++){
      if(S.timeBlocked[i]) continue;
      const lbl=`"${TIMING_LABELS[i]}"`;
      if(!S.p3Times[i])
        errs.push({section:'p3',msg:`P3 timing ${lbl}: not set yet.`});
      else{
        const c=getCautionForSlot(i);
        if(c==='earlier')
          errs.push({section:'p3',msg:`P3 timing ${lbl}: must be after the previous timing.`});
        else if(c==='oob')
          errs.push({section:'p3',msg:`P3 timing ${lbl}: outside shift window — disable it if it did not occur this shift.`});
        else if(c==='gap')
          errs.push({section:'p3',msg:`P3 timing ${lbl}: gap over 2 hours — confirm or dismiss.`});
      }
    }
  }
  if(S.detectedShiftLabel==='Night'&&S.redconCautionState!==null&&!S.redconCautionDismissed)
    errs.push({section:'redcon',msg:'REDCON: '+( S.redconCautionState==='empty'?'no data entered — paste the REDCON email or click "Yes, proceed".':'no alpha names found — paste valid data or click "Yes, proceed".')});
  return errs;
}

function updateValidation(){
  renderP3Summary();
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
function showAlert({type='error',title,bodyHTML,buttons=[],dismissAnywhere=false,resetOnClose=false,dismissHint=null}){
  el('modal-box').className='modal-box alert-'+type;
  el('modal-title').innerHTML=title; el('modal-body').innerHTML=bodyHTML;
  const acts=el('modal-actions'); acts.innerHTML='';
  buttons.forEach(btn=>{
    const b=document.createElement('button'); b.textContent=btn.label;
    b.onclick=()=>{closeModal();if(btn.cb)btn.cb();}; acts.appendChild(b);
  });
  const hint=el('modal-dismiss-hint');
  if(dismissHint){hint.textContent=dismissHint;hint.classList.remove('hidden');}
  else hint.classList.add('hidden');
  const ov=el('modal-overlay');
  if(dismissAnywhere) ov.dataset.dismissAnywhere='1'; else delete ov.dataset.dismissAnywhere;
  if(resetOnClose)    ov.dataset.resetOnClose='1';    else delete ov.dataset.resetOnClose;
  ov.classList.remove('hidden');
}

function closeModal(){
  const ov=el('modal-overlay'); ov.classList.add('hidden');
  el('modal-dismiss-hint').classList.add('hidden');
  el('modal-box').className='modal-box';
  const sr=ov.dataset.resetOnClose==='1';
  delete ov.dataset.dismissAnywhere; delete ov.dataset.resetOnClose;
  if(sr) resetAllState();
}

function resetAllState(){
  S.hasP3=false;S.p3PersonId=null;S.p3ActivatorMode=null;
  S.currentRotaPersonId=null;S.incomingRotaPersonId=null;
  S.redconData=[];S.redconCautionState=null;S.redconCautionDismissed=false;
  setP3(false); el('redcon-paste').value='';
  renderRedconTable(); renderRedconCaution(); renderP3Activator(); refreshDrums();
  setShiftMode('auto');
}

document.addEventListener('DOMContentLoaded',()=>{
  el('modal-overlay').addEventListener('click',e=>{
    const ov=el('modal-overlay');
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
      title:'<span class="alert-err-heading">⚠ Missing or invalid fields</span>',
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
      title:'✓ Code Copied!',
      bodyHTML:'Open Excel and run <strong>GenerateFromClipboard</strong> via <strong>Alt+F8</strong>.',
      buttons:[],dismissAnywhere:true,resetOnClose:true,
      dismissHint:'Click anywhere to dismiss',
    });
  }).catch(()=>{
    prompt('Copy this code manually (Ctrl+C):',code);
    showAlert({
      type:'success',
      title:'✓ Code Ready',
      bodyHTML:'Copy the code from the prompt, then open Excel and run <strong>GenerateFromClipboard</strong> via <strong>Alt+F8</strong>.',
      buttons:[],dismissAnywhere:true,resetOnClose:true,
      dismissHint:'Click anywhere to dismiss',
    });
  });
}

function buildClipboardString(){
  const st=S.shiftMode==='auto'?'AUTO':'OVERRIDE';
  const ss=S.shiftMode==='override'?fmtDate(S.overrideDate)+'-'+S.overrideShiftType:'';
  const p3t=S.hasP3?[0,1,2,3,4].map(i=>S.timeBlocked[i]?'BLOCKED':(S.p3Times[i]||'')):['','','','',''];
  const parts=['OPSLOG','2',st,ss,String(S.currentRotaPersonId),String(S.incomingRotaPersonId),
    S.hasP3?'YES':'NO',S.hasP3?String(S.p3PersonId):'',
    p3t[0],p3t[1],p3t[2],p3t[3],p3t[4]];
  // Send all redcon entries sorted; personId=0 means no match (VBA will write blank name)
  const rf=[...S.redconData].sort((a,b)=>{
    const sa=getStnFromCode(a.code)||'',sb=getStnFromCode(b.code)||'';
    return sa!==sb?sa.localeCompare(sb):a.code.localeCompare(b.code,undefined,{numeric:true});
  });
  parts.push(String(rf.length)); rf.forEach(r=>parts.push(r.code,String(r.personId||0)));
  const uPIds=new Set(); if(S.hasP3&&S.p3PersonId!=null)uPIds.add(S.p3PersonId);
  rf.forEach(r=>{if(r.personId!=null)uPIds.add(r.personId);});
  const pDB=loadPeopleDB(); const uP=[...uPIds].map(id=>pDB.people.find(p=>p.id===id)).filter(Boolean);
  parts.push('PEOPLE',String(uP.length)); uP.forEach(p=>parts.push(String(p.id),p.rank||'',p.name||''));
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

function openTimingEditor(idx){
  if(!S.hasP3) return;
  S.activeTimingIdx=idx;
  S._timingSnapshot=captureTimingState();
  // If slot has a suggestion but no committed value, pre-load the suggestion into the drum
  if(S.timeSuggested[idx] && S.timeH[idx]===null){
    S.timeH[idx]=S.timeSuggestH[idx];
    S.timeM[idx]=S.timeSuggestM[idx];
    renderDrum(idx);
  }
  // Show only the active timing cell
  for(let i=0;i<5;i++){
    const c=el(`timing-cell-${i}`);
    if(c) c.style.display=i===idx?'':'none';
  }
  el('timing-popup-title').textContent=`P3 — ${TIMING_LABELS[idx]}`;
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
  renderP3Summary();
}
function confirmTimingEditor(){
  const idx=S.activeTimingIdx;
  // Clear the suggestion for this slot (it's now committed)
  S.timeSuggested[idx]=false; S.timeSuggestH[idx]=null; S.timeSuggestM[idx]=null;
  S._timingSnapshot=null;
  el('p3-editor-overlay').classList.add('hidden');
  document.body.style.overflow='';
  // Re-derive suggestions for subsequent unset slots
  recalcSuggestions();
  renderP3Summary();
  showToast(`✓ P3 "${TIMING_LABELS[idx]}" updated`);
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
  updateOverrideDateChip();
  showToast('✓ Override date updated');
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

function openSettings(){
  el('settings-overlay').classList.remove('hidden');
  document.body.style.overflow='hidden';
}
function closeSettings(e){
  if(e&&e.target!==el('settings-overlay')) return;
  el('settings-overlay').classList.add('hidden');
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

  buildDrums();
  applyShiftResult(computeShift(new Date()));
  initCalendar();
  renderRotaSettingsList();
  renderApplianceSettingsList();
  updateValidation();
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
