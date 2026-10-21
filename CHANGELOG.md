# Changelog

## [Unreleased]

- **Alerts** key: count of the Studio's visible alerts, filled by the worst severity; press acknowledges the newest, hold dismisses it.
- **Test alert** key: fires a chosen alert rule's test alert.
- **Pause rotation** key: holds page rotation (Studio's touch) while the profile is rotating.
- **Coding agents** key: shows whether Claude Code / Codex sessions are waiting for you or working, with an agent filter and an optional page to open.
- **Sensor (dial)** action for Stream Deck +: label, value and bar on the touch strip.
- Sensor value: new **Style** (sparkline or bar) and **Bar max** settings; the bar defaults to 0-100 for % and ° units.

## [0.2.0]

Renamed to **InfoPanel Studio** to follow the app. Open `com.f3nn3x.infopanel-studio.streamDeckPlugin` to install.

- **Breaking:** the plugin UUID is now `com.f3nn3x.infopanel-studio`, so Stream Deck installs it as a new plugin.
  Remove the old "InfoPanel Dashboard" plugin, place the keys again, and re-enter the Studio URL under Connection.
- Next page / Previous page keys show the name of the page a press goes to instead of the current page.
- Actions are listed under the **InfoPanel Studio** category.

## [0.1.0]

First release: go to page, next / previous page, switch profile, auto-rotate, page cycler (Stream Deck +) and
sensor value actions.
