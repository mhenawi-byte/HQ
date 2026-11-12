// Talks to your HQ server (the Google Apps Script web app in your Google account).
// The connection (server URL + secret key) stays on this device only; it is never synced.

const CONN_KEY = 'hq.conn';
const CACHE_KEY = 'hq.cache';

export function getConn() {
  try { return JSON.parse(localStorage.getItem(CONN_KEY)) || {}; } catch { return {}; }
}
export function setConn(c) {
  try { if (c) localStorage.setItem(CONN_KEY, JSON.stringify(c)); else localStorage.removeItem(CONN_KEY); } catch {}
}
export const connected = () => !!getConn().url;

// Small local cache for things that come from Google/Canvas/WHOOP (so the app shows them offline).
export function getCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
export function setCache(patch) {
  const c = { ...getCache(), ...patch };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
  return c;
}
export function clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch {} }

export function newKey() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function call(action, payload = {}, conn = getConn()) {
  if (!conn.url) throw new Error('Google is not connected yet');
  let res;
  try {
    res = await fetch(conn.url, {
      method: 'POST',
      // text/plain keeps this a "simple" request, which Apps Script accepts from any site.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key: conn.key, ...payload }),
      redirect: 'follow',
    });
  } catch {
    throw new Error('Could not reach your HQ server (offline, or the URL is wrong)');
  }
  let data;
  try { data = await res.json(); } catch {
    throw new Error('The HQ server did not answer correctly. Check the deployment: Execute as "Me", access "Anyone".');
  }
  if (!data.ok) throw new Error(data.error || 'Server error');
  return data;
}

// Pairing link: lets your phone join with the same server + key (the key sits after #, so it is never sent to any server).
export function pairingLink(conn = getConn()) {
  const base = location.origin + location.pathname;
  return `${base}#pair=${btoa(JSON.stringify({ u: conn.url, k: conn.key }))}`;
}
export function readPairing(hash) {
  const m = hash.match(/^#pair=(.+)$/);
  if (!m) return null;
  try { const { u, k } = JSON.parse(atob(decodeURIComponent(m[1]))); return u && k ? { url: u, key: k } : null; } catch { return null; }
}
