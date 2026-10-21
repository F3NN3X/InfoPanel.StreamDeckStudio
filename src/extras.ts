// The client for the studio server's extras stream (coding-agent sessions). Opened by the first
// visible agents key and closed when none is left; obs and calendar data in the stream are ignored.

import { connectSse, type SseConnection, type SseConnector } from "./sse";

export type AgentKind = "claude" | "codex";
export type AgentState = "working" | "waiting" | "done" | "error" | "idle";

export interface AgentSession {
	key: string;
	agent: AgentKind;
	project: string;
	state: AgentState;
	since: number;
	tool?: string;
}

export interface ExtrasClientOptions {
	getBaseUrl: () => string;
	fetch?: typeof fetch;
	connect?: SseConnector;
}

const AGENTS: readonly string[] = ["claude", "codex"];
const STATES: readonly string[] = ["working", "waiting", "done", "error", "idle"];

const parseSessions = (raw: unknown): AgentSession[] | undefined => {
	const agents = (raw as { agents?: { sessions?: unknown } } | null | undefined)?.agents;
	if (!agents || !Array.isArray(agents.sessions)) return undefined;
	return agents.sessions
		.filter((s) => s && typeof s.key === "string" && AGENTS.includes(s.agent) && STATES.includes(s.state))
		.map((s) => ({
			key: s.key,
			agent: s.agent,
			project: typeof s.project === "string" ? s.project : "",
			state: s.state,
			since: Number(s.since) || 0,
			...(typeof s.tool === "string" ? { tool: s.tool } : {}),
		}));
};

export class ExtrasClient {
	/** Agent sessions, newest first. */
	sessions: AgentSession[] = [];
	/** The extras stream is open. */
	online = false;

	private readonly getBaseUrl: () => string;
	private readonly doFetch: typeof fetch;
	private readonly connect: SseConnector;
	private readonly listeners = new Set<() => void>();
	private connection: SseConnection | undefined;
	private refs = 0;
	private generation = 0;

	constructor(options: ExtrasClientOptions) {
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

	/** An agents key became visible. The first one opens the stream. */
	start(): void {
		this.refs++;
		if (this.refs === 1) this.open();
	}

	/** An agents key went away. The last one closes the stream. */
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
		const generation = ++this.generation;
		const live = () => generation === this.generation;
		this.connection = this.connect({
			url: `${this.getBaseUrl().replace(/\/+$/, "")}/events/extras`,
			fetch: this.doFetch,
			onOpen: () => {
				if (!live()) return;
				this.online = true;
				this.notify();
			},
			onClose: () => {
				if (!live() || !this.online) return;
				this.online = false;
				this.notify();
			},
			onMessage: (data) => {
				if (live()) this.setExtras(data);
			},
		});
	}

	private close(): void {
		this.generation++;
		this.connection?.close();
		this.connection = undefined;
		this.sessions = [];
		if (this.online) {
			this.online = false;
			this.notify();
		}
	}

	private setExtras(raw: unknown): void {
		let value = raw;
		if (typeof raw === "string") {
			try {
				value = JSON.parse(raw);
			} catch {
				return;
			}
		}
		const sessions = parseSessions(value);
		if (!sessions) return;
		this.sessions = sessions;
		this.notify();
	}
}
