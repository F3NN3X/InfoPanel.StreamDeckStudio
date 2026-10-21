import streamDeck from "@elgato/streamdeck";

import { Agents } from "./actions/agents";
import { Alerts } from "./actions/alerts";
import { AutoRotate } from "./actions/auto-rotate";
import { Dim } from "./actions/dim";
import { GoToPage } from "./actions/go-to-page";
import { Island } from "./actions/island";
import { MuteAlerts } from "./actions/mute-alerts";
import { PageCycler } from "./actions/page-cycler";
import { PauseRotation } from "./actions/pause-rotation";
import { ReloadKiosk } from "./actions/reload-kiosk";
import { SensorDial } from "./actions/sensor-dial";
import { SensorValue } from "./actions/sensor-value";
import { NextPage, PrevPage } from "./actions/step-page";
import { SwitchProfile } from "./actions/switch-profile";
import { TestAlert } from "./actions/test-alert";
import { applyConnection, type ConnectionSettings } from "./runtime";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new GoToPage());
streamDeck.actions.registerAction(new NextPage());
streamDeck.actions.registerAction(new PrevPage());
streamDeck.actions.registerAction(new SwitchProfile());
streamDeck.actions.registerAction(new AutoRotate());
streamDeck.actions.registerAction(new PageCycler());
streamDeck.actions.registerAction(new SensorValue());
streamDeck.actions.registerAction(new SensorDial());
streamDeck.actions.registerAction(new Alerts());
streamDeck.actions.registerAction(new TestAlert());
streamDeck.actions.registerAction(new PauseRotation());
streamDeck.actions.registerAction(new Agents());
streamDeck.actions.registerAction(new MuteAlerts());
streamDeck.actions.registerAction(new ReloadKiosk());
streamDeck.actions.registerAction(new Dim());
streamDeck.actions.registerAction(new Island());

// Server addresses live in the global settings, edited in every action's property inspector.
streamDeck.settings.onDidReceiveGlobalSettings<ConnectionSettings>((ev) => applyConnection(ev.settings));

await streamDeck.connect();
applyConnection(await streamDeck.settings.getGlobalSettings<ConnectionSettings>());
