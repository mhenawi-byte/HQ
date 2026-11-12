/**
 * HQ server — runs in YOUR Google account as a Google Apps Script web app.
 *
 * It does five things for the HQ app:
 *   1. Sync: keeps one copy of your HQ data in a file in your Google Drive ("HQ data.json").
 *   2. Calendar: reads, creates, edits and deletes events on your Google Calendar.
 *   3. Canvas: downloads your Canvas calendar feed and returns your assignments.
 *   4. WHOOP: connects to WHOOP and returns recovery, sleep and strain.
 *   5. Reminders: emails you once a day with what's due tomorrow (and a journal nudge).
 *
 * Nothing to edit here. Paste this whole file into a new Apps Script project,
 * deploy it as a web app (Execute as: Me, Who has access: Anyone),
 * and paste the web app URL into HQ → Settings → Connections.
 * The first HQ device that connects sets the secret key; after that only
 * requests carrying that key are answered.
 */

var PROPS = PropertiesService.getScriptProperties();
var DATA_FILE_NAME = 'HQ data.json';
var WHOOP_AUTH = 'https://api.prod.whoop.com/oauth/oauth2/auth';
var WHOOP_TOKEN = 'https://api.prod.whoop.com/oauth/oauth2/token';
var WHOOP_API = 'https://api.prod.whoop.com/developer/v2';
var COLLECTIONS = ['classes', 'school', 'grocery', 'personal', 'habits', 'food', 'money', 'focus', 'journal'];

/* ------------------------------------------------------------------ */
/* Entry points                                                         */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.code || p.error) return whoopCallback_(p);
  return HtmlService.createHtmlOutput(page_('HQ server is running', 'Paste this page\'s URL into HQ → Settings → Connections.'));
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var stored = PROPS.getProperty('KEY');

    if (req.action === 'hello') {
      if (!stored) {
        if (!req.key || String(req.key).length < 24) throw new Error('Key too short');
        PROPS.setProperty('KEY', req.key);
      } else if (stored !== req.key) {
        throw new Error('Wrong key. Use the pairing link from a device that is already connected.');
      }
      return json_({ ok: true, status: status_() });
    }

    if (!stored || stored !== req.key) throw new Error('Unauthorized');

    switch (req.action) {
      case 'status': return json_({ ok: true, status: status_() });
      case 'sync': return json_({ ok: true, state: sync_(req.state) });
      case 'events': return json_({ ok: true, events: listEvents_(req.from, req.to) });
      case 'createEvent': return json_({ ok: true, event: eventOut_(createEvent_(req.event)) });
      case 'updateEvent': return json_({ ok: true, event: eventOut_(updateEvent_(req.event)) });
      case 'deleteEvent': deleteEvent_(req.event); return json_({ ok: true });
      case 'setCanvas': return json_({ ok: true, items: setCanvas_(req.url) });
      case 'canvas': return json_({ ok: true, items: canvas_() });
      case 'setWhoop': return json_({ ok: true, authUrl: setWhoop_(req) });
      case 'whoop': return json_({ ok: true, whoop: whoop_() });
      case 'disconnect': disconnect_(req.what); return json_({ ok: true, status: status_() });
      case 'setReminders': setReminders_(req.on, req.hour); return json_({ ok: true, status: status_() });
      case 'testReminder': return json_({ ok: true, sent: sendReminders(true) });
      default: throw new Error('Unknown action: ' + req.action);
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function page_(title, body) {
  return '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:-apple-system,system-ui,sans-serif;background:#05070b;color:#e6eef8;min-height:100vh;margin:-8px;padding:48px 24px;text-align:center">' +
    '<div style="font:800 28px sans-serif;color:#3b9cff;letter-spacing:2px">HQ</div>' +
    '<h2>' + title + '</h2><p style="color:#8395ab">' + body + '</p></div>';
}

function status_() {
  return {
    canvas: !!PROPS.getProperty('CANVAS_URL'),
    whoop: !!PROPS.getProperty('WHOOP_REFRESH'),
    whoopApp: !!PROPS.getProperty('WHOOP_CLIENT_ID'),
    reminders: reminderTrigger_() ? Number(PROPS.getProperty('REMINDER_HOUR') || 20) : null,
    tz: Session.getScriptTimeZone(),
    email: Session.getEffectiveUser().getEmail(),
  };
}

function disconnect_(what) {
  if (what === 'canvas') PROPS.deleteProperty('CANVAS_URL');
  if (what === 'whoop') ['WHOOP_ACCESS', 'WHOOP_REFRESH', 'WHOOP_EXPIRES', 'WHOOP_STATE'].forEach(function (k) { PROPS.deleteProperty(k); });
}

/* ------------------------------------------------------------------ */
/* 1. Sync                                                              */
/* ------------------------------------------------------------------ */

function dataFile_() {
  var id = PROPS.getProperty('DATA_FILE');
  if (id) {
    try { return DriveApp.getFileById(id); } catch (e) { /* file deleted: make a new one */ }
  }
  var f = DriveApp.createFile(DATA_FILE_NAME, '{}', 'application/json');
  PROPS.setProperty('DATA_FILE', f.getId());
  return f;
}

function sync_(clientState) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var file = dataFile_();
    var server = {};
    try { server = JSON.parse(file.getBlob().getDataAsString() || '{}'); } catch (e) { server = {}; }
    var merged = merge_(server, clientState || {});
    file.setContent(JSON.stringify(merged));
    return merged;
  } finally {
    lock.releaseLock();
  }
}

