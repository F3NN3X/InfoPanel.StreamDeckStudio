// What the sensor key and the sensor dial share: the settings, the reading -> face input logic and
// the property inspector's datasource answers.

import streamDeck, { type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import type { ThemeTokens } from "../studio";
import type { Deps } from "../runtime";
import { barFraction, barMaxOf, formatValue, severity, type Severity } from "../sensor-format";
import { eventOf, pageItems, profileItems, sensorItems } from "./datasource";

export type SensorSettings = {
	sensor?: string;
	label?: string;
	unit?: string;
	decimals?: number | string;
	warn?: number | string;
	crit?: number | string;
	/** Lower is worse. */
	invert?: boolean;
	/** The key shows a sparkline (default) or a bar; the dial always shows a bar. */
	style?: "sparkline" | "bar";
	/** Where the bar is full; blank = 100 for percent and degree units. */
	barMax?: number | string;
	/** Page to open on press. */
	page?: string;
	profile?: string;
	/** PI-only: narrows the sensor list. */
	sensorFilter?: string;
} & JsonObject;

export interface SensorInput {
	theme: ThemeTokens;
	label: string;
	value?: string;
	unit?: string;
	severity: Severity;
	history: readonly number[];
	/** How full the bar is (0..1); undefined without a number or a bar max. */
	bar?: number;
}

const keyTail = (key: string) => key.slice(key.lastIndexOf(".") + 1);

/** The face input for a sensor's settings and its latest reading. */
export function sensorInput({ studio, dataApi }: Deps, settings: SensorSettings): SensorInput {
	const sensor = settings.sensor;
	const reading = sensor ? dataApi.get(sensor) : undefined;
	const number = typeof reading?.value === "number" ? reading.value : undefined;
	const unit = settings.unit?.trim() || reading?.unit || undefined;
	return {
		theme: studio.effectiveTheme(studio.resolveProfile(settings.profile || undefined)),
		label: settings.label?.trim() || reading?.name || (sensor ? keyTail(sensor) : "Pick a sensor"),
		value: number !== undefined ? formatValue(number, settings.decimals) : reading?.text || undefined,
		unit,
		severity: severity(number, settings.warn, settings.crit, settings.invert === true),
		history: sensor ? dataApi.history(sensor) : [],
		bar: barFraction(number, barMaxOf(settings.barMax, unit)),
	};
}

/** Open the configured page; false when there is none to open or the press failed. */
export async function openPage(deps: Deps, settings: SensorSettings): Promise<boolean> {
	return !!settings.page && deps.studio.online && !!(await deps.studio.postPage(settings.profile || undefined, settings.page));
}

async function sendSensors(deps: Deps, settings: SensorSettings, refresh: boolean): Promise<void> {
	const sensors = await deps.dataApi.catalogue(refresh);
	await streamDeck.ui.sendToPropertyInspector({ event: "getSensors", items: sensorItems(sensors, settings.sensorFilter, settings.sensor) });
}

/** Answer the inspector's sensor, profile and page selects. */
export async function answerSensorInspector(deps: Deps, ev: SendToPluginEvent<JsonValue, SensorSettings>): Promise<void> {
	const event = eventOf(ev.payload);
	const settings = await ev.action.getSettings();
	if (event === "getSensors") await sendSensors(deps, settings, true);
	else if (event === "getProfiles") await streamDeck.ui.sendToPropertyInspector({ event, items: profileItems(deps.studio, "shown") });
	else if (event === "getPages") await streamDeck.ui.sendToPropertyInspector({ event, items: pageItems(deps.studio, settings.profile) });
}

/** The sensor list follows the filter, the page list follows the profile. */
export function refreshInspector(deps: Deps, settings: SensorSettings): void {
	void sendSensors(deps, settings, false);
	void streamDeck.ui.sendToPropertyInspector({ event: "getPages", items: pageItems(deps.studio, settings.profile) });
}
