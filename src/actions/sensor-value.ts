import { action, type DidReceiveSettingsEvent, type KeyDownEvent, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import { sensorKey } from "../render/sensor";
import { runtime, type Deps } from "../runtime";
import { throttle, type Throttle } from "../throttle";
import { PaintedKey, type Entry, type View } from "./painted-key";
import { answerSensorInspector, openPage, refreshInspector, sensorInput, type SensorSettings } from "./sensor-input";

/** A sensor key repaints at most 4 times a second. */
export const REPAINT_MS = 250;

export type { SensorSettings };

@action({ UUID: "com.f3nn3x.infopanel-studio.sensor-value" })
export class SensorValue extends PaintedKey<SensorSettings> {
	private readonly subscriptions = new Map<string, { sensor: string; stop: () => void }>();
	private readonly gates = new Map<string, Throttle>();
	private unsubscribe: (() => void) | undefined;

	constructor(private readonly deps: Deps = runtime) {
		super();
	}

	protected view(settings: SensorSettings): View {
		const { bar, ...rest } = sensorInput(this.deps, settings);
		// Only the bar style draws the bar; without a bar max (or a number) the key falls back to the sparkline.
		const input = settings.style === "bar" ? { ...rest, bar } : rest;
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
		if (!ev.payload.settings.page) return;
		if (!(await openPage(this.deps, ev.payload.settings))) await ev.action.showAlert();
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, SensorSettings>): Promise<void> {
		await answerSensorInspector(this.deps, ev);
	}

	// The sensor list follows the filter, the page list follows the profile.
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SensorSettings>): void {
		super.onDidReceiveSettings(ev);
		refreshInspector(this.deps, ev.payload.settings);
	}
}
