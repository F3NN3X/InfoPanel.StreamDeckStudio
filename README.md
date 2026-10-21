# InfoPanel Stream Deck plugin

A native Stream Deck plugin (SDK 3, Stream Deck 7.1+, Windows 10+) that drives the
[InfoPanel Studio](https://github.com/F3NN3X/InfoPanel.Studio): switch pages and profiles, rotate pages,
and show live InfoPanel sensors on keys. Keys are drawn in Studio's own theme colours with its page icons.

## Actions

| Action | Press | Face |
|---|---|---|
| Go to page | show that page (profile or "shown profile", page) | page icon + name, filled while the page is showing |
| Next page / Previous page | next / previous page, wrapping | arrow + name of the page a press goes to |
| Switch profile | force a profile on the kiosks; "Auto" clears the override | profile name, filled while forced |
| Auto-rotate | toggle rotation; hold 1 s = back to the saved setting | play / pause, `saved: on/off` while overridden, dimmed with fewer than 2 pages |
| Page cycler (Stream Deck +) | dial: rotate = next / previous page, press = first page, touch = toggle rotation | touch strip: icon, page name, position bar `n / total`, rotating mark |
| Sensor value | open a page (optional) | label, live value + unit, warn / critical colours, sparkline or, with Style = Bar, a fill bar from 0 to Bar max (100 for % and ° units; no max falls back to the sparkline); repaints at most 4x per second |
| Sensor (dial) (Stream Deck +) | dial press or touch: open a page (optional) | touch strip: label, value + unit and a bar in the warn / critical colours; "Offline" only when there is neither a reading nor Studio; the same settings as Sensor value, minus Style |
| Alerts | press = acknowledge the newest alert, hold 1 s = dismiss it | bell + count of visible alerts, filled by the worst severity (critical / warning / info) with the newest alert's name; "No alerts" when quiet |
| Test alert | fire the chosen rule's test alert | flask tinted by the rule's severity + rule name |
| Pause rotation | hold page rotation for 30 s (or the rotate period); alerts when the profile is not rotating | hourglass, "Pause 30 s" (longer for a slow rotate period) while rotating, muted "Not rotating" otherwise |
| Coding agents | open a page (optional) | Claude Code / Codex sessions (filter: both, Claude or Codex): amber with the project when one waits for you ("N waiting" for several), the working count, else "Idle" |

When Studio cannot be reached the keys show a muted "Offline" face, a press shows the alert, and they recover
on their own when it is back. Page keys show the active fill instead of the OK tick; switch-profile and auto-rotate
show the tick after a successful press.

## Install

Needs Windows 10 or later and Stream Deck 7.1 or later.

1. Download `com.f3nn3x.infopanel-studio.streamDeckPlugin` from the
   [latest release](https://github.com/F3NN3X/InfoPanel.StreamDeckStudio/releases/latest/download/com.f3nn3x.infopanel-studio.streamDeckPlugin)
   and double-click it; the Stream Deck app installs it (installing a newer release updates it in place).
2. Drag the actions from the **InfoPanel Studio** category onto keys (or the dial).
3. In any action's property inspector, **Connection** sets the server addresses (shared by all actions):
   - Studio, default `http://127.0.0.1:3922`. It needs the control routes (`/api/control`, `/events/control`).
   - Data API, default `http://127.0.0.1:3921` (InfoPanel's Data API, used by the Sensor value key).

Leaving "Profile" on **Shown profile** targets the profile a kiosk is showing (Studio's own fallback order:
override, shown, pinned, first).

## Develop

To run from source, build once and link the plugin folder into the Stream Deck app
(remove an installed release first; both use the same plugin UUID):
`npx streamdeck link com.f3nn3x.infopanel-studio.sdPlugin`.

```
npm install
npm run build        # icons + rollup -> com.f3nn3x.infopanel-studio.sdPlugin/bin/plugin.js
npm run watch        # rebuild and `streamdeck restart` on change
npm test             # Vitest
npm run typecheck
npm run validate     # streamdeck validate
npm run pack         # .streamDeckPlugin
```

`npm run icons` bundles the lucide icons (`lucide-static`) into `src/render/lucide-data.ts` (generated, git-ignored);
the other scripts run it first.

Layout:

- `src/sse.ts`, `src/studio.ts`, `src/data-api.ts`: SSE over `fetch`, the shared Studio client (config, control
  state, POST helpers, profile resolution) and the Data API client (sensor catalogue, shared per-prefix streams, history).
- `src/render/`: pure SVG renderers (keys, touch strip, sensor key).
- `src/actions/`: one class per action; `painted-key.ts` / `studio-key.ts` hold the shared behaviour.
- `com.f3nn3x.infopanel-studio.sdPlugin/`: manifest, touch-strip layout, images and property inspectors (sdpi-components v4,
  vendored in `ui/`).

## Notes

- The action icons and plugin/category images are simple placeholders drawn from lucide; replace them before publishing.
- The plugin only reads from the Studio server and posts to `/api/control/*`; it never edits the Studio config.

## Releasing

1. Bump `version` in `package.json` and `Version` in `com.f3nn3x.infopanel-studio.sdPlugin/manifest.json` (Stream Deck format, `X.Y.Z.0`), and add a `## [X.Y.Z]` entry to `CHANGELOG.md` (it becomes the release notes).
2. Commit, then push a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The *Release Build* workflow (`.github/workflows/release.yml`) runs the tests, builds, validates and packs the plugin, checks the tag matches `package.json`, and publishes `com.f3nn3x.infopanel-studio.streamDeckPlugin` to the GitHub release. It can also be run manually (workflow_dispatch) to build without releasing.
