import streamDeck, { action, type DidReceiveSettingsEvent, type KeyDownEvent, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import type { ThemeTokens } from "../studio";
import { sensorKey } from "../render/sensor";
import { runtime, type Deps } from "../runtime";
import { formatValue, severity, type Severity } from "../sensor-format";
import { throttle, type Throttle } from "../throttle";
import { eventOf, pageItems, profileItems, sensorItems } from "./datasource";
import { PaintedKey, type Entry, type View } from "./painted-key";

/** A sensor key repaints at most 4 times a second. */
export const REPAINT_MS = 250;

export type SensorSettings = {
	sensor?: string;
	label?: string;
	unit?: string;
	decimals?: number | string;
	warn?: number | string;
	crit?: number | string;
	/** Lower is worse. */
	invert?: boolean;
	/** Page to open on press. */
	page?: string;
	profile?: string;
	/** PI-only: narrows the sensor list. */
	sensorFilter?: string;
} & JsonObject;

interface Input {
	theme: ThemeTokens;
	label: string;
	value?: string;
	unit?: string;
	severity: Severity;
	history: readonly number[];
}

const keyTail = (key: string) => key.slice(key.lastIndexOf(".") + 1);

@action({ UUID: "com.f3nn3x.infopanel-studio.sensor-value" })
export class SensorValue extends PaintedKey<SensorSettings> {
	private readonly subscriptions = new Map<string, { sensor: string; stop: () => void }>();
	private readonly gates = new Map<string, Throttle>();
	private unsubscribe: (() => void) | undefined;

	constructor(private readonly deps: Deps = runtime) {
		super();
	}

	protected view(settings: SensorSettings): View {
		const { studio, dataApi } = this.deps;
		const sensor = settings.sensor;
		const reading = sensor ? dataApi.get(sensor) : undefined;
		const number = typeof reading?.value === "number" ? reading.value : undefined;
		const input: Input = {
			theme: studio.effectiveTheme(studio.resolveProfile(settings.profile || undefined)),
			label: settings.label?.trim() || reading?.name || (sensor ? keyTail(sensor) : "Pick a sensor"),
			value: number !== undefined ? formatValue(number, settings.decimals) : reading?.text || undefined,
			unit: settings.unit?.trim() || reading?.unit || undefined,
			severity: severity(number, settings.warn, settings.crit, settings.invert === true),
			history: sensor ? dataApi.history(sensor) : [],
		};
		return { key: JSON.stringify(input), svg: () => sensorKey(input) };
	}

	private paintLater(id: string): void {
		this.gates.get(id)?.call(() => {
			const entry = this.entries.get(id);
			if (entry) this.paint(entry);
		});
	}

	private follow(entry: Entry<SensorSettings>): void {
		const id = entry.action.id;
		const sensor = entry.settings.sensor;
		if (this.subscriptions.get(id)?.sensor === sensor) return;
		this.subscriptions.get(id)?.stop();
		this.subscriptions.delete(id);
		if (sensor) this.subscriptions.set(id, { sensor, stop: this.deps.dataApi.subscribe(sensor, () => this.paintLater(id)) });
	}

	protected override appeared(entry: Entry<SensorSettings>): void {
		this.gates.set(entry.action.id, throttle(REPAINT_MS));
		this.deps.studio.start();
		this.unsubscribe ??= this.deps.studio.subscribe(() => {
			for (const id of this.entries.keys()) this.paintLater(id);
		});
		this.follow(entry);
	}

	protected override disappeared(entry: Entry<SensorSettings>): void {
		const id = entry.action.id;
		this.subscriptions.get(id)?.stop();
		this.subscriptions.delete(id);
		this.gates.get(id)?.cancel();
		this.gates.delete(id);
		this.deps.studio.stop();
		if (this.entries.size === 0) {
			this.unsubscribe?.();
			this.unsubscribe = undefined;
		}
	}

	protected override settingsChanged(entry: Entry<SensorSettings>): void {
		this.follow(entry);
	}

	override async onKeyDown(ev: KeyDownEvent<SensorSettings>): Promise<void> {
		const { page, profile } = ev.payload.settings;
		if (!page) return;
		if (!this.deps.studio.online || !(await this.deps.studio.postPage(profile || undefined, page))) await ev.action.showAlert();
	}

	private async sendSensors(settings: SensorSettings, refresh: boolean): Promise<void> {
		const sensors = await this.deps.dataApi.catalogue(refresh);
		await streamDeck.ui.sendToPropertyInspector({ event: "getSensors", items: sensorItems(sensors, settings.sensorFilter, settings.sensor) });
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, SensorSettings>): Promise<void> {
		const event = eventOf(ev.payload);
		const settings = await ev.action.getSettings();
		const { studio } = this.deps;
		if (event === "getSensors") await this.sendSensors(settings, true);
		else if (event === "getProfiles") await streamDeck.ui.sendToPropertyInspector({ event, items: profileItems(studio, "shown") });
		else if (event === "getPages") await streamDeck.ui.sendToPropertyInspector({ event, items: pageItems(studio, settings.profile) });
	}

	// The sensor list follows the filter, the page list follows the profile.
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SensorSettings>): void {
		super.onDidReceiveSettings(ev);
		void this.sendSensors(ev.payload.settings, false);
		void streamDeck.ui.sendToPropertyInspector({ event: "getPages", items: pageItems(this.deps.studio, ev.payload.settings.profile) });
	}
}
