import {
	action,
	SingletonAction,
	type DialAction,
	type DialDownEvent,
	type DidReceiveSettingsEvent,
	type SendToPluginEvent,
	type TouchTapEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { sensorFeedback } from "../render/strip";
import { runtime, type Deps } from "../runtime";
import { throttle, type Throttle } from "../throttle";
import { answerSensorInspector, openPage, refreshInspector, sensorInput, type SensorSettings } from "./sensor-input";
import { REPAINT_MS } from "./sensor-value";

interface Entry {
	action: DialAction<SensorSettings>;
	settings: SensorSettings;
	gate: Throttle;
	stop?: { sensor: string; stop: () => void };
	painted?: string;
}

/** Stream Deck + dial: label, live value and a bar on the touch strip; press or touch opens a page. */
@action({ UUID: "com.f3nn3x.infopanel-studio.sensor-dial" })
export class SensorDial extends SingletonAction<SensorSettings> {
	private readonly entries = new Map<string, Entry>();
	private unsubscribe: (() => void) | undefined;

	constructor(private readonly deps: Deps = runtime) {
		super();
	}

	private paint(entry: Entry): void {
		const { bar, ...input } = sensorInput(this.deps, entry.settings);
		// The value comes from the Data API: muted only when there is no reading and Studio (the theme) is down too.
		const offline = !this.deps.studio.online && (!entry.settings.sensor || this.deps.dataApi.get(entry.settings.sensor) === undefined);
		const feedback = sensorFeedback({ ...input, bar, offline });
		const key = JSON.stringify(feedback);
		if (entry.painted === key) return;
		entry.painted = key;
		void entry.action.setFeedback(feedback);
	}

	private paintLater(entry: Entry): void {
		entry.gate.call(() => this.paint(entry));
	}

	private follow(entry: Entry): void {
		const sensor = entry.settings.sensor;
		if (entry.stop?.sensor === sensor) return;
		entry.stop?.stop();
		entry.stop = sensor ? { sensor, stop: this.deps.dataApi.subscribe(sensor, () => this.paintLater(entry)) } : undefined;
	}

	override onWillAppear(ev: WillAppearEvent<SensorSettings>): void {
		if (!ev.action.isDial()) return;
		const entry: Entry = { action: ev.action, settings: ev.payload.settings, gate: throttle(REPAINT_MS) };
		this.entries.set(ev.action.id, entry);
		this.deps.studio.start();
		this.unsubscribe ??= this.deps.studio.subscribe(() => {
			for (const each of this.entries.values()) this.paintLater(each);
		});
		this.follow(entry);
		this.paint(entry);
	}

	override onWillDisappear(ev: WillDisappearEvent<SensorSettings>): void {
		const entry = this.entries.get(ev.action.id);
		if (!entry) return;
		entry.gate.cancel();
		entry.stop?.stop();
		this.entries.delete(ev.action.id);
		this.deps.studio.stop();
		if (this.entries.size === 0) {
			this.unsubscribe?.();
			this.unsubscribe = undefined;
		}
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SensorSettings>): void {
		const entry = this.entries.get(ev.action.id);
		if (!entry) return;
		entry.settings = ev.payload.settings;
		this.follow(entry);
		this.paint(entry);
		refreshInspector(this.deps, ev.payload.settings);
	}

	private async open(action: DialAction<SensorSettings>, settings: SensorSettings): Promise<void> {
		if (settings.page && !(await openPage(this.deps, settings))) await action.showAlert();
	}

	override onDialDown(ev: DialDownEvent<SensorSettings>): Promise<void> {
		return this.open(ev.action, ev.payload.settings);
	}

	override onTouchTap(ev: TouchTapEvent<SensorSettings>): Promise<void> {
		return this.open(ev.action, ev.payload.settings);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, SensorSettings>): Promise<void> {
		await answerSensorInspector(this.deps, ev);
	}
}
