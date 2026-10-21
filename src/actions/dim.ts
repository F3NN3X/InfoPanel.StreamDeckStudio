import { action, type KeyDownEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import { dimKey } from "../render/keys";
import { toNumber } from "../sensor-format";
import { StudioKey, type ProfileSettings } from "./studio-key";

export type DimSettings = { level?: number | string } & ProfileSettings;

interface Input {
	theme: ThemeTokens;
	dim: number;
}

/** The level setting (a percent, 10..90) as the server's 0.1..0.9; undefined lets the server use its remembered level. */
const dimLevel = (setting: number | string | undefined): number | undefined => {
	const percent = toNumber(setting);
	return percent === undefined ? undefined : Math.round(Math.min(90, Math.max(10, percent))) / 100;
};

/** Dims a profile's kiosk display, or brings it back. */
@action({ UUID: "com.f3nn3x.infopanel-studio.dim" })
export class Dim extends StudioKey<DimSettings, Input> {
	protected input(_settings: DimSettings, profile: string | null): Input {
		const { studio } = this.deps;
		const dim = profile ? studio.control?.profiles[profile]?.dim : undefined;
		return { theme: studio.effectiveTheme(profile), dim: typeof dim === "number" && dim > 0 ? dim : 0 };
	}

	protected render(input: Input): string {
		return dimKey(input);
	}

	override async onKeyDown(ev: KeyDownEvent<DimSettings>): Promise<void> {
		const { studio } = this.deps;
		const { settings } = ev.payload;
		if (!studio.online || !(await studio.postDim(this.profileArg(settings), "toggle", dimLevel(settings.level)))) await ev.action.showAlert();
	}
}
