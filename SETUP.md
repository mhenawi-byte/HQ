# Connecting HQ to Google, Canvas and WHOOP

Do these in order. Google comes first because Canvas and WHOOP both run through it.

---

## 1. Google (sync + Calendar), about 5 minutes

HQ talks to Google through a small script that runs **inside your own Google account**. You create it once.

1. Open HQ on your laptop → **Settings** → **Connections** → **Copy server code**.
2. Go to **https://script.google.com** → **New project**. Rename it (top left) to **HQ server**.
3. Delete everything in `Code.gs`, paste, and press **⌘S**.
4. In the toolbar's function dropdown pick **authorize**, then press **▶ Run**.
   - Google asks for permission. Choose your account.
   - If you see **"Google hasn't verified this app"**: click **Advanced** → **Go to HQ server (unsafe)**. It's your own script, so this is expected.
   - Allow access to Calendar, Drive and external requests.
5. Click **Deploy** → **New deployment** → gear icon ⚙ → **Web app**.
   - **Execute as:** Me
   - **Who has access:** Anyone
   - Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).
6. Back in HQ: paste the URL into **Settings → Connections → Google** and press **Connect**.

HQ creates one file in your Drive called **HQ data.json**. That's your synced data.

> **"Who has access: Anyone"** only means the script can be reached without a Google sign-in. Every request also has to carry the secret key that HQ created when you connected. Without that key the script answers nothing.

### If you change the server code later
Deploy → **Manage deployments** → pencil ✎ → Version: **New version** → Deploy. The URL stays the same.

---

## 2. Your phone

1. Put HQ online (GitHub Pages) and open it in **Safari** on your iPhone.
2. **Share → Add to Home Screen**.
3. On your laptop: **Settings → Pair your phone → Copy link**, and AirDrop or text it to yourself.
4. Open that link on the phone **in Safari**. HQ connects and pulls in all your data.

Keep the pairing link private. Anyone who has it can read your HQ data.

---

## 3. Canvas (VT), about 1 minute

1. Go to **https://canvas.vt.edu/calendar**.
2. Bottom right, click **Calendar Feed** and copy the link (it ends in `.ics`).
3. HQ → **Settings → Connections → Canvas** → paste → **Link**.

Upcoming assignments show up in **School** with their class and due time. HQ checks every 30 minutes, and the ↻ button on the School page imports right away.
- Classes are created automatically from the course codes (e.g. `CS 2114`).
- Only assignments due today or later are imported, not the whole semester.
- If you delete an imported assignment, it stays deleted.
- Canvas's feed doesn't say whether you've submitted something, so check items off yourself.

---

## 3b. Outlook / Teams (VT), about 1 minute

Shows your VT Outlook calendar (Teams meetings, anything on it) on Today and Calendar. View only.

1. Open [outlook.office.com](https://outlook.office.com/calendar) → ⚙ → **Calendar → Shared calendars**.
2. Under **Publish a calendar**: pick **Calendar**, **Can view all details**, then **Publish**.
3. Copy the **ICS** link (ends in `calendar.ics`) and paste it into **HQ → Settings → Outlook · Teams**.

Keep that link private: anyone with it can see your calendar. To revoke it, click **Unpublish** in the same Outlook screen.

---

## 4. WHOOP, about 5 minutes

1. Go to **https://developer-dashboard.whoop.com** and sign in with your WHOOP account.
2. Create an app (name it "HQ", or anything you like).
3. **Scopes:** tick all six: `read:recovery`, `read:cycles`, `read:sleep`, `read:workout`, `read:profile`, `read:body_measurement`.
4. **Redirect URL:** paste your HQ server URL (the same `/exec` URL from step 1). There's a "tap to copy" link for it in HQ's WHOOP section.
5. Copy the app's **Client ID** and **Client Secret** into HQ → **Settings → Connections → WHOOP** → **Connect WHOOP**.
6. A WHOOP page opens. Approve it, and you'll see "WHOOP connected ✓". Go back to HQ.

Recovery, sleep, strain and HRV then show on **Today** and refresh every 5 minutes while HQ is open (and right away when you come back to it).

---

## 5. Email reminders, about 1 minute

Darko can email you each evening: what's due tomorrow, what's still due today, a journal nudge and the habits you haven't checked off.

1. If you updated the server code, run `authorize` once in Apps Script (function picker → **authorize** → ▶ Run) and allow the new permissions (send email as you, run on a schedule).
2. In HQ: **Settings → Reminders**, turn them on and pick the hour.
3. Tap **Send a test now** to check your inbox.

The emails go only to your own Google address and are sent from your account.

---

## Troubleshooting

| What you see | Fix |
|---|---|
| "The HQ server did not answer correctly" | Redeploy with **Execute as: Me** and **Who has access: Anyone**. |
| "Wrong key" when connecting a second device | Use **Pair your phone** from a connected device instead of pasting the URL. |
| Lost the key everywhere | In Apps Script: ⚙ Project Settings → Script Properties → delete `KEY`, then connect again. |
| Canvas error 401/404 | Copy a fresh Calendar Feed link from Canvas and link it again. |
| Reminders say "authorize" | Run `authorize` in Apps Script once and allow the permissions, then try again. |
| "WHOOP sign-in expired" | Settings → WHOOP → Disconnect, then Connect again. |
