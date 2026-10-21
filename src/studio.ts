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

export interface StudioConfig {
	version: number;
	activeProfile?: string;
	theme: ThemeTokens;
	profiles: ProfileInfo[];
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
}

export interface StudioClientOptions {
	getBaseUrl: () => string;
	fetch?: typeof fetch;
	connect?: SseConnector;
}

const REQUEST_TIMEOUT_MS = 5000;

const asObject = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const parseConfig = (raw: unknown): StudioConfig | undefined => {
	const obj = asObject(raw);
	if (!obj || !Array.isArray(obj.profiles)) return undefined;
	return {
		version: Number(obj.version) || 0,
		activeProfile: typeof obj.activeProfile === "string" ? obj.activeProfile : undefined,
		theme: (asObject(obj.theme) ?? {}) as ThemeTokens,
		profiles: (obj.profiles as ProfileInfo[])
			.filter((p) => p && typeof p.id === "string")
			.map((p) => ({ ...p, pages: Array.isArray(p.pages) ? p.pages : [] })),
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
