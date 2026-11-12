# HQ

Personal headquarters, run by **Darko**. A dark, gadget-workshop style web app that installs on iPhone and works on a laptop.

## Run it locally

```bash
python3 -m http.server 5173
```

Then open http://localhost:5173.

## Install on iPhone

Open the hosted site in Safari → Share → **Add to Home Screen**.

## Roadmap

1. ✅ Core: Today, School, Grocery, Personal lists, habits with streaks, installable
2. ✅ Google sync (Drive) + Google Calendar, VT Canvas import, WHOOP (see [SETUP.md](SETUP.md))
3. ✅ Class schedule (weekly meeting times) + nightly email reminders
4. ✅ Focus (Pomodoro), Journal with moods + streak, Money with monthly budget warnings
5. ✅ Fuel: calories + macros against adjustable goals
6. ✅ Darko voice: free, on-device commands (tap the mic button). Optional later: an AI brain

## Files

- `index.html`: page shell + boot sequence
- `css/style.css`: theme
- `js/app.js`: views and actions
- `js/store.js`: data storage + merge rules for sync
- `js/api.js`: talks to your HQ server
- `apps-script/Code.gs`: the HQ server (runs in your Google account; see SETUP.md)
- `sw.js`, `manifest.webmanifest`, `icons/`: installable app bits
