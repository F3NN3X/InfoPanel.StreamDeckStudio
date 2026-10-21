# Changelog

## [Unreleased]

## [0.3.0]

Nine new actions for alerts, the kiosk displays, rotation, coding agents and sensors. Open
`com.f3nn3x.infopanel-studio.streamDeckPlugin` to install or update.

Alerts
- **Alerts** key: count of Studio's visible alerts, filled by the worst severity, with the newest alert's name.
  Press acknowledges the newest, a 1 s hold dismisses it.
- **Test alert** key: fires a chosen alert rule's test alert.
- **Mute alerts** key: mutes alerts for a chosen number of minutes (1-1440, default 30), unmutes when pressed while
  muted, and counts the time left down on the key.

Kiosk display (need InfoPanel Studio 1.3.0-beta.7 or later)
- **Reload kiosk** key: reloads one profile's kiosk, or every kiosk.
- **Dim display** key: dims or restores a profile's display, at an optional level (10-90%).
- **Island** key: shows or hides the island; a 1 s hold goes back to the profile's own setting, shown as
  `saved: on/off` while overridden.

Rotation, agents and sensors
- **Pause rotation** key: holds rotation for 30 s, or the rotate period when that is longer.
- **Coding agents** key: shows when a Claude Code or Codex session waits for you (amber, with the project), else how
  many are working; agent filter and an optional page to open.
- **Sensor (dial)** action for Stream Deck +: label, value and bar on the touch strip; keeps showing readings while
  only Studio is down.
- Sensor value: new **Style** (sparkline or bar) and **Bar max** settings; the bar defaults to 0-100 for % and ° units.

Other
- The release workflow is pinned to action commit SHAs, keeps write access in a separate release job, and moves to
  Node 24; Dependabot keeps the actions current.
- README rewritten as a full reference: requirements, every action's press, face and settings, and the Studio API
  the plugin uses.

## [0.2.0]

Renamed to **InfoPanel Studio** to follow the app. Open `com.f3nn3x.infopanel-studio.streamDeckPlugin` to install.

- **Breaking:** the plugin UUID is now `com.f3nn3x.infopanel-studio`, so Stream Deck installs it as a new plugin.
  Remove the old "InfoPanel Dashboard" plugin, place the keys again, and re-enter the Studio URL under Connection.
- Next page / Previous page keys show the name of the page a press goes to instead of the current page.
- Actions are listed under the **InfoPanel Studio** category.

## [0.1.0]

First release: go to page, next / previous page, switch profile, auto-rotate, page cycler (Stream Deck +) and
sensor value actions.
