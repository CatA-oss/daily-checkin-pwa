// ---- Storage (IndexedDB) ----
const DB_NAME = 'checkin-db', STORE = 'entries';
let db;
const openDB = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
  req.onsuccess = () => { db = req.result; resolve(db); };
  req.onerror = () => reject(req.error);
});
const txStore = (mode='readonly') => db.transaction(STORE, mode).objectStore(STORE);
const addEntry = (entry) => new Promise((res, rej) => {
  const r = txStore('readwrite').add(entry); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const getAll = () => new Promise((res, rej) => {
  const r = txStore().getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const clearAllStore = () => new Promise((res, rej) => {
  const r = txStore('readwrite').clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error);
});

// ---- UI helpers ----
const byId = (id) => document.getElementById(id);
const screens = {
  checkin: byId('screen-checkin'),
  history: byId('screen-history'),
  settings: byId('screen-settings'),
};
const show = (name) => {
  Object.values(screens).forEach(el => el.hidden = true);
  screens[name].hidden = false;
};
byId('tab-checkin').onclick = () => show('checkin');
byId('tab-history').onclick = () => { renderHistory(); show('history'); };
byId('tab-settings').onclick = () => show('settings');

// ---- Clock ----
const nowEl = byId('now');
const updateNow = () => {
  const d = new Date();
  nowEl.textContent = d.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday:'short', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
};
setInterval(updateNow, 1000); updateNow();

// ---- Save entry ----
const saveBtn = byId('save');
const saveStatus = byId('saveStatus');
saveBtn.onclick = async () => {
  await openDB();
  const entry = {
    createdAt: new Date().toISOString(),
    tz: 'Europe/London',
    physical: Number(byId('physical').value),
    emotional: Number(byId('emotional').value),
    mental: Number(byId('mental').value),
    spiritual: Number(byId('spiritual').value),
    mood: byId('mood').value,
    notes: byId('notes').value.trim(),
  };
  entry.average = Math.round(((entry.physical + entry.emotional + entry.mental + entry.spiritual)/4) * 10)/10;
  await addEntry(entry);
  saveStatus.textContent = 'Saved locally ✔';
  setTimeout(() => saveStatus.textContent = '', 1500);
  byId('notes').value = '';
};

// ---- History ----
async function renderHistory(){
  await openDB();
  const all = (await getAll()).sort((a,b) => (a.createdAt < b.createdAt ? 1 : -1));
  const last7 = all.slice(0,7);
  const ul = byId('history');
  ul.innerHTML = '';
  let sum = 0;
  last7.forEach(e => {
    sum += e.average || 0;
    const d = new Date(e.createdAt);
    const line = `${d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' })} — avg ${e.average} — ${e.mood} — ${e.notes || ''}`;
    const li = document.createElement('li'); li.textContent = line; ul.appendChild(li);
  });
  const avg = last7.length ? Math.round((sum/last7.length)*10)/10 : 0;
  byId('avg').textContent = last7.length ? `7‑day average: ${avg}` : 'No entries yet.';
}

// ---- Export / Clear ----
function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}
byId('exportCsv').onclick = async () => {
  await openDB();
  const all = await getAll();
  const header = ['createdAt','tz','physical','emotional','mental','spiritual','average','mood','notes'];
  const rows = all.map(e => header.map(h => {
    const v = (e[h] ?? '').toString().replace(/"/g,'""');
    return `"${v}"`;
  }).join(','));
  const csv = header.join(',') + '\n' + rows.join('\n');
  download('checkins.csv', csv);
};
byId('exportJson').onclick = async () => {
  await openDB();
  const all = await getAll();
  download('checkins.json', JSON.stringify(all, null, 2));
};
byId('clearAll').onclick = async () => {
  const ok = confirm('This will permanently delete all local entries on this device. Continue?');
  if (!ok) return;
  await openDB();
  await clearAllStore();
  alert('All local data cleared.');
  const ul = byId('history'); if (ul) ul.innerHTML = '';
  const avg = byId('avg'); if (avg) avg.textContent = 'No entries yet.';
};

// ---- Optional encrypted sync placeholder ----
async function deriveKey(passphrase){
  const enc = new TextEncoder().encode(passphrase);
  const keyMaterial = await crypto.subtle.importKey('raw', enc, {name:'PBKDF2'}, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {name:'PBKDF2', salt:new TextEncoder().encode('checkin-salt'), iterations:100000, hash:'SHA-256'},
    keyMaterial,
    {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
}
async function encryptJSON(obj, key){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, data);
  return { iv: Array.from(iv), payload: Array.from(new Uint8Array(cipher)) };
}
byId('runSync').onclick = async () => {
  const enabled = byId('syncEnabled').checked;
  const pass = byId('passphrase').value;
  const url = byId('webhook').value;
  if (!enabled) { alert('Enable sync first.'); return; }
  if (!pass || !url) { alert('Passphrase + Webhook URL required.'); return; }
  await openDB();
  const all = await getAll();
  const key = await deriveKey(pass);
  const encrypted = await encryptJSON({ entries: all }, key);
  try{
    const r = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted })
    });
    if(!r.ok) throw new Error(await r.text());
    alert('Synced (encrypted).');
  }catch(e){
    alert('Sync failed: ' + e.message);
  }
};

