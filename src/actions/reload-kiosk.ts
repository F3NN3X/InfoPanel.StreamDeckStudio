import { action, type KeyDownEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import { reloadKey } from "../render/keys";
import { StudioKey, type ProfileSettings } from "./studio-key";

interface Input {
	theme: ThemeTokens;
	name: string;
}

/** Reloads the kiosk of a profile, or every kiosk. */
@action({ UUID: "com.f3nn3x.infopanel-studio.reload-kiosk" })
export class ReloadKiosk extends StudioKey<ProfileSettings, Input> {
	protected override profileLead = "all" as const;

	protected input(settings: ProfileSettings, profile: string | null): Input {
		const { studio } = this.deps;
		const chosen = studio.profileById(settings.profile || undefined);
		return { theme: studio.effectiveTheme(profile), name: settings.profile ? chosen?.name || settings.profile : "All kiosks" };
	}

	protected render(input: Input): string {
		return reloadKey(input);
	}

	override async onKeyDown(ev: KeyDownEvent<ProfileSettings>): Promise<void> {
		const { studio } = this.deps;
		const ok = studio.online && !!(await studio.postReload(this.profileArg(ev.payload.settings)));
		await (ok ? ev.action.showOk() : ev.action.showAlert());
	}
}
