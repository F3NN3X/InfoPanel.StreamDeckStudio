// The shared client for the InfoPanel studio server: config snapshot, control state (live over
// SSE), POST helpers and the profile/page resolution the server uses. Opened by the first visible
// action and closed when none is left.

import { connectSse, type SseConnection, type SseConnector } from "./sse";

export type ThemeTokens = Record<string, string>;
export type RotateState = "on" | "off" | "toggle" | "saved";

export interface PageInfo {
	id: string;
	name: string;
	icon?: string;
}

export interface ProfileInfo {
	id: string;
	name: string;
	theme?: Partial<ThemeTokens>;
	pages: PageInfo[];
	rotate?: { enabled?: boolean; seconds?: number; pages?: string[] };
}

export type AlertSeverity = "info" | "warning" | "critical";

/** A live alert from the Studio's alert rules. */
export interface ActiveAlert {
	id: string;
	ruleId: string;
	name: string;
	severity: AlertSeverity;
	text: string;
	value?: number | string;
	unit?: string;
	startedAt: number;
	acknowledged: boolean;
	quiet?: boolean;
	test?: boolean;
}

export interface AlertRuleInfo {
	id: string;
	name: string;
	severity: AlertSeverity;
}

export interface StudioConfig {
	version: number;
	activeProfile?: string;
	theme: ThemeTokens;
	profiles: ProfileInfo[];
	alertRules: AlertRuleInfo[];
}

export interface ProfileControl {
	page: string | null;
	rotating: boolean;
	override: "on" | "off" | null;
}

export interface ControlState {
	profile: string | null;
	shown: string | null;
	profiles: Record<string, ProfileControl>;
	alerts: ActiveAlert[];
}

export interface StudioClientOptions {
	getBaseUrl: () => string;
	fetch?: typeof fetch;
	connect?: SseConnector;
}

const REQUEST_TIMEOUT_MS = 5000;

const asObject = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };

const asSeverity = (value: unknown): AlertSeverity => (value === "warning" || value === "critical" ? value : "info");

const parseAlerts = (raw: unknown): ActiveAlert[] =>
	Array.isArray(raw)
		? raw
				.filter((a) => a && typeof a.id === "string")
				.map((a) => ({ ...a, severity: asSeverity(a.severity), name: String(a.name ?? a.id), startedAt: Number(a.startedAt) || 0, acknowledged: a.acknowledged === true }))
		: [];

const parseAlertRules = (raw: unknown): AlertRuleInfo[] => {
	const rules = asObject(raw)?.rules;
	if (!Array.isArray(rules)) return [];
	return rules
		.filter((r) => r && typeof r.id === "string")
		.map((r) => ({ id: r.id as string, name: typeof r.name === "string" && r.name ? r.name : (r.id as string), severity: asSeverity(r.severity) }));
};

/** The most severe of the alerts (critical > warning > info); undefined for an empty list. */
export function worstSeverity(alerts: readonly ActiveAlert[]): AlertSeverity | undefined {
	return alerts.reduce<AlertSeverity | undefined>((worst, a) => (worst === undefined || SEVERITY_RANK[a.severity] > SEVERITY_RANK[worst] ? a.severity : worst), undefined);
}

const parseConfig =(raw: unknown): StudioConfig | undefined => {
	const obj = asObject(raw);
	if (!obj || !Array.isArray(obj.profiles)) return undefined;
	return {
		version: Number(obj.version) || 0,
		activeProfile: typeof obj.activeProfile === "string" ? obj.activeProfile : undefined,
		theme: (asObject(obj.theme) ?? {}) as ThemeTokens,
		profiles: (obj.profiles as ProfileInfo[])
			.filter((p) => p && typeof p.id === "string")
			.map((p) => ({ ...p, pages: Array.isArray(p.pages) ? p.pages : [] })),
		alertRules: parseAlertRules(obj.alerts),
	};
};

const parseControl = (raw: unknown): ControlState | undefined => {
	const obj = asObject(raw);
	const profiles = asObject(obj?.profiles);
	if (!obj || !profiles) return undefined;
	return {
		profile: typeof obj.profile === "string" ? obj.profile : null,
		shown: typeof obj.shown === "string" ? obj.shown : null,
		profiles: profiles as Record<string, ProfileControl>,
		alerts: parseAlerts(obj.alerts),
	};
};

export class StudioClient {
	config: StudioConfig | null = null;
	control: ControlState | null = null;
	/** The control stream is open. */
	online = false;

	private readonly getBaseUrl: () => string;
	private readonly doFetch: typeof fetch;
	private readonly connect: SseConnector;
	private readonly listeners = new Set<() => void>();
	private connections: SseConnection[] = [];
	private refs = 0;
	private generation = 0;

	constructor(options: StudioClientOptions) {
		this.getBaseUrl = options.getBaseUrl;
		this.doFetch = options.fetch ?? fetch;
		this.connect = options.connect ?? connectSse;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		for (const listener of [...this.listeners]) listener();
	}

	private base(): string {
		return this.getBaseUrl().replace(/\/+$/, "");
	}

	/** An action became visible. The first one opens the streams. */
	start(): void {
		this.refs++;
		if (this.refs === 1) this.open();
	}

	/** An action went away. The last one closes the streams. */
	stop(): void {
		if (this.refs === 0) return;
		this.refs--;
		if (this.refs === 0) this.close();
	}

