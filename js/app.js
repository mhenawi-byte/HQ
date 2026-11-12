import { load, save, uid, defaults, merge, STORAGE_KEY, COLLECTIONS, SETTING_DEFAULTS } from './store.js';
import { getConn, setConn, connected, getCache, setCache, clearCache, newKey, call, pairingLink, readPairing } from './api.js';

const VERSION = '0.3.0';
let S = load();

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------------- Dates (all local, 'YYYY-MM-DD') ---------------- */

const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => isoOf(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return isoOf(d); };
const diffDays = (a, b) => Math.round((parse(a) - parse(b)) / 86400000);
const dayStart = (s) => parse(s).getTime();
const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const ago = (ms) => {
  if (!ms) return 'never';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

function dueInfo(due) {
  if (!due) return { label: 'No date', cls: '' };
  const d = diffDays(due, todayISO());
  if (d < 0) return { label: d === -1 ? 'Yesterday' : `${-d}d overdue`, cls: 'late' };
  if (d === 0) return { label: 'Today', cls: 'now' };
  if (d === 1) return { label: 'Tomorrow', cls: 'soon' };
  if (d < 7) return { label: parse(due).toLocaleDateString(undefined, { weekday: 'long' }), cls: '' };
  return { label: parse(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: '' };
}

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const usd = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthOf = (iso) => iso.slice(0, 7);
const atTime = (day, hm) => { const [h, m] = hm.split(':').map(Number); const d = parse(day); d.setHours(h, m, 0, 0); return d.getTime(); };
const fmtHM = (hm) => (hm ? fmtTime(atTime(todayISO(), hm)) : '');
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

const PRI = { high: 'P1', med: 'P2', low: 'P3' };
const PRI_RANK = { high: 0, med: 1, low: 2 };
const byDue = (a, b) =>
  (a.due ? 0 : 1) - (b.due ? 0 : 1) ||
  (a.due || '').localeCompare(b.due || '') ||
  (PRI_RANK[a.priority] ?? 1) - (PRI_RANK[b.priority] ?? 1) ||
  (a.created || 0) - (b.created || 0);

const CLASS_COLORS = ['#4da3ff', '#3dd6f5', '#9d7bff', '#f06bd0', '#ff9f43', '#ffd23f', '#3ddc97', '#ff5d6c'];

const DONE_LINES = [
  'DARKO › Nice work.',
  'DARKO › Target neutralized.',
  'DARKO › Logged. Moving on.',
  'DARKO › One less thing.',
  'DARKO › Clean execution.',
  'DARKO › Power level rising.',
];

/* ---------------- Icons ---------------- */

const svg = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  today: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'),
  school: svg('<path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M7 11.5V16c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5v-4.5"/><path d="M21 9v5"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M14 14h2M8 17h2"/>'),
  grocery: svg('<path d="M3 4h2l2.2 11h10.6L20 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>'),
  personal: svg('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>', 'stroke-width="3"'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.2"'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  left: svg('<path d="M15 5l-7 7 7 7"/>', 'stroke-width="2.2"'),
  right: svg('<path d="M9 5l7 7-7 7"/>', 'stroke-width="2.2"'),
  sync: svg('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>'),
  link: svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>'),
  pin: svg('<path d="M12 21s-6.5-6.2-6.5-11A6.5 6.5 0 0 1 18.5 10c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  fuel: svg('<path d="M12 3c1.2 3.6 5.5 5.6 5.5 10.2a5.5 5.5 0 0 1-11 0c0-2.6 1.5-4.2 2.6-5.2.3 1.7 1 2.7 2.1 3.1-.1-3.2.6-5.6.8-8.1z"/>'),
  money: svg('<rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v5M17.5 9.5v5"/>'),
  focus: svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 2M9.5 2.8h5M12 2.8v3.2"/>'),
  journal: svg('<path d="M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v15.5H7.5A1.5 1.5 0 0 1 6 19V3.5z"/><path d="M6 17.5h12.5M9.5 8h5.5M9.5 11h4"/>'),
  more: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>'),
  send: svg('<path d="M4.5 12L20 4.5 15 20l-3-6.2z"/><path d="M12 13.8L20 4.5"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z"/>', 'fill="currentColor"'),
  pause: svg('<path d="M9 5.5v13M15 5.5v13"/>', 'stroke-width="3"'),
  emblem: `<svg viewBox="0 0 120 120" aria-hidden="true"><polygon points="60,6 106,33 106,87 60,114 14,87 14,33" fill="none" stroke="#3b9cff" stroke-width="5" stroke-linejoin="round"/><polygon points="60,22 92,41 92,79 60,98 28,79 28,41" fill="rgba(59,156,255,.12)" stroke="#3b9cff" stroke-width="1.5" opacity=".7"/><text x="60" y="71" text-anchor="middle" fill="#fff" font-family="-apple-system,system-ui,sans-serif" font-weight="800" font-size="30">HQ</text></svg>`,
};

// phone: shown in the phone's bottom bar. The rest live under "More" on a phone and in the side rail on a laptop.
const TABS = [
  { id: 'today', label: 'Today', phone: true },
  { id: 'school', label: 'School', phone: true },
  { id: 'calendar', label: 'Calendar', phone: true },
  { id: 'grocery', label: 'Grocery' },
  { id: 'personal', label: 'Personal' },
  { id: 'fuel', label: 'Fuel', phone: true },
  { id: 'money', label: 'Money' },
  { id: 'focus', label: 'Focus' },
  { id: 'journal', label: 'Journal' },
  { id: 'settings', label: 'Settings' },
  { id: 'more', label: 'More', phoneOnly: true },
];

/* ---------------- State helpers ---------------- */

let lastRoute = null;
function commit() { save(S); render(); scheduleSync(); }
const route = () => {
  const r = location.hash.slice(1);
  return TABS.some((t) => t.id === r) ? r : 'today';
};
const findItem = (kind, id) => S[kind].find((x) => x.id === id);
const className = (id) => S.classes.find((c) => c.id === id);

// Delete items and leave tombstones so the deletion syncs to your other devices.
function removeItems(kind, ids) {
  const set = new Set(ids);
  const now = Date.now();
  S[kind] = S[kind].filter((x) => !set.has(x.id));
  ids.forEach((id) => { S.deleted[id] = now; });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/* ---------------- Calendar events (from Google, cached locally) ---------------- */

const normEvent = (ev) => ({
  ...ev,
  s: ev.allDay ? dayStart(ev.start) : ev.start,
  e: ev.allDay ? dayStart(ev.end) : ev.end,
});

function eventsOn(day) {
  const a = dayStart(day), b = dayStart(addDays(day, 1));
  return (getCache().events || [])
    .filter((ev) => ev.s < b && ev.e > a)
    .sort((x, y) => (y.allDay - x.allDay) || x.s - y.s);
}

const eventKey = (ev) => `${ev.id}|${ev.s}`;
const findEvent = (key) => (getCache().events || []).find((ev) => eventKey(ev) === key);

async function loadEvents(from, to) {
  try {
    const res = await call('events', { from, to });
    const bad = res.events.find((ev) => ev.id === 'outlook-error');
    const events = res.events.filter((ev) => ev.id !== 'outlook-error');
    const cutoff = Date.now() - 60 * 86400000;
    const keep = (getCache().events || []).filter((ev) => (ev.e <= from || ev.s >= to) && ev.e > cutoff);
    setCache({ events: [...keep, ...events.map(normEvent)], eventsAt: Date.now(), eventsError: '', outlookError: bad ? bad.error : '' });
  } catch (e) {
    setCache({ eventsError: e.message });
  }
  softRender();
}

const loadedMonths = new Set();
function gridRange(y, m) {
  const first = new Date(y, m, 1);
  const start = addDays(isoOf(first), -first.getDay());
  const days = Math.ceil((first.getDay() + new Date(y, m + 1, 0).getDate()) / 7) * 7;
  return { start, days };
}
function ensureMonthLoaded(y, m) {
  const key = `${y}-${m}`;
  if (!connected() || loadedMonths.has(key)) return;
  loadedMonths.add(key);
  const { start, days } = gridRange(y, m);
  loadEvents(dayStart(start), dayStart(addDays(start, days)));
}
function reloadEventsAround(day) {
  const d = parse(day);
  loadedMonths.delete(`${d.getFullYear()}-${d.getMonth()}`);
  ensureMonthLoaded(d.getFullYear(), d.getMonth());
  const t = todayISO();
  loadEvents(dayStart(addDays(t, -1)), dayStart(addDays(t, 8)));
}

/* ---------------- Canvas import ---------------- */

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function courseCode(course) {
  const m = course.match(/([A-Z]{2,5})[\s_-]*(\d{4}[A-Z]?)/);
  return m ? `${m[1]} ${m[2]}` : course.split(/\s[-–|]\s/)[0].slice(0, 24).trim();
}
function ensureClass(course) {
  if (!course) return '';
  const code = courseCode(course);
  const found = S.classes.find((c) => norm(c.name) === norm(code));
  if (found) return found.id;
  const id = `cls-${norm(code)}`;
  if (S.deleted[id]) return '';
  const now = Date.now();
  S.classes.push({ id, name: code, color: CLASS_COLORS[S.classes.length % CLASS_COLORS.length], created: now, updated: now });
  return id;
}
function applyCanvas(items) {
  const t = todayISO();
  const now = Date.now();
  let added = 0, changed = false;
  for (const it of items) {
    const id = `cv-${it.uid.replace(/[^a-z0-9-]/gi, '')}`;
    if (S.deleted[id]) continue;
    const task = findItem('school', id);
    if (!task) {
      if (!it.due || it.due < t) continue; // only upcoming work, not the whole semester
      S.school.push({
        id, title: it.title, classId: ensureClass(it.course), due: it.due, dueTime: it.time || '',
        priority: 'med', notes: '', url: it.url || '', source: 'canvas',
        done: false, doneAt: null, created: now, updated: now,
      });
      added++; changed = true;
    } else if (task.title !== it.title || task.due !== it.due || (task.dueTime || '') !== (it.time || '')) {
      Object.assign(task, { title: it.title, due: it.due, dueTime: it.time || '', updated: now });
      changed = true;
    }
  }
  if (changed) { save(S); softRender(); scheduleSync(); }
  return added;
}
async function importCanvas({ announce = false } = {}) {
  try {
    const { items } = await call('canvas');
    const added = applyCanvas(items);
    setCache({ canvasAt: Date.now(), canvasCount: items.length, canvasError: '' });
    if (announce) toast(added ? `DARKO › ${added} new assignment${added > 1 ? 's' : ''} from Canvas.` : 'DARKO › Canvas is up to date.');
  } catch (e) {
    setCache({ canvasError: e.message });
    if (announce) toast(`Canvas: ${e.message}`);
  }
  softRender();
}

/* ---------------- WHOOP ---------------- */

async function loadWhoop({ announce = false } = {}) {
  try {
    const { whoop } = await call('whoop');
    setCache({ whoop, whoopAt: Date.now(), whoopError: '' });
    if (announce) toast('DARKO › WHOOP data refreshed.');
  } catch (e) {
    setCache({ whoopError: e.message });
    if (announce) toast(`WHOOP: ${e.message}`);
  }
  softRender();
}
function whoopNow() {
  const w = getCache().whoop;
  if (!w) return null;
  const rec = (w.recovery || []).find((r) => typeof r.recovery === 'number');
  const sl = (w.sleep || []).find((s) => s.asleepMs);
  const cyc = (w.cycles || [])[0];
  return { rec, sl, cyc };
}
const recColor = (n) => (n >= 67 ? 'var(--ok)' : n >= 34 ? 'var(--soon)' : 'var(--late)');
const hrsMin = (ms) => `${Math.floor(ms / 3600000)}h ${pad(Math.round((ms % 3600000) / 60000))}m`;

/* ---------------- Sync engine ---------------- */

let syncTimer = null, syncing = false, syncAgain = false;
let syncStatus = connected() ? 'idle' : 'off';

function setSync(s) {
  syncStatus = s;
  const el = $('#syncState');
  if (el) el.textContent = syncLabel();
}
function syncLabel() {
  if (!connected()) return 'DARKO · LOCAL';
  return { idle: 'DARKO · ONLINE', syncing: 'DARKO · SYNCING', ok: 'DARKO · SYNCED', error: 'DARKO · OFFLINE' }[syncStatus] || 'DARKO · ONLINE';
}

function scheduleSync(delay = 1200) {
  if (!connected()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, delay);
}

async function syncNow() {
  if (!connected()) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setSync('syncing');
  const sent = JSON.stringify(S);
  try {
    const { state } = await call('sync', { state: S });
    const before = JSON.stringify(S);
    S = merge(state, S);
    save(S);
    setCache({ lastSync: Date.now(), syncError: '' });
    setSync('ok');
    if (JSON.stringify(S) !== before) softRender();
    if (before !== sent) syncAgain = true; // you changed something while we were syncing
  } catch (e) {
    setCache({ syncError: e.message });
    setSync('error');
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(400); }
  }
}

async function refreshAll({ force = false } = {}) {
  if (!connected()) return;
  const c = getCache();
  const now = Date.now();
  syncNow();
  try {
    const { status } = await call('status');
    setCache({ status });
  } catch { /* shown via sync state */ }
  const t = todayISO();
  loadEvents(dayStart(addDays(t, -1)), dayStart(addDays(t, 8)));
  const st = getCache().status || {};
  if (st.canvas && (force || now - (c.canvasAt || 0) > 30 * 60000)) importCanvas();
  // WHOOP every ~5 min (the 4.5 min gap keeps a 5-min timer from skipping a round).
  if (st.whoop && (force || now - (c.whoopAt || 0) > 4.5 * 60000)) loadWhoop();
}

/* ---------------- Today data ---------------- */

function todayData() {
  const t = todayISO();
  const tasks = [
    ...S.school.map((x) => ({ ...x, kind: 'school' })),
    ...S.personal.map((x) => ({ ...x, kind: 'personal' })),
  ];
  const overdue = tasks.filter((x) => !x.done && x.due && x.due < t);
  const dueToday = tasks.filter((x) => x.due === t);
  const caughtUp = tasks.filter((x) => x.done && x.doneAt === t && x.due && x.due < t);
  const mission = [...overdue, ...dueToday, ...caughtUp].sort((a, b) => (a.done - b.done) || byDue(a, b));
  const tomorrow = tasks.filter((x) => !x.done && x.due === addDays(t, 1)).sort(byDue);
  const habitsDone = S.habits.filter((h) => h.log[t]).length;
  const total = mission.length + S.habits.length;
  const done = mission.filter((x) => x.done).length + habitsDone;
  const pct = total ? Math.round((done / total) * 100) : 100;
  const week = S.school.filter((x) => !x.done && x.due && x.due >= t && x.due <= addDays(t, 6)).length;
  const sched = scheduleOn(t);
  const next = sched
    .map((x) => (x.kind === 'class' ? x.m : x.ev.allDay ? null : x.ev))
    .filter((x) => x && x.e > Date.now())
    .sort((a, b) => a.s - b.s)[0];
  return { t, overdue, dueToday, mission, tomorrow, habitsDone, pct, week, sched, next };
}

function darkoStatus(d) {
  const open = d.dueToday.filter((x) => !x.done).length;
  const parts = [];
  if (d.overdue.length) parts.push(`${d.overdue.length} overdue`);
  parts.push(open ? `${open} due today` : 'nothing else due today');
  if (S.habits.length) parts.push(`habits ${d.habitsDone}/${S.habits.length}`);
  let line = parts.join(' · ') + '.';
  if (!d.overdue.length && !open && d.habitsDone === S.habits.length) line = 'All systems nominal. You are clear for today.';
  if (d.next) line += ` Next: ${d.next.title} at ${fmtTime(d.next.s)}.`;
  return line;
}

/* ---------------- Row templates ---------------- */

function taskRow(t, kind, { showKind = false } = {}) {
  const info = dueInfo(t.due);
  const cls = kind === 'school' ? className(t.classId) : null;
  const meta = [
    showKind && kind === 'personal' ? `<span class="chip" style="--c:#8395ab">Personal</span>` : '',
    cls ? `<span class="chip" style="--c:${cls.color}">${esc(cls.name)}</span>` : '',
    showKind && kind === 'school' && !cls ? `<span class="chip">School</span>` : '',
    t.due ? `<span class="due ${t.done ? '' : info.cls}">${info.label}${t.dueTime ? ` · ${esc(t.dueTime)}` : ''}</span>` : '',
    kind === 'school' && t.priority === 'high' ? `<span class="pri">${PRI.high}</span>` : '',
    t.source === 'canvas' ? `<span class="src">CANVAS</span>` : '',
  ].join('');
  return `<li class="task ${t.done ? 'done' : ''} pri-${t.priority || 'med'}">
    <button class="check" data-act="toggle" data-kind="${kind}" data-id="${t.id}" aria-pressed="${!!t.done}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${ICON.check}</button>
    <button class="task-body" data-act="edit" data-kind="${kind}" data-id="${t.id}">
      <span class="task-title">${esc(t.title)}</span>
      <span class="task-meta">${meta}</span>
    </button>
  </li>`;
}

function streak(h) {
  let d = todayISO();
  if (!h.log[d]) d = addDays(d, -1);
  let n = 0;
  while (h.log[d]) { n++; d = addDays(d, -1); }
  return n;
}

function habitRow(h) {
  const t = todayISO();
  const on = !!h.log[t];
  const s = streak(h);
  const days = `<div class="week">${[6, 5, 4, 3, 2, 1, 0].map((i) => {
    const d = addDays(t, -i);
    const letter = parse(d).toLocaleDateString(undefined, { weekday: 'narrow' });
    return `<button class="dot ${h.log[d] ? 'on' : ''} ${i === 0 ? 'today' : ''}" data-act="habit-day" data-id="${h.id}" data-day="${d}" aria-label="${esc(h.name)} on ${d}${h.log[d] ? ', done' : ''}"><i></i>${letter}</button>`;
  }).join('')}</div>`;
  return `<li class="habit">
    <button class="check" data-act="habit-day" data-id="${h.id}" data-day="${t}" aria-pressed="${on}" aria-label="${esc(h.name)} today">${ICON.check}</button>
    <button class="habit-name" data-act="edit-habit" data-id="${h.id}">${esc(h.name)}
      <small class="${s >= 3 ? 'hot' : ''}">${s ? `${s}-day streak` : 'No streak yet'}</small>
    </button>
    ${days}
  </li>`;
}

// Compact toggle used on Today.
function habitPill(h) {
  const t = todayISO();
  const on = !!h.log[t];
  const s = streak(h);
  return `<button class="hpill ${on ? 'on' : ''}" data-act="habit-day" data-id="${h.id}" data-day="${t}" aria-pressed="${on}">
    <span class="hbox">${ICON.check}</span><span class="hname">${esc(h.name)}</span>${s > 1 ? `<span class="hstreak">${s}</span>` : ''}
  </button>`;
}

function eventRow(ev, day) {
  let time = 'All day';
  if (!ev.allDay) {
    const startsBefore = ev.s < dayStart(day), endsAfter = ev.e > dayStart(addDays(day, 1));
    time = `${startsBefore ? '…' : fmtTime(ev.s)} – ${endsAfter ? '…' : fmtTime(ev.e)}`;
  }
  const past = !ev.allDay && ev.e < Date.now();
  return `<li class="event ${past ? 'past' : ''}">
    <button class="event-body" data-act="edit-event" data-key="${esc(eventKey(ev))}">
      <span class="event-time">${time}</span>
      <span class="event-main"><span class="event-title">${esc(ev.title)}${ev.source === 'outlook' ? `<span class="src-tag">${/teams/i.test(ev.location) || ev.join ? 'Teams' : 'Outlook'}</span>` : ''}</span>
      ${ev.location ? `<span class="event-loc">${ICON.pin}${esc(ev.location)}</span>` : ''}</span>
    </button>
  </li>`;
}

/* ---------------- Views ---------------- */

// Personal to-dos on Today: everything open that isn't already on the Mission board or Incoming,
// plus what you checked off today (so a tap doesn't make it vanish).
function todoCard(d) {
  const shown = new Set([...d.mission, ...d.tomorrow].map((x) => x.id));
  const open = S.personal.filter((x) => !x.done && !shown.has(x.id)).sort(byDue);
  const doneToday = S.personal.filter((x) => x.done && x.doneAt === d.t && !shown.has(x.id));
  const total = S.personal.filter((x) => !x.done).length;
  return `
    <div class="card">
      <div class="card-head"><span class="eyebrow">To-do · Personal</span><a class="btn ghost small" href="#personal">${total} open</a></div>
      <form class="addbar" data-form="personal-quick" autocomplete="off">
        <input name="title" placeholder="Add a to-do…" aria-label="Add a personal to-do" enterkeyhint="done">
        <button class="btn primary" type="submit" aria-label="Add to-do">${ICON.plus}</button>
      </form>
      ${open.length || doneToday.length
        ? `<ul class="list">${[...open.slice(0, 12), ...doneToday].map((x) => taskRow(x, 'personal')).join('')}</ul>
           ${open.length > 12 ? `<a class="more-link" href="#personal">+ ${open.length - 12} more in Personal</a>` : ''}`
        : `<div class="empty">${total ? 'All your to-dos with dates are on the Mission board above.' : 'Nothing on your list. Add one above.'}</div>`}
    </div>`;
}

function viewToday() {
  const d = todayData();
  const name = S.settings.name ? `, ${esc(S.settings.name)}` : '';
  const r = 50, c = 2 * Math.PI * r;
  const groceryLeft = S.grocery.filter((g) => !g.done).length;
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const w = whoopNow();
  const st = getCache().status || {};

  const scheduleCard = `
    <div class="card">
      <div class="card-head"><span class="eyebrow">Schedule</span><a class="btn ghost small" href="#calendar">Calendar</a></div>
      ${connected() ? `
      <form class="addbar quick-event" data-form="event-quick" autocomplete="off">
        <input name="text" placeholder="Add to calendar: gym tomorrow 6pm" aria-label="Quick add a calendar event" enterkeyhint="done">
        <button type="button" class="btn icon-only" data-act="event-full" aria-label="Open full event form" title="More options">${ICON.calendar}</button>
        <button class="btn primary" type="submit" aria-label="Add event">${ICON.plus}</button>
      </form>` : ''}
      ${d.sched.length
        ? `<ul class="list">${scheduleRows(d.t)}</ul>`
        : `<div class="empty">${connected() ? 'No events or classes today.' : 'No classes today. Connect Google in <a href="#settings">Settings</a> to see your calendar here.'}</div>`}
    </div>`;

  const whoopCard = connected() && st.whoop ? `
    <div class="card">
      <div class="card-head"><span class="eyebrow">WHOOP</span><span class="count">${getCache().whoopAt ? ago(getCache().whoopAt).toUpperCase() : ''}</span></div>
      ${w && w.rec ? `
        <div class="whoop">
          <div class="wstat"><b style="color:${recColor(w.rec.recovery)}">${Math.round(w.rec.recovery)}%</b><span>Recovery</span></div>
          <div class="wstat"><b>${w.sl ? hrsMin(w.sl.asleepMs) : '–'}</b><span>Sleep${w.sl && w.sl.performance != null ? ` · ${Math.round(w.sl.performance)}%` : ''}</span></div>
          <div class="wstat"><b>${w.cyc && w.cyc.strain != null ? w.cyc.strain.toFixed(1) : '–'}</b><span>Strain</span></div>
          <div class="wstat"><b>${w.rec.hrv != null ? Math.round(w.rec.hrv) : '–'}</b><span>HRV ms</span></div>
        </div>`
        : `<div class="empty">${getCache().whoopError ? esc(getCache().whoopError) : 'Waiting for today\'s WHOOP data…'}</div>`}
    </div>` : '';

  const jr = journalOf(d.t);
  const journalNudge = new Date().getHours() >= 18 && !(jr && jr.text.trim())
    ? `<a class="banner nudge" href="#journal">${ICON.journal}<span><b>DARKO ›</b> Today's journal is still empty. Two minutes, then you're done.</span></a>` : '';

  return `
  ${journalNudge}
  <section class="hero">
    <div>
      <div class="eyebrow">${esc(dateStr)}</div>
      <h1>${greeting()}${name}.</h1>
      <div class="darko-line"><b>DARKO</b><span>${esc(darkoStatus(d))}<span class="blink"></span></span></div>
    </div>
    <div class="power" role="img" aria-label="Power level ${d.pct} percent">
      <svg class="ring" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="${r}" class="ring-track"/>
        <circle cx="60" cy="60" r="58" class="ring-ticks"/>
        <circle cx="60" cy="60" r="${r}" class="ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - d.pct / 100)}"/>
      </svg>
      <div class="power-label"><b>${d.pct}<small>%</small></b><span>POWER</span></div>
    </div>
  </section>

  <section class="stats">
    ${w && w.rec
      ? `<a class="stat" href="#today"><b style="color:${recColor(w.rec.recovery)}">${Math.round(w.rec.recovery)}%</b><span>Recovery</span></a>`
      : `<a class="stat ${d.overdue.length ? 'alert' : ''}" href="#school"><b>${d.overdue.length}</b><span>Overdue</span></a>`}
    <a class="stat" href="#school"><b>${d.week}</b><span>School · 7 days</span></a>
    <a class="stat" href="#calendar"><b>${d.sched.length}</b><span>On schedule</span></a>
    <a class="stat" href="#grocery"><b>${groceryLeft}</b><span>To buy</span></a>
  </section>

  <section class="grid two">
    <div class="stack">
      <div class="card">
        <div class="card-head"><span class="eyebrow">Mission board</span><span class="count">${d.mission.filter((x) => !x.done).length} OPEN</span></div>
        ${d.mission.length
          ? `<ul class="list">${d.mission.map((x) => taskRow(x, x.kind, { showKind: true })).join('')}</ul>`
          : `<div class="empty"><b>Nothing due today.</b><br>Add assignments in School or tasks in Personal.</div>`}
      </div>
      ${todoCard(d)}
      ${scheduleCard}
      <div class="card">
        <div class="card-head"><span class="eyebrow" style="color:var(--soon)">Incoming · tomorrow</span><span class="count">${d.tomorrow.length}</span></div>
        ${d.tomorrow.length
          ? `<ul class="list">${d.tomorrow.map((x) => taskRow(x, x.kind, { showKind: true })).join('')}</ul>`
          : `<div class="empty">Nothing due tomorrow.</div>`}
      </div>
    </div>

    <div class="stack">
      ${whoopCard}
      ${vitalsCard()}
      <div class="card">
        <div class="card-head"><span class="eyebrow">Habits</span><span class="count">${d.habitsDone}/${S.habits.length} · <a href="#personal">MANAGE</a></span></div>
        ${S.habits.length
          ? `<div class="hgrid">${S.habits.map(habitPill).join('')}</div>`
          : `<div class="empty">No habits yet. <a href="#personal">Add your first one</a>.</div>`}
      </div>
    </div>
  </section>`;
}

let schoolFilter = 'all';
let schoolShowDone = false;

function viewSchool() {
  const t = todayISO();
  if (schoolFilter !== 'all' && !className(schoolFilter)) schoolFilter = 'all';
  const tasks = S.school.filter((x) => schoolFilter === 'all' || x.classId === schoolFilter);
  const open = tasks.filter((x) => !x.done).sort(byDue);
  const done = tasks.filter((x) => x.done).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const st = getCache().status || {};

  const groups = [
    { label: 'Overdue', cls: 'late', items: open.filter((x) => x.due && x.due < t) },
    { label: 'Today', items: open.filter((x) => x.due === t) },
    { label: 'Tomorrow', cls: 'soon', items: open.filter((x) => x.due === addDays(t, 1)) },
    { label: 'This week', items: open.filter((x) => x.due && x.due > addDays(t, 1) && x.due <= addDays(t, 6)) },
    { label: 'Later', items: open.filter((x) => x.due && x.due > addDays(t, 6)) },
    { label: 'No due date', items: open.filter((x) => !x.due) },
  ].filter((g) => g.items.length);

  const filters = S.classes.length
    ? `<div class="filters" role="toolbar" aria-label="Filter by class">
        <button class="filter ${schoolFilter === 'all' ? 'on' : ''}" data-act="filter" data-id="all">All</button>
        ${S.classes.map((c) => `<button class="filter ${schoolFilter === c.id ? 'on' : ''}" style="--c:${c.color}" data-act="filter" data-id="${c.id}"><i></i>${esc(c.name)}</button>`).join('')}
      </div>`
    : '';

  return `
  <header class="page-head">
    <div><div class="eyebrow">Academic ops${st.canvas ? ` · Canvas ${getCache().canvasAt ? ago(getCache().canvasAt) : 'linked'}` : ''}</div><h1>School</h1></div>
    <div class="actions">
      ${st.canvas ? `<button class="icon-btn" data-act="canvas-now" aria-label="Import from Canvas now" title="Import from Canvas">${ICON.sync}</button>` : ''}
      <button class="btn" data-act="classes">Classes</button>
      <button class="btn primary" data-act="new" data-kind="school">${ICON.plus}Task</button>
    </div>
  </header>
  ${filters}
  <div class="card">
    ${groups.length
      ? groups.map((g) => `
        <div class="section-label"><span class="eyebrow ${g.cls || ''}">${g.label}</span><span class="count mono" style="color:var(--muted);font-size:11px">${g.items.length}</span></div>
        <ul class="list">${g.items.map((x) => taskRow(x, 'school')).join('')}</ul>`).join('')
      : `<div class="empty"><b>No open assignments${schoolFilter !== 'all' ? ' for this class' : ''}.</b><br>${st.canvas ? 'Canvas is linked, so new assignments show up here automatically.' : 'Add one with <b>+ Task</b>, or link Canvas in <a href="#settings">Settings</a> to import them automatically.'}</div>`}
    ${done.length ? `
      <div class="section-label">
        <span class="eyebrow" style="color:var(--dim)">Completed · ${done.length}</span>
        <button class="btn ghost small" data-act="toggle-done-list">${schoolShowDone ? 'Hide' : 'Show'}</button>
      </div>
      ${schoolShowDone ? `<ul class="list">${done.slice(0, 50).map((x) => taskRow(x, 'school')).join('')}</ul>` : ''}` : ''}
  </div>
  ${weekScheduleCard()}`;
}

let calY = new Date().getFullYear();
let calM = new Date().getMonth();
let calSel = todayISO();

function viewCalendar() {
  const t = todayISO();
  const { start, days } = gridRange(calY, calM);
  const monthName = new Date(calY, calM, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const cache = getCache();
  const dueBy = {};
  S.school.forEach((x) => { if (!x.done && x.due) dueBy[x.due] = (dueBy[x.due] || 0) + 1; });

  const cells = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const dt = parse(d);
    const evs = [...eventsOn(d), ...classMeetings(d)];
    const cls = [
      'day',
      dt.getMonth() !== calM ? 'out' : '',
      d === t ? 'is-today' : '',
      d === calSel ? 'sel' : '',
    ].join(' ');
    cells.push(`<button class="${cls}" data-act="cal-day" data-day="${d}" aria-label="${dt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}: ${evs.length} events${dueBy[d] ? `, ${dueBy[d]} due` : ''}" aria-pressed="${d === calSel}">
      <span class="num">${dt.getDate()}</span>
      <span class="marks">${evs.slice(0, 3).map(() => '<i></i>').join('')}${dueBy[d] ? '<i class="due"></i>' : ''}</span>
      <span class="peek">${evs.slice(0, 2).map((ev) => `<em>${esc(ev.title)}</em>`).join('')}</span>
    </button>`);
  }

  const selDate = parse(calSel);
  const selSched = scheduleOn(calSel);
  const selDue = S.school.filter((x) => x.due === calSel).sort(byDue);
  const selPersonal = S.personal.filter((x) => x.due === calSel);
  const weekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2026, 1, i + 1).toLocaleDateString(undefined, { weekday: 'short' }));

  return `
  <header class="page-head">
    <div><div class="eyebrow">Command schedule</div><h1>Calendar</h1></div>
    <div class="actions">
      <button class="btn primary" data-act="new-event">${ICON.plus}Event</button>
    </div>
  </header>
  ${connected() ? (cache.eventsError ? `<div class="banner warn">Calendar: ${esc(cache.eventsError)}</div>` : '')
    : `<div class="banner">Connect Google in <a href="#settings">Settings</a> to see and edit your Google Calendar. School due dates already show here.</div>`}
  <div class="cal-layout">
    <div class="card cal">
      <div class="cal-head">
        <button class="icon-btn" data-act="cal-prev" aria-label="Previous month">${ICON.left}</button>
        <b>${monthName}</b>
        <button class="icon-btn" data-act="cal-next" aria-label="Next month">${ICON.right}</button>
        <button class="btn ghost small" data-act="cal-today">Today</button>
      </div>
      <div class="cal-grid">
        ${weekdays.map((w) => `<span class="wd">${w}</span>`).join('')}
        ${cells.join('')}
      </div>
      <div class="cal-legend"><span><i></i>Event or class</span><span><i class="due"></i>School due</span></div>
    </div>
    <div class="card">
      <div class="card-head"><span class="eyebrow">${esc(selDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}</span>
        <button class="btn small" data-act="new-event">${ICON.plus}Add</button></div>
      ${selSched.length ? `<ul class="list">${scheduleRows(calSel)}</ul>` : `<div class="empty">${connected() ? 'No events or classes.' : 'No classes. Google Calendar not connected.'}</div>`}
      ${selDue.length || selPersonal.length ? `
        <div class="section-label"><span class="eyebrow soon">Due</span></div>
        <ul class="list">${selDue.map((x) => taskRow(x, 'school')).join('')}${selPersonal.map((x) => taskRow(x, 'personal', { showKind: true })).join('')}</ul>` : ''}
    </div>
  </div>`;
}

function viewGrocery() {
  const open = S.grocery.filter((g) => !g.done);
  const got = S.grocery.filter((g) => g.done);
  const row = (g) => `<li class="task ${g.done ? 'done' : ''}">
    <button class="check" data-act="toggle" data-kind="grocery" data-id="${g.id}" aria-pressed="${!!g.done}" aria-label="${esc(g.title)}">${ICON.check}</button>
    <span class="task-body" style="padding-top:2px"><span class="task-title">${esc(g.title)}</span></span>
    <button class="icon-btn del" data-act="delete" data-kind="grocery" data-id="${g.id}" aria-label="Remove ${esc(g.title)}">${ICON.x}</button>
  </li>`;
  return `
  <header class="page-head">
    <div><div class="eyebrow">Supply run</div><h1>Grocery</h1></div>
  </header>
  <div class="card">
    <form class="addbar" data-form="grocery" autocomplete="off">
      <input name="title" placeholder="Add items (milk, eggs, rice…)" aria-label="Add grocery item" enterkeyhint="done">
      <button class="btn primary" type="submit">${ICON.plus}Add</button>
    </form>
    ${open.length ? `<ul class="list">${open.map(row).join('')}</ul>` : `<div class="empty">List is empty. Tip: add several at once with commas.</div>`}
    ${got.length ? `
      <div class="section-label"><span class="eyebrow" style="color:var(--dim)">In the cart · ${got.length}</span>
      <button class="btn ghost small" data-act="clear-grocery">Clear</button></div>
      <ul class="list">${got.map(row).join('')}</ul>` : ''}
  </div>`;
}

let personalShowDone = false;
function viewPersonal() {
  const open = S.personal.filter((x) => !x.done).sort(byDue);
  const done = S.personal.filter((x) => x.done).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const t = todayISO();
  return `
  <header class="page-head">
    <div><div class="eyebrow">Life ops</div><h1>Personal</h1></div>
  </header>
  <div class="grid two">
    <div class="card">
      <div class="card-head"><span class="eyebrow">Habits · ${S.habits.filter((h) => h.log[t]).length}/${S.habits.length} today</span><button class="btn small" data-act="new-habit">${ICON.plus}Habit</button></div>
      ${S.habits.length
        ? `<ul class="list">${S.habits.map((h) => habitRow(h)).join('')}</ul>`
        : `<div class="empty">Track daily habits and build streaks.</div>`}
    </div>
    <div class="card">
      <div class="card-head"><span class="eyebrow">Tasks</span><button class="btn small" data-act="new" data-kind="personal">${ICON.plus}With date</button></div>
      <form class="addbar" data-form="personal-quick" autocomplete="off">
        <input name="title" placeholder="Quick add a task…" aria-label="Quick add personal task" enterkeyhint="done">
        <button class="btn primary" type="submit" aria-label="Add task">${ICON.plus}</button>
      </form>
      ${open.length ? `<ul class="list">${open.map((x) => taskRow(x, 'personal')).join('')}</ul>` : `<div class="empty">No open tasks.</div>`}
      ${done.length ? `
        <div class="section-label"><span class="eyebrow" style="color:var(--dim)">Completed · ${done.length}</span>
        <button class="btn ghost small" data-act="toggle-personal-done">${personalShowDone ? 'Hide' : 'Show'}</button></div>
        ${personalShowDone ? `<ul class="list">${done.slice(0, 50).map((x) => taskRow(x, 'personal')).join('')}</ul>` : ''}` : ''}
    </div>
  </div>`;
}

function connectionsCard() {
  const conn = getConn();
  const c = getCache();
  const st = c.status || {};
  const on = connected();

  const google = on ? `
    <div class="conn">
      <div class="conn-head"><b>Google</b><span class="status ${syncStatus === 'error' ? 'off' : 'on'}">${syncStatus === 'error' ? 'ERROR' : 'ONLINE'}</span></div>
      <p>${st.email ? `Signed in as ${esc(st.email)}. ` : ''}Data syncs to <b>HQ data.json</b> in your Drive. Last sync ${ago(c.lastSync)}.</p>
      ${c.syncError && syncStatus === 'error' ? `<p class="err">${esc(c.syncError)}</p>` : ''}
      <div class="btn-row">
        <button class="btn small" data-act="sync-now">${ICON.sync}Sync now</button>
        <button class="btn small" data-act="pair">Pair your phone</button>
        <button class="btn ghost small" data-act="disconnect-google">Disconnect</button>
      </div>
    </div>` : `
    <div class="conn">
      <div class="conn-head"><b>Google</b><span class="status off">OFFLINE</span></div>
      <p>Syncs your data between phone and laptop, and connects Google Calendar. One-time setup, about 5 minutes.</p>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn small primary" data-act="setup-guide">Setup guide</button>
        <button class="btn small" data-act="copy-server">Copy server code</button>
      </div>
      <form class="addbar" data-form="connect-google" autocomplete="off">
        <input name="url" type="text" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="Server URL (…/exec) or pairing link" aria-label="HQ server URL or pairing link" required>
        <button class="btn primary" type="submit">Connect</button>
      </form>
    </div>`;

  const canvas = !on ? '' : st.canvas ? `
    <div class="conn">
      <div class="conn-head"><b>Canvas · VT</b><span class="status ${c.canvasError ? 'off' : 'on'}">${c.canvasError ? 'ERROR' : 'ONLINE'}</span></div>
      <p>${c.canvasCount != null ? `${c.canvasCount} items in your feed. ` : ''}Imported ${ago(c.canvasAt)}. Upcoming assignments are added to School automatically.</p>
      ${c.canvasError ? `<p class="err">${esc(c.canvasError)}</p>` : ''}
      <div class="btn-row">
        <button class="btn small" data-act="canvas-now">${ICON.sync}Import now</button>
        <button class="btn ghost small" data-act="disconnect-canvas">Disconnect</button>
      </div>
    </div>` : `
    <div class="conn">
      <div class="conn-head"><b>Canvas · VT</b><span class="status off">OFFLINE</span></div>
      <ol class="steps">
        <li>Open <a href="https://canvas.vt.edu/calendar" target="_blank" rel="noopener">canvas.vt.edu/calendar</a>.</li>
        <li>Bottom right: click <b>Calendar Feed</b> and copy the link.</li>
        <li>Paste it here.</li>
      </ol>
      <form class="addbar" data-form="connect-canvas" autocomplete="off" style="margin-top:10px">
        <input name="url" type="url" placeholder="https://canvas.vt.edu/feeds/calendars/user_….ics" aria-label="Canvas calendar feed link" required>
        <button class="btn primary" type="submit">Link</button>
      </form>
    </div>`;

  const outlook = !on ? '' : st.outlook ? `
    <div class="conn">
      <div class="conn-head"><b>Outlook · Teams</b><span class="status ${c.outlookError ? 'off' : 'on'}">${c.outlookError ? 'ERROR' : 'ONLINE'}</span></div>
      <p>Your VT calendar (classes, Teams meetings) shows on Today and Calendar, refreshed every 5 minutes. View only.</p>
      ${c.outlookError ? `<p class="err">${esc(c.outlookError)}</p>` : ''}
      <div class="btn-row">
        <button class="btn small" data-act="sync-now">${ICON.sync}Refresh</button>
        <button class="btn ghost small" data-act="disconnect-outlook">Disconnect</button>
      </div>
    </div>` : `
    <div class="conn">
      <div class="conn-head"><b>Outlook · Teams</b><span class="status off">OFFLINE</span></div>
      <ol class="steps">
        <li>Open <a href="https://outlook.office.com/calendar" target="_blank" rel="noopener">outlook.office.com</a> → ⚙ → Calendar → <b>Shared calendars</b>.</li>
        <li>Under <b>Publish a calendar</b>: Calendar, <b>Can view all details</b>, Publish.</li>
        <li>Copy the <b>ICS</b> link and paste it here.</li>
      </ol>
      <form class="addbar" data-form="connect-outlook" autocomplete="off" style="margin-top:10px">
        <input name="url" type="text" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://outlook.office365.com/owa/calendar/…/calendar.ics" aria-label="Outlook calendar ICS link" required>
        <button class="btn primary" type="submit">Link</button>
      </form>
    </div>`;

  const whoop = !on ? '' : st.whoop ? `
    <div class="conn">
      <div class="conn-head"><b>WHOOP</b><span class="status ${c.whoopError ? 'off' : 'on'}">${c.whoopError ? 'ERROR' : 'ONLINE'}</span></div>
      <p>Recovery, sleep and strain refresh every 5 minutes while HQ is open. Last ${ago(c.whoopAt)}.</p>
      ${c.whoopError ? `<p class="err">${esc(c.whoopError)}</p>` : ''}
      <div class="btn-row">
        <button class="btn small" data-act="whoop-now">${ICON.sync}Refresh</button>
        <button class="btn ghost small" data-act="disconnect-whoop">Disconnect</button>
      </div>
    </div>` : `
    <div class="conn">
      <div class="conn-head"><b>WHOOP</b><span class="status off">OFFLINE</span></div>
      <ol class="steps">
        <li>Go to <a href="https://developer-dashboard.whoop.com" target="_blank" rel="noopener">developer-dashboard.whoop.com</a>, sign in with your WHOOP account and create an app (any name, e.g. "HQ").</li>
        <li>Scopes: tick all six (recovery, cycles, sleep, workout, profile, body measurement).</li>
        <li>Redirect URL: paste <button class="linkish" data-act="copy-redirect">this (tap to copy)</button>, your HQ server URL.</li>
        <li>Copy the app's <b>Client ID</b> and <b>Client Secret</b> below and press Connect.</li>
      </ol>
      <form data-form="connect-whoop" autocomplete="off" style="margin-top:10px">
        <div class="row2">
          <label class="field"><span>Client ID</span><input name="clientId" required></label>
          <label class="field"><span>Client Secret</span><input name="clientSecret" type="password" required></label>
        </div>
        <button class="btn primary" type="submit">Connect WHOOP</button>
      </form>
      ${st.whoopApp ? `<p class="hint" style="margin-top:10px">Already approved in WHOOP? <button class="linkish" data-act="status-now">Check again</button></p>` : ''}
    </div>`;

  return `<div class="card span">
    <div class="card-head"><span class="eyebrow">Connections</span>${on ? `<span class="count">${esc(conn.url.replace(/^https:\/\/script\.google\.com\/macros\/s\/(.{6}).*$/, 'SERVER $1…'))}</span>` : ''}</div>
    <div class="conns">${google}${canvas}${outlook}${whoop}</div>
  </div>`;
}

function viewSettings() {
  const st = getCache().status || {};
  const modules = [
    ['Core · lists, habits, Today', true],
    ['Google sync + Calendar', connected()],
    ['Canvas (VT)', !!st.canvas],
    ['Outlook · Teams', !!st.outlook],
    ['WHOOP sleep + recovery', !!st.whoop],
    ['Class schedule', S.classes.some((c) => (c.slots || []).length) || 'Add times: School → Classes'],
    ['Email reminders', st.reminders != null || 'Turn on above'],
    ['Fuel · Money · Focus · Journal', true],
    ['Darko voice', !!SR],
  ];
  return `
  <header class="page-head">
    <div><div class="eyebrow">Control room</div><h1>Settings</h1></div>
  </header>
  <div class="grid two">
    ${connectionsCard()}
    <div class="card">
      <div class="card-head"><span class="eyebrow">Operator</span></div>
      <form data-form="settings" autocomplete="off">
        <label class="field"><span>Your name (Darko greets you with it)</span>
          <input name="name" value="${esc(S.settings.name)}" placeholder="e.g. Mo"></label>
        <button class="btn primary" type="submit">Save</button>
      </form>
      <div class="setting-row" style="margin-top:10px">
        <div><b>Classes</b><p>${S.classes.length} saved</p></div>
        <button class="btn" data-act="classes">Manage</button>
      </div>
    </div>

    ${remindersCard()}

    <div class="card">
      <div class="card-head"><span class="eyebrow">Darko</span></div>
      <label class="toggle"><input type="checkbox" data-act="voice-toggle" ${S.settings.voice ? 'checked' : ''}><span></span>Darko talks back</label>
      <p class="hint" style="margin-top:10px">Tap the mic button (bottom right) and speak. ${SR ? 'Voice works in this browser.' : 'This browser has no voice input, so type your command instead.'} Say <b>help</b> to hear what Darko can do.</p>
    </div>

    <div class="card">
      <div class="card-head"><span class="eyebrow">Modules</span><span class="count">v${VERSION}</span></div>
      <ul class="modules">${modules.map(([n, on]) => `<li><span>${n}${typeof on === 'string' ? `<small>${on}</small>` : ''}</span><span class="status ${on === true ? 'on' : 'off'}">${on === true ? 'ONLINE' : typeof on === 'string' ? 'NOT SET' : 'OFFLINE'}</span></li>`).join('')}</ul>
    </div>

    <div class="card">
      <div class="card-head"><span class="eyebrow">Install on iPhone</span></div>
      <ol class="steps">
        <li>Open HQ in <b>Safari</b>.</li>
        <li>Tap <b>Share</b> → <b>Add to Home Screen</b>.</li>
        <li>Open it from the home screen, then use <b>Pair your phone</b> from your laptop to sync.</li>
      </ol>
    </div>

    <div class="card">
      <div class="card-head"><span class="eyebrow">Data</span></div>
      <p class="hint" style="margin:0 0 12px">${connected() ? 'Your data is synced to Google Drive.' : 'Data is stored on this device until you connect Google.'} You can also export a backup.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-act="export">Export backup</button>
        <label class="btn" style="cursor:pointer">Import backup<input type="file" accept="application/json" data-act="import" hidden></label>
        <button class="btn danger" data-act="wipe">Erase all</button>
      </div>
    </div>
  </div>`;
}

/* ---------------- Class schedule ---------------- */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LETTER = { 1: 'M', 2: 'T', 3: 'W', 4: 'Th', 5: 'F', 6: 'Sa', 0: 'Su' };
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Your classes that meet on `day` (skipping any already on your Google Calendar at the same time).
function classMeetings(day) {
  const dow = parse(day).getDay();
  const evs = eventsOn(day);
  const out = [];
  for (const c of S.classes) {
    for (const sl of c.slots || []) {
      if (!(sl.days || []).includes(dow) || !sl.start || !sl.end) continue;
      const s = atTime(day, sl.start), e = atTime(day, sl.end);
      if (evs.some((ev) => !ev.allDay && Math.abs(ev.s - s) < 15 * 60000)) continue;
      out.push({ cls: c, title: c.name, s, e, where: sl.where || '' });
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

// Google events + class meetings for one day, in time order (all-day events first).
function scheduleOn(day) {
  const evs = eventsOn(day).map((ev) => ({ kind: 'event', ev, s: ev.allDay ? 0 : ev.s }));
  const cls = classMeetings(day).map((m) => ({ kind: 'class', m, s: m.s }));
  return [...evs, ...cls].sort((a, b) => a.s - b.s);
}

function classRow(m) {
  return `<li class="event ${m.e < Date.now() ? 'past' : ''}">
    <button class="event-body" data-act="edit-class" data-id="${m.cls.id}">
      <span class="event-time">${fmtTime(m.s)} – ${fmtTime(m.e)}</span>
      <span class="event-main" style="border-color:${m.cls.color}"><span class="event-title">${esc(m.title)} <span class="src">CLASS</span></span>
      ${m.where ? `<span class="event-loc">${ICON.pin}${esc(m.where)}</span>` : ''}</span>
    </button>
  </li>`;
}
const scheduleRows = (day) => scheduleOn(day).map((x) => (x.kind === 'event' ? eventRow(x.ev, day) : classRow(x.m))).join('');

function slotSummary(c) {
  return (c.slots || []).map((sl) => `${WEEK_ORDER.filter((d) => sl.days.includes(d)).map((d) => DAY_LETTER[d]).join('')} ${fmtHM(sl.start)}`).join(' · ');
}

function weekScheduleCard() {
  const has = S.classes.some((c) => (c.slots || []).length);
  if (!has) {
    return `<div class="card" style="margin-top:14px">
      <div class="card-head"><span class="eyebrow">Class schedule</span></div>
      <div class="empty">Add your weekly class times and they'll show on Today and the Calendar.<br><button class="btn small" style="margin-top:10px" data-act="classes">Set class times</button></div>
    </div>`;
  }
  const today = parse(todayISO()).getDay();
  const days = WEEK_ORDER.filter((d) => (d >= 1 && d <= 5) || S.classes.some((c) => (c.slots || []).some((sl) => sl.days.includes(d))));
  const rows = days.map((d) => {
    const items = [];
    S.classes.forEach((c) => (c.slots || []).forEach((sl) => { if (sl.days.includes(d)) items.push({ c, sl }); }));
    items.sort((a, b) => a.sl.start.localeCompare(b.sl.start));
    return `<div class="wk-row ${d === today ? 'today' : ''}">
      <span class="wk-day">${WEEKDAYS[d]}</span>
      <div class="wk-items">${items.length ? items.map(({ c, sl }) => `<button class="wk-item" style="--c:${c.color}" data-act="edit-class" data-id="${c.id}"><b>${esc(c.name)}</b><span>${fmtHM(sl.start)}–${fmtHM(sl.end)}${sl.where ? ` · ${esc(sl.where)}` : ''}</span></button>`).join('') : '<span class="wk-free">Free</span>'}</div>
    </div>`;
  }).join('');
  return `<div class="card" style="margin-top:14px">
    <div class="card-head"><span class="eyebrow">Class schedule</span><button class="btn ghost small" data-act="classes">Edit</button></div>
    ${rows}
  </div>`;
}

function slotRow(sl = { days: [], start: '', end: '', where: '' }) {
  return `<div class="slot">
    <div class="days" role="group" aria-label="Days">${WEEK_ORDER.map((d) => `<label><input type="checkbox" value="${d}" ${sl.days.includes(d) ? 'checked' : ''}><span>${DAY_LETTER[d]}</span></label>`).join('')}</div>
    <div class="slot-times">
      <input type="time" data-f="start" value="${sl.start}" aria-label="Starts">
      <span>to</span>
      <input type="time" data-f="end" value="${sl.end}" aria-label="Ends">
      <button type="button" class="icon-btn del" data-act="slot-remove" aria-label="Remove this time">${ICON.trash}</button>
    </div>
    <input data-f="where" value="${esc(sl.where)}" placeholder="Room (optional), e.g. McBryde 100" aria-label="Room">
  </div>`;
}

function classForm(c) {
  const slots = (c.slots || []).length ? c.slots : [undefined];
  return `<form data-form="class-edit" data-id="${c.id}" autocomplete="off">
    ${sheetHead('Class')}
    <label class="field"><span>Name</span><input name="name" required value="${esc(c.name)}"></label>
    <div class="field"><span>Weekly times</span>
      <div class="slots">${slots.map((sl) => slotRow(sl)).join('')}</div>
      <button type="button" class="btn small" data-act="slot-add">${ICON.plus}Add another time (e.g. a lab)</button>
    </div>
    <div class="sheet-actions">
      <button type="button" class="btn ghost" data-act="classes">Back</button>
      <button class="btn primary" type="submit">Save</button>
    </div>
  </form>`;
}

/* ---------------- Vitals on Today ---------------- */

const foodOn = (day) => S.food.filter((f) => f.date === day);
function fuelTotals(day) {
  return foodOn(day).reduce((a, f) => ({ kcal: a.kcal + num(f.kcal), p: a.p + num(f.p), c: a.c + num(f.c), f: a.f + num(f.f) }), { kcal: 0, p: 0, c: 0, f: 0 });
}
function moneyTotals(month) {
  const xs = S.money.filter((m) => monthOf(m.date) === month);
  const spent = xs.filter((m) => m.type !== 'income').reduce((a, m) => a + num(m.amount), 0);
  const income = xs.filter((m) => m.type === 'income').reduce((a, m) => a + num(m.amount), 0);
  return { xs, spent, income, net: income - spent };
}
const focusMinutes = (day) => S.focus.filter((f) => f.date === day).reduce((a, f) => a + num(f.minutes), 0);
const journalOf = (day) => S.journal.find((j) => j.id === `jr-${day}`);

function vitalsCard() {
  const t = todayISO();
  const fuel = fuelTotals(t);
  const goal = num(S.settings.kcalGoal) || 2200;
  const left = Math.round(goal - fuel.kcal);
  const m = moneyTotals(monthOf(t));
  const budget = num(S.settings.budget);
  const jr = journalOf(t);
  return `<div class="card">
    <div class="card-head"><span class="eyebrow">Vitals</span><span class="count">${jr && jr.text.trim() ? 'JOURNAL ✓' : '<a href="#journal">JOURNAL ›</a>'}</span></div>
    <div class="whoop">
      <a class="wstat" href="#fuel"><b style="color:${left < 0 ? 'var(--late)' : 'var(--text)'}">${Math.abs(left)}</b><span>kcal ${left < 0 ? 'over' : 'left'}</span></a>
      <a class="wstat" href="#fuel"><b>${Math.round(fuel.p)}<small>/${num(S.settings.proteinGoal)}g</small></b><span>Protein</span></a>
      <a class="wstat" href="#focus"><b>${focusMinutes(t)}<small>m</small></b><span>Focus</span></a>
      <a class="wstat" href="#money"><b style="color:${budget && m.spent > budget ? 'var(--late)' : budget && m.spent > budget * 0.8 ? 'var(--soon)' : 'var(--text)'}">${budget ? `${Math.round((m.spent / budget) * 100)}%` : usd(m.spent).replace('.00', '')}</b><span>${budget ? 'Budget used' : 'Spent · month'}</span></a>
    </div>
  </div>`;
}

/* ---------------- Fuel (food + macros) ---------------- */

let fuelDay = todayISO();

function macroBar(label, val, goal, color) {
  const pct = goal ? Math.min(100, (val / goal) * 100) : 0;
  return `<div class="mbar">
    <div class="mbar-top"><span>${label}</span><b>${Math.round(val)}<small> / ${goal} g</small></b></div>
    <div class="track"><i style="width:${pct}%;background:${color}"></i></div>
  </div>`;
}

function dayNav(prefix, day) {
  const t = todayISO();
  const label = day === t ? 'Today' : day === addDays(t, -1) ? 'Yesterday' : parse(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `<div class="daynav">
    <button class="icon-btn" data-act="${prefix}-prev" aria-label="Previous day">${ICON.left}</button>
    <button class="btn ghost small" data-act="${prefix}-today">${label}</button>
    <button class="icon-btn" data-act="${prefix}-next" aria-label="Next day" ${day >= t ? 'disabled' : ''}>${ICON.right}</button>
  </div>`;
}

function viewFuel() {
  const st = S.settings, t = todayISO();
  const tot = fuelTotals(fuelDay);
  const goal = num(st.kcalGoal) || 2200;
  const left = Math.round(goal - tot.kcal);
  const pct = Math.min(100, (tot.kcal / goal) * 100);
  const r = 50, c = 2 * Math.PI * r;
  const ringColor = tot.kcal > goal ? 'var(--late)' : tot.kcal >= goal * 0.9 ? 'var(--ok)' : 'var(--accent)';
  const items = foodOn(fuelDay).sort((a, b) => (a.created || 0) - (b.created || 0));
  const seen = new Set(), recent = [];
  [...S.food].sort((a, b) => (b.created || 0) - (a.created || 0)).forEach((f) => {
    const k = f.name.toLowerCase();
    if (!seen.has(k) && recent.length < 10) { seen.add(k); recent.push(f); }
  });
  const week = [6, 5, 4, 3, 2, 1, 0].map((i) => { const d = addDays(t, -i); return { d, k: fuelTotals(d).kcal }; });
  const max = Math.max(goal * 1.2, ...week.map((w) => w.k));
  const logged = week.filter((w) => w.k > 0);
  const avg = logged.length ? Math.round(logged.reduce((a, w) => a + w.k, 0) / logged.length) : 0;

  return `
  <header class="page-head">
    <div><div class="eyebrow">Fuel bay · goal ${goal} kcal</div><h1>Fuel</h1></div>
    <div class="actions">${dayNav('fuel', fuelDay)}<button class="btn" data-act="goals">Goals</button></div>
  </header>
  <div class="grid two">
    <div class="stack">
      <div class="card">
        <div class="fuel-top">
          <div class="power" role="img" aria-label="${Math.round(tot.kcal)} of ${goal} calories">
            <svg class="ring" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="${r}" class="ring-track"/>
              <circle cx="60" cy="60" r="${r}" class="ring-fill" style="stroke:${ringColor}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}"/>
            </svg>
            <div class="power-label"><b>${Math.abs(left)}</b><span>${left < 0 ? 'KCAL OVER' : 'KCAL LEFT'}</span></div>
          </div>
          <div class="macros">
            <div class="mbar-top big"><span>Eaten</span><b>${Math.round(tot.kcal)}<small> / ${goal} kcal</small></b></div>
            ${macroBar('Protein', tot.p, num(st.proteinGoal), 'var(--accent)')}
            ${macroBar('Carbs', tot.c, num(st.carbsGoal), 'var(--soon)')}
            ${macroBar('Fat', tot.f, num(st.fatGoal), '#f06bd0')}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><span class="eyebrow">Log food</span></div>
        <form data-form="food" autocomplete="off">
          <label class="field"><span>What</span><input name="name" required placeholder="e.g. Chicken rice bowl"></label>
          <div class="row4">
            <label class="field"><span>kcal</span><input name="kcal" inputmode="decimal" placeholder="650"></label>
            <label class="field"><span>Protein</span><input name="p" inputmode="decimal" placeholder="g"></label>
            <label class="field"><span>Carbs</span><input name="c" inputmode="decimal" placeholder="g"></label>
            <label class="field"><span>Fat</span><input name="f" inputmode="decimal" placeholder="g"></label>
          </div>
          <button class="btn primary" type="submit">${ICON.plus}Add${fuelDay !== t ? ` to ${parse(fuelDay).toLocaleDateString(undefined, { weekday: 'short' })}` : ''}</button>
        </form>
        ${recent.length ? `<div class="section-label"><span class="eyebrow" style="color:var(--muted)">Eat again · one tap</span></div>
          <div class="chips">${recent.map((f) => `<button class="filter" data-act="food-again" data-id="${f.id}">${esc(f.name)} <small>${Math.round(num(f.kcal))}</small></button>`).join('')}</div>` : ''}
      </div>
    </div>
    <div class="stack">
      <div class="card">
        <div class="card-head"><span class="eyebrow">${fuelDay === t ? 'Today' : esc(parse(fuelDay).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }))}</span><span class="count">${items.length} ITEMS</span></div>
        ${items.length ? `<ul class="list">${items.map((f) => `<li class="task">
          <span class="task-body"><span class="task-title">${esc(f.name)}</span>
          <span class="task-meta"><span>${Math.round(num(f.kcal))} kcal</span>${num(f.p) ? `<span>P ${num(f.p)}</span>` : ''}${num(f.c) ? `<span>C ${num(f.c)}</span>` : ''}${num(f.f) ? `<span>F ${num(f.f)}</span>` : ''}</span></span>
          <button class="icon-btn del" data-act="delete" data-kind="food" data-id="${f.id}" aria-label="Remove ${esc(f.name)}">${ICON.x}</button>
        </li>`).join('')}</ul>` : `<div class="empty">Nothing logged${fuelDay === t ? ' yet today' : ''}. Tip: tell Darko "ate eggs 300 calories 20 protein".</div>`}
      </div>
      <div class="card">
        <div class="card-head"><span class="eyebrow">Last 7 days</span><span class="count">AVG ${avg} KCAL</span></div>
        <div class="bars">
          <b class="goal-line" style="bottom:${(goal / max) * 100}%"><span>${goal}</span></b>
          ${week.map((w) => `<button class="bar ${w.d === fuelDay ? 'sel' : ''}" data-act="fuel-day" data-day="${w.d}" aria-label="${w.d}: ${Math.round(w.k)} kcal">
            <i class="${w.k > goal ? 'over' : ''}" style="height:${(w.k / max) * 100}%"></i><span>${parse(w.d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></button>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function goalsSheet() {
  const st = S.settings;
  return `<form data-form="goals" autocomplete="off">
    ${sheetHead('Fuel goals')}
    <label class="field"><span>Daily calories</span><input name="kcalGoal" inputmode="numeric" value="${num(st.kcalGoal)}"></label>
    <div class="row2">
      <label class="field"><span>Protein (g)</span><input name="proteinGoal" inputmode="numeric" value="${num(st.proteinGoal)}"></label>
      <label class="field"><span>Carbs (g)</span><input name="carbsGoal" inputmode="numeric" value="${num(st.carbsGoal)}"></label>
    </div>
    <label class="field"><span>Fat (g)</span><input name="fatGoal" inputmode="numeric" value="${num(st.fatGoal)}"></label>
    <p class="hint">You're cutting at 2200 kcal. A common rule of thumb for protein is about 1 g per pound of your goal body weight.</p>
    <div class="sheet-actions"><button type="button" class="btn ghost" data-act="goals-reset">Reset to 2200 cut</button><button class="btn primary" type="submit">Save</button></div>
  </form>`;
}

/* ---------------- Money ---------------- */

let moneyMonth = monthOf(todayISO());
const CATS = {
  expense: ['Food', 'Groceries', 'Transport', 'Shopping', 'Bills', 'School', 'Fun', 'Health', 'Other'],
  income: ['Job', 'Gift', 'Refund', 'Other'],
};
const CAT_COLOR = {
  Food: '#ff9f43', Groceries: '#3ddc97', Transport: '#3dd6f5', Shopping: '#f06bd0', Bills: '#ff5d6c',
  School: '#9d7bff', Fun: '#ffd23f', Health: '#4da3ff', Other: '#8395ab', Job: '#3ddc97', Gift: '#f06bd0', Refund: '#3dd6f5',
};
const catOptions = (type, sel = '') => CATS[type].map((c) => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');

function budgetState(spent, budget) {
  if (!budget) return '';
  const pct = (spent / budget) * 100;
  return pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
}

function viewMoney() {
  const t = todayISO();
  const { xs, spent, income, net } = moneyTotals(moneyMonth);
  const budget = num(S.settings.budget);
  const state = budgetState(spent, budget);
  const pct = budget ? Math.min(100, (spent / budget) * 100) : 0;
  const [y, mo] = moneyMonth.split('-').map(Number);
  const monthName = new Date(y, mo - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const isCur = moneyMonth === monthOf(t);
  const daysLeft = isCur ? new Date(y, mo, 0).getDate() - parse(t).getDate() + 1 : 0;
  const perDay = budget && isCur && spent < budget ? (budget - spent) / daysLeft : 0;

  const byCat = {};
  xs.filter((m) => m.type !== 'income').forEach((m) => { byCat[m.category] = (byCat[m.category] || 0) + num(m.amount); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const topCat = cats.length ? cats[0][1] : 1;

  const days = [...new Set(xs.map((m) => m.date))].sort().reverse();

  const banner = state === 'over'
    ? `<div class="banner danger"><b>Over budget</b> by ${usd(spent - budget)} this month.</div>`
    : state === 'warn'
      ? `<div class="banner warn">Heads up: you've used ${Math.round((spent / budget) * 100)}% of your ${usd(budget)} budget${isCur ? `, ${usd(budget - spent)} left for ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : ''}.</div>`
      : '';

  return `
  <header class="page-head">
    <div><div class="eyebrow">Treasury</div><h1>Money</h1></div>
    <div class="actions"><div class="daynav">
      <button class="icon-btn" data-act="money-prev" aria-label="Previous month">${ICON.left}</button>
      <button class="btn ghost small" data-act="money-now">${esc(monthName)}</button>
      <button class="icon-btn" data-act="money-next" aria-label="Next month" ${isCur ? 'disabled' : ''}>${ICON.right}</button>
    </div></div>
  </header>
  ${banner}
  <div class="grid two">
    <div class="stack">
      <div class="card">
        <div class="card-head"><span class="eyebrow">Budget</span><button class="btn ghost small" data-act="budget">${budget ? 'Change' : 'Set budget'}</button></div>
        <div class="money-big"><b class="${state}">${usd(spent)}</b><span>${budget ? `of ${usd(budget)} spent` : 'spent this month'}</span></div>
        ${budget ? `<div class="track big ${state}"><i style="width:${pct}%"></i></div>
          <p class="hint" style="margin:8px 0 0">${state === 'over' ? 'Try to hold spending until next month.' : isCur ? `About ${usd(perDay)} a day keeps you on budget.` : `${Math.round((spent / budget) * 100)}% of budget used.`}</p>`
          : `<p class="hint" style="margin:6px 0 0">Set a monthly limit and HQ warns you at 80% and when you go over.</p>`}
        <div class="whoop" style="margin-top:14px;grid-template-columns:repeat(3,1fr)">
          <div class="wstat"><b style="color:var(--ok)">${usd(income)}</b><span>Income</span></div>
          <div class="wstat"><b>${usd(spent)}</b><span>Spent</span></div>
          <div class="wstat"><b style="color:${net < 0 ? 'var(--late)' : 'var(--ok)'}">${usd(net)}</b><span>Net</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><span class="eyebrow">Add</span></div>
        <form data-form="money" autocomplete="off">
          <fieldset><div class="seg">
            <label><input type="radio" name="type" value="expense" checked><span>Expense</span></label>
            <label><input type="radio" name="type" value="income"><span>Income</span></label>
          </div></fieldset>
          <div class="row2">
            <label class="field"><span>Amount ($)</span><input name="amount" inputmode="decimal" required placeholder="12.50"></label>
            <label class="field"><span>Category</span><select name="category">${catOptions('expense')}</select></label>
          </div>
          <div class="row2">
            <label class="field"><span>Note</span><input name="note" placeholder="e.g. Chipotle"></label>
            <label class="field"><span>Date</span><input type="date" name="date" value="${isCur ? t : `${moneyMonth}-01`}"></label>
          </div>
          <button class="btn primary" type="submit">${ICON.plus}Add</button>
        </form>
      </div>
    </div>
    <div class="stack">
      <div class="card">
        <div class="card-head"><span class="eyebrow">Where it went</span></div>
        ${cats.length ? cats.map(([c, v]) => `<div class="mbar">
          <div class="mbar-top"><span>${esc(c)}</span><b>${usd(v)}</b></div>
          <div class="track"><i style="width:${(v / topCat) * 100}%;background:${CAT_COLOR[c] || 'var(--accent)'}"></i></div>
        </div>`).join('') : '<div class="empty">No spending logged this month.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><span class="eyebrow">Transactions</span><span class="count">${xs.length}</span></div>
        ${days.length ? days.map((d) => `
          <div class="section-label"><span class="eyebrow" style="color:var(--muted)">${esc(dueInfo(d).label === 'Today' ? 'Today' : parse(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}</span></div>
          <ul class="list">${xs.filter((m) => m.date === d).sort((a, b) => (b.created || 0) - (a.created || 0)).map((m) => `<li class="task">
            <span class="task-body"><span class="task-title">${esc(m.note || m.category)}</span>
            <span class="task-meta"><span class="chip" style="--c:${CAT_COLOR[m.category] || '#8395ab'}">${esc(m.category)}</span></span></span>
            <b class="amt ${m.type}">${m.type === 'income' ? '+' : '−'}${usd(num(m.amount))}</b>
            <button class="icon-btn del" data-act="delete" data-kind="money" data-id="${m.id}" aria-label="Remove">${ICON.x}</button>
          </li>`).join('')}</ul>`).join('') : '<div class="empty">Nothing here yet. Tip: tell Darko "spent 12 on lunch".</div>'}
      </div>
    </div>
  </div>`;
}

function budgetSheet() {
  return `<form data-form="budget" autocomplete="off">
    ${sheetHead('Monthly budget')}
    <label class="field"><span>Spending limit per month ($)</span><input name="budget" inputmode="decimal" value="${num(S.settings.budget) || ''}" placeholder="e.g. 600"></label>
    <p class="hint">HQ warns you at 80% and when you go over. Leave empty for no limit.</p>
    <div class="sheet-actions"><button class="btn primary" type="submit">Save</button></div>
  </form>`;
}

// Add a money entry and say something if it crossed a budget line.
function addMoney(entry) {
  const month = monthOf(entry.date);
  const budget = num(S.settings.budget);
  const before = moneyTotals(month).spent;
  S.money.push(entry);
  commit();
  if (entry.type === 'income' || !budget) return '';
  const after = before + num(entry.amount);
  if (after > budget && before <= budget) return `That puts you over budget by ${usd(after - budget)}.`;
  if (after >= budget * 0.8 && before < budget * 0.8) return `Heads up: ${Math.round((after / budget) * 100)}% of your budget used.`;
  if (after > budget) return `Still over budget, by ${usd(after - budget)}.`;
  return '';
}

/* ---------------- Focus (Pomodoro) ---------------- */

const FOCUS_KEY = 'hq.focus';
function getTimer() { try { return JSON.parse(localStorage.getItem(FOCUS_KEY)) || { phase: 'idle' }; } catch { return { phase: 'idle' }; } }
function setTimer(t) { try { localStorage.setItem(FOCUS_KEY, JSON.stringify(t)); } catch {} }
function timerLeft(t = getTimer()) {
  if (t.phase === 'idle') return (num(S.settings.focusMin) || 25) * 60000;
  return t.paused ? t.remaining : Math.max(0, t.endsAt - Date.now());
}
const clock = (ms) => { const s = Math.ceil(ms / 1000); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

let audioCtx = null;
function unlockAudio() {
  try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch {}
}
function beep() {
  if (!audioCtx) return;
  try {
    [0, 0.25, 0.5].forEach((d) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + d);
      g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + d + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + d); o.stop(audioCtx.currentTime + d + 0.22);
    });
  } catch {}
}
async function notify(title, body) {
  toast(`DARKO › ${title}. ${body}`);
  beep();
  try { navigator.vibrate?.([200, 100, 200]); } catch {}
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'hq-focus' });
      else new Notification(title, { body });
    }
  } catch {}
}

function focusStart(label = '', minutes = null) {
  unlockAudio();
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch {}
  const mins = minutes || num(S.settings.focusMin) || 25;
  setTimer({ phase: 'focus', endsAt: Date.now() + mins * 60000, total: mins * 60000, paused: false, label });
  focusTick(); softRender();
}
function focusPause() {
  const t = getTimer(); if (t.phase === 'idle' || t.paused) return;
  setTimer({ ...t, paused: true, remaining: Math.max(0, t.endsAt - Date.now()) }); focusTick(); render();
}
function focusResume() {
  unlockAudio();
  const t = getTimer(); if (!t.paused) return;
  setTimer({ ...t, paused: false, endsAt: Date.now() + t.remaining }); focusTick(); render();
}
function focusReset() { setTimer({ phase: 'idle' }); document.title = 'HQ'; focusTick(); softRender(); }

// End the current phase. A finished (or skipped) focus block is logged, then a break starts.
function finishPhase(t, early = false) {
  const cur = getTimer();
  if (cur.phase !== t.phase || cur.endsAt !== t.endsAt) return; // another tab already handled it
  if (t.phase === 'focus') {
    const elapsed = t.total - (early ? timerLeft(t) : 0);
    const mins = Math.floor(elapsed / 60000);
    if (mins >= 1) {
      const now = Date.now();
      S.focus.push({ id: uid(), date: todayISO(), minutes: mins, label: t.label || '', at: now, created: now, updated: now });
      save(S); scheduleSync();
    }
    const br = num(S.settings.breakMin) || 5;
    setTimer({ phase: 'break', endsAt: Date.now() + br * 60000, total: br * 60000, paused: false, label: t.label });
    if (!early) notify('Focus block done', `${mins} min logged. Take a ${br}-minute break.`);
  } else {
    setTimer({ phase: 'idle' });
    document.title = 'HQ';
    if (!early) notify('Break over', 'Ready for the next round?');
  }
  softRender();
}

function focusTick() {
  const t = getTimer();
  if (t.phase !== 'idle' && !t.paused && Date.now() >= t.endsAt) { finishPhase(t); return; }
  const left = timerLeft(t);
  const el = document.getElementById('focusClock');
  if (el) el.textContent = clock(left);
  const ring = document.getElementById('focusRing');
  if (ring && t.phase !== 'idle') {
    const c = 2 * Math.PI * 50;
    ring.style.strokeDashoffset = String(c * (left / t.total));
  }
  const pill = document.getElementById('focusPill');
  if (pill) {
    const show = t.phase !== 'idle' && route() !== 'focus';
    pill.hidden = !show;
    if (show) pill.innerHTML = `${ICON.focus}<span>${t.phase === 'break' ? 'Break' : 'Focus'} ${clock(left)}${t.paused ? ' · paused' : ''}</span>`;
  }
  if (t.phase !== 'idle' && !t.paused) document.title = `${clock(left)} · ${t.phase === 'break' ? 'Break' : 'Focus'} · HQ`;
}

function viewFocus() {
  const t = getTimer();
  const left = timerLeft(t);
  const day = todayISO();
  const r = 50, c = 2 * Math.PI * r;
  const offset = t.phase === 'idle' ? 0 : c * (left / t.total);
  const todays = S.focus.filter((f) => f.date === day).sort((a, b) => (b.at || 0) - (a.at || 0));
  const week = [6, 5, 4, 3, 2, 1, 0].map((i) => { const d = addDays(day, -i); return { d, m: focusMinutes(d) }; });
  const max = Math.max(60, ...week.map((w) => w.m));
  const weekTotal = week.reduce((a, w) => a + w.m, 0);
  const openTasks = [...S.school, ...S.personal].filter((x) => !x.done).sort(byDue).slice(0, 12);
  const phaseLabel = t.phase === 'focus' ? 'FOCUS' : t.phase === 'break' ? 'BREAK' : 'READY';

  return `
  <header class="page-head">
    <div><div class="eyebrow">Deep work chamber</div><h1>Focus</h1></div>
  </header>
  <div class="grid two">
    <div class="card focus-card">
      <div class="focus-dial ${t.phase} ${t.paused ? 'paused' : ''}">
        <svg class="ring" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="${r}" class="ring-track"/>
          <circle cx="60" cy="60" r="58" class="ring-ticks"/>
          <circle id="focusRing" cx="60" cy="60" r="${r}" class="ring-fill" stroke-dasharray="${c}" stroke-dashoffset="${offset}"/>
        </svg>
        <div class="power-label"><span>${phaseLabel}${t.paused ? ' · PAUSED' : ''}</span><b id="focusClock">${clock(left)}</b>${t.label ? `<span class="flabel">${esc(t.label)}</span>` : ''}</div>
      </div>
      ${t.phase === 'idle' ? `
        <form data-form="focus-start" class="focus-form" autocomplete="off">
          <input name="label" list="focusTasks" placeholder="What are you working on? (optional)" aria-label="What are you working on">
          <datalist id="focusTasks">${openTasks.map((x) => `<option value="${esc(x.title)}">`).join('')}</datalist>
          <button class="btn primary big" type="submit">${ICON.play}Start ${num(S.settings.focusMin) || 25} min</button>
        </form>`
      : `<div class="btn-row center">
          ${t.paused ? `<button class="btn primary big" data-act="focus-resume">${ICON.play}Resume</button>` : `<button class="btn big" data-act="focus-pause">${ICON.pause}Pause</button>`}
          <button class="btn big" data-act="focus-skip">${t.phase === 'focus' ? 'Finish early' : 'Skip break'}</button>
          <button class="btn ghost big" data-act="focus-reset">Stop</button>
        </div>`}
      <form data-form="focus-settings" class="focus-settings" autocomplete="off">
        <label>Focus <input name="focusMin" inputmode="numeric" value="${num(S.settings.focusMin) || 25}"> min</label>
        <label>Break <input name="breakMin" inputmode="numeric" value="${num(S.settings.breakMin) || 5}"> min</label>
        <button class="btn small" type="submit">Save</button>
      </form>
    </div>
    <div class="stack">
      <div class="card">
        <div class="card-head"><span class="eyebrow">Today</span><span class="count">${todays.length} BLOCKS · ${focusMinutes(day)} MIN</span></div>
        ${todays.length ? `<ul class="list">${todays.map((f) => `<li class="task">
          <span class="task-body"><span class="task-title">${esc(f.label || 'Focus block')}</span>
          <span class="task-meta"><span>${f.minutes} min</span><span>${fmtTime(f.at)}</span></span></span>
          <button class="icon-btn del" data-act="delete" data-kind="focus" data-id="${f.id}" aria-label="Remove">${ICON.x}</button>
        </li>`).join('')}</ul>` : '<div class="empty">No focus blocks yet today. Start one and HQ logs it when it ends.</div>'}
      </div>
      <div class="card">
        <div class="card-head"><span class="eyebrow">This week</span><span class="count">${Math.floor(weekTotal / 60)}H ${weekTotal % 60}M</span></div>
        <div class="bars">
          ${week.map((w) => `<div class="bar ${w.d === day ? 'sel' : ''}" aria-label="${w.d}: ${w.m} min"><i style="height:${(w.m / max) * 100}%"></i><span>${parse(w.d).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------------- Journal ---------------- */

let journalDay = todayISO();
const MOODS = [[1, 'Rough'], [2, 'Low'], [3, 'Okay'], [4, 'Good'], [5, 'Great']];
const PROMPTS = [
  'What went well today?',
  'What drained you today, and what gave you energy?',
  'One thing you learned today.',
  'What are you grateful for right now?',
  'What would make tomorrow great?',
  'How did you show up for your goals today?',
  "What's on your mind?",
];

function saveJournal(day, patch) {
  const now = Date.now();
  let j = journalOf(day);
  if (!j) { j = { id: `jr-${day}`, date: day, text: '', mood: 0, created: now }; S.journal.push(j); }
  Object.assign(j, patch, { updated: now });
  // Writing a real entry today checks off your "Journal" habit.
  if (day === todayISO() && (j.text || '').trim().length >= 20) {
    const h = S.habits.find((x) => x.id === 'hb-journal' || x.name.toLowerCase() === 'journal');
    if (h && !h.log[day]) { h.log[day] = true; h.updated = now; }
  }
  save(S); scheduleSync();
}

function journalStreak() {
  const has = (d) => { const j = journalOf(d); return j && j.text.trim(); };
  let d = todayISO();
  if (!has(d)) d = addDays(d, -1);
  let n = 0;
  while (has(d)) { n++; d = addDays(d, -1); }
  return n;
}

function viewJournal() {
  const j = journalOf(journalDay) || { text: '', mood: 0 };
  const t = todayISO();
  const prompt = PROMPTS[Math.abs(diffDays(journalDay, '2026-01-01')) % PROMPTS.length];
  const past = S.journal.filter((x) => x.text.trim() && x.date !== journalDay).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  const words = j.text.trim() ? j.text.trim().split(/\s+/).length : 0;
  const streakN = journalStreak();
  return `
  <header class="page-head">
    <div><div class="eyebrow">Captain's log${streakN ? ` · ${streakN}-day streak` : ''}</div><h1>Journal</h1></div>
    <div class="actions">${dayNav('journal', journalDay)}</div>
  </header>
  <div class="grid two">
    <div class="card span">
      <div class="card-head"><span class="eyebrow">${esc(parse(journalDay).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</span><span class="count" id="jSaved">${words ? `${words} WORDS · SAVED` : ''}</span></div>
      <div class="moods" role="group" aria-label="Mood">${MOODS.map(([v, l]) => `<button class="mood m${v} ${j.mood === v ? 'on' : ''}" data-act="journal-mood" data-mood="${v}" aria-pressed="${j.mood === v}"><i></i>${l}</button>`).join('')}</div>
      <form data-form="journal" autocomplete="off">
        <textarea name="text" class="journal-text" data-autosave="journal" rows="10" placeholder="${esc(prompt)}">${esc(j.text)}</textarea>
      </form>
      <p class="hint" style="margin:8px 0 0">Saves as you type. ${journalDay === t ? 'A real entry also checks off your Journal habit.' : ''}</p>
    </div>
  </div>
  ${past.length ? `<div class="card" style="margin-top:14px">
    <div class="card-head"><span class="eyebrow">Past entries</span><span class="count">${S.journal.filter((x) => x.text.trim()).length}</span></div>
    <ul class="list">${past.map((x) => `<li class="task"><button class="task-body" data-act="journal-open" data-day="${x.date}">
      <span class="task-title">${esc(parse(x.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}${x.mood ? ` <span class="mood-dot m${x.mood}"></span>` : ''}</span>
      <span class="task-meta"><span>${esc(x.text.trim().slice(0, 110))}${x.text.trim().length > 110 ? '…' : ''}</span></span>
    </button></li>`).join('')}</ul>
  </div>` : ''}`;
}

/* ---------------- More (phone hub) ---------------- */

function viewMore() {
  const t = todayISO();
  const m = moneyTotals(monthOf(t));
  const budget = num(S.settings.budget);
  const jr = journalOf(t);
  const timer = getTimer();
  const tiles = [
    ['grocery', 'Grocery', `${S.grocery.filter((g) => !g.done).length} to buy`],
    ['personal', 'Personal', `${S.personal.filter((x) => !x.done).length} open · habits ${S.habits.filter((h) => h.log[t]).length}/${S.habits.length}`],
    ['money', 'Money', budget ? `${usd(m.spent)} of ${usd(budget)}` : `${usd(m.spent)} this month`],
    ['focus', 'Focus', timer.phase !== 'idle' ? `Running · ${clock(timerLeft(timer))}` : `${focusMinutes(t)} min today`],
    ['journal', 'Journal', jr && jr.text.trim() ? 'Written today ✓' : 'Not written yet'],
    ['settings', 'Settings', 'Connections, reminders, data'],
  ];
  return `
  <header class="page-head"><div><div class="eyebrow">Armory</div><h1>More</h1></div></header>
  <div class="tiles">${tiles.map(([id, name, sub]) => `<a class="tile" href="#${id}">${ICON[id]}<b>${name}</b><span>${esc(sub)}</span></a>`).join('')}</div>`;
}

/* ---------------- Reminders (Settings) ---------------- */

function remindersCard() {
  const c = getCache();
  const st = c.status || {};
  if (!connected()) {
    return `<div class="card"><div class="card-head"><span class="eyebrow">Reminders</span></div>
      <p class="hint" style="margin:0">Connect Google first. Then HQ can email you every evening with what's due tomorrow.</p></div>`;
  }
  const on = st.reminders != null;
  const hour = on ? st.reminders : num(S.settings.reminderHour) || 20;
  const hours = [16, 17, 18, 19, 20, 21, 22, 23];
  return `<div class="card">
    <div class="card-head"><span class="eyebrow">Reminders</span><span class="status ${on ? 'on' : 'off'}">${on ? 'ON' : 'OFF'}</span></div>
    <p class="hint" style="margin:0 0 12px">Every evening your HQ server emails ${st.email ? `<b>${esc(st.email)}</b>` : 'you'} what's due tomorrow, anything still due today, the habits you have left, and a nudge if you haven't journaled. It only sends when there's something to say.</p>
    <form data-form="reminders" autocomplete="off">
      <label class="toggle"><input type="checkbox" name="on" ${on ? 'checked' : ''}><span></span>Daily email</label>
      <label class="field" style="margin-top:12px"><span>Send at</span><select name="hour">${hours.map((h) => `<option value="${h}" ${h === hour ? 'selected' : ''}>${fmtTime(new Date(2026, 0, 1, h).getTime())}</option>`).join('')}</select></label>
      <div class="btn-row"><button class="btn primary small" type="submit">Save</button><button type="button" class="btn small" data-act="test-reminder">Send a test now</button></div>
    </form>
    ${c.remindersError ? `<p class="err" style="margin-top:10px">${esc(c.remindersError)}</p>` : ''}
  </div>`;
}

/* ---------------- Darko ---------------- */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let darkoLog = [];
const EXAMPLES = [
  "What's due tomorrow?",
  'Add eggs and rice to grocery',
  'Ate chicken bowl 650 calories 45 protein',
  'Spent 12 on lunch',
  'Check off workout',
  'Start focus for physics',
  'How did I sleep?',
  'Remind me to call mom tomorrow',
];

function darkoSheet() {
  return `${sheetHead('Darko')}
    <div class="dlog" id="dlog">${darkoLogHtml()}</div>
    <form class="addbar darko-bar" data-form="darko" autocomplete="off">
      <button type="button" class="icon-btn mic" data-act="darko-mic" aria-label="Speak to Darko">${ICON.mic}</button>
      <input name="q" placeholder="Tell Darko…" aria-label="Command for Darko" enterkeyhint="send">
      <button class="btn primary" type="submit" aria-label="Send">${ICON.send}</button>
    </form>
    <div class="chips">${EXAMPLES.map((x) => `<button class="filter" data-act="darko-say" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
}
function darkoLogHtml() {
  if (!darkoLog.length) return `<div class="dmsg a"><b>DARKO</b>${SR ? 'Listening. Tap the mic any time, or type.' : 'Type a command below.'} Say <i>help</i> for the full list.</div>`;
  return darkoLog.slice(-8).map((x) => `<div class="dmsg ${x.who}">${x.who === 'a' ? '<b>DARKO</b>' : ''}${esc(x.text)}</div>`).join('');
}

const VIEWS = {
  today: viewToday, school: viewSchool, calendar: viewCalendar, grocery: viewGrocery, personal: viewPersonal,
  fuel: viewFuel, money: viewMoney, focus: viewFocus, journal: viewJournal, settings: viewSettings, more: viewMore,
};

/* ---------------- Render ---------------- */

function renderNav(r) {
  const t = todayISO();
  const badge = {
    school: S.school.filter((x) => !x.done && x.due && x.due < t).length,
    grocery: S.grocery.filter((g) => !g.done).length,
  };
  $('#nav').innerHTML = `
    <div class="brand">${ICON.emblem}<div><b>HQ</b><small id="syncState">${syncLabel()}</small></div></div>
    ${TABS.map((tab) => {
      const on = r === tab.id || (tab.id === 'more' && !TABS.find((x) => x.id === r)?.phone);
      const where = tab.phone ? '' : tab.phoneOnly ? 'phone-only' : 'desk-only';
      return `<a class="nav-item ${tab.id} ${where} ${on ? 'active' : ''}" href="#${tab.id}" ${r === tab.id ? 'aria-current="page"' : ''}>
      ${ICON[tab.id]}<span>${tab.label}</span>${badge[tab.id] ? `<span class="badge">${badge[tab.id]}</span>` : ''}
    </a>`;
    }).join('')}`;
}

function render() {
  pendingRender = false;
  const r = route();
  const view = $('#view');
  const sameRoute = r === lastRoute;
  view.classList.toggle('no-anim', sameRoute);
  renderNav(r);
  // Keep anything typed into forms on this page when it redraws (e.g. after a background sync).
  const kept = sameRoute ? [...view.querySelectorAll('form[data-form] [name]')]
    .filter((el) => el.type !== 'checkbox' && el.type !== 'radio' && el.value && el.form.dataset.form !== submitting)
    .map((el) => [el.form.dataset.form, el.name, el.value]) : [];
  view.innerHTML = VIEWS[r]();
  for (const [f, n, v] of kept) {
    const el = view.querySelector(`form[data-form="${f}"] [name="${n}"]`);
    if (el && !el.value) el.value = v;
  }
  if (!sameRoute) { window.scrollTo(0, 0); lastRoute = r; }
  if (r === 'calendar') ensureMonthLoaded(calY, calM);
}

// Background updates shouldn't wipe out something you're typing.
let pendingRender = false;
function softRender() {
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select') && $('#view').contains(a)) { pendingRender = true; return; }
  render();
}
document.addEventListener('focusout', () => {
  if (pendingRender) setTimeout(() => { if (pendingRender) softRender(); }, 50);
});

/* ---------------- Sheets (forms) ---------------- */

function openSheet(html, { focus = true } = {}) {
  const L = $('#sheet');
  L.innerHTML = `<div class="sheet-backdrop" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  L.hidden = false;
  requestAnimationFrame(() => L.classList.add('open'));
  if (focus) setTimeout(() => L.querySelector('input:not([type=radio]):not([type=checkbox]),select,textarea')?.focus(), 60);
}
function closeSheet() {
  const L = $('#sheet');
  L.classList.remove('open');
  setTimeout(() => { if (!L.classList.contains('open')) { L.hidden = true; L.innerHTML = ''; } }, 220);
}
const sheetHead = (title) => `<div class="sheet-head"><span class="eyebrow">${title}</span><button type="button" class="icon-btn" data-act="close" aria-label="Close">${ICON.x}</button></div>`;

function outlookSheet(ev) {
  const fmtDay = (iso) => parse(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const when = ev.allDay
    ? `${fmtDay(ev.start)}${ev.end && addDays(ev.start, 1) !== ev.end ? ` – ${fmtDay(addDays(ev.end, -1))}` : ''} · All day`
    : `${fmtDay(isoOf(new Date(ev.s)))} · ${fmtTime(ev.s)} – ${fmtTime(ev.e)}`;
  return `${sheetHead(/teams/i.test(ev.location) || ev.join ? 'Teams meeting' : 'Outlook event')}
    <h2 class="ro-title">${esc(ev.title)}</h2>
    <p class="ro-line">${when}</p>
    ${ev.location ? `<p class="ro-line">${ICON.pin} ${esc(ev.location)}</p>` : ''}
    ${ev.recurring ? '<p class="ro-line muted">Repeating meeting</p>' : ''}
    ${ev.notes ? `<p class="ro-notes">${esc(ev.notes)}</p>` : ''}
    <p class="hint">From your VT Outlook calendar. Change or cancel it in Outlook or Teams; HQ picks it up within 5 minutes.</p>
    <div class="sheet-actions">
      ${ev.join ? `<a class="btn primary" href="${esc(ev.join)}" target="_blank" rel="noopener">Join in Teams</a>` : `<a class="btn" href="https://teams.microsoft.com/v2/" target="_blank" rel="noopener">Open Teams</a>`}
    </div>`;
}

function taskForm(kind, t) {
  const isNew = !t;
  t = t || { title: '', classId: schoolFilter !== 'all' ? schoolFilter : '', due: route() === 'calendar' ? calSel : '', priority: 'med', notes: '' };
  const school = kind === 'school';
  return `<form data-form="task" data-kind="${kind}" data-id="${t.id || ''}" autocomplete="off">
    ${sheetHead(`${isNew ? 'New' : 'Edit'} ${school ? 'assignment' : 'task'}`)}
    <label class="field"><span>Title</span><input name="title" required value="${esc(t.title)}" placeholder="${school ? 'e.g. Lab 4 report' : 'e.g. Call the bank'}"></label>
    ${school ? `
      <div class="row2">
        <label class="field"><span>Class</span><select name="classId">
          <option value="">None</option>
          ${S.classes.map((c) => `<option value="${c.id}" ${c.id === t.classId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
        <label class="field"><span>Due</span><input type="date" name="due" value="${t.due || ''}"></label>
      </div>
      ${S.classes.length ? '' : `<p class="hint">No classes yet. <a href="#" data-act="classes">Add your classes</a> to tag assignments.</p>`}
      <fieldset><legend>Priority</legend><div class="seg">
        ${['high', 'med', 'low'].map((p) => `<label><input type="radio" name="priority" value="${p}" ${t.priority === p ? 'checked' : ''}><span>${PRI[p]} · ${p === 'med' ? 'Normal' : p[0].toUpperCase() + p.slice(1)}</span></label>`).join('')}
      </div></fieldset>`
    : `<label class="field"><span>Due (optional)</span><input type="date" name="due" value="${t.due || ''}"></label>`}
    <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Optional">${esc(t.notes)}</textarea></label>
    ${t.source === 'canvas' ? `<p class="hint">Imported from Canvas${t.dueTime ? `, due ${esc(t.dueTime)}` : ''}. ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">Open in Canvas ↗</a>` : ''}</p>` : ''}
    <div class="sheet-actions">
      ${isNew ? '' : `<button type="button" class="btn danger" data-act="delete" data-kind="${kind}" data-id="${t.id}">${ICON.trash}Delete</button>`}
      <button class="btn primary" type="submit">${isNew ? 'Add' : 'Save'}</button>
    </div>
  </form>`;
}

function eventForm(ev) {
  const isNew = !ev;
  const base = calSel || todayISO();
  let date = base, endDate = base, st = '09:00', en = '10:00';
  if (isNew) {
    const now = new Date();
    if (base === todayISO()) { const h = Math.min(now.getHours() + 1, 22); st = `${pad(h)}:00`; en = `${pad(h + 1)}:00`; }
  } else if (ev.allDay) {
    date = ev.start; endDate = addDays(ev.end, -1);
  } else {
    date = isoOf(new Date(ev.s)); endDate = date; st = hhmm(ev.s); en = hhmm(ev.e);
  }
  const allDay = !isNew && ev.allDay;
  return `<form data-form="event" data-key="${isNew ? '' : esc(eventKey(ev))}" class="${allDay ? 'allday' : ''}" autocomplete="off">
    ${sheetHead(isNew ? 'New event' : 'Edit event')}
    <label class="field"><span>Title</span><input name="title" required value="${esc(ev?.title)}" placeholder="e.g. CS 2114 office hours"></label>
    <label class="toggle"><input type="checkbox" name="allDay" ${allDay ? 'checked' : ''} data-act="allday"><span></span>All day</label>
    <div class="row2">
      <label class="field"><span data-date-label>${allDay ? 'Starts' : 'Date'}</span><input type="date" name="date" value="${date}" required></label>
      <label class="field only-allday"><span>Ends</span><input type="date" name="endDate" value="${endDate}"></label>
    </div>
    <div class="row2 only-timed">
      <label class="field"><span>Start</span><input type="time" name="start" value="${st}"></label>
      <label class="field"><span>End</span><input type="time" name="end" value="${en}"></label>
    </div>
    <label class="field"><span>Location</span><input name="location" value="${esc(ev?.location)}" placeholder="Optional"></label>
    <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Optional">${esc(ev?.notes)}</textarea></label>
    ${ev?.recurring ? `<p class="hint">This is a repeating event. Changes here apply to this one occurrence only.</p>` : ''}
    <div class="sheet-actions">
      ${isNew ? '' : `<button type="button" class="btn danger" data-act="delete-event" data-key="${esc(eventKey(ev))}">${ICON.trash}Delete</button>`}
      <button class="btn primary" type="submit">${isNew ? 'Add to Google' : 'Save'}</button>
    </div>
  </form>`;
}

function classesSheet() {
  return `${sheetHead('Classes')}
    ${S.classes.length ? `<div style="margin-bottom:14px">${S.classes.map((c) => `
      <div class="class-row">
        <button class="swatch" style="--c:${c.color}" data-act="class-color" data-id="${c.id}" aria-label="Change color for ${esc(c.name)}"></button>
        <button class="class-name" data-act="edit-class" data-id="${c.id}">${esc(c.name)}<small>${slotSummary(c) || 'Tap to add class times'}</small></button>
        <button class="icon-btn del" data-act="class-delete" data-id="${c.id}" aria-label="Delete ${esc(c.name)}">${ICON.trash}</button>
      </div>`).join('')}</div>` : `<p class="hint" style="margin:0 0 14px">Add each class once, e.g. <b>CS 2114</b>, <b>MATH 2214</b>. Canvas creates them for you automatically. Tap a color square to change it.</p>`}
    ${S.classes.length ? `<p class="hint">Tap a class to set its weekly times. They show on Today and the Calendar.</p>` : ''}
    <form class="addbar" data-form="class" autocomplete="off">
      <input name="name" placeholder="Class name" aria-label="Class name" required>
      <button class="btn primary" type="submit">${ICON.plus}Add</button>
    </form>`;
}

function habitForm(h) {
  const isNew = !h;
  return `<form data-form="habit" data-id="${h?.id || ''}" autocomplete="off">
    ${sheetHead(isNew ? 'New habit' : 'Edit habit')}
    <label class="field"><span>Habit</span><input name="name" required value="${esc(h?.name)}" placeholder="e.g. Gym, Read 20 min"></label>
    ${isNew ? '' : `<p class="hint">Current streak: ${streak(h)} days · ${Object.keys(h.log).length} total check-ins</p>`}
    <div class="sheet-actions">
      ${isNew ? '' : `<button type="button" class="btn danger" data-act="habit-delete" data-id="${h.id}">${ICON.trash}Delete</button>`}
      <button class="btn primary" type="submit">${isNew ? 'Add' : 'Save'}</button>
    </div>
  </form>`;
}

function setupGuide() {
  return `${sheetHead('Connect Google · 5 min')}
    <ol class="steps big">
      <li>On your laptop, tap <button class="linkish" data-act="copy-server">Copy server code</button>.</li>
      <li>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com → New project</a>. Name it <b>HQ server</b>.</li>
      <li>Delete what's in <b>Code.gs</b>, paste, and press <b>Save</b> (⌘S).</li>
      <li>In the function menu at the top pick <b>authorize</b> and press <b>▶ Run</b>. Approve the permissions. If Google says the app isn't verified, choose <b>Advanced → Go to HQ server</b>. It's your own script.</li>
      <li><b>Deploy → New deployment</b>, gear icon → <b>Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Press <b>Deploy</b>.</li>
      <li>Copy the <b>Web app URL</b> (ends in <code>/exec</code>) and paste it in Settings → Connect.</li>
    </ol>
    <p class="hint">Your data stays in your own Google account. HQ creates one file, <b>HQ data.json</b>, in your Drive.</p>`;
}

/* ---------------- Toast ---------------- */

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

async function copy(text, msg = 'Copied.') {
  try { await navigator.clipboard.writeText(text); toast(`DARKO › ${msg}`); }
  catch { prompt('Copy this:', text); }
}

/* ---------------- Actions ---------------- */

const actions = {
  toggle(el) {
    const { kind, id } = el.dataset;
    const t = findItem(kind, id);
    if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? todayISO() : null;
    t.updated = Date.now();
    commit();
    if (t.done && kind !== 'grocery') toast(pick(DONE_LINES));
  },
  edit(el) {
    const { kind, id } = el.dataset;
    const t = findItem(kind, id);
    if (t) openSheet(taskForm(kind, t), { focus: false });
  },
  new(el) { openSheet(taskForm(el.dataset.kind)); },
  delete(el) {
    const { kind, id } = el.dataset;
    removeItems(kind, [id]);
    commit();
    if (kind !== 'grocery') { closeSheet(); toast('DARKO › Deleted.'); }
  },
  close() { closeSheet(); },
  filter(el) { schoolFilter = el.dataset.id; render(); },
  'toggle-done-list'() { schoolShowDone = !schoolShowDone; render(); },
  'toggle-personal-done'() { personalShowDone = !personalShowDone; render(); },
  'clear-grocery'() { removeItems('grocery', S.grocery.filter((g) => g.done).map((g) => g.id)); commit(); },
  classes() { openSheet(classesSheet()); },
  'class-color'(el) {
    const c = className(el.dataset.id);
    c.color = CLASS_COLORS[(CLASS_COLORS.indexOf(c.color) + 1) % CLASS_COLORS.length];
    c.updated = Date.now();
    commit();
    $('#sheet .sheet').innerHTML = classesSheet();
  },
  'class-delete'(el) {
    const c = className(el.dataset.id);
    if (!confirm(`Delete class "${c.name}"? Its assignments stay, just untagged.`)) return;
    removeItems('classes', [c.id]);
    S.school.forEach((t) => { if (t.classId === c.id) { t.classId = ''; t.updated = Date.now(); } });
    commit();
    $('#sheet .sheet').innerHTML = classesSheet();
  },
  'new-habit'() { openSheet(habitForm()); },
  'edit-habit'(el) { openSheet(habitForm(S.habits.find((h) => h.id === el.dataset.id)), { focus: false }); },
  'habit-day'(el) {
    const h = S.habits.find((x) => x.id === el.dataset.id);
    const d = el.dataset.day;
    if (h.log[d]) delete h.log[d]; else h.log[d] = true;
    h.updated = Date.now();
    commit();
    if (h.log[d] && d === todayISO()) {
      const s = streak(h);
      toast(s > 1 ? `DARKO › ${h.name}: ${s}-day streak.` : `DARKO › ${h.name}: logged.`);
    }
  },
  'habit-delete'(el) {
    const h = S.habits.find((x) => x.id === el.dataset.id);
    if (!confirm(`Delete habit "${h.name}" and its history?`)) return;
    removeItems('habits', [h.id]);
    commit(); closeSheet();
  },

  // Calendar
  'cal-prev'() { calM--; if (calM < 0) { calM = 11; calY--; } render(); },
  'cal-next'() { calM++; if (calM > 11) { calM = 0; calY++; } render(); },
  'cal-today'() { const n = new Date(); calY = n.getFullYear(); calM = n.getMonth(); calSel = todayISO(); render(); },
  'cal-day'(el) {
    calSel = el.dataset.day;
    const d = parse(calSel);
    if (d.getMonth() !== calM) { calM = d.getMonth(); calY = d.getFullYear(); }
    render();
  },
  'event-full'(el) {
    calSel = todayISO();
    const text = el.closest('form')?.elements.text?.value.trim();
    openSheet(eventForm());
    if (text) { const t = $('#sheet [name=title]'); if (t) t.value = text; }
  },
  'new-event'() {
    if (!connected()) { toast('DARKO › Connect Google in Settings first.'); return; }
    openSheet(eventForm());
  },
  'edit-event'(el) {
    const ev = findEvent(el.dataset.key);
    if (ev?.readonly) { openSheet(outlookSheet(ev), { focus: false }); return; }
    if (ev) openSheet(eventForm(ev), { focus: false });
  },
  allday(el) {
    const f = el.closest('form');
    f.classList.toggle('allday', el.checked);
    f.querySelector('[data-date-label]').textContent = el.checked ? 'Starts' : 'Date';
  },
  async 'delete-event'(el) {
    const ev = findEvent(el.dataset.key);
    if (!ev || !confirm(`Delete "${ev.title}" from your Google Calendar?`)) return;
    el.disabled = true;
    try {
      await call('deleteEvent', { event: { id: ev.id, origStart: ev.start, origAllDay: ev.allDay } });
      setCache({ events: (getCache().events || []).filter((x) => eventKey(x) !== eventKey(ev)) });
      closeSheet(); render(); toast('DARKO › Event deleted.');
    } catch (e) { el.disabled = false; toast(`Calendar: ${e.message}`); }
  },

  // Connections
  'setup-guide'() { openSheet(setupGuide(), { focus: false }); },
  async 'copy-server'() {
    try {
      const code = await (await fetch('apps-script/Code.gs', { cache: 'no-store' })).text();
      await copy(code, 'Server code copied. Paste it into Apps Script.');
    } catch { toast('Could not load the server code.'); }
  },
  'copy-redirect'() { copy(getConn().url, 'Redirect URL copied.'); },
  'sync-now'() { refreshAll({ force: true }); toast('DARKO › Syncing…'); },
  pair() {
    const link = pairingLink();
    openSheet(`${sheetHead('Pair your phone')}
      <p class="hint" style="margin:0 0 12px">Open this link on your phone (AirDrop it or send it to yourself), in Safari. It connects that device to the same HQ server. Keep it private: anyone with it can see your HQ data.</p>
      <div class="pairbox mono">${esc(link)}</div>
      <div class="sheet-actions"><button class="btn primary" data-act="copy-pair">Copy link</button></div>`, { focus: false });
  },
  'copy-pair'() { copy(pairingLink(), 'Pairing link copied.'); },
  'disconnect-google'() {
    if (!confirm('Disconnect this device from Google? Your data stays here and in your Drive.')) return;
    setConn(null); clearCache(); loadedMonths.clear(); setSync('off'); render();
  },
  'canvas-now'() { importCanvas({ announce: true }); },
  async 'disconnect-outlook'() {
    if (!confirm('Stop showing your Outlook / Teams calendar?')) return;
    try {
      const { status } = await call('disconnect', { what: 'outlook' });
      setCache({ status, outlookError: '', events: (getCache().events || []).filter((ev) => ev.source !== 'outlook') });
      render();
    } catch (e) { toast(e.message); }
  },
  async 'disconnect-canvas'() {
    if (!confirm('Stop importing from Canvas? Assignments already imported stay.')) return;
    try { const { status } = await call('disconnect', { what: 'canvas' }); setCache({ status, canvasError: '' }); render(); } catch (e) { toast(e.message); }
  },
  'whoop-now'() { loadWhoop({ announce: true }); },
  async 'disconnect-whoop'() {
    if (!confirm('Disconnect WHOOP?')) return;
    try { const { status } = await call('disconnect', { what: 'whoop' }); setCache({ status, whoop: null, whoopError: '' }); render(); } catch (e) { toast(e.message); }
  },
  async 'status-now'() {
    try { const { status } = await call('status'); setCache({ status }); if (status.whoop) loadWhoop({ announce: true }); render(); } catch (e) { toast(e.message); }
  },

  export() {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hq-backup-${todayISO()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  wipe() {
    const msg = connected()
      ? 'Erase ALL HQ data, on every synced device and in your Drive file? This cannot be undone.'
      : 'Erase ALL HQ data on this device? This cannot be undone.';
    if (!confirm(msg)) return;
    const now = Date.now();
    const deleted = { ...S.deleted };
    COLLECTIONS.forEach((c) => S[c].forEach((x) => { deleted[x.id] = now; }));
    S = { ...defaults(), habits: [], deleted };
    commit(); toast('DARKO › Memory wiped.');
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  fn(el);
});

document.addEventListener('change', (e) => {
  if (e.target.matches('input[data-act=allday]')) { actions.allday(e.target); return; }
  if (e.target.matches('input[data-act=import]')) {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((txt) => {
      try {
        const data = JSON.parse(txt);
        if (!data || typeof data !== 'object' || !Array.isArray(data.school)) throw new Error('bad');
        if (!confirm('Replace everything on this device with this backup?')) return;
        const now = Date.now();
        S = { ...defaults(), ...data, deleted: data.deleted || {} };
        COLLECTIONS.forEach((c) => S[c].forEach((x) => { x.updated = now; })); // make the backup win on sync
        commit(); toast('DARKO › Backup restored.');
      } catch { alert('That file is not an HQ backup.'); }
    });
  }
});

// The form being submitted right now: a redraw caused by its own submit must not put the sent text back.
let submitting = null;
document.addEventListener('submit', (e) => {
  submitting = e.target.closest('form[data-form]')?.dataset.form || null;
  setTimeout(() => { submitting = null; }, 0);
}, true);

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fd = new FormData(f);
  const val = (k) => (fd.get(k) || '').toString().trim();
  const now = Date.now();
  const btn = f.querySelector('button[type=submit]');

  switch (f.dataset.form) {
    case 'grocery': {
      const items = val('title').split(',').map((s) => s.trim()).filter(Boolean);
      if (!items.length) return;
      items.forEach((title) => S.grocery.push({ id: uid(), title, done: false, created: now, updated: now }));
      commit();
      $('[data-form=grocery] input')?.focus();
      break;
    }
    case 'personal-quick': {
      const title = val('title');
      if (!title) return;
      S.personal.push({ id: uid(), title, due: '', notes: '', done: false, doneAt: null, created: now, updated: now });
      commit();
      $('[data-form=personal-quick] input')?.focus();
      break;
    }
    case 'task': {
      const { kind, id } = f.dataset;
      const fields = { title: val('title'), due: val('due'), notes: val('notes') };
      if (!fields.title) return;
      if (kind === 'school') { fields.classId = val('classId'); fields.priority = val('priority') || 'med'; }
      if (id) {
        const t = findItem(kind, id);
        if (fields.due !== t.due) fields.dueTime = '';
        Object.assign(t, fields, { updated: now });
      } else S[kind].push({ id: uid(), ...fields, done: false, doneAt: null, created: now, updated: now });
      commit(); closeSheet();
      toast(id ? 'DARKO › Updated.' : 'DARKO › Added to the board.');
      break;
    }
    case 'class': {
      const name = val('name');
      if (!name) return;
      S.classes.push({ id: uid(), name, color: CLASS_COLORS[S.classes.length % CLASS_COLORS.length], created: now, updated: now });
      commit();
      $('#sheet .sheet').innerHTML = classesSheet();
      $('#sheet [data-form=class] input')?.focus();
      break;
    }
    case 'habit': {
      const name = val('name');
      if (!name) return;
      const id = f.dataset.id;
      if (id) Object.assign(S.habits.find((h) => h.id === id), { name, updated: now });
      else S.habits.push({ id: uid(), name, log: {}, created: now, updated: now });
      commit(); closeSheet();
      break;
    }
    case 'settings': {
      S.settings = { ...S.settings, name: val('name'), updated: now };
      commit(); toast('DARKO › Profile saved.');
      break;
    }
    case 'event-quick': {
      const text = val('text');
      if (!text) return;
      if (!connected()) { toast('DARKO › Connect Google in Settings first.'); return; }
      const when = parseWhen(text);
      const date = when.due || todayISO();
      const tm = parseTimes(when.rest);
      const title = cap((tm ? tm.rest : when.rest).replace(/^(?:add|schedule|put)\s+/i, '').replace(/\s+(?:on|at)$/i, '').trim());
      if (!title) { toast('DARKO › What should I call it?'); return; }
      const d = parse(date);
      const ev = { title, location: '', notes: '', allDay: !tm };
      if (tm) {
        ev.start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), tm.start[0], tm.start[1]).getTime();
        ev.end = tm.end ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), tm.end[0], tm.end[1]).getTime() : ev.start + 3600000;
        if (ev.end <= ev.start) ev.end = ev.start + 3600000;
      } else { ev.start = date; ev.end = date; }
      f.reset();
      btn.disabled = true;
      try {
        await call('createEvent', { event: ev });
        const dayLabel = date === todayISO() ? 'today' : date === addDays(todayISO(), 1) ? 'tomorrow' : parse(date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
        toast(`DARKO › Added "${title}" ${dayLabel}${tm ? ` at ${fmtTime(ev.start)}` : ', all day'}.`, 4000);
        reloadEventsAround(date);
      } catch (err) {
        toast(`Calendar: ${err.message}`, 6000);
      }
      btn.disabled = false;
      break;
    }
    case 'event': {
      const allDay = fd.get('allDay') === 'on';
      const date = val('date');
      const ev = { title: val('title'), location: val('location'), notes: val('notes'), allDay };
      if (allDay) {
        ev.start = date;
        ev.end = val('endDate') && val('endDate') > date ? val('endDate') : date;
      } else {
        const [sh, sm] = (val('start') || '09:00').split(':').map(Number);
        const [eh, em] = (val('end') || '10:00').split(':').map(Number);
        const d = parse(date);
        ev.start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm).getTime();
        ev.end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em).getTime();
        if (ev.end <= ev.start) ev.end = ev.start + 3600000;
      }
      const old = f.dataset.key ? findEvent(f.dataset.key) : null;
      if (old) Object.assign(ev, { id: old.id, origStart: old.start, origAllDay: old.allDay });
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await call(old ? 'updateEvent' : 'createEvent', { event: ev });
        closeSheet();
        toast(old ? 'DARKO › Event updated.' : 'DARKO › Event added to Google Calendar.');
        reloadEventsAround(date);
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Try again';
        toast(`Calendar: ${err.message}`);
      }
      break;
    }
    case 'connect-google': {
      let url = val('url');
      const pairIdx = url.indexOf('#pair=');
      if (pairIdx >= 0) { await handlePairing(url.slice(pairIdx)); break; }
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec$/.test(url)) {
        toast('That should be the Web app URL ending in /exec');
        return;
      }
      const conn = { url, key: newKey() };
      btn.disabled = true; btn.textContent = 'Connecting…';
      try {
        const { status } = await call('hello', {}, conn);
        setConn(conn);
        setCache({ status });
        setSync('idle');
        toast('DARKO › Google connected. Syncing…');
        render();
        refreshAll({ force: true });
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Connect';
        toast(err.message);
      }
      break;
    }
    case 'connect-canvas': {
      btn.disabled = true; btn.textContent = 'Linking…';
      try {
        const { items } = await call('setCanvas', { url: val('url') });
        const added = applyCanvas(items);
        const { status } = await call('status');
        setCache({ status, canvasAt: Date.now(), canvasCount: items.length, canvasError: '' });
        toast(`DARKO › Canvas linked. ${added} upcoming assignment${added === 1 ? '' : 's'} imported.`);
        render();
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Link';
        toast(`Canvas: ${err.message}`);
      }
      break;
    }
    case 'connect-outlook': {
      btn.disabled = true; btn.textContent = 'Linking…';
      try {
        const { count, status } = await call('setOutlook', { url: val('url') });
        setCache({ status, outlookError: '' });
        loadedMonths.clear();
        toast(`DARKO › Outlook linked. ${count} event${count === 1 ? '' : 's'} in the next 30 days.`);
        render();
        refreshAll({ force: true });
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Link';
        toast(`Outlook: ${err.message}`, 8000);
      }
      break;
    }
    case 'connect-whoop': {
      btn.disabled = true; btn.textContent = 'Opening WHOOP…';
      // Open the tab right away (browsers block pop-ups opened after waiting on the network).
      const tab = window.open('', '_blank');
      try {
        const { authUrl } = await call('setWhoop', { clientId: val('clientId'), clientSecret: val('clientSecret'), redirect: getConn().url });
        const { status } = await call('status');
        setCache({ status });
        if (tab) { tab.opener = null; tab.location.href = authUrl; } else location.href = authUrl;
        toast('DARKO › Approve HQ in the WHOOP tab, then come back.');
        render();
      } catch (err) {
        if (tab) tab.close();
        btn.disabled = false; btn.textContent = 'Connect WHOOP';
        toast(`WHOOP: ${err.message}`);
      }
      break;
    }
  }
});

/* ---------------- Actions: schedule, Fuel, Money, Focus, Journal, Darko ---------------- */

const shiftDay = (day, n) => { const d = addDays(day, n); return d > todayISO() ? todayISO() : d; };
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

Object.assign(actions, {
  // Class schedule
  'edit-class'(el) { const c = className(el.dataset.id); if (c) openSheet(classForm(c), { focus: false }); },
  'slot-add'(el) { el.closest('form').querySelector('.slots').insertAdjacentHTML('beforeend', slotRow()); },
  'slot-remove'(el) { el.closest('.slot').remove(); },

  // Fuel
  'fuel-prev'() { fuelDay = shiftDay(fuelDay, -1); render(); },
  'fuel-next'() { fuelDay = shiftDay(fuelDay, 1); render(); },
  'fuel-today'() { fuelDay = todayISO(); render(); },
  'fuel-day'(el) { fuelDay = el.dataset.day; render(); },
  goals() { openSheet(goalsSheet(), { focus: false }); },
  'goals-reset'() {
    const { kcalGoal, proteinGoal, carbsGoal, fatGoal } = SETTING_DEFAULTS;
    S.settings = { ...S.settings, kcalGoal, proteinGoal, carbsGoal, fatGoal, updated: Date.now() };
    commit(); closeSheet(); toast('DARKO › Goals reset to a 2200 kcal cut.');
  },
  'food-again'(el) {
    const f = findItem('food', el.dataset.id);
    if (!f) return;
    const now = Date.now();
    S.food.push({ id: uid(), date: fuelDay, name: f.name, kcal: num(f.kcal), p: num(f.p), c: num(f.c), f: num(f.f), created: now, updated: now });
    commit();
    toast(`DARKO › ${f.name} logged. ${Math.round((num(S.settings.kcalGoal) || 2200) - fuelTotals(fuelDay).kcal)} kcal left.`);
  },

  // Money
  'money-prev'() { moneyMonth = shiftMonth(moneyMonth, -1); render(); },
  'money-next'() { const n = shiftMonth(moneyMonth, 1); if (n <= monthOf(todayISO())) { moneyMonth = n; render(); } },
  'money-now'() { moneyMonth = monthOf(todayISO()); render(); },
  budget() { openSheet(budgetSheet()); },

  // Focus
  'focus-pause'() { focusPause(); },
  'focus-resume'() { focusResume(); },
  'focus-skip'() { finishPhase(getTimer(), true); toast('DARKO › Moving on.'); },
  'focus-reset'() { focusReset(); },

  // Journal
  'journal-prev'() { journalDay = shiftDay(journalDay, -1); render(); },
  'journal-next'() { journalDay = shiftDay(journalDay, 1); render(); },
  'journal-today'() { journalDay = todayISO(); render(); },
  'journal-open'(el) { journalDay = el.dataset.day; render(); },
  'journal-mood'(el) {
    const v = Number(el.dataset.mood);
    const j = journalOf(journalDay);
    saveJournal(journalDay, { mood: j && j.mood === v ? 0 : v });
    render();
  },

  // Reminders
  async 'test-reminder'(el) {
    el.disabled = true; el.textContent = 'Sending…';
    try {
      await call('testReminder');
      setCache({ remindersError: '' });
      toast('DARKO › Test email sent. Check your inbox.');
    } catch (e) {
      setCache({ remindersError: reminderErr(e) });
      render();
    }
    el.disabled = false; el.textContent = 'Send a test now';
  },

  // Darko
  darko() { openSheet(darkoSheet(), { focus: !SR }); if (SR) listen(); },
  'darko-mic'() { listen(); },
  'darko-say'(el) { darkoAsk(el.dataset.text); },
});

function reminderErr(e) {
  const m = String(e.message || e);
  return /authori|permission|scope/i.test(m)
    ? 'Your HQ server needs one more permission. In Apps Script, pick "authorize" in the function menu, press Run and approve, then try again.'
    : m;
}

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.matches('form[data-form=money] input[name=type]')) {
    el.form.querySelector('select[name=category]').innerHTML = catOptions(el.value);
  }
  if (el.matches('input[data-act=voice-toggle]')) {
    S.settings = { ...S.settings, voice: el.checked, updated: Date.now() };
    save(S); scheduleSync();
    toast(el.checked ? 'DARKO › I\'ll talk back.' : 'DARKO › Going quiet.');
  }
});

let journalTimer = null;
document.addEventListener('input', (e) => {
  if (!e.target.matches('[data-autosave=journal]')) return;
  const text = e.target.value;
  const day = journalDay;
  const label = $('#jSaved');
  if (label) label.textContent = 'SAVING…';
  clearTimeout(journalTimer);
  journalTimer = setTimeout(() => {
    saveJournal(day, { text });
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const l = $('#jSaved');
    if (l) l.textContent = words ? `${words} WORDS · SAVED` : 'SAVED';
  }, 500);
});

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  const fd = new FormData(f);
  const val = (k) => (fd.get(k) || '').toString().trim();
  const now = Date.now();
  const btn = f.querySelector('button[type=submit]');

  switch (f.dataset.form) {
    case 'class-edit': {
      const c = className(f.dataset.id);
      if (!c) return;
      const slots = [...f.querySelectorAll('.slot')].map((row) => ({
        days: [...row.querySelectorAll('input[type=checkbox]:checked')].map((x) => Number(x.value)),
        start: row.querySelector('[data-f=start]').value,
        end: row.querySelector('[data-f=end]').value,
        where: row.querySelector('[data-f=where]').value.trim(),
      })).filter((sl) => sl.days.length && sl.start && sl.end);
      Object.assign(c, { name: val('name') || c.name, slots, updated: now });
      commit();
      $('#sheet .sheet').innerHTML = classesSheet();
      toast(slots.length ? `DARKO › ${c.name}: ${slotSummary(c)}.` : 'DARKO › Saved.');
      break;
    }
    case 'food': {
      const name = val('name');
      if (!name) return;
      S.food.push({ id: uid(), date: fuelDay, name, kcal: num(val('kcal')), p: num(val('p')), c: num(val('c')), f: num(val('f')), created: now, updated: now });
      commit();
      const left = Math.round((num(S.settings.kcalGoal) || 2200) - fuelTotals(fuelDay).kcal);
      toast(left >= 0 ? `DARKO › Logged. ${left} kcal left.` : `DARKO › Logged. ${-left} kcal over.`);
      $('[data-form=food] input[name=name]')?.focus();
      break;
    }
    case 'goals': {
      const g = (k) => Math.max(0, Math.round(num(val(k))));
      S.settings = { ...S.settings, kcalGoal: g('kcalGoal') || 2200, proteinGoal: g('proteinGoal'), carbsGoal: g('carbsGoal'), fatGoal: g('fatGoal'), updated: now };
      commit(); closeSheet(); toast('DARKO › Goals saved.');
      break;
    }
    case 'money': {
      const amount = Math.round(num(val('amount')) * 100) / 100;
      if (!amount) { toast('Enter an amount.'); return; }
      const type = val('type') === 'income' ? 'income' : 'expense';
      const date = val('date') || todayISO();
      const warn = addMoney({ id: uid(), date, type, amount, category: val('category') || 'Other', note: val('note'), created: now, updated: now });
      toast(warn ? `DARKO › ${warn}` : `DARKO › ${type === 'income' ? 'Income' : 'Expense'} logged.`);
      $('[data-form=money] input[name=amount]')?.focus();
      break;
    }
    case 'budget': {
      S.settings = { ...S.settings, budget: Math.max(0, Math.round(num(val('budget')) * 100) / 100), updated: now };
      commit(); closeSheet(); toast('DARKO › Budget saved.');
      break;
    }
    case 'focus-start': focusStart(val('label')); break;
    case 'focus-settings': {
      const fm = Math.min(180, Math.max(1, Math.round(num(val('focusMin'))) || 25));
      const bm = Math.min(60, Math.max(1, Math.round(num(val('breakMin'))) || 5));
      S.settings = { ...S.settings, focusMin: fm, breakMin: bm, updated: now };
      commit(); toast(`DARKO › ${fm} min focus, ${bm} min break.`);
      break;
    }
    case 'reminders': {
      const on = fd.get('on') === 'on';
      const hour = Number(val('hour')) || 20;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const { status } = await call('setReminders', { on, hour });
        setCache({ status, remindersError: '' });
        S.settings = { ...S.settings, remindersOn: on, reminderHour: hour, updated: now };
        commit();
        toast(on ? `DARKO › I'll email you every day at ${fmtTime(new Date(2026, 0, 1, hour).getTime())}.` : 'DARKO › Reminders off.');
      } catch (err) {
        setCache({ remindersError: reminderErr(err) });
        render();
      }
      break;
    }
    case 'darko': {
      const q = val('q');
      if (!q) { listen(); return; }
      f.reset();
      darkoAsk(q);
      break;
    }
  }
});

/* ---------------- Darko: voice + commands ---------------- */

let rec = null;
function listen() {
  if (!SR) { toast('Voice input is not available in this browser. Type instead.'); $('#sheet input[name=q]')?.focus(); return; }
  if (rec) { rec.stop(); return; }
  try { speechSynthesis.cancel(); } catch {}
  rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let heard = '';
  const input = $('#sheet input[name=q]');
  const mic = $('#sheet .mic');
  mic?.classList.add('live');
  rec.onresult = (e) => {
    heard = [...e.results].map((r) => r[0].transcript).join('');
    if (input) input.value = heard;
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Microphone is blocked. Allow it for this site, or type instead.');
  };
  rec.onend = () => {
    mic?.classList.remove('live');
    rec = null;
    const q = heard.trim();
    if (q) { if (input) input.value = ''; darkoAsk(q); }
  };
  try { rec.start(); } catch { rec = null; mic?.classList.remove('live'); }
}

function speak(text) {
  if (!S.settings.voice || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/›/g, ''));
    const voices = speechSynthesis.getVoices();
    const pref = ['Daniel', 'Alex', 'Google UK English Male', 'Aaron', 'Arthur', 'Fred'];
    u.voice = pref.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) || voices.find((v) => /^en/i.test(v.lang)) || null;
    u.rate = 1.05; u.pitch = 0.9;
    speechSynthesis.speak(u);
  } catch {}
}

function darkoAsk(q) {
  let reply;
  try { reply = darkoRun(q); } catch (e) { console.error(e); reply = 'Something went wrong on my end. Try again.'; }
  darkoLog.push({ who: 'q', text: q }, { who: 'a', text: reply });
  const box = $('#dlog');
  if (box) { box.innerHTML = darkoLogHtml(); box.scrollTop = box.scrollHeight; }
  else toast(`DARKO › ${reply}`);
  speak(reply);
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Pull a date out of a sentence: "tomorrow", "friday", "in 3 days", "today".
// "6pm", "at 6:30", "18:00", "6-7pm", "from 2 to 3:30pm" → { start: [h, m], end: [h, m] | null, rest }
function parseTimes(text) {
  const re = /(\s(?:at|@|from))?\s(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?(?:\s*(?:-|–|to|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?)?(?=\s)/i;
  const s = ` ${text} `;
  const m = s.match(re);
  if (!m) return null;
  const [, pre, h1, m1, ap1, h2, m2, ap2] = m;
  if (!pre && !ap1 && !ap2 && !m1) return null; // a bare number (e.g. "CS 2114") is not a time
  const to24 = (h, ap, fallback) => {
    h = Number(h);
    ap = (ap || fallback || '').toLowerCase()[0];
    if (ap === 'p' && h < 12) return h + 12;
    if (ap === 'a' && h === 12) return 0;
    if (!ap && h >= 1 && h <= 7) return h + 12; // "at 6" → 6 PM
    return h;
  };
  const sh = to24(h1, ap1, ap2), sm = Number(m1 || 0);
  if (sh > 23 || sm > 59) return null;
  let end = null;
  if (h2) {
    let eh = to24(h2, ap2, ap1), em = Number(m2 || 0);
    if (eh * 60 + em <= sh * 60 + sm && eh < 12) eh += 12;
    if (eh <= 23) end = [eh, em];
  }
  return { start: [sh, sm], end, rest: s.replace(m[0], ' ').replace(/\s+/g, ' ').trim() };
}

function parseWhen(text) {
  const t = todayISO();
  let s = ` ${text} `;
  const rules = [
    [/\s(?:due\s+)?(?:by\s+)?(?:today|tonight)(?=\s)/i, () => t],
    [/\s(?:due\s+)?(?:by\s+)?(?:tomorrow|tmrw|tmr)(?=\s)/i, () => addDays(t, 1)],
    [/\s(?:due\s+)?in\s+(\d+)\s+days?(?=\s)/i, (m) => addDays(t, Number(m[1]))],
    [/\s(?:due\s+)?(?:by\s+)?(?:on\s+|this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?=\s)/i, (m) => {
      const target = DAY_NAMES.indexOf(m[1].toLowerCase());
      const diff = (target - parse(t).getDay() + 7) % 7 || 7;
      return addDays(t, diff);
    }],
  ];
  for (const [re, fn] of rules) {
    const m = s.match(re);
    if (m) return { due: fn(m), rest: s.replace(m[0], ' ').replace(/\s+/g, ' ').replace(/\s+due\s*$/i, '').trim() };
  }
  return { due: '', rest: text.trim() };
}

// Best fuzzy match of a spoken phrase against a list of names.
function bestMatch(list, nameOf, q) {
  const nq = norm(q);
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  let best = null, bestScore = 0;
  for (const x of list) {
    const name = nameOf(x).toLowerCase();
    const nn = norm(name);
    let score = 0;
    if (nn === nq) score = 100;
    else if (nn.includes(nq) || (nn.length > 3 && nq.includes(nn))) score = 50;
    else {
      const hit = words.filter((w) => name.includes(w)).length;
      if (words.length && hit / words.length >= 0.5) score = hit * 10;
    }
    if (score > bestScore) { best = x; bestScore = score; }
  }
  return best;
}

function findClass(q) {
  const digits = q.match(/\d{4}/);
  if (digits) { const c = S.classes.find((x) => x.name.includes(digits[0])); if (c) return c; }
  return bestMatch(S.classes, (c) => c.name, q);
}

function guessCategory(note) {
  const n = ` ${note.toLowerCase()} `;
  const map = [
    ['Groceries', /grocer|kroger|walmart|food lion|aldi|trader|costco|target|market/],
    ['Food', /lunch|dinner|breakfast|coffee|starbucks|chipotle|pizza|restaurant|food|snack|cafe|mcdonald|chick|burger|sushi|drink|boba|uber eats|doordash/],
    ['Transport', /gas|uber|lyft|bus|parking|train|flight|car|fuel/],
    ['Bills', /rent|bill|phone|electric|internet|wifi|subscription|netflix|spotify|insurance/],
    ['School', /book|textbook|tuition|class|school|course|supplies|printing/],
    ['Shopping', /amazon|clothes|shoes|shirt|shopping|mall|nike/],
    ['Health', /gym|doctor|pharmacy|medicine|vitamin|protein powder|supplement/],
    ['Fun', /movie|game|concert|bowling|party|ticket|fun/],
  ];
  return (map.find(([, re]) => re.test(n)) || ['Other'])[0];
}

const listJoin = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const say = (items, max = 4) => listJoin(items.slice(0, max)) + (items.length > max ? `, plus ${items.length - max} more` : '');

const HELP = 'Try: add milk to grocery. Remind me to call mom tomorrow. Add homework lab report for PHYS 2334 due friday. Ate eggs 300 calories 20 protein. Spent 12 on lunch. Check off workout. Start focus. Journal: today was good. Or ask: what\'s due tomorrow, how did I sleep, calories left, how\'s my budget, what\'s next.';

function darkoRun(raw) {
  const text = raw.trim().replace(/^(?:hey\s+|ok\s+|okay\s+)?darko[,!.\s]*/i, '').replace(/[.!?]+$/, '').trim();
  const lower = text.toLowerCase();
  const T = todayISO();
  const now = Date.now();
  let m;
  if (!text) return "I'm listening.";

  if (/^(help|what can you do|commands|how do (?:i|you) work)/i.test(lower)) return HELP;
  if (/^(hi|hello|hey|yo|sup|what'?s up|good (?:morning|afternoon|evening))\b/i.test(lower)) return `${greeting()}. ${darkoStatus(todayData())}`;

  // Navigation
  if ((m = lower.match(/^(?:open|go to|show(?: me)?|take me to)\s+(?:the\s+|my\s+)?([a-z]+)(?:\s+(?:page|tab|screen))?$/))) {
    const alias = { groceries: 'grocery', shopping: 'grocery', food: 'fuel', calories: 'fuel', macros: 'fuel', budget: 'money', spending: 'money', timer: 'focus', pomodoro: 'focus', diary: 'journal', homework: 'school', assignments: 'school', classes: 'school', home: 'today', habits: 'personal', tasks: 'personal', schedule: 'calendar' };
    const tab = alias[m[1]] || m[1];
    if (TABS.some((x) => x.id === tab)) { closeSheet(); location.hash = `#${tab}`; return `Opening ${tab}.`; }
  }

  // Grocery
  if ((m = text.match(/^(?:add|put)\s+(.+?)\s+(?:to|on|in)\s+(?:the\s+|my\s+)?(?:grocery|groceries|shopping)(?:\s+list)?$/i)) || (m = text.match(/^(?:buy|we need|i need to buy)\s+(.+)$/i))) {
    const items = m[1].split(/,|\band\b|\s&\s/i).map((x) => x.trim()).filter(Boolean).map(cap);
    items.forEach((title) => S.grocery.push({ id: uid(), title, done: false, created: now, updated: now }));
    commit();
    return `Added ${listJoin(items)} to grocery.`;
  }

  // Budget / goals
  if ((m = lower.match(/^(?:set|change|make)\s+(?:my\s+|the\s+)?(?:monthly\s+)?budget\s+(?:to\s+)?\$?(\d+(?:\.\d+)?)/))) {
    S.settings.budget = parseFloat(m[1]); S.settings.updated = now; commit();
    return `Monthly budget set to ${usd(S.settings.budget)}. I'll warn you at 80 percent.`;
  }
  if ((m = lower.match(/^(?:set|change|make)\s+(?:my\s+|the\s+)?(?:daily\s+)?(calorie|kcal|protein|carbs?|fat)\s+goal\s+(?:to\s+)?(\d+)/))) {
    const key = { calorie: 'kcalGoal', kcal: 'kcalGoal', protein: 'proteinGoal', carb: 'carbsGoal', carbs: 'carbsGoal', fat: 'fatGoal' }[m[1]];
    S.settings[key] = parseInt(m[2], 10); S.settings.updated = now; commit();
    return `${cap(m[1] === 'kcal' ? 'calorie' : m[1])} goal set to ${m[2]}${key === 'kcalGoal' ? '' : ' grams'}.`;
  }

  // Food
  if ((m = text.match(/^(?:i\s+)?(?:just\s+)?(?:ate|had|eaten|eat|log(?:ged)?(?:\s+food)?)\s+(.+)$/i)) && !/^\s*(?:a\s+)?(?:meeting|class|call)\b/i.test(m[1])) {
    let body = ` ${m[1]} `;
    const grab = (re) => { const x = body.match(re); if (!x) return null; body = body.replace(x[0], ' '); return parseFloat(x[1]); };
    const kcal = grab(/(\d+(?:\.\d+)?)\s*(?:k?cals?|calories|kilocalories)\b/i);
    const p = grab(/(\d+(?:\.\d+)?)\s*(?:g|grams?)?\s*(?:of\s+)?protein\b/i);
    const c = grab(/(\d+(?:\.\d+)?)\s*(?:g|grams?)?\s*(?:of\s+)?carbs?\b/i);
    const f = grab(/(\d+(?:\.\d+)?)\s*(?:g|grams?)?\s*(?:of\s+)?fats?\b/i);
    let name = body.replace(/\s+/g, ' ').replace(/(?:\s*\b(?:with|and|plus)\b|\s*,)+\s*$/i, '').replace(/^\s*(?:a|an|some)\s+/i, '').trim();
    if (/^\d*$/.test(name)) name = '';
    const prev = name && [...S.food].reverse().find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (kcal == null && !prev) {
      return name ? `How many calories was ${name}? Say: ate ${name} 400 calories.` : 'Tell me what you ate and the calories, like: ate chicken bowl 650 calories 45 protein.';
    }
    const useOld = kcal == null && prev;
    const entry = {
      id: uid(), date: T, name: cap(name || prev?.name || 'Food'),
      kcal: kcal ?? num(prev.kcal), p: p ?? (useOld ? num(prev.p) : 0), c: c ?? (useOld ? num(prev.c) : 0), f: f ?? (useOld ? num(prev.f) : 0),
      created: now, updated: now,
    };
    S.food.push(entry);
    commit();
    const left = Math.round((num(S.settings.kcalGoal) || 2200) - fuelTotals(T).kcal);
    return `Logged ${entry.name}, ${Math.round(entry.kcal)} calories${entry.p ? ` and ${Math.round(entry.p)} grams of protein` : ''}. ${left >= 0 ? `${left} calories left today.` : `You're ${-left} over your goal.`}`;
  }
  if ((m = lower.match(/^log\s+(\d+(?:\.\d+)?)\s*(?:k?cals?|calories)$/))) {
    S.food.push({ id: uid(), date: T, name: 'Quick add', kcal: Number(m[1]), p: 0, c: 0, f: 0, created: now, updated: now });
    commit();
    return `Logged ${m[1]} calories. ${Math.round((num(S.settings.kcalGoal) || 2200) - fuelTotals(T).kcal)} left.`;
  }

  // Money
  if ((m = text.match(/^(?:i\s+)?(?:just\s+)?(?:spent|paid|spend)\s+\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks)?(?:\s+(?:on|for|at)\s+(.+))?$/i))) {
    const note = cap((m[2] || '').trim());
    const category = guessCategory(note);
    const warn = addMoney({ id: uid(), date: T, type: 'expense', amount: Number(m[1]), category, note, created: now, updated: now });
    return `Logged ${usd(Number(m[1]))}${note ? ` for ${note}` : ''} under ${category}. ${warn}`.trim();
  }
  if ((m = text.match(/^(?:i\s+)?(?:got paid|earned|made|received|income(?: of)?)\s+\$?\s?(\d+(?:\.\d{1,2})?)\s*(?:dollars?|bucks)?(?:\s+(?:from|for|at)\s+(.+))?$/i))) {
    const note = cap((m[2] || '').trim());
    addMoney({ id: uid(), date: T, type: 'income', amount: Number(m[1]), category: /gift|birthday/i.test(note) ? 'Gift' : 'Job', note, created: now, updated: now });
    return `Nice. ${usd(Number(m[1]))} income logged.`;
  }

  // Focus
  if ((m = text.match(/^(?:start|begin|let'?s)\s+(?:a\s+)?(?:focus|pomodoro|timer|study(?:ing)?)(?:\s+(?:session|block|timer))?(.*)$/i))) {
    let rest = m[1] || '';
    const mins = (rest.match(/(\d+)\s*(?:min|minutes?)/i) || [])[1];
    rest = rest.replace(/(?:for\s+)?\d+\s*(?:min|minutes?)/i, '').replace(/^\s*(?:for|on)\s+/i, '').trim();
    focusStart(cap(rest), mins ? Number(mins) : null);
    closeSheet();
    location.hash = '#focus';
    return `Focus started${mins ? ` for ${mins} minutes` : ''}${rest ? ` on ${rest}` : ''}. Go.`;
  }
  if (/^(?:stop|cancel|end|reset)\s+(?:the\s+)?(?:focus|pomodoro|timer)/i.test(lower)) { focusReset(); return 'Timer stopped.'; }
  if (/^pause\s+(?:the\s+)?(?:focus|pomodoro|timer)/i.test(lower)) { focusPause(); return 'Paused.'; }
  if (/^(?:resume|continue)\s+(?:the\s+)?(?:focus|pomodoro|timer)/i.test(lower)) { focusResume(); return 'Back to it.'; }

  // Journal
  if ((m = text.match(/^(?:journal|dear diary|note to self|write in (?:my\s+)?journal|add to (?:my\s+)?journal)[:,]?\s+(.+)$/i))) {
    const j = journalOf(T);
    const line = `${fmtTime(now)} — ${cap(m[1])}`;
    saveJournal(T, { text: j && j.text.trim() ? `${j.text.trimEnd()}\n${line}` : line });
    softRender();
    return "Saved to today's journal.";
  }

  // Check things off
  if ((m = text.match(/^(?:check off|tick off|mark|done with|i did|i finished|finished|complete|completed|did)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:as\s+)?(?:done|complete))?(?:\s+habit)?$/i))) {
    const q = m[1];
    const h = bestMatch(S.habits, (x) => x.name, q);
    if (h) {
      h.log[T] = true; h.updated = now; commit();
      const s = streak(h);
      return `${h.name} checked off.${s > 1 ? ` ${s}-day streak.` : ''}`;
    }
    const task = bestMatch([...S.school.map((x) => ({ x, kind: 'school' })), ...S.personal.map((x) => ({ x, kind: 'personal' }))].filter((o) => !o.x.done), (o) => o.x.title, q);
    if (task) { Object.assign(task.x, { done: true, doneAt: T, updated: now }); commit(); return `${task.x.title}: done. ${pick(['Nice work.', 'Target neutralized.', 'One less thing.'])}`; }
    const g = bestMatch(S.grocery.filter((x) => !x.done), (x) => x.title, q);
    if (g) { Object.assign(g, { done: true, updated: now }); commit(); return `${g.title} is in the cart.`; }
    return `I couldn't find "${q}" in your habits, tasks or grocery list.`;
  }

  // Add school work
  if ((m = text.match(/^(?:add|new)\s+(?:an?\s+)?(?:homework|assignment|hw|exam|quiz|test|project)\s+(.+)$/i))) {
    let { due, rest } = parseWhen(m[1]);
    let classId = '';
    const fm = rest.match(/\s+(?:for|in)\s+(.+)$/i);
    if (fm) { const c = findClass(fm[1]); if (c) { classId = c.id; rest = rest.slice(0, fm.index); } }
    if (!classId) { const c = findClass(rest); if (c && rest.toLowerCase().includes(c.name.toLowerCase().split(' ').pop())) classId = c.id; }
    const title = cap(rest.replace(/\s+due$/i, '').trim());
    S.school.push({ id: uid(), title, classId, due, dueTime: '', priority: 'med', notes: '', done: false, doneAt: null, created: now, updated: now });
    commit();
    return `Added ${title}${classId ? ` for ${className(classId).name}` : ''}${due ? `, due ${dueInfo(due).label.toLowerCase()}` : ''}.`;
  }
  // Add a personal task
  if ((m = text.match(/^(?:remind me to|add (?:a\s+)?task(?:\s+to)?|to-?do|add)\s+(.+)$/i))) {
    const { due, rest } = parseWhen(m[1]);
    const title = cap(rest);
    S.personal.push({ id: uid(), title, due, notes: '', done: false, doneAt: null, created: now, updated: now });
    commit();
    return `Added "${title}" to Personal${due ? `, ${dueInfo(due).label.toLowerCase()}` : ''}.`;
  }

  // Questions
  if (/\bdue\b|\bhomework\b|\bassignments?\b|what do i have to do/i.test(lower)) {
    const when = /tomorrow/.test(lower) ? 'tomorrow' : /week/.test(lower) ? 'week' : 'today';
    const end = when === 'week' ? addDays(T, 6) : when === 'tomorrow' ? addDays(T, 1) : T;
    const start = when === 'tomorrow' ? end : T;
    const items = [...S.school, ...S.personal].filter((x) => !x.done && x.due && x.due >= start && x.due <= end).sort(byDue);
    const overdue = [...S.school, ...S.personal].filter((x) => !x.done && x.due && x.due < T).length;
    const label = when === 'week' ? 'this week' : when;
    const base = items.length ? `${items.length} due ${label}: ${say(items.map((x) => x.title))}.` : `Nothing due ${label}.`;
    return base + (overdue && when === 'today' ? ` Also ${overdue} overdue.` : '');
  }
  if (/sleep|recover|whoop|hrv|strain|rested/i.test(lower)) {
    const w = whoopNow();
    if (!w || !w.rec) return 'No WHOOP data yet. Make sure WHOOP is connected in Settings.';
    const r = Math.round(w.rec.recovery);
    return `Recovery ${r} percent${r >= 67 ? ', green. Go hard.' : r >= 34 ? ', yellow. Steady day.' : ', red. Take it easy.'}${w.sl ? ` You slept ${hrsMin(w.sl.asleepMs).replace('h', ' hours').replace('m', ' minutes')}.` : ''}${w.cyc && w.cyc.strain != null ? ` Strain so far ${w.cyc.strain.toFixed(1)}.` : ''}`;
  }
  if (/calorie|protein|macro|carbs|eaten|fuel/i.test(lower)) {
    const tot = fuelTotals(T);
    const goal = num(S.settings.kcalGoal) || 2200;
    const left = Math.round(goal - tot.kcal);
    return `${Math.round(tot.kcal)} of ${goal} calories so far, ${left >= 0 ? `${left} left` : `${-left} over`}. Protein ${Math.round(tot.p)} of ${num(S.settings.proteinGoal)} grams.`;
  }
  if (/budget|spent|spend|spending|money|broke/i.test(lower)) {
    const { spent, income } = moneyTotals(monthOf(T));
    const budget = num(S.settings.budget);
    if (!budget) return `You've spent ${usd(spent)} this month${income ? ` and earned ${usd(income)}` : ''}. Set a budget on the Money page to get warnings.`;
    const leftB = budget - spent;
    return `${usd(spent)} of your ${usd(budget)} budget used, ${Math.round((spent / budget) * 100)} percent. ${leftB >= 0 ? `${usd(leftB)} left.` : `Over by ${usd(-leftB)}.`}`;
  }
  if (/next|schedule|class(?:es)? today|calendar|what do i have|agenda/i.test(lower)) {
    const tomorrowQ = /tomorrow/.test(lower);
    const day = tomorrowQ ? addDays(T, 1) : T;
    const items = scheduleOn(day).map((x) => (x.kind === 'class' ? x.m : x.ev)).filter((x) => tomorrowQ || x.allDay || x.e > now);
    if (!items.length) return tomorrowQ ? 'Nothing on the schedule tomorrow.' : 'Nothing else on your schedule today.';
    const fmt = (x) => (x.allDay ? `${x.title} all day` : `${x.title} at ${fmtTime(x.s)}`);
    return /next/.test(lower) && !tomorrowQ ? `Next up: ${fmt(items[0])}.` : `${tomorrowQ ? 'Tomorrow' : 'Still today'}: ${say(items.map(fmt))}.`;
  }
  if (/focus|studied|study time/i.test(lower)) {
    const t = getTimer();
    if (t.phase !== 'idle') return `${t.phase === 'break' ? 'Break' : 'Focus'} running, ${clock(timerLeft(t))} left.`;
    return `${focusMinutes(T)} minutes of focus today.`;
  }
  if (/habit|streak/i.test(lower)) {
    const left = S.habits.filter((h) => !h.log[T]).map((h) => h.name);
    const top = [...S.habits].sort((a, b) => streak(b) - streak(a))[0];
    return `${S.habits.length - left.length} of ${S.habits.length} habits done.${left.length ? ` Left: ${say(left)}.` : ' All done.'}${top && streak(top) > 1 ? ` Best streak: ${top.name}, ${streak(top)} days.` : ''}`;
  }
  if (/how am i|status|report|brief/i.test(lower)) return darkoStatus(todayData());

  return "I didn't catch that. Say help to hear what I can do.";
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
});

window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#pair=')) { handlePairing(); return; }
  closeSheet(); render();
});

// Keep multiple open tabs in sync, catch up when you come back, and roll over at midnight.
window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { S = load(); softRender(); } });
let renderedDay = todayISO();
let lastFocusRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (todayISO() !== renderedDay) { renderedDay = todayISO(); render(); }
  if (connected() && Date.now() - lastFocusRefresh > 30000) {
    lastFocusRefresh = Date.now();
    (async () => {
      try { const { status } = await call('status'); setCache({ status }); } catch {}
      refreshAll();
    })();
  }
});
// Every 5 minutes while HQ is open: sync your lists, reload the calendar and WHOOP.
setInterval(() => { if (!document.hidden) refreshAll(); }, 5 * 60000);

/* ---------------- Pairing a second device ---------------- */

async function handlePairing(hash = location.hash) {
  const conn = readPairing(hash.trim());
  if (location.hash.startsWith('#pair=')) history.replaceState(null, '', location.pathname + '#today');
  if (!conn) { toast('That pairing link is broken. Copy it again from your laptop: Settings → Pair your phone.', 8000); render(); return; }
  toast('DARKO › Pairing…');
  try {
    const { status } = await call('hello', {}, conn);
    setConn(conn);
    setCache({ status });
    setSync('idle');
    toast('DARKO › This device is paired. Syncing…');
    render();
    refreshAll({ force: true });
  } catch (e) {
    toast(`Pairing failed: ${e.message}`, 8000);
    render();
  }
}

/* ---------------- Boot sequence ---------------- */

function boot() {
  const el = $('#boot');
  let seen = false;
  try { seen = sessionStorage.getItem('hq.booted') === '1'; sessionStorage.setItem('hq.booted', '1'); } catch {}
  if (seen || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.remove(); return; }

  const d = todayData();
  const name = S.settings.name ? `, ${S.settings.name}` : '';
  const open = d.dueToday.filter((x) => !x.done).length;
  const w = whoopNow();
  const lines = [
    ['Initializing HQ…', ''],
    [connected() ? 'Uplink: Google · Canvas · WHOOP' : 'Linking modules: school · supply · personal', ''],
    ['Darko online.', 'ok'],
    [`Welcome back${name}.${w && w.rec ? ` Recovery ${Math.round(w.rec.recovery)}%.` : ''} ${d.overdue.length ? `${d.overdue.length} overdue, ` : ''}${open} due today.`, 'greet'],
  ];
  const log = $('#bootLog');
  const timers = lines.map(([txt, cls], i) => setTimeout(() => {
    const div = document.createElement('div');
    div.textContent = txt;
    if (cls) div.className = cls;
    log.appendChild(div);
  }, 250 + i * 380));

  const finish = () => {
    timers.forEach(clearTimeout);
    el.classList.add('out');
    setTimeout(() => el.remove(), 500);
  };
  const auto = setTimeout(finish, 2300);
  el.addEventListener('click', () => { clearTimeout(auto); finish(); }, { once: true });
}

/* ---------------- Start ---------------- */

document.body.insertAdjacentHTML('beforeend',
  `<a class="focus-pill" id="focusPill" href="#focus" hidden></a>
   <button class="darko-fab" data-act="darko" aria-label="Talk to Darko">${ICON.mic}</button>`);
focusTick();
setInterval(focusTick, 1000);

if (location.hash.startsWith('#pair=')) handlePairing();
else render();
boot();
save(S);
refreshAll();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      // Look for a new version whenever the app comes back to the front, and every 30 minutes.
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      setInterval(check, 30 * 60000);
    }).catch(() => {});
    // A new version took over: reload once to show it (unless you're in the middle of typing).
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      const reload = () => { if (reloading) return; reloading = true; location.reload(); };
      const a = document.activeElement;
      if (a && a.matches('input, textarea') && a.value) document.addEventListener('focusout', () => setTimeout(reload, 100), { once: true });
      else reload();
    });
  });
}
