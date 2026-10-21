import { action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";
import type { ProfileInfo, ThemeTokens } from "../studio";
import { islandKey } from "../render/keys";
import { HOLD_MS } from "./auto-rotate";
import { StudioKey, type ProfileSettings } from "./studio-key";

interface Input {
	theme: ThemeTokens;
	island: boolean;
	override: "on" | "off" | null;
	saved: boolean;
}

const asOverride = (value: unknown): "on" | "off" | null => (value === "on" || value === "off" ? value : null);

/** The profile's own island setting, as the studio reads it: configured and not switched off. */
export const savedIsland = (profile: ProfileInfo | undefined): boolean => !!profile?.island && profile.island.enabled !== false;

/** Shows or hides the kiosk's island: press toggles, hold 1 s goes back to the saved setting. */
@action({ UUID: "com.f3nn3x.infopanel-studio.island" })
export class Island extends StudioKey<ProfileSettings, Input> {
	private readonly downAt = new Map<string, number>();

	protected input(_settings: ProfileSettings, profile: string | null): Input {
		const { studio } = this.deps;
		const control = profile ? studio.control?.profiles[profile] : undefined;
		return {
			theme: studio.effectiveTheme(profile),
			island: control?.island === true,
			override: asOverride(control?.islandOverride),
			saved: savedIsland(studio.profileById(profile)),
		};
	}

	protected render(input: Input): string {
		return islandKey(input);
	}

	override onKeyDown(ev: KeyDownEvent<ProfileSettings>): void {
		this.downAt.set(ev.action.id, Date.now());
	}

	override async onKeyUp(ev: KeyUpEvent<ProfileSettings>): Promise<void> {
		const start = this.downAt.get(ev.action.id);
		this.downAt.delete(ev.action.id);
		const { studio } = this.deps;
		if (!studio.online) return ev.action.showAlert();
		const profile = this.profileArg(ev.payload.settings);
		const held = start !== undefined && Date.now() - start >= HOLD_MS;
		const resolved = studio.resolveProfile(profile);
		const overridden = asOverride(resolved ? studio.control?.profiles[resolved]?.islandOverride : undefined) !== null;
		const state = await studio.postIsland(profile, held ? "saved" : "toggle");
		if (!state) await ev.action.showAlert();
		else if (held && !overridden) await ev.action.showOk();
	}
}