	/** The base URL setting changed: reopen against the new one when running. */
	reconnect(): void {
		if (this.refs === 0) return;
		this.close();
		this.open();
	}

	private open(): void {
		const base = this.base();
		const generation = ++this.generation;
		const live = () => generation === this.generation;
		this.connections = [
			this.connect({
				url: `${base}/events/control`,
				fetch: this.doFetch,
				onOpen: () => {
					if (!live()) return;
					this.online = true;
					void this.refetchControl(generation);
					this.notify();
				},
				onClose: () => {
					if (!live() || !this.online) return;
					this.online = false;
					this.notify();
				},
				onMessage: (data) => {
					if (live()) this.setControl(data);
				},
			}),
			this.connect({
				url: `${base}/events/config`,
				fetch: this.doFetch,
				onOpen: () => {
					if (live()) void this.refetchConfig(generation);
				},
				onMessage: () => {
					if (live()) void this.refetchConfig(generation);
				},
			}),
		];
	}

	private close(): void {
		this.generation++;
		for (const connection of this.connections) connection.close();
		this.connections = [];
		if (this.online) {
			this.online = false;
			this.notify();
		}
	}

	private setControl(raw: unknown): void {
		let value = raw;
		if (typeof raw === "string") {
			try {
				value = JSON.parse(raw);
			} catch {
				return;
			}
		}
		const control = parseControl(value);
		if (!control) return;
		this.control = control;
		this.notify();
	}

	private async getJson(path: string): Promise<unknown> {
		const res = await this.doFetch(`${this.base()}${path}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	}

	async refetchConfig(generation = this.generation): Promise<void> {
		try {
			const config = parseConfig(await this.getJson("/api/config"));
			if (!config || generation !== this.generation) return;
			this.config = config;
			this.notify();
		} catch {
			// keep the previous config
		}
	}

	async refetchControl(generation = this.generation): Promise<void> {
		try {
			const raw = await this.getJson("/api/control");
			if (generation === this.generation) this.setControl(raw);
		} catch {
			// the stream delivers the state anyway
		}
	}

	private async post(path: string, body: Record<string, unknown>): Promise<ControlState | null> {
		try {
			const res = await this.doFetch(`${this.base()}/api/control/${path}`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Dashboard-Control": "1" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!res.ok) return null;
			const control = parseControl(await res.json());
			if (!control) return null;
			this.control = control;
			this.notify();
			return control;
		} catch {
			return null;
		}
	}

	/** Switch the page: an id, or "next" / "prev". Omit the profile to let the server pick. */
	postPage(profile: string | undefined, page: string): Promise<ControlState | null> {
		return this.post("page", profile ? { profile, page } : { page });
	}

	/** Set the profile override, or clear it with null (Auto). */
	postProfile(profile: string | null): Promise<ControlState | null> {
		return this.post("profile", { profile });
	}

	postRotate(profile: string | undefined, state: RotateState): Promise<ControlState | null> {
		return this.post("rotate", profile ? { profile, state } : { state });
	}

	/** Hold page rotation (the server only does so for a rotating profile). */
	postTouch(profile: string | undefined): Promise<ControlState | null> {
		return this.post("touch", profile ? { profile } : {});
	}

	/** Acknowledge or dismiss an alert, or fire a rule's test alert. The reply carries the alert list only. */
	async postAlert(body: { id: string; action: "ack" | "dismiss" } | { ruleId: string; action: "test" }): Promise<boolean> {
		try {
			const res = await this.doFetch(`${this.base()}/api/control/alert`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "X-Dashboard-Control": "1" },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!res.ok) return false;
			const alerts = parseAlerts(asObject(await res.json())?.alerts);
			if (this.control) {
				this.control = { ...this.control, alerts };
				this.notify();
			}
			return true;
		} catch {
			return false;
		}
	}

	/** Alerts to show: not acknowledged, not quiet, newest first. */
	visibleAlerts(): ActiveAlert[] {
		return (this.control?.alerts ?? []).filter((a) => !a.acknowledged && !a.quiet).sort((a, b) => b.startedAt - a.startedAt);
	}

	profileById(id: string | null | undefined): ProfileInfo | undefined {
		return id ? this.config?.profiles.find((p) => p.id === id) : undefined;
	}

	/** The profile an action means: its own setting, else the override, the shown one, the pinned, the first. */
	resolveProfile(settingsProfile?: string): string | null {
		const config = this.config;
		if (!config) return settingsProfile || null;
		const pinned = config.activeProfile && config.activeProfile !== "auto" ? config.activeProfile : null;
		for (const candidate of [settingsProfile, this.control?.profile, this.control?.shown, pinned]) {
			if (candidate && this.profileById(candidate)) return candidate;
		}
		return config.profiles[0]?.id ?? null;
	}

	/** Studio theme with the profile's overrides on top. */
	effectiveTheme(profileId?: string | null): ThemeTokens {
		return { ...(this.config?.theme ?? {}), ...(this.profileById(profileId)?.theme ?? {}) } as ThemeTokens;
	}

	pagesOf(profileId?: string | null): PageInfo[] {
		return this.profileById(profileId)?.pages ?? [];
	}

	/** The page a profile currently shows, from the control state (the first page before any state arrives). */
	pageOf(profileId?: string | null): PageInfo | undefined {
		const pages = this.pagesOf(profileId);
		const id = profileId ? this.control?.profiles[profileId]?.page : undefined;
		return pages.find((p) => p.id === id) ?? pages[0];
	}
}
