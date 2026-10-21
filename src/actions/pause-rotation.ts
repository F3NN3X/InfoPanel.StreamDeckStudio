import { action, type KeyDownEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import { pauseKey } from "../render/keys";
import { StudioKey, type ProfileSettings } from "./studio-key";

interface Input {
	theme: ThemeTokens;
	rotating: boolean;
	seconds: number;
}

/** The server's hold (control.mjs held): at least 30 s, or the profile's rotate period (3..3600 s, 15 by default) when longer. */
const holdSeconds = (rotateSeconds: number | undefined): number => {
	const s = Number(rotateSeconds);
	return Math.max(30, Number.isFinite(s) ? Math.max(3, Math.min(3600, s)) : 15);
};

/** Holds page rotation for a while; only does anything while the profile is rotating. */
@action({ UUID: "com.f3nn3x.infopanel-studio.pause-rotation" })
export class PauseRotation extends StudioKey<ProfileSettings, Input> {
	private rotating(profile: string | null): boolean {
		return !!profile && this.deps.studio.control?.profiles[profile]?.rotating === true;
	}

	protected input(_settings: ProfileSettings, profile: string | null): Input {
		const { studio } = this.deps;
		return { theme: studio.effectiveTheme(profile), rotating: this.rotating(profile), seconds: holdSeconds(studio.profileById(profile)?.rotate?.seconds) };
	}

	protected render(input: Input): string {
		return pauseKey(input);
	}

	override async onKeyDown(ev: KeyDownEvent<ProfileSettings>): Promise<void> {
		const { studio } = this.deps;
		const arg = this.profileArg(ev.payload.settings);
		const ok = studio.online && this.rotating(studio.resolveProfile(arg)) && !!(await studio.postTouch(arg));
		await (ok ? ev.action.showOk() : ev.action.showAlert());
	}
}
