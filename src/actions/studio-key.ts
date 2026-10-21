// Base for the page-control keys: follows the shared studio client, draws the offline face when
// it cannot be reached, and answers the property inspector's profile and page selects.

import streamDeck, { type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import type { ThemeTokens } from "../studio";
import { offlineKey } from "../render/keys";
import { runtime, type Deps } from "../runtime";
import { eventOf, pageItems, profileItems } from "./datasource";
import { PaintedKey, type Entry, type View } from "./painted-key";

export type ProfileSettings = { profile?: string } & JsonObject;

export abstract class StudioKey<S extends ProfileSettings, I extends { theme: ThemeTokens }> extends PaintedKey<S> {
	private unsubscribe: (() => void) | undefined;

	constructor(protected readonly deps: Deps = runtime) {
		super();
	}

	/** What the face depends on, given the resolved profile. */
	protected abstract input(settings: S, profile: string | null): I;
	protected abstract render(input: I): string;
	/** Which entry leads the profile select: the shown profile (page keys), Auto (switch profile) or all kiosks (reload). */
	protected profileLead: "shown" | "auto" | "all" = "shown";

	protected view(settings: S): View {
		const { studio } = this.deps;
		const profile = studio.resolveProfile(settings.profile || undefined);
		if (!studio.online) {
			const theme = studio.effectiveTheme(profile);
			return { key: `offline:${JSON.stringify(theme)}`, svg: () => offlineKey(theme) };
		}
		const input = this.input(settings, profile);
		return { key: JSON.stringify(input), svg: () => this.render(input) };
	}

	protected override appeared(_entry: Entry<S>): void {
		this.deps.studio.start();
		this.unsubscribe ??= this.deps.studio.subscribe(() => this.paintAll());
	}

	protected override disappeared(_entry: Entry<S>): void {
		this.deps.studio.stop();
		if (this.entries.size === 0) {
			this.unsubscribe?.();
			this.unsubscribe = undefined;
		}
	}

	/** The settings profile as the server would resolve it for a press (undefined = let the server pick). */
	protected profileArg(settings: S): string | undefined {
		return settings.profile || undefined;
	}

	protected async sendProfiles(): Promise<void> {
		await streamDeck.ui.sendToPropertyInspector({ event: "getProfiles", items: profileItems(this.deps.studio, this.profileLead) });
	}

	protected async sendPages(profile: string | undefined): Promise<void> {
		await streamDeck.ui.sendToPropertyInspector({ event: "getPages", items: pageItems(this.deps.studio, profile) });
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, S>): Promise<void> {
		const event = eventOf(ev.payload);
		if (event === "getProfiles") await this.sendProfiles();
		else if (event === "getPages") await this.sendPages((await ev.action.getSettings()).profile);
	}
}
