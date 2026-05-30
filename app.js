'use strict';

// =============================================
// CONFIG
// =============================================
const CFG_KEY = 'opslog_config_v2';
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; }
}
function saveConfig() {
  const cfg = {
    rotasPath:      el('cfg-rotas-path').value.trim()      || 'rotas.csv',
    appliancesPath: el('cfg-appliances-path').value.trim() || 'appliances.csv',
    peoplePath:     el('cfg-people-path').value.trim()     || 'people.csv',
  };
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
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
function exportPeopleCSV() {
  const db = loadPeopleDB();
  let csv = 'PersonID,Rank,Name\n';
  db.people.forEach(p => { csv += `${p.id},${p.rank},${p.name}\n`; });
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'people.csv'; a.click();
  URL.revokeObjectURL(url);
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
  timeBlocked:      [false, false, false, false, false], // event disabled by user
  timeGapDismissed: [false, false, false, false, false], // >2h gap caution dismissed
  p3Times:          ['', '', '', '', ''],

  // REDCON
  redconData: [],
  redconCautionState: null,      // null | 'empty' | 'nonames'
  redconCautionDismissed: false,

  rotas: [], appliances: [],
};

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
  const badge = el('shift-badge');
  badge.textContent = r.shiftLabel + ' · ' + r.currentRota;
  badge.className = 'shift-badge ' + r.shiftLabel.toLowerCase();
  el('rota-display').innerHTML =
    `<span class="rota-chip">Current: <strong>${r.currentRota}</strong></span>` +
    `<span class="rota-chip">Incoming: <strong>${r.incomingRota}</strong></span>`;
  if (r.shiftLabel === 'Night') {
    el('section-redcon').classList.remove('hidden');
    updateRedconCautionState();
    renderRedconTable();
  } else {
    el('section-redcon').classList.add('hidden');
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
  if (mode==='auto') { S.overrideDate=null; applyShiftResult(computeShift(new Date())); }
  else { if (!S.overrideDate){S.overrideDate=new Date();S.overrideDate.setHours(0,0,0,0);} applyOverrideShift(); }
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
function selectCalDay(y,m,d){ S.overrideDate=new Date(y,m,d); renderCalendar(); applyOverrideShift(); }

// =============================================
// CSV LOADING
// =============================================
function parseCSV(text) {
  return text.trim().split('\n').map(line=>{
    const cols=[];let cur='',inQ=false;
    for(const c of line){if(c==='"'){inQ=!inQ;continue;}if(c===','&&!inQ){cols.push(cur.trim());cur='';}else cur+=c;}
    cols.push(cur.trim());return cols;
  });
}
async function fetchCSV(path){const r=await fetch(path);if(!r.ok)throw new Error('HTTP '+r.status);return r.text();}
async function loadFromCSV(){
  const cfg=loadConfig();
  try{
    const text=await fetchCSV(cfg.rotasPath||'rotas.csv');
    const rows=parseCSV(text).slice(1);
    S.rotas=rows.filter(r=>r.length>=4&&r[1]).map(r=>({rota:r[1].trim(),rank:r[2].trim().toUpperCase(),name:r[3].trim().toUpperCase()}));
    S.rotas.forEach(p=>findOrAddRotaPerson(p.rota,p.rank,p.name));
  }catch{S.rotas=[];console.warn('Could not load rotas.csv');}
  try{
    const text=await fetchCSV(cfg.appliancesPath||'appliances.csv');
    const rows=parseCSV(text).slice(1);
    S.appliances=rows.filter(r=>r.length>=1&&r[0]).map(r=>({code:r[0].trim().toUpperCase(),desc:(r[1]||'').trim()}));
  }catch{S.appliances=[];console.warn('Could not load appliances.csv');}
  try{
    const text=await fetchCSV(cfg.peoplePath||'people.csv');
    const rows=parseCSV(text).slice(1);const db=loadPeopleDB();let changed=false;
    rows.forEach(r=>{
      if(r.length>=3&&r[0]&&!isNaN(parseInt(r[0],10))){
        const id=parseInt(r[0],10);
        if(!db.people.find(p=>p.id===id)){db.people.push({id,rank:r[1].trim().toUpperCase(),name:r[2].trim().toUpperCase()});if(id>=db.nextId)db.nextId=id+1;changed=true;}
      }
    });
    if(changed)savePeopleDB(db);
  }catch{}
  renderICButtons();renderApplianceList();renderPeopleList();renderRotaPeopleList();updateValidation();
}
async function reloadData(){saveConfig();await loadFromCSV();}

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
function selectIC(stateKey,pid){S[stateKey]=pid;renderICButtons();updateValidation();}

// =============================================
// P3
// =============================================
function setP3(hasP3){
  S.hasP3=hasP3; toggle('btn-nop3',!hasP3); toggle('btn-yesp3',hasP3);
  el('p3-panel').classList.toggle('hidden',!hasP3); updateValidation();
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
  const sl=S.detectedShiftLabel;
  let rH=S.timeH[fromIdx],rM=S.timeM[fromIdx];
  if(rH===null||rM===null) return;
  for(let i=fromIdx+1;i<5;i++){
    if(S.timeBlocked[i]) continue;
    let ah=rH,am=rM+1; if(am>=60){am=0;ah=(ah+1)%24;}
    if(S.timeH[i]===null||S.timeAutoSet[i]){
      S.timeH[i]=ah;S.timeM[i]=am;
      S.p3Times[i]=String(ah).padStart(2,'0')+String(am).padStart(2,'0');
      S.timeAutoSet[i]=true;S.timeGapDismissed[i]=false;
      renderDrum(i);renderTimingFeedback(i);rH=ah;rM=am;
    }else{
      const rOrd=nightOrder(rH*100+rM,sl),tOrd=nightOrder(S.timeH[i]*100+S.timeM[i],sl);
      if(tOrd<=rOrd){
        S.timeH[i]=ah;S.timeM[i]=am;
        S.p3Times[i]=String(ah).padStart(2,'0')+String(am).padStart(2,'0');
        S.timeAutoSet[i]=true;S.timeGapDismissed[i]=false;
        renderDrum(i);renderTimingFeedback(i);rH=ah;rM=am;
      }else{rH=S.timeH[i];rM=S.timeM[i];}
    }
  }
}

function clearTimesFrom(idx){
  for(let i=idx;i<5;i++){
    S.timeH[i]=null;S.timeM[i]=null;S.timeAutoSet[i]=false;
    S.timeBlocked[i]=false;S.timeGapDismissed[i]=false;
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

function blockEvent(idx){
  S.timeBlocked[idx]=true;
  S.timeH[idx]=null;S.timeM[idx]=null;S.p3Times[idx]='';
  S.timeAutoSet[idx]=false;S.timeGapDismissed[idx]=false;
  renderDrum(idx);renderDisableButton(idx);renderTimingFeedback(idx);
  // Re-evaluate neighbours — their "previous time" lookup may have changed
  for(let i=0;i<5;i++) if(i!==idx) renderTimingFeedback(i);
  updateValidation();
}

function unblockEvent(idx){
  S.timeBlocked[idx]=false;
  renderDrum(idx);renderDisableButton(idx);renderTimingFeedback(idx);
  for(let i=0;i<5;i++) if(i!==idx) renderTimingFeedback(i);
  updateValidation();
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
  const A4_RE=/^A4\d{2}$/i; const found={};
  for(let i=0;i<lines.length;i++){
    const code=lines[i].trim().toUpperCase(); if(!A4_RE.test(code)) continue;
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
  S.redconCautionState=S.redconData.some(r=>r.personId)?null:'nonames';
  renderRedconTable(); renderPeopleList(); renderRedconCaution(); updateValidation();
}

function updateRedconCautionState(){
  if(S.detectedShiftLabel!=='Night'){S.redconCautionState=null;}
  else if(!el('redcon-paste').value.trim()){S.redconCautionState='empty';}
  renderRedconCaution();
}

function renderRedconCaution(){
  const eEl=el('redcon-caution-empty'), nEl=el('redcon-caution-nonames');
  if(!eEl||!nEl) return;
  eEl.classList.toggle('hidden', !(S.redconCautionState==='empty'  &&!S.redconCautionDismissed));
  nEl.classList.toggle('hidden', !(S.redconCautionState==='nonames'&&!S.redconCautionDismissed));
}

function dismissRedconCaution(){
  S.redconCautionDismissed=true; renderRedconCaution(); updateValidation();
}

function renderRedconTable(){
  const wrap=el('redcon-results');
  if(!S.redconData.length){wrap.classList.add('hidden');return;}
  wrap.innerHTML=`<table class="redcon-table"><thead><tr><th>Code</th><th>Rank</th><th>Name</th></tr></thead><tbody>
    ${S.redconData.map(r=>`<tr class="${r.matched?'matched':'unmatched'}">
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
  const rf=S.redconData.filter(r=>r.personId);
  parts.push(String(rf.length)); rf.forEach(r=>parts.push(r.code,String(r.personId)));
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
function toggleSettings(){
  const panel=el('settings-panel'),chevron=el('settings-chevron');
  const no=!panel.classList.contains('hidden');
  panel.classList.toggle('hidden',no); chevron.textContent=no?'▸':'▾';
}
function renderApplianceList(){
  const wrap=el('appliance-list');
  if(!S.appliances.length){wrap.innerHTML='<span class="no-names-hint">No appliances loaded.</span>';return;}
  wrap.innerHTML=S.appliances.map(a=>`<span class="appliance-chip" title="${esc(a.desc)}">${a.code}</span>`).join('');
}
function renderPeopleList(){
  const wrap=el('people-list'); const db=loadPeopleDB();
  if(!db.people.length){wrap.innerHTML='<span class="no-names-hint">No alpha manning people yet.</span>';return;}
  wrap.innerHTML=db.people.map(p=>`<div class="person-row"><span class="pid">#${p.id}</span><span class="prank">${p.rank||'—'}</span><span class="pname">${p.name}</span></div>`).join('');
}
function renderRotaPeopleList(){
  const wrap=el('rota-people-list'); if(!wrap) return; const db=loadRotaPeopleDB();
  if(!db.people.length){wrap.innerHTML='<span class="no-names-hint">No rota members loaded yet.</span>';return;}
  wrap.innerHTML=db.people.map(p=>`<div class="person-row"><span class="pid">#${p.id}</span><span class="prank">${p.rank||'—'}</span><span class="pname">${p.name} <span style="color:var(--text-3);font-size:11px">(${p.rota})</span></span></div>`).join('');
}

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
async function init(){
  const cfg=loadConfig();
  if(cfg.rotasPath)      el('cfg-rotas-path').value=cfg.rotasPath;
  if(cfg.appliancesPath) el('cfg-appliances-path').value=cfg.appliancesPath;
  if(cfg.peoplePath)     el('cfg-people-path').value=cfg.peoplePath;
  buildDrums();
  applyShiftResult(computeShift(new Date()));
  initCalendar();
  await loadFromCSV();
  renderPeopleList(); renderRotaPeopleList(); updateValidation();
}
document.addEventListener('DOMContentLoaded',init);
