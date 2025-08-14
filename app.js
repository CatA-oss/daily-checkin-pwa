// Passcode-enabled PWA (local-only).

/* ---------------- IndexedDB ---------------- */
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

/* ---------------- UI helpers ---------------- */
const byId = (id) => document.getElementById(id);
const screens = {
  passSetup: byId('screen-pass-setup'),
  passUnlock: byId('screen-pass-unlock'),
  checkin: byId('screen-checkin'),
  history: byId('screen-history'),
  settings: byId('screen-settings'),
};
function showOnly(name){
  Object.values(screens).forEach(el => el.hidden = true);
  screens[name].hidden = false;
}

/* ---------------- Tabs ---------------- */
byId('tab-checkin').onclick = () => { if (guardUnlocked()) { renderNow(); showOnly('checkin'); } };
byId('tab-history').onclick = () => { if (guardUnlocked()) { renderHistory(); showOnly('history'); } };
byId('tab-settings').onclick = () => { if (guardUnlocked()) showOnly('settings'); };

/* ---------------- Passcode logic ---------------- */
const LS_KEY_HASH = 'pinHash';
const LS_KEY_SALT = 'pinSalt';
const LS_KEY_AUTOLOCK = 'autoLockMins';
let unlocked = false;
let idleTimer = null;

async function sha256(str){ // hex
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
}
function randHex(len=16){
  const a = new Uint8Array(len/2);
  crypto.getRandomValues(a);
  return Array.from(a).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function resetIdleTimer(){
  clearTimeout(idleTimer);
  const mins = Number(localStorage.getItem(LS_KEY_AUTOLOCK) || 2);
  idleTimer = setTimeout(() => lockNow(), mins*60*1000);
}
function lockNow(){
  unlocked = false;
  showOnly('passUnlock');
}
function guardUnlocked(){
  if(!unlocked){
    showOnly('passUnlock');
    return false;
  }
  resetIdleTimer();
  return true;
}

async function initPass(){
  const has = localStorage.getItem(LS_KEY_HASH);
  if(!has){
    showOnly('passSetup');
  } else {
    showOnly('passUnlock');
  }
}

/* Set passcode */
byId('savePass').addEventListener('click', async () => {
  const p1 = byId('pin1').value.trim();
  const p2 = byId('pin2').value.trim();
  const msg = byId('passMsg');
  if(p1.length !== 4 || !/^\d{4}$/.test(p1)){ msg.textContent = 'Please enter 4 digits.'; return; }
  if(p1 !== p2){ msg.textContent = 'Passcodes do not match.'; return; }
  const salt = randHex(16);
  const h = await sha256(p1 + ':' + salt);
  localStorage.setItem(LS_KEY_HASH, h);
  localStorage.setItem(LS_KEY_SALT, salt);
  localStorage.setItem(LS_KEY_AUTOLOCK, '2');
  byId('pin1').value = ''; byId('pin2').value = '';
  msg.textContent = 'Passcode saved.';
  unlocked = true;
  showOnly('checkin');
  resetIdleTimer();
});

/* Unlock */
byId('unlockBtn').addEventListener('click', async () => {
  const pin = byId('pinUnlock').value.trim();
  const salt = localStorage.getItem(LS_KEY_SALT);
  const hash = localStorage.getItem(LS_KEY_HASH);
  const msg = byId('unlockMsg');
  if(!salt || !hash){ msg.textContent = 'No passcode set. Reload and set one.'; return; }
  const h = await sha256(pin + ':' + salt);
  if(h === hash){
    byId('pinUnlock').value='';
    unlocked = true;
    showOnly('checkin');
    resetIdleTimer();
  } else {
    msg.textContent = 'Incorrect passcode.';
  }
});

/* Change passcode */
byId('changePass').addEventListener('click', () => {
  if(!guardUnlocked()) return;
  showOnly('passSetup');
});

/* Lock now */
byId('lockNow').addEventListener('click', () => lockNow());

/* Auto-lock setting */
const autoLockMinsInput = byId('autoLockMins');
autoLockMinsInput.value = localStorage.getItem(LS_KEY_AUTOLOCK) || '2';
autoLockMinsInput.addEventListener('change', () => {
  const v = Math.max(1, Math.min(60, Number(autoLockMinsInput.value||2)));
  localStorage.setItem(LS_KEY_AUTOLOCK, String(v));
  resetIdleTimer();
});

/* ---------------- Now / check-in ---------------- */
const nowEl = byId('now');
function renderNow(){
  const d = new Date();
  nowEl.textContent = d.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday:'short', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
setInterval(() => { if(unlocked) renderNow(); }, 1000);

/* Save entry */
const saveBtn = byId('save');
const saveStatus = byId('saveStatus');
saveBtn.addEventListener('click', async () => {
  if(!guardUnlocked()) return;
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
  resetIdleTimer();
});

/* History */
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

/* Export */
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
byId('exportCsv').addEventListener('click', async () => {
  if(!guardUnlocked()) return;
  await openDB();
  const all = await getAll();
  const header = ['createdAt','tz','physical','emotional','mental','spiritual','average','mood','notes'];
  const rows = all.map(e => header.map(h => {
    const v = (e[h] ?? '').toString().replace(/"/g,'""');
    return `"${v}"`;
  }).join(','));
  const csv = header.join(',') + '\\n' + rows.join('\\n');
  download('checkins.csv', csv);
});
byId('exportJson').addEventListener('click', async () => {
  if(!guardUnlocked()) return;
  await openDB();
  const all = await getAll();
  download('checkins.json', JSON.stringify(all, null, 2));
});
byId('clearAll').addEventListener('click', async () => {
  if(!guardUnlocked()) return;
  const ok = confirm('This will permanently delete all local entries on this device. Continue?');
  if (!ok) return;
  await openDB();
  await clearAllStore();
  alert('All local data cleared.');
  const ul = byId('history'); if (ul) ul.innerHTML = '';
  const avg = byId('avg'); if (avg) avg.textContent = 'No entries yet.';
});

/* Global activity resets idle timer */
['click','touchstart','keydown','mousemove','scroll'].forEach(evt =>
  window.addEventListener(evt, () => unlocked && resetIdleTimer(), { passive:true })
);

/* Init */
initPass();
