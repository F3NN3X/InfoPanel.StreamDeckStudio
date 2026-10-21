import { action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";
import { worstSeverity, type AlertSeverity, type ThemeTokens } from "../studio";
import { alertsKey } from "../render/keys";
import { HOLD_MS } from "./auto-rotate";
import { StudioKey, type ProfileSettings } from "./studio-key";

interface Input {
	theme: ThemeTokens;
	count: number;
	severity?: AlertSeverity;
	name?: string;
}

/** Count of visible alerts: press acknowledges the newest, hold dismisses it. */
@action({ UUID: "com.f3nn3x.infopanel-studio.alerts" })
export class Alerts extends StudioKey<ProfileSettings, Input> {
	private readonly downAt = new Map<string, number>();

	protected input(_settings: ProfileSettings, profile: string | null): Input {
		const { studio } = this.deps;
		const visible = studio.visibleAlerts();
		return { theme: studio.effectiveTheme(profile), count: visible.length, severity: worstSeverity(visible), name: visible[0]?.name };
	}

	protected render(input: Input): string {
		return alertsKey(input);
	}

	override onKeyDown(ev: KeyDownEvent<ProfileSettings>): void {
		this.downAt.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<ProfileSettings>): Promise<void> {
		const start = this.downAt.get(ev.action.id);
		this.downAt.delete(ev.action.id);
		const { studio } = this.deps;
		const held = start !== undefined && Date.now() - start >= HOLD_MS;
		// A hold also dismisses an acknowledged alert, but never a quiet one.
		const target = held
			? [...(studio.control?.alerts ?? [])].filter((a) => !a.quiet).sort((a, b) => b.startedAt - a.startedAt)[0]
			: studio.visibleAlerts()[0];
		if (!studio.online || !target || !(await studio.postAlert({ id: target.id, action: held ? "dismiss" : "ack" }))) await ev.action.showAlert();
	}
}