// Same rules as merge() in js/store.js.
function merge_(a, b) {
  var out = { v: 1, habitsSeeded: true, deleted: {} };
  var id;
  var da = a.deleted || {}, db = b.deleted || {};
  for (id in da) out.deleted[id] = da[id];
  for (id in db) out.deleted[id] = Math.max(out.deleted[id] || 0, db[id]);
  var sa = a.settings || {}, sb = b.settings || {};
  out.settings = (sb.updated || 0) > (sa.updated || 0) ? sb : sa;
  // Every list of items is merged, including ones a newer version of HQ added.
  var lists = COLLECTIONS.slice();
  [a, b].forEach(function (src) {
    for (var k in src) if (k !== 'deleted' && Object.prototype.toString.call(src[k]) === '[object Array]' && lists.indexOf(k) < 0) lists.push(k);
  });
  lists.forEach(function (c) {
    var order = [], map = {};
    (a[c] || []).forEach(function (x) { if (!map[x.id]) order.push(x.id); map[x.id] = x; });
    (b[c] || []).forEach(function (x) {
      var cur = map[x.id];
      if (!cur) { order.push(x.id); map[x.id] = x; }
      else if ((x.updated || 0) > (cur.updated || 0)) map[x.id] = x;
    });
    out[c] = order.map(function (k) { return map[k]; }).filter(function (x) {
      return !(out.deleted[x.id] && out.deleted[x.id] >= (x.updated || 0));
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Google Calendar                                                   */
/* ------------------------------------------------------------------ */

function cal_() { return CalendarApp.getDefaultCalendar(); }
function tz_() { return cal_().getTimeZone(); }
function ymd_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function parseYmd_(s) { return Utilities.parseDate(s, tz_(), 'yyyy-MM-dd'); }

function eventOut_(ev) {
  var allDay = ev.isAllDayEvent();
  var desc = ev.getDescription() || '';
  return {
    id: ev.getId(),
    title: ev.getTitle() || '(No title)',
    allDay: allDay,
    start: allDay ? ymd_(ev.getAllDayStartDate()) : ev.getStartTime().getTime(),
    end: allDay ? ymd_(ev.getAllDayEndDate()) : ev.getEndTime().getTime(), // all-day end is exclusive
    location: ev.getLocation() || '',
    notes: desc.length > 2000 ? desc.slice(0, 2000) + '…' : desc,
    recurring: ev.isRecurringEvent(),
  };
}

function listEvents_(from, to) {
  return cal_().getEvents(new Date(from), new Date(to)).map(eventOut_);
}

// Finds one specific event (for recurring events: the instance that starts at `start`).
function findEvent_(e) {
  var single = cal_().getEventById(e.id);
  if (single && !single.isRecurringEvent()) return single;
  var at = e.origAllDay ? parseYmd_(e.origStart) : new Date(e.origStart);
  var list = cal_().getEvents(new Date(at.getTime() - 1000), new Date(at.getTime() + 86400000));
  for (var i = 0; i < list.length; i++) if (list[i].getId() === e.id) return list[i];
  if (single) return single;
  throw new Error('Event not found');
}

function createEvent_(e) {
  var opts = { location: e.location || '', description: e.notes || '' };
  if (e.allDay) {
    var start = parseYmd_(e.start);
    var end = parseYmd_(e.end || e.start);
    if (end.getTime() > start.getTime()) return cal_().createAllDayEvent(e.title, start, new Date(end.getTime() + 86400000), opts);
    return cal_().createAllDayEvent(e.title, start, opts);
  }
  return cal_().createEvent(e.title, new Date(e.start), new Date(e.end), opts);
}

function updateEvent_(e) {
  var ev = findEvent_(e);
  ev.setTitle(e.title);
  ev.setLocation(e.location || '');
  ev.setDescription(e.notes || '');
  if (e.allDay) {
    var start = parseYmd_(e.start), end = parseYmd_(e.end || e.start);
    if (end.getTime() > start.getTime()) ev.setAllDayDates(start, new Date(end.getTime() + 86400000));
    else ev.setAllDayDate(start);
  } else {
    ev.setTime(new Date(e.start), new Date(e.end));
  }
  return ev;
}

function deleteEvent_(e) { findEvent_(e).deleteEvent(); }

/* ------------------------------------------------------------------ */
/* 3. Canvas (calendar feed)                                            */
/* ------------------------------------------------------------------ */

function setCanvas_(url) {
  url = String(url || '').trim();
  if (!/^https:\/\/[^\s]+\.ics(\?.*)?$/i.test(url) && !/\/feeds\/calendars\//.test(url)) {
    throw new Error('That does not look like a Canvas calendar feed link (it should end in .ics).');
  }
  PROPS.setProperty('CANVAS_URL', url);
  return canvas_();
}

function canvas_() {
  var url = PROPS.getProperty('CANVAS_URL');
  if (!url) return [];
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('Canvas feed returned ' + res.getResponseCode());
  return parseCanvasIcs_(res.getContentText());
}

function icsText_(s) {
  return String(s || '').replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function parseCanvasIcs_(txt) {
  var tz = tz_();
  var lines = txt.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  var items = [], cur = null;
  lines.forEach(function (line) {
    if (line === 'BEGIN:VEVENT') { cur = {}; return; }
    if (line === 'END:VEVENT') { if (cur) items.push(cur); cur = null; return; }
    if (!cur) return;
    var i = line.indexOf(':');
    if (i < 0) return;
    var head = line.slice(0, i), val = line.slice(i + 1);
    cur[head.split(';')[0].toUpperCase()] = { head: head, val: val };
  });

  var out = [];
  items.forEach(function (ev) {
    var uid = ev.UID && ev.UID.val;
    if (!uid || !/assignment/i.test(uid) || !ev.DTSTART) return;
    var summary = icsText_(ev.SUMMARY && ev.SUMMARY.val);
    var m = summary.match(/^(.*)\s\[([^\]]+)\]\s*$/);
    var title = m ? m[1] : summary, course = m ? m[2] : '';
    var raw = ev.DTSTART.val, head = ev.DTSTART.head, due = '', time = '';
    if (/VALUE=DATE(?!-)/i.test(head) || /^\d{8}$/.test(raw)) {
      due = raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
    } else {
      var d;
      if (/Z$/.test(raw)) {
        d = new Date(Date.UTC(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8), +raw.slice(9, 11), +raw.slice(11, 13), +raw.slice(13, 15)));
      } else {
        var tzm = head.match(/TZID=([^;:]+)/i);
        d = Utilities.parseDate(raw.slice(0, 15), tzm ? tzm[1] : tz, "yyyyMMdd'T'HHmmss");
      }
      due = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
      time = Utilities.formatDate(d, tz, 'h:mm a');
    }
    out.push({ uid: uid, title: title, course: course, due: due, time: time, url: ev.URL ? ev.URL.val : '' });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* 4. WHOOP                                                             */
/* ------------------------------------------------------------------ */

function setWhoop_(req) {
  if (req.clientId) PROPS.setProperty('WHOOP_CLIENT_ID', String(req.clientId).trim());
  if (req.clientSecret) PROPS.setProperty('WHOOP_CLIENT_SECRET', String(req.clientSecret).trim());
  if (req.redirect) PROPS.setProperty('WHOOP_REDIRECT', String(req.redirect).trim());
  if (!PROPS.getProperty('WHOOP_CLIENT_ID') || !PROPS.getProperty('WHOOP_CLIENT_SECRET')) throw new Error('WHOOP Client ID and Client Secret are required');
  var state = Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  PROPS.setProperty('WHOOP_STATE', state);
  return WHOOP_AUTH +
    '?response_type=code' +
    '&client_id=' + encodeURIComponent(PROPS.getProperty('WHOOP_CLIENT_ID')) +
    '&redirect_uri=' + encodeURIComponent(PROPS.getProperty('WHOOP_REDIRECT')) +
    '&scope=' + encodeURIComponent('offline read:recovery read:sleep read:cycles read:workout read:profile read:body_measurement') +
    '&state=' + state;
}

function whoopCallback_(p) {
  if (p.error) return HtmlService.createHtmlOutput(page_('WHOOP was not connected', String(p.error_description || p.error)));
  if (!p.state || p.state !== PROPS.getProperty('WHOOP_STATE')) {
    return HtmlService.createHtmlOutput(page_('WHOOP link expired', 'Go back to HQ and press Connect WHOOP again.'));
  }
  var res = UrlFetchApp.fetch(WHOOP_TOKEN, {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      grant_type: 'authorization_code',
      code: p.code,
      redirect_uri: PROPS.getProperty('WHOOP_REDIRECT'),
      client_id: PROPS.getProperty('WHOOP_CLIENT_ID'),
      client_secret: PROPS.getProperty('WHOOP_CLIENT_SECRET'),
    },
  });
  if (res.getResponseCode() !== 200) {
    return HtmlService.createHtmlOutput(page_('WHOOP connection failed', 'WHOOP said: ' + res.getContentText().slice(0, 300)));
  }
  saveWhoopTokens_(JSON.parse(res.getContentText()));
  PROPS.deleteProperty('WHOOP_STATE');
  return HtmlService.createHtmlOutput(page_('WHOOP connected ✓', 'You can close this tab and go back to HQ.'));
}

function saveWhoopTokens_(t) {
  PROPS.setProperty('WHOOP_ACCESS', t.access_token);
  if (t.refresh_token) PROPS.setProperty('WHOOP_REFRESH', t.refresh_token);
  PROPS.setProperty('WHOOP_EXPIRES', String(Date.now() + (t.expires_in || 3600) * 1000));
}

function whoopToken_() {
  var exp = +PROPS.getProperty('WHOOP_EXPIRES') || 0;
  if (PROPS.getProperty('WHOOP_ACCESS') && exp > Date.now() + 60000) return PROPS.getProperty('WHOOP_ACCESS');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Another request may have refreshed while we waited (WHOOP refresh tokens are single-use).
    exp = +PROPS.getProperty('WHOOP_EXPIRES') || 0;
    if (PROPS.getProperty('WHOOP_ACCESS') && exp > Date.now() + 60000) return PROPS.getProperty('WHOOP_ACCESS');
    var refresh = PROPS.getProperty('WHOOP_REFRESH');
    if (!refresh) throw new Error('WHOOP not connected');
    var res = UrlFetchApp.fetch(WHOOP_TOKEN, {
      method: 'post',
      muteHttpExceptions: true,
      payload: {
        grant_type: 'refresh_token',
        refresh_token: refresh,
        client_id: PROPS.getProperty('WHOOP_CLIENT_ID'),
        client_secret: PROPS.getProperty('WHOOP_CLIENT_SECRET'),
        scope: 'offline',
      },
    });
    if (res.getResponseCode() !== 200) throw new Error('WHOOP sign-in expired. Reconnect WHOOP in Settings.');
    saveWhoopTokens_(JSON.parse(res.getContentText()));
    return PROPS.getProperty('WHOOP_ACCESS');
  } finally {
    lock.releaseLock();
  }
}

function whoopGet_(path) {
  var res = UrlFetchApp.fetch(WHOOP_API + path, {
    headers: { Authorization: 'Bearer ' + whoopToken_() },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) throw new Error('WHOOP ' + path + ' returned ' + res.getResponseCode());
  return JSON.parse(res.getContentText()).records || [];
}

function whoop_() {
  if (!PROPS.getProperty('WHOOP_REFRESH')) return null;
  var recovery = whoopGet_('/recovery?limit=7');
  var sleep = whoopGet_('/activity/sleep?limit=10');
  var cycles = whoopGet_('/cycle?limit=7');
  return {
    fetchedAt: Date.now(),
    recovery: recovery.map(function (r) {
      var s = r.score || {};
      return { at: r.created_at, state: r.score_state, recovery: s.recovery_score, rhr: s.resting_heart_rate, hrv: s.hrv_rmssd_milli };
    }),
    sleep: sleep.filter(function (s) { return !s.nap; }).map(function (s) {
      var sc = s.score || {}, st = sc.stage_summary || {};
      var asleep = (st.total_in_bed_time_milli || 0) - (st.total_awake_time_milli || 0);
      return {
        start: s.start, end: s.end, state: s.score_state,
        asleepMs: asleep > 0 ? asleep : null,
        inBedMs: st.total_in_bed_time_milli || null,
        performance: sc.sleep_performance_percentage,
        efficiency: sc.sleep_efficiency_percentage,
        consistency: sc.sleep_consistency_percentage,
      };
    }),
    cycles: cycles.map(function (c) {
      var s = c.score || {};
      return { start: c.start, end: c.end, state: c.score_state, strain: s.strain, kj: s.kilojoule };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* 5. Reminders (daily email)                                           */
/* ------------------------------------------------------------------ */

function reminderTrigger_() {
  try {
    var t = ScriptApp.getProjectTriggers().filter(function (x) { return x.getHandlerFunction() === 'sendReminders'; });
    return t[0] || null;
  } catch (e) { return null; } // not authorized for triggers yet
}

function setReminders_(on, hour) {
  ScriptApp.getProjectTriggers().forEach(function (x) {
    if (x.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(x);
  });
  if (!on) return;
  var h = Math.max(0, Math.min(23, Math.round(Number(hour) || 20)));
  PROPS.setProperty('REMINDER_HOUR', String(h));
  ScriptApp.newTrigger('sendReminders').timeBased().everyDays(1).atHour(h).inTimezone(tz_()).create();
}

// Runs once a day from the trigger (and from "Send a test" in HQ).
function sendReminders(force) {
  var data = {};
  try { data = JSON.parse(dataFile_().getBlob().getDataAsString() || '{}'); } catch (e) { data = {}; }
  var tz = tz_();
  var now = new Date();
  var today = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var tomorrow = Utilities.formatDate(new Date(now.getTime() + 864e5), tz, 'yyyy-MM-dd');
  var classes = {};
  (data.classes || []).forEach(function (c) { classes[c.id] = c.name; });
  var open = function (x) { return !x.done && x.due; };
  var label = function (x) {
    return x.title + (classes[x.classId] ? ' (' + classes[x.classId] + ')' : '') + (x.dueTime ? ' at ' + x.dueTime : '');
  };
  var school = (data.school || []).filter(open), personal = (data.personal || []).filter(open);
  var dueTomorrow = school.concat(personal).filter(function (x) { return x.due === tomorrow; }).map(label);
  var dueToday = school.concat(personal).filter(function (x) { return x.due === today; }).map(label);
  var overdue = school.concat(personal).filter(function (x) { return x.due < today; }).length;
  var journaled = (data.journal || []).some(function (j) { return j.date === today && String(j.text || '').trim(); });
  var habits = data.habits || [];
  var habitsLeft = habits.filter(function (h) { return !(h.log || {})[today]; }).map(function (h) { return h.name; });

  if (!force && !dueTomorrow.length && !dueToday.length && journaled && !habitsLeft.length) return false;

  var esc = function (s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
  var section = function (title, items, color) {
    if (!items.length) return '';
    return '<h3 style="margin:18px 0 6px;color:' + color + ';font:700 12px monospace;letter-spacing:2px;text-transform:uppercase">' + title + '</h3>' +
      '<ul style="margin:0;padding-left:18px">' + items.map(function (i) { return '<li style="margin:3px 0">' + esc(i) + '</li>'; }).join('') + '</ul>';
  };
  var html = '<div style="font-family:-apple-system,system-ui,sans-serif;background:#05070b;color:#e6eef8;padding:24px;border-radius:12px">' +
    '<div style="font:800 22px sans-serif;color:#3b9cff;letter-spacing:2px">HQ · DARKO</div>' +
    '<p style="color:#8395ab;margin:6px 0 0">Evening briefing for ' + Utilities.formatDate(now, tz, 'EEEE, MMM d') + '.</p>' +
    section('Due tomorrow', dueTomorrow, '#ffb547') +
    section('Still due today', dueToday, '#86c5ff') +
    (overdue ? '<p style="color:#ff5d6c">' + overdue + ' overdue item' + (overdue > 1 ? 's' : '') + ' waiting in HQ.</p>' : '') +
    (journaled ? '' : section('Journal', ['You haven\'t written today\'s journal entry yet.'], '#3ddc97')) +
    section('Habits left today', habitsLeft, '#8395ab') +
    (!dueTomorrow.length && !dueToday.length ? '<p style="color:#3ddc97">Nothing due tomorrow. You\'re clear.</p>' : '') +
    '</div>';
  var subject = dueTomorrow.length
    ? 'HQ: ' + dueTomorrow.length + ' due tomorrow'
    : (!journaled ? 'HQ: time to journal' : 'HQ: evening briefing');
  MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), subject: subject, htmlBody: html, name: 'HQ · Darko' });
  return true;
}

/* ------------------------------------------------------------------ */
/* Run this once from the editor (▶ Run → authorize) before deploying, */
/* so Google asks for all permissions up front.                        */
/* ------------------------------------------------------------------ */
function authorize() {
  CalendarApp.getDefaultCalendar().getName();
  DriveApp.getRootFolder().getName();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  ScriptApp.getProjectTriggers();
  MailApp.getRemainingDailyQuota();
  Logger.log('HQ server authorized for ' + Session.getEffectiveUser().getEmail());
}
