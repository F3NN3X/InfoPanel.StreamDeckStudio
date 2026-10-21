import { describe, expect, it, vi } from "vitest";
import { ExtrasClient } from "./extras";
import { fakeConnector, fakeFetch } from "./test-utils";

function setup(base = "http://dash:3922/") {
	const c = fakeConnector();
	let url = base;
	const client = new ExtrasClient({ getBaseUrl: () => url, fetch: fakeFetch({}).fetch, connect: c.connect });
	return { client, c, setUrl: (next: string) => (url = next) };
}

const session = (key: string, patch: object = {}) => ({ key, agent: "claude", project: "demo", state: "working", since: 1, ...patch });
const extras = (sessions: unknown) => JSON.stringify({ obs: { x: 1 }, calendar: [], agents: { sessions, plan: null, usage: null } });

describe("extras client", () => {
	it("opens one stream on the first start only and closes it on the last stop", () => {
		const { client, c } = setup();
		client.start();
		client.start();
		expect(c.connections.map((x) => x.options.url)).toEqual(["http://dash:3922/events/extras"]);
		client.stop();
		expect(c.open()).toHaveLength(1);
		client.stop();
		expect(c.open()).toHaveLength(0);
		client.start();
		expect(c.open()).toHaveLength(1);
	});

	it("ignores an unbalanced stop", () => {
		const { client, c } = setup();
		client.stop();
		client.start();
		expect(c.open()).toHaveLength(1);
	});

	it("follows the stream open and close and notifies", () => {
		const { client, c } = setup();
		const listener = vi.fn();
		client.subscribe(listener);
		client.start();
		expect(client.online).toBe(false);
		c.find("/events/extras")!.options.onOpen!();
		expect(client.online).toBe(true);
		c.find("/events/extras")!.options.onClose!();
		expect(client.online).toBe(false);
		c.find("/events/extras")!.options.onClose!(); // already offline: no second notification
		expect(listener).toHaveBeenCalledTimes(2);
		c.find("/events/extras")!.options.onOpen!();
		client.stop();
		expect(client.online).toBe(false);
		expect(listener).toHaveBeenCalledTimes(4);
	});

	it("parses agent sessions in order and drops malformed entries", () => {
		const { client, c } = setup();
		client.start();
		const listener = vi.fn();
		client.subscribe(listener);
		c.find("/events/extras")!.options.onMessage(
			extras([
				session("a", { tool: "Bash" }),
				session("b", { agent: "codex", state: "waiting", project: 7 }),
				session("bad-agent", { agent: "gemini" }),
				session("bad-state", { state: "sleeping" }),
				{ agent: "claude", state: "idle" },
				null,
				"junk",
			]),
		);
		expect(client.sessions).toEqual([
			{ key: "a", agent: "claude", project: "demo", state: "working", since: 1, tool: "Bash" },
			{ key: "b", agent: "codex", project: "", state: "waiting", since: 1 },
		]);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("keeps the sessions on garbage and replaces them on every state", () => {
		const { client, c } = setup();
		client.start();
		const stream = c.find("/events/extras")!;
		stream.options.onMessage(extras([session("a")]));
		stream.options.onMessage("{not json");
		stream.options.onMessage('{"obs":1}');
		stream.options.onMessage('{"agents":{"sessions":"nope"}}');
		expect(client.sessions.map((s) => s.key)).toEqual(["a"]);
		stream.options.onMessage(extras([]));
		expect(client.sessions).toEqual([]);
	});

	it("reopens against a changed base URL only while running, and ignores the old stream", () => {
		const { client, c, setUrl } = setup("http://a");
		client.reconnect();
		expect(c.connections).toHaveLength(0);
		client.start();
		const old = c.find("/events/extras")!;
		old.options.onOpen!();
		setUrl("http://b/");
		client.reconnect();
		expect(old.closed).toBe(true);
		expect(client.online).toBe(false);
		expect(c.open().map((x) => x.options.url)).toEqual(["http://b/events/extras"]);
		old.options.onOpen!();
		old.options.onMessage(extras([session("stale")]));
		expect(client.online).toBe(false);
		expect(client.sessions).toEqual([]);
	});

	it("drops the sessions when the stream closes or reconnects", () => {
		const { client, c } = setup();
		client.start();
		c.find("/events/extras")!.options.onMessage(extras([session("a")]));
		client.reconnect();
		expect(client.sessions).toEqual([]);
		c.find("/events/extras")!.options.onMessage(extras([session("b")]));
		client.stop();
		expect(client.sessions).toEqual([]);
	});
});
