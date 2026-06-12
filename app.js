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

  // Turnouts (replaces single hasP3 toggle)
  turnouts: [],
  activeTurnoutIdx: null,

  // Drum scratchpad — loaded from the active turnout when timing popup opens
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
    // Don't wipe existing redcon data — just hide the caution if user was on night and switched to day override
    renderRedconCaution();
  }
  // Do NOT reset IC selections or turnouts — preserve all user-entered state across mode/date switches
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
    t.type=type; // don't touch t.othersText — that belongs to activator
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
  if(tick) tick.textContent=val?`✓ ${val}`:'';
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
    tick.textContent=p?`✓ ${p.rank?`${p.rank} ${p.name}`:p.name}`:'';
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
  }).join('')+`<button class="turnout-type-btn${isCustomType?' selected':''}" onclick="selectTurnoutType(${idx},'others')">Others…</button>`;

  const typeTickHTML=!isCustomType&&t.type?`<div class="p3-activator-current" style="margin-top:6px">✓ ${esc(t.type)}</div>`:'';
  const customTypeHTML=isCustomType?`<div style="margin-top:6px"><input type="text" class="text-input" id="turnout-type-custom-${idx}"
    value="${esc(t.type)}" placeholder="Enter type…"
    oninput="onTurnoutTypeCustomInput(${idx})">
  <div id="turnout-type-tick-${idx}" class="p3-activator-current">${t.type?`✓ ${esc(t.type)}`:''}</div></div>`:'';

  const activatorModes=['OPS CTR','HEAD OPS','others'];
  const isCustomAct=t.activatorMode==='others';
  const activatorHTML=activatorModes.map(mode=>{
    const sel=t.activatorMode===mode;
    const label=mode==='others'?'Others…':mode;
    return `<button class="activator-btn${sel?' selected':''}" onclick="selectTurnoutActivator(${idx},'${mode}')">${label}</button>`;
  }).join('');

  const customActHTML=isCustomAct?`<div style="margin-top:6px"><input type="text" class="text-input" id="turnout-activator-custom-${idx}"
    value="${esc(t.othersText||'')}" placeholder="Enter name or rank+name…"
    oninput="onTurnoutActivatorCustomInput(${idx})"></div>`:'';

  const p=t.personId?getPersonById(t.personId):null;
  const actCurrentHTML=`<div id="turnout-act-tick-${idx}" class="p3-activator-current">${p?`✓ ${esc(p.rank?`${p.rank} ${p.name}`:p.name)}`:''}</div>`;

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
      if(caution==='earlier'){cls='is-caution-err';cautionIcon='<span class="p3-sum-caution p3-sum-caution-err" title="Before previous event">✕</span>';}
      else if(caution){cls='is-caution';cautionIcon='<span class="p3-sum-caution" title="Timing warning">⚠</span>';}
    } else if(hasSugg){
      timeStr=`${String(t.timeSuggestH[i]).padStart(2,'0')}:${String(t.timeSuggestM[i]).padStart(2,'0')}`;
      cls='is-suggested'; hint='<span class="p3-sum-hint">Suggested — tap to confirm</span>';
    } else {
      timeStr='—'; cls='is-unset';
    }
    return `<div class="p3-summary-cell ${cls}" onclick="openTimingEditor(${idx},${i})" title="Click to edit">
      <span class="p3-sum-label">${lbl} ✎</span>
      <span class="p3-sum-time">${timeStr}${cautionIcon}</span>${hint}</div>`;
  }).join('');

  return `<div class="turnout-card" id="turnout-card-${idx}">
    <div class="turnout-card-header">
      <span class="turnout-card-title">Turnout #${idx+1}</span>
      <button class="turnout-remove-btn" onclick="removeTurnout(${idx})" title="Remove">✕</button>
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
  S.turnouts.forEach((t,ti)=>{
    const num=ti+1;
    if(!t.personId) errs.push({section:'p3',msg:`Turnout #${num}: Select who activated it.`});
    const bp=validateBlockPatternFor(t);
    if(bp==='all')
      errs.push({section:'p3',msg:`Turnout #${num}: All events disabled — re-enable at least one or remove this turnout.`});
    else if(bp)
      errs.push({section:'p3',msg:`Turnout #${num}: Invalid disable pattern — disabled events must be consecutive from start or end.`});
    for(let i=0;i<5;i++){
      if(t.timeBlocked[i]) continue;
      const lbl=`"${TIMING_LABELS[i]}"`;
      if(!t.p3Times[i])
        errs.push({section:'p3',msg:`Turnout #${num} ${lbl}: not set yet.`});
      else{
        const c=getCautionForTurnoutSlot(t,i);
        if(c==='earlier') errs.push({section:'p3',msg:`Turnout #${num} ${lbl}: must be after the previous timing.`});
        else if(c==='oob') errs.push({section:'p3',msg:`Turnout #${num} ${lbl}: outside shift window — disable if it did not occur this shift.`});
        else if(c==='gap') errs.push({section:'p3',msg:`Turnout #${num} ${lbl}: gap over 2 hours — confirm or dismiss.`});
      }
    }
  });
  if(S.detectedShiftLabel==='Night'&&S.redconCautionState!==null&&!S.redconCautionDismissed)
    errs.push({section:'redcon',msg:'REDCON: '+(S.redconCautionState==='empty'?'no data entered — paste the REDCON email or click "Yes, proceed".':'no alpha names found — paste valid data or click "Yes, proceed".')});
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
      buttons:[],dismissAnywhere:true,
      dismissHint:'Click anywhere to dismiss',
    });
  }).catch(()=>{
    prompt('Copy this code manually (Ctrl+C):',code);
    showAlert({
      type:'success',
      title:'✓ Code Ready',
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

  el('timing-popup-title').textContent=`${t.type||'Turnout'} — ${TIMING_LABELS[slotIdx]}`;
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
  showToast(`✓ ${t.type||'Turnout'} "${TIMING_LABELS[idx]}" updated`);
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
  // Render RDR settings lists if they exist (combined panel)
  if (typeof rdrRenderSettingsList === 'function') {
    rdrRenderSettingsList('ops');
    rdrRenderSettingsList('ems');
  }
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
    // Shift just flipped — check if there's meaningful state worth prompting about
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
  // Work out the override target for "Keep" — the shift that just ended
  const now = new Date();
  let oldDate = new Date(now); oldDate.setHours(0,0,0,0);
  let oldShiftType;
  if (oldShiftLabel === 'Day') {
    // Day just ended → night started: old date = today, old type = D
    oldShiftType = 'D';
  } else {
    // Night just ended → day started: night shift started yesterday
    oldDate.setDate(oldDate.getDate() - 1);
    oldShiftType = 'N';
  }
  const shiftIcon = oldShiftLabel === 'Day' ? '🌤️' : '🌙';
  showAlert({
    type: 'error',
    title: `⏰ ${oldShiftLabel} Shift Has Ended`,
    bodyHTML: `The ${shiftIcon} <strong>${oldShiftLabel} shift</strong> has ended. Would you like to reset all fields for the new shift, or keep the current session?
      <br><br><span style="font-size:13px;color:var(--text-2)">
      <strong>Reset</strong> — clear everything and start fresh.<br>
      <strong>Keep Session</strong> — retain all fields; the panel will switch to Override so your previous shift is preserved.
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
        // If already on override, user has manually chosen a date+shift — leave it untouched
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
    // Rebuild grid in case rota settings changed while on ops-log tab
    rdrBuildAttGrid();
    rdrUpdateSubjectPreview();
  }
}

// =============================================
// RDR — CONSTANTS & STATE
// =============================================
const RDR_STATUS_OPTS = ['', 'IN', 'ON DUTY', 'MC', 'VL', 'HL', 'OIL', 'OFF DUTY', 'COURSE', 'RSO', 'ORD', 'DUTY', 'AWOL'];
const RDR_STATUS_COLORS = {
  'IN':'#34c759','ON DUTY':'#34c759','MC':'#ff3b30','AWOL':'#ff3b30',
  'VL':'#ff9500','HL':'#ff9500','OIL':'#ff9500','OFF DUTY':'#ff9500',
  'COURSE':'#ff9500','RSO':'#ff9500','ORD':'#ff9500','DUTY':'#ff9500',
};
// Longer prefixes first
const RDR_STATUS_MAP = [
  { prefix:'OFF DUTY HL', value:'HL'       },
  { prefix:'OFF DUTY',    value:'OFF DUTY'  },
  { prefix:'ON DUTY',     value:'ON DUTY'   },
  { prefix:'COURSE',      value:'COURSE'    },
  { prefix:'AWOL',        value:'AWOL'      },
  { prefix:'DUTY',        value:'DUTY'      },
  { prefix:'OIL',         value:'OIL'       },
  { prefix:'RSO',         value:'RSO'       },
  { prefix:'ORD',         value:'ORD'       },
  { prefix:'MC',          value:'MC'        },
  { prefix:'VL',          value:'VL'        },
  { prefix:'HL',          value:'HL'        },
  { prefix:'IN',          value:'IN'        },
];
const RDR_RANKS = ['PTE','LCP','CPL','SGT','SSG','WO','MWO','SWO','CWO',
                   'ME4','ME5','2LT','LTA','CPT','MAJ','LTC','COL','BG','MG'];
const RDR_SK = { OPS:'rdr2_ops', EMS:'rdr2_ems' };
const RDR_DEFAULTS = {
  ops:[
    {rank:'LCP',name:'IRFAN'},{rank:'CPL',name:'RAZIN'},
    {rank:'CPL',name:'RIZQ'},{rank:'LCP',name:'JEFF'},
    {rank:'PTE',name:'HUZAIFAH'},{rank:'LCP',name:'ZACHARIAH'},
    {rank:'LCP',name:'MARCUS'},{rank:'PTE',name:'MAHESHWARAN'},
    {rank:'PTE',name:'KHAIRUL'},{rank:'LCP',name:'KAR KIT'},
    {rank:'PTE',name:'FERDINAND'},{rank:'PTE',name:'IRYAN'},
    {rank:'PTE',name:'GARRET'},{rank:'PTE',name:'MIRZA'},
  ],
  ems:[
    {rank:'CPL',name:'KHAIRI'},{rank:'PTE',name:'DARWISY'},
    {rank:'PTE',name:'CYRUS'},{rank:'LCP',name:'ZEN'},
    {rank:'CPL',name:'WEN XUAN'},
  ],
};

let rdrLists = { ops:[], ems:[] };
let rdrSelectedShift = 'AM';
let rdrSelectedDay   = 'WEEKDAY';

// ── Persistence ───────────────────────────────────────────────
function rdrLoadLists() {
  for (const key of ['ops','ems']) {
    const raw = localStorage.getItem(RDR_SK[key.toUpperCase()]);
    rdrLists[key] = raw ? JSON.parse(raw) : RDR_DEFAULTS[key].map(p=>({...p}));
  }
}
function rdrSaveLists(key) {
  localStorage.setItem(RDR_SK[key.toUpperCase()], JSON.stringify(rdrLists[key]));
}

// ── Rota info from date ───────────────────────────────────────
function getRdrRotaInfo() {
  const dateVal = el('rdr-date')?.value;
  if (!dateVal) return { amRota:'', pmRota:'', amPeople:[], pmPeople:[] };
  const [y, mo, d] = dateVal.split('-').map(Number);
  const dayRef   = new Date(y, mo-1, d, 9,  0, 0);
  const nightRef = new Date(y, mo-1, d, 21, 0, 0);
  const dayInfo   = computeShift(dayRef);
  const nightInfo = computeShift(nightRef);
  const amRota  = dayInfo.currentRota;
  const pmRota  = nightInfo.currentRota;
  const amPeople = S.rotas.filter(r => r.rota === amRota);
  const pmPeople = S.rotas.filter(r => r.rota === pmRota);
  return { amRota, pmRota, amPeople, pmPeople };
}

function rdrOnDateChange() {
  rdrUpdateSubjectPreview();
  rdrUpdateRotaInfo();
  rdrBuildAttGrid();
  // Re-run any pasted rollcalls against new rota lists
  ['am','pm'].forEach(t => {
    const ta = el(`rollcall-paste-${t}`);
    if (ta && ta.value.trim()) rdrOnRollcallInput(t);
  });
}

function rdrUpdateRotaInfo() {
  const { amRota, pmRota } = getRdrRotaInfo();
  const infoEl = el('rdr-rota-info');
  if (!infoEl) return;
  if (!amRota && !pmRota) { infoEl.classList.add('hidden'); return; }
  infoEl.classList.remove('hidden');
  const amChip = el('rdr-am-rota-chip');
  const pmChip = el('rdr-pm-rota-chip');
  const mkChip = (rota) => {
    const n = rotaNum(rota);
    return `<span class="rota-chip rc-${n}">${rota}</span>`;
  };
  if (amChip) amChip.innerHTML = amRota ? mkChip(amRota) : '—';
  if (pmChip) pmChip.innerHTML = pmRota ? mkChip(pmRota) : '—';
  // Update rollcall labels
  const lam = el('rdr-label-am');
  const lpm = el('rdr-label-pm');
  if (lam) lam.innerHTML = `AM Rota ${amRota ? `<span class="rota-chip rc-${rotaNum(amRota)}" style="font-size:10px;padding:1px 7px">${amRota}</span>` : ''}`;
  if (lpm) lpm.innerHTML = `PM Rota ${pmRota ? `<span class="rota-chip rc-${rotaNum(pmRota)}" style="font-size:10px;padding:1px 7px">${pmRota}</span>` : ''}`;
}

// ── Date / subject ─────────────────────────────────────────────
function rdrGetDateStr() {
  const raw = el('rdr-date')?.value;
  if (!raw) return 'DD/MM/YY';
  const [y,m,d] = raw.split('-');
  return `${d}/${m}/${String(y).slice(2)}`;
}
function rdrUpdateSubjectPreview() {
  const label = {AM:'AM Shift',PM:'PM Shift',FULL:'Full Shift'}[rdrSelectedShift] || rdrSelectedShift;
  const prev = el('rdr-subject-preview');
  if (prev) prev.textContent = `Subject: RDR report for ${rdrGetDateStr()} (${label})`;
}

// ── Attendance Grid ───────────────────────────────────────────
function rdrBuildAttGrid() {
  const grid = el('rdr-att-grid'); if (!grid) return;
  grid.innerHTML = '';
  const { amRota, pmRota, amPeople, pmPeople } = getRdrRotaInfo();

  // Column headers
  rdrAddCell(grid, 'att-col-hdr span-2', 'OFFICE HOURS');
  rdrAddCell(grid, 'att-col-hdr span-2', 'RDR ROTA SHIFTS');

  // OPS + AM section
  const amLabel = amRota
    ? `AM SHIFT <span class="rota-mini-chip rc-${rotaNum(amRota)}" style="background:var(--rota-${rotaNum(amRota)}-bg);color:var(--rota-${rotaNum(amRota)})">${amRota}</span>`
    : 'AM SHIFT';
  rdrAddCell(grid, 'att-section-hdr', 'OPS READINESS &amp; PLANNING TEAM');
  const amHdr = rdrAddCell(grid, 'att-section-hdr', amLabel);
  amHdr.innerHTML = amLabel; // allow HTML for chip

  const upperLen = Math.max(rdrLists.ops.length, amPeople.length);
  if (upperLen === 0) {
    rdrAddCell(grid, 'att-empty-row', 'No names configured. Open Settings to add OPS names.');
  } else {
    for (let i = 0; i < upperLen; i++) {
      rdrAddPersonRow(grid, rdrLists.ops[i], 'ops', i, amPeople[i], 'am', i);
    }
  }

  // EMS + PM section
  const pmLabel = pmRota
    ? `PM SHIFT <span class="rota-mini-chip rc-${rotaNum(pmRota)}" style="background:var(--rota-${rotaNum(pmRota)}-bg);color:var(--rota-${rotaNum(pmRota)})">${pmRota}</span>`
    : 'PM SHIFT';
  rdrAddCell(grid, 'att-section-hdr', 'EMS TEAM');
  const pmHdr = rdrAddCell(grid, 'att-section-hdr', pmLabel);
  pmHdr.innerHTML = pmLabel;

  const lowerLen = Math.max(rdrLists.ems.length, pmPeople.length);
  if (lowerLen === 0) {
    rdrAddCell(grid, 'att-empty-row', 'No names configured. Open Settings to add EMS names.');
  } else {
    for (let i = 0; i < lowerLen; i++) {
      rdrAddPersonRow(grid, rdrLists.ems[i], 'ems', i, pmPeople[i], 'pm', i);
    }
  }
}

function rdrAddCell(parent, className, html) {
  const d = document.createElement('div');
  d.className = className;
  d.innerHTML = html;
  parent.appendChild(d);
  return d;
}

function rdrAddPersonRow(grid, leftP, leftKey, leftIdx, rightP, rightKey, rightIdx) {
  const lName = document.createElement('div');
  lName.className = 'att-name-cell' + (leftP ? '' : ' empty');
  lName.textContent = leftP ? `${leftP.rank} ${leftP.name}` : '';
  grid.appendChild(lName);

  const lStat = document.createElement('div');
  lStat.className = 'att-status-cell' + (leftP ? '' : ' empty');
  lStat.appendChild(leftP
    ? rdrMakeStatusSelect(`rsel_${leftKey}_${leftIdx}`)
    : Object.assign(document.createElement('select'), {className:'att-status-select', disabled:true, innerHTML:'<option>—</option>'}));
  grid.appendChild(lStat);

  const rName = document.createElement('div');
  rName.className = 'att-name-cell' + (rightP ? '' : ' empty');
  rName.textContent = rightP ? `${rightP.rank} ${rightP.name}` : '';
  grid.appendChild(rName);

  const rStat = document.createElement('div');
  rStat.className = 'att-status-cell' + (rightP ? '' : ' empty');
  rStat.appendChild(rightP
    ? rdrMakeStatusSelect(`rsel_${rightKey}_${rightIdx}`)
    : Object.assign(document.createElement('select'), {className:'att-status-select', disabled:true, innerHTML:'<option>—</option>'}));
  grid.appendChild(rStat);
}

function rdrMakeStatusSelect(id) {
  const sel = document.createElement('select');
  sel.id = id; sel.className = 'att-status-select';
  RDR_STATUS_OPTS.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt || '—';
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => rdrColorSelect(sel));
  rdrColorSelect(sel);
  return sel;
}

function rdrColorSelect(sel) {
  const c = RDR_STATUS_COLORS[sel.value] || '';
  sel.style.color = c; sel.style.fontWeight = c ? '700' : ''; sel.style.borderColor = c || '';
}

function rdrGetSelVal(key, idx) {
  const s = el(`rsel_${key}_${idx}`); return s ? s.value : '';
}
function rdrSetSelVal(key, idx, value) {
  const s = el(`rsel_${key}_${idx}`); if (!s) return;
  const exists = [...s.options].some(o => o.value === value);
  s.value = exists ? value : '';
  rdrColorSelect(s);
}

// ── Rollcall Parser ───────────────────────────────────────────
function rdrStripEmoji(str) {
  return str
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[︀-️]/g, '')
    .replace(/​/g, '')  // ZWJ
    .replace(/[✅❌⚠️]/g, '');
}

function rdrDetectStatus(raw) {
  const upper = rdrStripEmoji(raw).toUpperCase().replace(/\s+/g,' ').trim();
  for (const {prefix,value} of RDR_STATUS_MAP) {
    if (upper === prefix || upper.startsWith(prefix+' ') || upper.startsWith(prefix+'(')) return value;
  }
  return null;
}

function rdrStartsWithRank(name) {
  return RDR_RANKS.some(r => name === r || name.startsWith(r+' '));
}

function rdrMatchInList(rollcallName, list) {
  const rc = rollcallName.toUpperCase().trim();
  for (let i = 0; i < list.length; i++) {
    if ((list[i].rank+' '+list[i].name).toUpperCase().trim() === rc) return i;
  }
  for (let i = 0; i < list.length; i++) {
    const full = (list[i].rank+' '+list[i].name).toUpperCase().trim();
    if (full.startsWith(rc) || rc.startsWith(full)) return i;
  }
  return -1;
}

function rdrOnRollcallInput(target) {
  const textEl = el(`rollcall-paste-${target}`);
  const resEl  = el(`rollcall-results-${target}`);
  const text   = textEl.value;
  if (!text.trim()) { resEl.classList.add('hidden'); return; }
  rdrParseAndApply(text, target, resEl);
}

function rdrParseAndApply(text, target, resEl) {
  const lines = text.split('\n');
  // Auto-detect date
  for (const line of lines) {
    const m = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (m) {
      const dd=m[1].padStart(2,'0'), mm=m[2].padStart(2,'0'), yyyy=m[3];
      el('rdr-date').value = `${yyyy}-${mm}-${dd}`;
      rdrUpdateSubjectPreview(); rdrUpdateRotaInfo(); rdrBuildAttGrid();
      break;
    }
  }

  const { amPeople, pmPeople } = getRdrRotaInfo();
  const searchMap = {
    oh: [{ key:'ops', list:rdrLists.ops }, { key:'ems', list:rdrLists.ems }],
    am: [{ key:'am',  list:amPeople }],
    pm: [{ key:'pm',  list:pmPeople }],
  };
  const searches = searchMap[target] || searchMap.oh;

  const matched = [], unmatched = [];
  for (const rawLine of lines) {
    const line = rdrStripEmoji(rawLine).replace(/—/g,'-').replace(/–/g,'-').trim();
    if (!line) continue;
    const dashMatch = line.match(/^(.+?)\s+-\s+(.+)$/);
    if (!dashMatch) continue;
    const namePart   = dashMatch[1].trim().toUpperCase();
    const statusPart = dashMatch[2].trim();
    if (!rdrStartsWithRank(namePart)) continue;
    const status = rdrDetectStatus(statusPart);
    if (!status) continue;

    let found = false;
    for (const { key, list } of searches) {
      const idx = rdrMatchInList(namePart, list);
      if (idx >= 0) {
        rdrSetSelVal(key, idx, status);
        matched.push({ name: namePart, status });
        found = true; break;
      }
    }
    if (!found) unmatched.push({ name: namePart, status });
  }
  rdrRenderResults(matched, unmatched, resEl);
}

function rdrRenderResults(matched, unmatched, container) {
  container.innerHTML = ''; container.classList.remove('hidden');
  if (!matched.length && !unmatched.length) {
    container.innerHTML = '<div class="rollcall-no-match">No recognisable entries found.</div>'; return;
  }
  if (matched.length) {
    const t = document.createElement('div');
    t.className = 'rollcall-result-title matched-title';
    t.textContent = `✓ ${matched.length} matched`;
    container.appendChild(t);
    const ul = document.createElement('div'); ul.className = 'rollcall-result-list';
    matched.forEach(m => {
      const row = document.createElement('div'); row.className = 'rollcall-match-row';
      const c = RDR_STATUS_COLORS[m.status] || 'var(--text-2)';
      row.innerHTML = `<span class="rollcall-match-name">${m.name}</span><span class="rollcall-match-status" style="color:${c}">${m.status}</span>`;
      ul.appendChild(row);
    });
    container.appendChild(ul);
  }
  if (unmatched.length) {
    const t = document.createElement('div');
    t.className = 'rollcall-result-title unmatched-title';
    t.textContent = `⚠ ${unmatched.length} not in list`;
    container.appendChild(t);
    const ul = document.createElement('div'); ul.className = 'rollcall-result-list';
    unmatched.forEach(u => {
      const row = document.createElement('div'); row.className = 'rollcall-unmatch-row';
      row.textContent = u.name; ul.appendChild(row);
    });
    container.appendChild(ul);
  }
}

// ── Generate RDR code ─────────────────────────────────────────
function rdrGenerate() {
  if (!el('rdr-date')?.value) {
    showAlert({ type:'error', title:'Missing Date', bodyHTML:'Please select a report date.', buttons:[{label:'OK'}] });
    return;
  }
  const { amPeople, pmPeople } = getRdrRotaInfo();
  const parts = ['RDR2', rdrGetDateStr(), rdrSelectedShift, rdrSelectedDay];

  function appendList(key, list) {
    parts.push(String(list.length));
    list.forEach((p, i) => parts.push(p.rank, p.name, rdrGetSelVal(key, i)));
  }
  appendList('ops', rdrLists.ops);
  appendList('ems', rdrLists.ems);
  appendList('am',  amPeople);
  appendList('pm',  pmPeople);
  for (let n = 41; n <= 45; n++) parts.push('');
  const code = parts.join('~');

  navigator.clipboard.writeText(code).then(() => {
    showToast('RDR code copied to clipboard!');
    const btn = el('rdr-generate-btn');
    const orig = btn.textContent;
    btn.textContent = '✓  Code Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2500);
  }).catch(() => {
    showAlert({ type:'error', title:'Copy Failed', bodyHTML:'Could not write to clipboard. Please try again.', buttons:[{label:'OK'}] });
  });
}

// ── RDR Settings ──────────────────────────────────────────────
let _rdrDragSrc = null, _rdrDragTab = null;

function rdrRenderSettingsList(tab) {
  const container = el(`rdr-settings-list-${tab}`); if (!container) return;
  container.innerHTML = '';
  const list = rdrLists[tab];
  if (!list.length) {
    container.innerHTML = '<div class="settings-empty-hint">No entries yet — add names below.</div>'; return;
  }
  const body = document.createElement('div');
  body.className = 'rota-entries-body';
  body.id = `rdr-body-${tab}`;
  list.forEach((p, i) => body.appendChild(_rdrMakeRow(tab, i, p)));
  container.appendChild(body);
  _rdrInitDrag(body, tab);
}

function _rdrMakeRow(tab, i, p) {
  const row = document.createElement('div');
  row.className = 'rota-entry-row'; row.dataset.idx = i; row.draggable = true;
  row.innerHTML = `
    <span class="drag-handle" title="Drag to reorder">⠿</span>
    <span class="rota-entry-rank">${esc(p.rank||'')}</span>
    <span class="rota-entry-name">${esc(p.name)}</span>
    <button class="entry-edit-btn"   onclick="rdrEditEntry('${tab}',${i})"   title="Edit">✎</button>
    <button class="entry-remove-btn" onclick="rdrRemoveEntry('${tab}',${i})" title="Remove">✕</button>`;
  return row;
}

function rdrEditEntry(tab, i) {
  const p = rdrLists[tab][i];
  el(`rdr-rank-${tab}`).value = p.rank || '';
  el(`rdr-name-${tab}`).value = p.name;
  const btn = el(`rdr-add-btn-${tab}`);
  btn.textContent = 'Save'; btn.dataset.editIdx = i;
  el(`rdr-rank-${tab}`).focus();
}

function rdrRemoveEntry(tab, i) {
  showConfirmRdr(`Remove "${(rdrLists[tab][i].rank?rdrLists[tab][i].rank+' ':'')}${rdrLists[tab][i].name}"?`, () => {
    rdrLists[tab].splice(i, 1); rdrSaveLists(tab); rdrRenderSettingsList(tab);
  });
}

function rdrAddEntry(tab) {
  const rankEl = el(`rdr-rank-${tab}`), nameEl = el(`rdr-name-${tab}`);
  const addBtn = el(`rdr-add-btn-${tab}`);
  const rank = rankEl.value.trim().toUpperCase();
  const name = nameEl.value.trim().toUpperCase();
  if (!name) { showAlert({type:'error',title:'Missing Name',bodyHTML:'Please enter a name.',buttons:[{label:'OK'}]}); return; }
  const editIdx = parseInt(addBtn.dataset.editIdx ?? '-1');
  if (editIdx >= 0) {
    rdrLists[tab][editIdx] = { rank, name };
    addBtn.textContent = '+ Add'; delete addBtn.dataset.editIdx;
  } else {
    rdrLists[tab].push({ rank, name });
  }
  rankEl.value = ''; nameEl.value = '';
  rdrSaveLists(tab); rdrRenderSettingsList(tab);
  showToast(`✓ ${name} added to ${tab.toUpperCase()}`);
}

function rdrImportEntries(tab) {
  const text = el(`rdr-import-${tab}`)?.value.trim(); if (!text) return;
  const lines = text.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
  let added = 0;
  for (const line of lines) {
    const parts = line.toUpperCase().trim().split(/\s+/);
    if (parts.length >= 2 && RDR_RANKS.includes(parts[0])) {
      rdrLists[tab].push({ rank: parts[0], name: parts.slice(1).join(' ') }); added++;
    } else if (parts.length >= 1 && parts[0]) {
      rdrLists[tab].push({ rank:'', name: parts.join(' ') }); added++;
    }
  }
  if (added > 0) {
    el(`rdr-import-${tab}`).value = '';
    rdrSaveLists(tab); rdrRenderSettingsList(tab);
    showToast(`✓ ${added} ${added===1?'entry':'entries'} imported`);
  } else { showToast('No new entries to import'); }
}

function showConfirmRdr(msg, onConfirm) {
  showAlert({
    type:'info', title:'Confirm', bodyHTML:msg,
    buttons:[{label:'Cancel'},{label:'Remove',cb:onConfirm}],
  });
}

function _rdrInitDrag(container, tab) {
  container.addEventListener('dragstart', e => {
    const row = e.target.closest('.rota-entry-row'); if (!row) return;
    _rdrDragSrc = row; _rdrDragTab = tab;
    setTimeout(() => row.classList.add('drag-active'), 0);
  });
  container.addEventListener('dragend', () => {
    if (_rdrDragSrc) _rdrDragSrc.classList.remove('drag-active');
    container.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
    _rdrDragSrc = null;
  });
  container.addEventListener('dragover', e => {
    e.preventDefault();
    const row = e.target.closest('.rota-entry-row');
    if (!row || row === _rdrDragSrc) return;
    container.querySelectorAll('.drag-over').forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
  });
  container.addEventListener('drop', e => {
    e.preventDefault();
    const row = e.target.closest('.rota-entry-row');
    if (!row || row === _rdrDragSrc || _rdrDragTab !== tab) return;
    const srcIdx = parseInt(_rdrDragSrc.dataset.idx);
    const dstIdx = parseInt(row.dataset.idx);
    const item = rdrLists[tab].splice(srcIdx, 1)[0];
    rdrLists[tab].splice(dstIdx, 0, item);
    rdrSaveLists(tab); rdrRenderSettingsList(tab);
  });
}

// ── Init RDR ──────────────────────────────────────────────────
function initRdr() {
  rdrLoadLists();

  const today = new Date().toISOString().slice(0,10);
  const dateEl = el('rdr-date'); if (dateEl) dateEl.value = today;

  const shiftBtns = el('rdr-shift-btns');
  if (shiftBtns) shiftBtns.addEventListener('click', e => {
    const btn = e.target.closest('[data-shift]'); if (!btn) return;
    rdrSelectedShift = btn.dataset.shift;
    shiftBtns.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b===btn));
    rdrUpdateSubjectPreview();
  });

  const dayBtns = el('rdr-day-btns');
  if (dayBtns) dayBtns.addEventListener('click', e => {
    const btn = e.target.closest('[data-day]'); if (!btn) return;
    rdrSelectedDay = btn.dataset.day;
    dayBtns.querySelectorAll('.toggle-btn').forEach(b => b.classList.toggle('active', b===btn));
  });

  rdrUpdateSubjectPreview();
  rdrUpdateRotaInfo();
  rdrBuildAttGrid();
  rdrRenderSettingsList('ops');
  rdrRenderSettingsList('ems');
}

document.addEventListener('DOMContentLoaded', initRdr);
