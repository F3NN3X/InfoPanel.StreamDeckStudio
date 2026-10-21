import { describe, expect, it, vi } from "vitest";
import { StudioClient, type StudioConfig, type ControlState } from "./studio";
import { fakeConnector, fakeFetch, flush, json } from "./test-utils";

const config: StudioConfig = {
	version: 3,
	activeProfile: "strip",
	theme: { background: "240 10% 3.9%", primary: "0 0% 98%" },
	profiles: [
		{
			id: "main",
			name: "Main",
			theme: { primary: "10 80% 50%" },
			pages: [
				{ id: "p1", name: "Main", icon: "layout-dashboard" },
				{ id: "p2", name: "Gaming", icon: "gamepad-2" },
			],
		},
		{ id: "strip", name: "Strip", pages: [{ id: "s1", name: "One" }] },
	],
};

const control: ControlState = {
	profile: null,
	shown: "strip",
	profiles: {
		main: { page: "p2", rotating: false, override: null },
		strip: { page: "s1", rotating: true, override: "on" },
	},
};

function setup(routes: Record<string, () => Response> = {}) {
	const f = fakeFetch({
		"/api/config": () => json(config),
		"/api/control": () => json(control),
		...routes,
	});
	const c = fakeConnector();
	const client = new StudioClient({ getBaseUrl: () => "http://dash:3922/", fetch: f.fetch, connect: c.connect });
	return { client, f, c };
}

describe("ref-counted start/stop", () => {
	it("opens the streams on the first start only and closes on the last stop", () => {
		const { client, c } = setup();
		client.start();
		client.start();
		expect(c.connections.map((x) => x.options.url)).toEqual(["http://dash:3922/events/control", "http://dash:3922/events/config"]);
		client.stop();
		expect(c.open()).toHaveLength(2);
		client.stop();
		expect(c.open()).toHaveLength(0);
		client.start();
		expect(c.open()).toHaveLength(2);
	});

	it("ignores an unbalanced stop", () => {
		const { client, c } = setup();
		client.stop();
		client.start();
		expect(c.open()).toHaveLength(2);
	});

	it("goes offline when stopped and notifies", async () => {
		const { client, c } = setup();
		const listener = vi.fn();
		client.subscribe(listener);
		client.start();
		c.find("/events/control")!.options.onOpen!();
		expect(client.online).toBe(true);
		client.stop();
		expect(client.online).toBe(false);
		expect(listener).toHaveBeenCalled();
	});

	it("reopens against a changed base URL", () => {
		let base = "http://a";
		const c = fakeConnector();
		const client = new StudioClient({ getBaseUrl: () => base, fetch: fakeFetch({}).fetch, connect: c.connect });
		client.start();
		base = "http://b";
		client.reconnect();
		expect(c.open().map((x) => x.options.url)).toEqual(["http://b/events/control", "http://b/events/config"]);
	});
});

