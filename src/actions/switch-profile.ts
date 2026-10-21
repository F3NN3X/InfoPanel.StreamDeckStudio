import { action, type KeyDownEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import { profileKey } from "../render/keys";
import { StudioKey, type ProfileSettings } from "./studio-key";

interface Input {
	theme: ThemeTokens;
	name: string;
	active: boolean;
}

/** Settings: `profile` is a profile id, or "" for Auto (clears the override). */
@action({ UUID: "com.f3nn3x.infopanel-studio.switch-profile" })
export class SwitchProfile extends StudioKey<ProfileSettings, Input> {
	protected override profileLead = "auto" as const;

	protected input(settings: ProfileSettings): Input {
		const { studio } = this.deps;
		const id = settings.profile || null;
		return {
			// The face wears the theme of the profile it switches to; Auto uses whichever is resolved.
			theme: studio.effectiveTheme(studio.resolveProfile(id ?? undefined)),
			name: id ? (studio.profileById(id)?.name ?? id) : "Auto",
			active: (studio.control?.profile ?? null) === id,
		};
	}

	protected render(input: Input): string {
		return profileKey(input);
	}

	override async onKeyDown(ev: KeyDownEvent<ProfileSettings>): Promise<void> {
		if (!this.deps.studio.online) return ev.action.showAlert();
		const state = await this.deps.studio.postProfile(ev.payload.settings.profile || null);
		await (state ? ev.action.showOk() : ev.action.showAlert());
	}
}
