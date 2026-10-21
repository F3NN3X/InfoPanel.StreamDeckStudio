import streamDeck, { action, type KeyDownEvent, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";
import type { AlertSeverity, ThemeTokens } from "../studio";
import { testAlertKey } from "../render/keys";
import { eventOf, ruleItems } from "./datasource";
import { StudioKey, type ProfileSettings } from "./studio-key";

export type TestAlertSettings = { rule?: string } & ProfileSettings;

interface Input {
	theme: ThemeTokens;
	name?: string;
	severity?: AlertSeverity;
}

/** Fires a rule's test alert, so the Studio's alert styling can be previewed. */
@action({ UUID: "com.f3nn3x.infopanel-studio.test-alert" })
export class TestAlert extends StudioKey<TestAlertSettings, Input> {
	protected input(settings: TestAlertSettings, profile: string | null): Input {
		const { studio } = this.deps;
		const rule = studio.config?.alertRules.find((r) => r.id === settings.rule);
		return { theme: studio.effectiveTheme(profile), name: rule?.name, severity: rule?.severity };
	}

	protected render(input: Input): string {
		return testAlertKey(input);
	}

	override async onKeyDown(ev: KeyDownEvent<TestAlertSettings>): Promise<void> {
		const { rule } = ev.payload.settings;
		const ok = !!rule && this.deps.studio.online && (await this.deps.studio.postAlert({ ruleId: rule, action: "test" }));
		await (ok ? ev.action.showOk() : ev.action.showAlert());
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, TestAlertSettings>): Promise<void> {
		if (eventOf(ev.payload) === "getRules") await streamDeck.ui.sendToPropertyInspector({ event: "getRules", items: ruleItems(this.deps.studio) });
		else await super.onSendToPlugin(ev);
	}
}