describe("snapshots and streams", () => {
	it("refetches control and config when the streams open, including after a reconnect", async () => {
		const { client, f, c } = setup();
		client.start();
		c.find("/events/control")!.options.onOpen!();
		c.find("/events/config")!.options.onOpen!();
		await flush(10);
		expect(client.config?.profiles).toHaveLength(2);
		expect(client.control?.shown).toBe("strip");
		const before = f.calls.length;
		c.find("/events/control")!.options.onClose!();
		expect(client.online).toBe(false);
		c.find("/events/control")!.options.onOpen!();
		await flush(10);
		expect(f.calls.length).toBeGreaterThan(before);
		expect(client.online).toBe(true);
	});

	it("refetches the config on every config event", async () => {
		const { client, f, c } = setup();
		client.start();
		c.find("/events/config")!.options.onMessage('{"version":4}');
		c.find("/events/config")!.options.onMessage('{"version":5}');
		await flush(10);
		expect(f.calls.filter((x) => x.url.endsWith("/api/config"))).toHaveLength(2);
	});

	it("applies control events and ignores garbage", () => {
		const { client, c } = setup();
		client.start();
		const listener = vi.fn();
		client.subscribe(listener);
		c.find("/events/control")!.options.onMessage("{not json");
		c.find("/events/control")!.options.onMessage('{"nope":1}');
		expect(client.control).toBeNull();
		c.find("/events/control")!.options.onMessage(JSON.stringify(control));
		expect(client.control?.profiles.main?.page).toBe("p2");
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("keeps the old config when a refetch fails", async () => {
		let fail = false;
		const { client } = setup({ "/api/config": () => (fail ? json({}, 500) : json(config)) });
		await client.refetchConfig();
		fail = true;
		await client.refetchConfig();
		expect(client.config?.version).toBe(3);
	});

	it("drops results that arrive after stop", async () => {
		const { client } = setup();
		client.start();
		const pending = client.refetchConfig();
		client.stop();
		await pending;
		expect(client.config).toBeNull();
	});
});

describe("POST helpers", () => {
	it("sends the control header, JSON body and updates the state", async () => {
		const { client, f } = setup({ "/api/control/page": () => json(control) });
		const result = await client.postPage("main", "next");
		const call = f.calls.at(-1)!;
		expect(call.url).toBe("http://dash:3922/api/control/page");
		expect(call.init?.method).toBe("POST");
		expect(call.init?.headers).toEqual({ "Content-Type": "application/json", "X-Dashboard-Control": "1" });
		expect(JSON.parse(String(call.init?.body))).toEqual({ profile: "main", page: "next" });
		expect(result).toEqual(control);
		expect(client.control).toEqual(control);
	});

	it("omits the profile when none is given", async () => {
		const { client, f } = setup({ "/api/control/page": () => json(control), "/api/control/rotate": () => json(control) });
		await client.postPage(undefined, "p1");
		expect(JSON.parse(String(f.calls.at(-1)?.init?.body))).toEqual({ page: "p1" });
		await client.postRotate(undefined, "toggle");
		expect(JSON.parse(String(f.calls.at(-1)?.init?.body))).toEqual({ state: "toggle" });
		await client.postRotate("main", "saved");
		expect(JSON.parse(String(f.calls.at(-1)?.init?.body))).toEqual({ profile: "main", state: "saved" });
	});

	it("posts a null profile to clear the override", async () => {
		const { client, f } = setup({ "/api/control/profile": () => json(control) });
		await client.postProfile(null);
		expect(f.calls.at(-1)?.url).toBe("http://dash:3922/api/control/profile");
		expect(JSON.parse(String(f.calls.at(-1)?.init?.body))).toEqual({ profile: null });
	});

	it("returns null on a 400, a bad body and a network error, never throwing", async () => {
		const { client } = setup({ "/api/control/page": () => new Response("unknown page", { status: 400 }) });
		expect(await client.postPage("main", "nope")).toBeNull();
		const bad = setup({ "/api/control/page": () => json({ weird: true }) });
		expect(await bad.client.postPage("main", "p1")).toBeNull();
		const down = new StudioClient({
			getBaseUrl: () => "http://x",
			fetch: (async () => {
				throw new Error("ECONNREFUSED");
			}) as typeof fetch,
			connect: fakeConnector().connect,
		});
		expect(await down.postProfile("main")).toBeNull();
		expect(await down.postRotate(undefined, "on")).toBeNull();
	});
});

describe("resolution helpers", () => {
	async function loaded(state: Partial<ControlState> = {}) {
		const { client } = setup();
		await client.refetchConfig();
		client.control = { ...control, ...state };
		return client;
	}

	it("prefers the settings profile, then override, shown, pinned, first", async () => {
		const client = await loaded();
		expect(client.resolveProfile("main")).toBe("main");
		expect(client.resolveProfile()).toBe("strip"); // shown
		expect((await loaded({ profile: "main" })).resolveProfile()).toBe("main"); // override beats shown
		expect((await loaded({ shown: null })).resolveProfile()).toBe("strip"); // pinned
		const unpinned = await loaded({ shown: null });
		unpinned.config = { ...config, activeProfile: "auto" };
		expect(unpinned.resolveProfile()).toBe("main"); // first
		expect(client.resolveProfile("gone")).toBe("strip");
	});

	it("falls back to the settings value before the config has loaded", () => {
		const { client } = setup();
		expect(client.resolveProfile("main")).toBe("main");
		expect(client.resolveProfile()).toBeNull();
	});

	it("merges the profile theme over the studio theme", async () => {
		const client = await loaded();
		expect(client.effectiveTheme("main")).toEqual({ background: "240 10% 3.9%", primary: "10 80% 50%" });
		expect(client.effectiveTheme("strip")).toEqual(config.theme);
		expect(client.effectiveTheme(null)).toEqual(config.theme);
	});

	it("lists pages and finds the current one, defaulting to the first", async () => {
		const client = await loaded();
		expect(client.pagesOf("main").map((p) => p.id)).toEqual(["p1", "p2"]);
		expect(client.pageOf("main")?.id).toBe("p2");
		client.control = null;
		expect(client.pageOf("main")?.id).toBe("p1");
		expect(client.pageOf("nope")).toBeUndefined();
		expect(client.pagesOf(undefined)).toEqual([]);
	});
});
