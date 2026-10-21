import { action, type KeyDownEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import { navKey } from "../render/keys";
import { StudioKey, type ProfileSettings } from "./studio-key";

interface Input {
	theme: ThemeTokens;
	pageName: string;
}

/** Next / previous page of a profile (wrapping); the face shows the page the profile is on. */
abstract class StepPage extends StudioKey<ProfileSettings, Input> {
	protected abstract readonly direction: "next" | "prev";

	protected input(_settings: ProfileSettings, profile: string | null): Input {
		const { studio } = this.deps;
		return { theme: studio.effectiveTheme(profile), pageName: studio.pageOf(profile)?.name ?? "" };
	}

	protected render(input: Input): string {
		return navKey({ ...input, direction: this.direction });
	}

	override async onKeyDown(ev: KeyDownEvent<ProfileSettings>): Promise<void> {
		if (!this.deps.studio.online) return ev.action.showAlert();
		if (!(await this.deps.studio.postPage(ev.payload.settings.profile || undefined, this.direction))) await ev.action.showAlert();
	}
}

@action({ UUID: "com.f3nn3x.infopanel-studio.next-page" })
export class NextPage extends StepPage {
	protected readonly direction = "next";
}

@action({ UUID: "com.f3nn3x.infopanel-studio.prev-page" })
export class PrevPage extends StepPage {
	protected readonly direction = "prev";
}
