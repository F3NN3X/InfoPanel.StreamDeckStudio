import { action, type DidReceiveSettingsEvent, type KeyDownEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import { pageKey } from "../render/keys";
import { StudioKey, type ProfileSettings } from "./studio-key";

export type GoToPageSettings = { page?: string } & ProfileSettings;

interface Input {
	theme: ThemeTokens;
	icon?: string;
	name: string;
	active: boolean;
}

@action({ UUID: "com.f3nn3x.infopanel-studio.go-to-page" })
export class GoToPage extends StudioKey<GoToPageSettings, Input> {
	protected input(settings: GoToPageSettings, profile: string | null): Input {
		const { studio } = this.deps;
		const page = studio.pagesOf(profile).find((p) => p.id === settings.page);
		return {
			theme: studio.effectiveTheme(profile),
			icon: page?.icon,
			name: page?.name ?? (settings.page ? settings.page : "Pick a page"),
			active: !!settings.page && !!profile && studio.control?.profiles[profile]?.page === settings.page,
		};
	}

	protected render(input: Input): string {
		return pageKey(input);
	}

	override async onKeyDown(ev: KeyDownEvent<GoToPageSettings>): Promise<void> {
		const { page, profile } = ev.payload.settings;
		if (!page || !this.deps.studio.online) return ev.action.showAlert();
		if (!(await this.deps.studio.postPage(profile || undefined, page))) await ev.action.showAlert();
	}

	// The page select follows the chosen profile.
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<GoToPageSettings>): void {
		super.onDidReceiveSettings(ev);
		void this.sendPages(ev.payload.settings.profile);
	}
}
