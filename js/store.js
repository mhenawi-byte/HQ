// HQ data store.
// Data lives in this device's localStorage and, once Google is connected,
// syncs through your own Apps Script server to a file in your Google Drive.
// Every item carries an `updated` timestamp and deletions leave a tombstone
// in `deleted`, so two devices can merge their changes safely.

const KEY = 'hq.v1';

export const COLLECTIONS = ['classes', 'school', 'grocery', 'personal', 'habits', 'food', 'money', 'focus', 'journal'];

// Settings you can change. New ones get their default when an older copy of the data is loaded.
export const SETTING_DEFAULTS = {
  name: '',
  kcalGoal: 2200, proteinGoal: 180, carbsGoal: 200, fatGoal: 70, // cutting
  budget: 0,            // monthly spending limit in dollars (0 = no limit)
  focusMin: 35, breakMin: 5,
  remindersOn: false, reminderHour: 20,
  voice: true,          // Darko talks back
};

// Your habits. Fixed ids so every device seeds the same ones (no duplicates after sync).
const STARTER_HABITS = [
  ['hb-wake-early', 'Wake up early'],
  ['hb-workout', 'Workout'],
  ['hb-quran', 'Read Quran'],
  ['hb-morning-routine', 'Morning routine'],
  ['hb-night-routine', 'Night routine'],
  ['hb-no-phone', 'No phone first hour'],
  ['hb-water', 'Drink 2L water'],
  ['hb-journal', 'Journal'],
  ['hb-all-tasks', 'Finish all tasks for the day'],
  ['hb-stretch', 'Stretch'],
  ['hb-vitamins', 'Vitamins'],
  ['hb-nofap', 'No fap'],
  ['hb-witr', 'Pray witr'],
  ['hb-dua', 'Pray du7a'],
];

const starterHabits = () => STARTER_HABITS.map(([id, name]) => ({ id, name, log: {}, created: 0, updated: 0 }));

export const defaults = () => ({
  v: 1,
  settings: { ...SETTING_DEFAULTS, updated: 0 },
  classes: [],   // { id, name, color, slots: [{ days: [1,3,5], start: '10:10', end: '11:00', where }] }
  school: [],    // { id, title, classId, due, dueTime, priority, notes, done, doneAt, source, url, created, updated }
  grocery: [],   // { id, title, done, created, updated }
  personal: [],  // { id, title, due, notes, done, doneAt, created, updated }
  habits: starterHabits(), // { id, name, log: { 'YYYY-MM-DD': true }, created, updated }
  food: [],      // { id, date, name, kcal, p, c, f, created, updated }
  money: [],     // { id, date, type: 'expense'|'income', amount, category, note, created, updated }
  focus: [],     // { id, date, minutes, label, at, created, updated }   (finished focus sessions)
  journal: [],   // { id: 'jr-YYYY-MM-DD', date, text, mood (1-5), created, updated }
  deleted: {},   // { id: timestampDeleted }
  habitsSeeded: true,
});

export function load() {
  let s;
  try {
    const raw = localStorage.getItem(KEY);
    s = raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
  } catch {
    s = defaults();
  }
  s.deleted = s.deleted || {};
  s.settings = { ...SETTING_DEFAULTS, ...(s.settings || {}) };
  COLLECTIONS.forEach((c) => { if (!Array.isArray(s[c])) s[c] = []; });
  // People who opened HQ before the starter habits existed get them once.
  if (!s.habitsSeeded) {
    const have = new Set(s.habits.map((h) => h.id));
    starterHabits().forEach((h) => { if (!have.has(h.id) && !s.deleted[h.id]) s.habits.push(h); });
    s.habitsSeeded = true;
  }
  return s;
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('HQ: could not save', e);
  }
}

export const STORAGE_KEY = KEY;

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Merge two copies of the data. Newest `updated` wins per item; tombstones remove items.
// The exact same function runs on the server (apps-script/Code.gs).
export function merge(a, b) {
  const out = { v: 1, habitsSeeded: true };
  out.deleted = { ...(a.deleted || {}) };
  for (const [id, t] of Object.entries(b.deleted || {})) out.deleted[id] = Math.max(out.deleted[id] || 0, t);
  const sa = a.settings || {}, sb = b.settings || {};
  out.settings = { ...SETTING_DEFAULTS, ...((sb.updated || 0) > (sa.updated || 0) ? sb : sa) };
  // Every list of items is merged, including ones a newer version of HQ added.
  const lists = new Set(COLLECTIONS);
  for (const src of [a, b]) for (const [k, v] of Object.entries(src || {})) if (Array.isArray(v) && k !== 'deleted') lists.add(k);
  for (const c of lists) {
    const map = new Map();
    for (const x of a[c] || []) map.set(x.id, x);
    for (const x of b[c] || []) {
      const cur = map.get(x.id);
      if (!cur || (x.updated || 0) > (cur.updated || 0)) map.set(x.id, x);
    }
    out[c] = [...map.values()].filter((x) => !(out.deleted[x.id] && out.deleted[x.id] >= (x.updated || 0)));
  }
  return out;
}
