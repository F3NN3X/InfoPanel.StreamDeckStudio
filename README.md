# InfoPanel Studio for Stream Deck

A native Stream Deck plugin (SDK 3, Stream Deck 7.1+, Windows 10+) that drives
[InfoPanel Studio](https://github.com/F3NN3X/InfoPanel.Studio): switch pages and profiles, rotate pages, handle
alerts, control the kiosk displays, follow your coding agents and show live InfoPanel sensors on keys and dials.
Keys are drawn in Studio's own theme colours with its page icons. Changes per version are in
[CHANGELOG.md](CHANGELOG.md).

## Requirements

- Windows 10 or later, Stream Deck 7.1 or later. The page cycler and sensor dial need a Stream Deck +.
- InfoPanel Studio running (default `http://127.0.0.1:3922`). Mute alerts, Reload kiosk, Dim display and Island
  need Studio **1.3.0-beta.7 or later** (the mute and kiosk controls); the other actions work with 1.3.0-beta.6.
- For the sensor actions: InfoPanel with its Data API enabled (default `http://127.0.0.1:3921`).

## Install

1. Download `com.f3nn3x.infopanel-studio.streamDeckPlugin` from the
   [latest release](https://github.com/F3NN3X/InfoPanel.StreamDeckStudio/releases/latest/download/com.f3nn3x.infopanel-studio.streamDeckPlugin)
   and double-click it; the Stream Deck app installs it. Installing a newer release updates it in place.
2. Drag the actions from the **InfoPanel Studio** category onto keys (or the dial).
3. In any action's property inspector, **Connection** sets the server addresses. They are global: every action
   shares them, so set them once.
   - **Studio**: the Studio server. It needs the control routes (`/api/control`, `/events/control`).
   - **Data API**: InfoPanel's Data API, used by the sensor actions.

Upgrading from 0.1.0 ("InfoPanel Dashboard"): the plugin ID changed in 0.2.0, so remove the old plugin, place the
keys again and re-enter the Studio URL.

## Actions

### Pages and profiles

| Action | Press | Face |
|---|---|---|
| Go to page | show that page | page icon + name, filled while the page is showing |
| Next page / Previous page | next / previous page, wrapping | arrow + the name of the page a press goes to |
| Switch profile | force a profile on the kiosks; "Auto" clears the override | profile name, filled while forced |
| Auto-rotate | toggle rotation; hold 1 s = back to the saved setting | play / pause, `saved: on/off` while overridden, dimmed with fewer than 2 pages |
| Pause rotation | hold rotation for 30 s, or the rotate period when that is longer; alerts when the profile is not rotating | hourglass + "Pause 30 s" while rotating, muted "Not rotating" otherwise |
| Page cycler (Stream Deck +) | rotate = next / previous page, press = first page, touch = toggle rotation | touch strip: icon, page name, position bar `n / total`, rotating mark |

### Alerts

| Action | Press | Face |
|---|---|---|
| Alerts | acknowledge the newest alert; hold 1 s = dismiss it | bell + count of visible alerts (not acknowledged, not quiet), filled by the worst severity (critical / warning / info) with the newest alert's name; "No alerts" otherwise |
| Test alert | fire the chosen rule's test alert (tick on success) | flask tinted by the rule's severity + rule name |
| Mute alerts | mute alerts for the chosen minutes; pressed while muted it unmutes | bell + "Mute 30 min"; filled bell-off + the time left ("Muted 12m", "Muted 1h 20m"), counting down |

While muted, Studio marks alerts quiet, so they drop off the Alerts count. Test alerts fired during a mute are not
marked quiet by Studio and still count.

### Kiosk display

| Action | Press | Face |
|---|---|---|
| Reload kiosk | reload the chosen profile's kiosk, or every kiosk (tick on success; Studio ignores a repeat within 2 s) | rotate glyph + profile name or "All kiosks" |
| Dim display | dim / restore the display of the chosen (or shown) profile | sun + "Dim"; filled moon + "Dim 60%" while dimmed |
| Island | show / hide the island; hold 1 s = back to the profile's own setting | panel glyph + "showing" / "hidden", or `saved: on/off` while overridden |

Studio fades the dim overlay over 300 ms and keeps alerts above it. An island override clears when someone changes
that profile's island setting in Studio; turning the island on for a profile without island settings shows the
default island. Dim levels and island overrides survive a Studio restart.

### Sensors and agents

| Action | Press | Face |
|---|---|---|
| Sensor value | open a page (optional) | label, live value + unit, warn / critical colours, and a sparkline or (Style = Bar) a bar from 0 to Bar max; repaints at most 4x per second |
| Sensor (dial) (Stream Deck +) | press or touch: open a page (optional) | touch strip: label, value + unit and a bar in the warn / critical colours |
| Coding agents | open a page (optional) | Claude Code / Codex sessions: amber with the project when one waits for you ("N waiting" for several), else the working count, else "Idle" |

### Settings

Every action also has the global **Connection** section. **Profile** left on "Shown profile" targets the profile a
kiosk is showing, in Studio's own fallback order: override, shown, pinned, first.

| Action | Settings |
|---|---|
| Go to page | Profile, Page |
| Next page / Previous page, Auto-rotate, Pause rotation, Page cycler, Island | Profile |
| Switch profile | Profile ("Auto" clears the override) |
| Alerts | none |
| Test alert | Rule (from Studio's alert rules) |
| Mute alerts | Minutes, 1-1440 (default 30) |
| Reload kiosk | Profile (empty = all kiosks) |
| Dim display | Profile, Level % 10-90 (empty = the level Studio remembers for that profile, 60% at first) |
| Coding agents | Agent (both, Claude Code or Codex), Open page + Profile |
| Sensor value | Find (narrows the sensor list), Sensor, Label, Unit, Decimals, Style (sparkline / bar), Bar max, Warn at, Critical at, Lower is worse, Open page + Profile |
| Sensor (dial) | as Sensor value, without Style (the strip always shows the bar) |

Bar max defaults to 100 for `%` and `°` units, as Studio's own sensor bars do; without a max the key falls back to the
sparkline and the dial's bar stays empty. Warn and Critical colour the value, sparkline and bar; "Lower is worse"
flips them for values such as free space.

### Offline and feedback

When Studio cannot be reached the keys show a muted "Offline" face, a press shows the alert, and they recover on
their own when it is back. The sensor dial keeps showing Data API readings while only Studio is down. Keys whose
face reflects the result (page keys, Alerts, Mute, Dim, Island) change their face instead of showing the OK tick;
Switch profile, Auto-rotate, Test alert, Pause rotation and Reload kiosk show the tick after a successful press.

## Studio API used

The plugin only reads from Studio and posts to `/api/control/*`; it never edits the Studio config. Control posts
send `Content-Type: application/json` and `X-Dashboard-Control: 1`.

| Route | Used for |
|---|---|
| `GET /api/config`, SSE `/events/config` | profiles, pages, theme, alert rules |
| `GET /api/control`, SSE `/events/control` | shown / overridden profile, pages, rotation, alerts, mute, dim, island |
| `POST /api/control/{page,profile,rotate,touch}` | page keys, Switch profile, Auto-rotate, Pause rotation |
| `POST /api/control/alert` | acknowledge, dismiss, test and mute (`{ action: "mute", minutes }`, 0 unmutes) |
| `POST /api/control/kiosk` | reload, dim, island |
| SSE `/events/extras` | coding-agent sessions (OBS and calendar are ignored) |
| Data API `/api/sensors`, SSE `/events?prefix=` | sensor catalogue and live readings, one stream per key prefix |

## Develop

To run from source, build once and link the plugin folder into the Stream Deck app (remove an installed release
first; both use the same plugin UUID):

```
npm install
npm run build        # icons + rollup -> com.f3nn3x.infopanel-studio.sdPlugin/bin/plugin.js
npx streamdeck link com.f3nn3x.infopanel-studio.sdPlugin
npm run watch        # rebuild and `streamdeck restart` on change
npm test             # Vitest
npm run typecheck
npm run validate     # streamdeck validate
npm run pack         # .streamDeckPlugin
```

`npm run icons` bundles the lucide icons (`lucide-static`) into `src/render/lucide-data.ts` (generated, git-ignored);
the other scripts run it first. A changed `manifest.json` (new actions, inspector paths) is only read when the Stream
Deck app starts, so restart the app after such a change; `streamdeck restart` is enough for code changes.

Layout:

- `src/sse.ts`: server-sent events over `fetch` (parser and reconnecting reader with backoff).
- `src/studio.ts`: the shared Studio client: config, control state (alerts, mute, dim, island), the control posts and
  Studio's profile resolution.
- `src/extras.ts`: the `/events/extras` client (coding-agent sessions).
- `src/data-api.ts`: the Data API client: sensor catalogue, shared per-prefix streams, history.
- `src/runtime.ts`: the plugin-wide clients and the global Connection settings.
- `src/render/`: pure SVG renderers (keys, touch strip, sensor key) and the colour and text helpers.
- `src/actions/`: one class per action; `painted-key.ts` / `studio-key.ts` hold the shared key behaviour,
  `sensor-input.ts` the logic both sensor actions share, `datasource.ts` the property inspector lists.
- `com.f3nn3x.infopanel-studio.sdPlugin/`: manifest, touch-strip layouts, images and property inspectors
  (sdpi-components v4, vendored in `ui/`).

The action icons and plugin/category images are simple placeholders drawn from lucide.

## Releasing

1. Bump `version` in `package.json` (and `package-lock.json`, e.g. `npm version X.Y.Z --no-git-tag-version`) and
   `Version` in `com.f3nn3x.infopanel-studio.sdPlugin/manifest.json` (Stream Deck format, `X.Y.Z.0`).
2. Move the `## [Unreleased]` entries in `CHANGELOG.md` under `## [X.Y.Z]`; that section becomes the release notes.
3. Merge to `main`, then push a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The *Release Build* workflow (`.github/workflows/release.yml`) tests, builds, validates and packs the plugin in a
read-only job and checks that the tag matches `package.json`; a separate release job, the only one with write access,
publishes `com.f3nn3x.infopanel-studio.streamDeckPlugin` to the GitHub release. Run it manually
(workflow_dispatch) to build without releasing. Actions are pinned to commit SHAs; Dependabot proposes updates.
