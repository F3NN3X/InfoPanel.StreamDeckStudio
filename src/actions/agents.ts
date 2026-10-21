import { action, type DidReceiveSettingsEvent, type KeyDownEvent } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import type { AgentKind } from "../extras";
import { agentsKey, offlineKey } from "../render/keys";
import { StudioKey, type ProfileSettings } from "./studio-key";
import type { Entry, View } from "./painted-key";

export type AgentsSettings = { agent?: "" | AgentKind; page?: string } & ProfileSettings;

interface Input {
	theme: ThemeTokens;
	waiting: number;
	working: number;
	project?: string;
}

/** Coding-agent sessions (Claude, Codex): waiting for you beats working beats idle. Press opens a page. */
@action({ UUID: "com.f3nn3x.infopanel-studio.agents" })
export class Agents extends StudioKey<AgentsSettings, Input> {
	private unsubscribeExtras: (() => void) | undefined;

	protected override view(settings: AgentsSettings): View {
		const { studio, extras } = this.deps;
		if (extras.online) return super.view(settings);
		const theme = studio.effectiveTheme(studio.resolveProfile(settings.profile || undefined));
		return { key: `offline:${JSON.stringify(theme)}`, svg: () => offlineKey(theme) };
	}

	protected input(settings: AgentsSettings, profile: string | null): Input {
		const sessions = this.deps.extras.sessions.filter((s) => !settings.agent || s.agent === settings.agent);
		const waiting = sessions.filter((s) => s.state === "waiting").sort((a, b) => b.since - a.since);
		return {
			theme: this.deps.studio.effectiveTheme(profile),
			waiting: waiting.length,
			working: sessions.filter((s) => s.state === "working").length,
			project: waiting[0]?.project,
		};
	}

	protected render(input: Input): string {
		return agentsKey(input);
	}

	protected override appeared(entry: Entry<AgentsSettings>): void {
		super.appeared(entry);
		this.deps.extras.start();
		this.unsubscribeExtras ??= this.deps.extras.subscribe(() => this.paintAll());
	}

	protected override disappeared(entry: Entry<AgentsSettings>): void {
		super.disappeared(entry);
		this.deps.extras.stop();
		if (this.entries.size === 0) {
			this.unsubscribeExtras?.();
			this.unsubscribeExtras = undefined;
		}
	}

	override async onKeyDown(ev: KeyDownEvent<AgentsSettings>): Promise<void> {
		const { page, profile } = ev.payload.settings;
		if (!page) return;
		if (!this.deps.studio.online || !(await this.deps.studio.postPage(profile || undefined, page))) await ev.action.showAlert();
	}

	// The page select follows the chosen profile.
	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<AgentsSettings>): void {
		super.onDidReceiveSettings(ev);
		void this.sendPages(ev.payload.settings.profile);
	}
}
