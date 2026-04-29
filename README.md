# Fast-Facts-Simulator

This is a lightweight Fast Facts practice web app (vanilla HTML/CSS/JS) intended for Science Olympiad-style warmups.

Recent UI/behavior notes:
- Settings moved to a right-aligned gear menu in the header.
- Tournament mode is a single toggle (On/Off) in Settings; when enabled it locks filters and enforces competitive defaults (random category, 20s timer, Auto Advance enabled) and disables hints.
- Hints are now a per-round setting in Settings with options: All / Half / None. Tournament and Hard modes force hints to None.
- Scoreboard visibility is controlled via Settings and persists across reloads.
- Auto Advance, Reset Scores, and Dark/Light theme are available from Settings.

Data and persistence:
- The dataset is `data.json` (categories -> letters -> words). See file for format.
- User settings and filters are saved to `localStorage` under the key `fastfacts_filters`.
- Scores and streaks are saved under `fastfacts_score`.

To run locally:

Serve the folder over HTTP (fetch('./data.json') requires a server). Example using Python 3:

```bash
python -m http.server 8000
# then open http://localhost:8000 in your browser
```

If you'd like the README expanded (feature list, developer notes, or contribution guidelines), tell me what to include.