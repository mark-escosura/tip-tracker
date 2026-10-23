# Tip Tracker (Mark's Denny's tips)

Live: https://mark-escosura.github.io/tip-tracker/  ·  Repo: https://github.com/mark-escosura/tip-tracker

Private iPhone PWA. Shifts are stored only in the phone's localStorage (`tiptracker.shifts.v1`).
No bank, payroll, tax, accounts, analytics or runtime network requests. Backup = Export/Import CSV.

## Layout
- `site/` – the deployed app (its own git repo, pushed to GitHub Pages)
  - `index.html`, `styles.css`, `app.js` – UI, storage, stats, text parser, CSV, scroll setup
  - `js/scene3d.js` – built 3D scene (three.js r186 tree-shaken + `src/scene3d.js`)
  - `vendor/` – gsap.min.js 3.15, ScrollTrigger.min.js, lenis.min.js 1.3.27 (all local, cached by `sw.js`)
  - `sw.js` – offline cache. **Bump `VERSION` on every deploy.**
- `src/scene3d.js` – 3D scene source. Rebuild with `./build.sh` (esbuild).
- `deploy_github_pages.sh` – commit + push `site/` and wait for Pages to return 200.
- `tests/test_full.py` – Playwright suite (iPhone viewport). `python3 tests/test_full.py [URL]`
- `tests/record_preview.py` – renders `preview.mp4`.
- `shifts.json` – shifts Mark texts to the bot (see format below).

## Scroll architecture
Lenis smooth scroll → `lenis.on('scroll', ScrollTrigger.update)`; `gsap.ticker` drives `lenis.raf`; `lagSmoothing(0)`.
One master timeline on `#hero`: `pin: true, scrub: 1, end: '+=300%'`, `ease: 'none'`, tweening `proxy.p` 0→1.
A second scrubbed trigger over the content below tweens `proxy.h` 0→1 (history continues the 3D move).
One `gsap.ticker` render loop calls `scene.render(proxy.p, proxy.h)`; the scene is a pure function of those
values and only re-renders when they change. Canvas is `position: fixed`, so content scrolls over it.
Weak GPU (software renderer / low memory) → DPR cap 1.5, fewer particles/segments; slow frames → auto downgrade.
No WebGL (or `?lite`) → 2D CSS fallback driven by the same progress. `prefers-reduced-motion` → no Lenis, direct scrub.

## Pay math
Base wage: setting in "Settings & backup" (localStorage `tiptracker.wage`, default 16.90). It applies to all shifts (not stored per shift).
- Wages = hours × wage
- Take-home = wages + tips − tip-out
- Total $/hr = take-home ÷ hours; Tips $/hr = (tips − tip-out) ÷ hours
- Best shifts ranked by total $/hr. Week = Monday–Sunday. Tip % of sales = tips ÷ sales (shifts with sales only).
3D jar fill = this week's take-home ÷ best week's take-home; bars = Mon–Sun take-home.

## Calendar
Month grid between the log card and history (‹ › or swipe to change month). Cells show day take-home with gold heat shading
(dots = multiple shifts); header shows the month total. Tap a day to see/edit/delete its shifts, quick-log onto that date,
or open the full form preset to that date. Cells rise in with a scrubbed scroll animation.

## Data format (localStorage, CSV, and shifts.json)
`shifts.json` is a JSON array of shift objects; CSV uses the same fields as columns
(`id,date,shift,hours,tips,sales,tipout,note`), so texted shifts can be turned into a CSV Mark imports.

| field   | type            | notes |
|---------|-----------------|-------|
| id      | string          | unique, e.g. `s<base36 time><rand>`; import skips ids already present |
| date    | `YYYY-MM-DD`    | local date of the shift (CSV import also accepts `M/D/YYYY`) |
| shift   | string          | `breakfast` \| `lunch` \| `dinner` \| `overnight` |
| hours   | number          | > 0, ≤ 24 |
| tips    | number          | all tips $ (cash + card together) |
| sales   | number \| null  | optional |
| tipout  | number          | optional, default 0 |
| note    | string          | optional, ≤ 200 chars |
| createdAt | ISO string    | optional |

Migration: older entries/CSVs with `cash` and `card` are summed into `tips` automatically (on load and on import).

Example: `[{"id":"s1","date":"2026-10-18","shift":"dinner","hours":6,"tips":73,"sales":null,"tipout":12,"note":""}]`

Text phrasing the app (and bot) understand: `6h dinner, 73 tips, tipped out 12`, `dinner 6h 70` (a single bare amount = tips),
`lunch 5.5 hrs tips 65 sales 380 tip out 6`, `yesterday breakfast 6 hours made 93`, `fri dinner ...`, `10/16 dinner ...`, `... note: big party`.
"cash"/"card" amounts are still understood and summed into tips. Two or more unlabeled amounts are flagged, never guessed.

## Clock in / clock out
- Optional **Clock in** / **Clock out** on the log form and edit view. Hours fill in automatically; if out is earlier than in, the shift crossed midnight (10pm–6am = 8h).
- Hours stays editable: knock off an unpaid break (shows "8h clocked, 0.5h break") or override.
- Stored as `clockIn` / `clockOut` ("HH:MM" 24h, or null). CSV columns: `id,date,shift,hours,clockIn,clockOut,tips,sales,tipout,note`; older CSVs without them still import.
- Quick box understands `10p-6a`, `4:30pm to 11`, `6-2pm`, `22:00-06:30`. An explicit `6.5h` wins over the span.
- Scheduled-shift prefill link: `?log=2026-10-20&shift=dinner&in=16:00&out=23:00`.
