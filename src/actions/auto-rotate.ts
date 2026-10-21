import { action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import { rotateKey } from "../render/keys";
import { StudioKey, type ProfileSettings } from "./studio-key";

/** Holding the key at least this long restores the saved setting instead of toggling. */
export const HOLD_MS = 1000;

interface Input {
	theme: ThemeTokens;
	rotating: boolean;
	disabled: boolean;
	override: "on" | "off" | null;
	saved: boolean;
}

@action({ UUID: "com.f3nn3x.infopanel-studio.auto-rotate" })
export class AutoRotate extends StudioKey<ProfileSettings, Input> {
	private readonly downAt = new Map<string, number>();

	protected input(_settings: ProfileSettings, profile: string | null): Input {
		const { studio } = this.deps;
		const control = profile ? studio.control?.profiles[profile] : undefined;
		return {
			theme: studio.effectiveTheme(profile),
			rotating: control?.rotating === true,
			disabled: studio.pagesOf(profile).length < 2,
			override: control?.override ?? null,
			saved: studio.profileById(profile)?.rotate?.enabled === true,
		};
	}

	protected render(input: Input): string {
		return rotateKey(input);
	}

	override onKeyDown(ev: KeyDownEvent<ProfileSettings>): void {
		this.downAt.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<ProfileSettings>): Promise<void> {
		const start = this.downAt.get(ev.action.id);
		this.downAt.delete(ev.action.id);
		const { studio } = this.deps;
		const profile = ev.payload.settings.profile || undefined;
		if (!studio.online || studio.pagesOf(studio.resolveProfile(profile)).length < 2) return ev.action.showAlert();
		const held = start !== undefined && Date.now() - start >= HOLD_MS;
		const state = await studio.postRotate(profile, held ? "saved" : "toggle");
		await (state ? ev.action.showOk() : ev.action.showAlert());
	}
}
