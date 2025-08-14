// --- Tiny IndexedDB wrapper ---
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
const putEntry = (entry) => new Promise((res, rej) => {
  const r = txStore('readwrite').put(entry); r.onsuccess = () => res(); r.onerror = () => rej(r.error);
});

// --- UI helpers ---
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

// --- Now text ---
const nowEl = byId('now');
const updateNow = () => {
  const d = new Date();
  nowEl.textContent = d.toLocaleString('en-GB', { timeZone: 'Europe/London', weekday:'short', day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
};
setInterval(updateNow, 1000); updateNow();

// --- Save entry ---
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

// --- History render (last 7 days) ---
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

// --- Simple E2E encryption for sync ---
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

// --- Sync (optional, sends encrypted blob to n8n) ---
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
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ encrypted })
    });
    if(!r.ok) throw new Error(await r.text());
    alert('Synced (encrypted).');
  }catch(e){
    alert('Sync failed: ' + e.message);
  }
};
