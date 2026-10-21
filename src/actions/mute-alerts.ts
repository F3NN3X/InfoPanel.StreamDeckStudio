import { action, type KeyDownEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import { muteKey } from "../render/keys";
import { toNumber } from "../sensor-format";
import { StudioKey, type ProfileSettings } from "./studio-key";
import type { Entry } from "./painted-key";

export type MuteSettings = { minutes?: number | string } & ProfileSettings;

interface Input {
	theme: ThemeTokens;
	minutes: number;
	left: number;
}

const MINUTE_MS = 60_000;

/** How long a press mutes for: the setting in whole minutes, within the server's 1..1440. */
const muteMinutes = (setting: number | string | undefined): number => Math.round(Math.min(1440, Math.max(1, toNumber(setting) ?? 30)));

/** Mutes alerts for a while; pressed while muted it unmutes. The remaining time ticks down on the face. */
@action({ UUID: "com.f3nn3x.infopanel-studio.mute-alerts" })
export class MuteAlerts extends StudioKey<MuteSettings, Input> {
	private timer: ReturnType<typeof setTimeout> | undefined;

	protected input(settings: MuteSettings, profile: string | null): Input {
		const { studio } = this.deps;
		return { theme: studio.effectiveTheme(profile), minutes: muteMinutes(settings.minutes), left: Math.ceil(studio.mutedFor() / MINUTE_MS) };
	}

	protected render(input: Input): string {
		return muteKey(input);
	}

	/** Repaint when the remaining minutes next change, for as long as a visible key is muted. */
	private arm(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
		const { studio } = this.deps;
		const left = studio.mutedFor();
		if (this.entries.size === 0 || !studio.online || left <= 0) return;
		this.timer = setTimeout(() => this.paintAll(), left - (Math.ceil(left / MINUTE_MS) - 1) * MINUTE_MS);
	}

	protected override paint(entry: Entry<MuteSettings>): void {
		super.paint(entry);
		this.arm();
	}

	protected override disappeared(entry: Entry<MuteSettings>): void {
		super.disappeared(entry);
		this.arm();
	}

	override async onKeyDown(ev: KeyDownEvent<MuteSettings>): Promise<void> {
		const { studio } = this.deps;
		const minutes = studio.mutedFor() > 0 ? 0 : muteMinutes(ev.payload.settings.minutes);
		if (!studio.online || !(await studio.postMute(minutes))) await ev.action.showAlert();
	}
}