// ---- PASSCODE LOCK ----
const lockOverlay = byId('lockOverlay');
const lockTitle = byId('lockTitle');
const setupBlock = byId('setupBlock');
const unlockBlock = byId('unlockBlock');
const pinSetup1 = byId('pinSetup1');
const pinSetup2 = byId('pinSetup2');
const savePin = byId('savePin');
const lockMsg = byId('lockMsg');
const pinInput = byId('pin');
const unlockBtn = byId('unlockBtn');
const unlockMsg = byId('unlockMsg');
const lockNowBtn = byId('lockNow');
const changePinBtn = byId('changePin');
const idleMinutesInput = byId('idleMinutes');

// Simple hash using SHA-256
async function sha256(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStored(key){ return localStorage.getItem(key); }
function setStored(key,val){ localStorage.setItem(key, val); }
function removeStored(key){ localStorage.removeItem(key); }

function isPinSet(){ return !!getStored('pinHash'); }

async function showSetup(){
  lockTitle.textContent = 'Set a 4‑digit passcode';
  setupBlock.hidden = false;
  unlockBlock.hidden = true;
  lockOverlay.hidden = false;
  pinSetup1.value = ''; pinSetup2.value = '';
  lockMsg.textContent = '';
  pinSetup1.focus();
}

async function showUnlock(){
  lockTitle.textContent = 'Enter passcode to unlock';
  setupBlock.hidden = true;
  unlockBlock.hidden = false;
  lockOverlay.hidden = false;
  pinInput.value = '';
  unlockMsg.textContent = '';
  pinInput.focus();
}

async function unlock(){
  const pin = pinInput.value.trim();
  if(pin.length !== 4){ unlockMsg.textContent = 'Enter 4 digits.'; return; }
  const salt = getStored('pinSalt') || '';
  const hash = await sha256(pin + ':' + salt);
  if(hash === getStored('pinHash')){
    lockOverlay.hidden = true;
    resetIdleTimer();
  } else {
    unlockMsg.textContent = 'Incorrect passcode.';
  }
}

savePin.onclick = async () => {
  const a = pinSetup1.value.trim();
  const b = pinSetup2.value.trim();
  if(a.length !== 4 || b.length !== 4){ lockMsg.textContent = 'Use exactly 4 digits.'; return; }
  if(a !== b){ lockMsg.textContent = 'Passcodes do not match.'; return; }
  const salt = Math.random().toString(36).slice(2);
  const hash = await sha256(a + ':' + salt);
  setStored('pinSalt', salt);
  setStored('pinHash', hash);
  lockOverlay.hidden = true;
  resetIdleTimer();
};

unlockBtn.onclick = unlock;
pinInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') unlock(); });

lockNowBtn.onclick = () => { showUnlock(); };

changePinBtn.onclick = () => {
  // Require current pin to change
  const current = prompt('Enter current 4‑digit passcode:');
  if(!current) return;
  const salt = getStored('pinSalt') || '';
  sha256(current + ':' + salt).then(h => {
    if(h !== getStored('pinHash')){ alert('Incorrect current passcode.'); return; }
    const a = prompt('New 4‑digit passcode:');
    const b = prompt('Confirm new passcode:');
    if(!a || !b || a.length!==4 || b.length!==4 || a!==b){ alert('Passcode change cancelled or invalid.'); return; }
    const newSalt = Math.random().toString(36).slice(2);
    sha256(a + ':' + newSalt).then(newHash => {
      setStored('pinSalt', newSalt);
      setStored('pinHash', newHash);
      alert('Passcode updated.');
    });
  });
};

// Idle auto-lock
let idleTimer;
function resetIdleTimer(){
  const mins = Math.max(1, Number(idleMinutesInput.value||2));
  clearTimeout(idleTimer);
  idleTimer = setTimeout(()=>{
    showUnlock();
  }, mins * 60 * 1000);
}
['click','keydown','touchstart','mousemove'].forEach(evt => {
  window.addEventListener(evt, ()=>{
    if(lockOverlay.hidden) resetIdleTimer();
  }, {passive:true});
});

// Gate on load
(function initLock(){
  if(isPinSet()){ showUnlock(); }
  else { showSetup(); }
})();
