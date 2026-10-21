import { describe, expect, it, vi } from "vitest";
import { StudioClient, worstSeverity, type ActiveAlert, type StudioConfig, type ControlState } from "./studio";
import { fakeConnector, fakeFetch, flush, json } from "./test-utils";

const config: StudioConfig = {
	version: 3,
	activeProfile: "strip",
	theme: { background: "240 10% 3.9%", primary: "0 0% 98%" },
	alertRules: [],
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
	alerts: [],
	mutedUntil: null,
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

const alert = (id: string, patch: Partial<ActiveAlert> = {}): ActiveAlert => ({
	id,
	ruleId: "r1",
	name: id,
	severity: "info",
	text: "",
	startedAt: 1,
	acknowledged: false,
	...patch,
});

describe("alerts", () => {
	const withAlerts = (alerts: unknown) => JSON.stringify({ ...control, alerts });

	it("parses the alert list, keeping entries with a string id and defaulting to none", () => {
		const { client, c } = setup();
		client.start();
		const stream = c.find("/events/control")!;
		stream.options.onMessage(JSON.stringify({ profile: null, shown: "strip", profiles: {} }));
		expect(client.control?.alerts).toEqual([]);
		stream.options.onMessage(withAlerts("nope"));
		expect(client.control?.alerts).toEqual([]);
		stream.options.onMessage(withAlerts([{ id: "a1", name: "CPU", severity: "critical", startedAt: 5, acknowledged: true }, { name: "no id" }, null, { id: 7 }, { id: "a2", severity: "weird" }]));
		expect(client.control?.alerts.map((a) => a.id)).toEqual(["a1", "a2"]);
		expect(client.control?.alerts[0]).toMatchObject({ name: "CPU", severity: "critical", startedAt: 5, acknowledged: true });
		expect(client.control?.alerts[1]).toMatchObject({ name: "a2", severity: "info", startedAt: 0, acknowledged: false });
	});

	it("parses the alert rules from the config, falling back to the id for a missing name", async () => {
		const { client } = setup({
			"/api/config": () => json({ ...config, alerts: { enabled: true, rules: [{ id: "r1", name: "CPU hot", severity: "critical" }, { id: "r2", severity: "warning" }, { name: "no id" }, "junk"] } }),
		});
		await client.refetchConfig();
		expect(client.config?.alertRules).toEqual([
			{ id: "r1", name: "CPU hot", severity: "critical" },
			{ id: "r2", name: "r2", severity: "warning" },
		]);
		const plain = setup();
		await plain.client.refetchConfig();
		expect(plain.client.config?.alertRules).toEqual([]);
	});

	it("lists visible alerts newest first, without acknowledged or quiet ones", () => {
		const { client } = setup();
		expect(client.visibleAlerts()).toEqual([]);
		client.control = {
			...control,
			alerts: [alert("old", { startedAt: 1 }), alert("acked", { startedAt: 9, acknowledged: true }), alert("new", { startedAt: 5 }), alert("quiet", { startedAt: 8, quiet: true })],
		};
		expect(client.visibleAlerts().map((a) => a.id)).toEqual(["new", "old"]);
		expect(client.control.alerts.map((a) => a.id)).toEqual(["old", "acked", "new", "quiet"]); // the state itself is not reordered
	});

	it("ranks critical over warning over info", () => {
		expect(worstSeverity([])).toBeUndefined();
		expect(worstSeverity([alert("a")])).toBe("info");
		expect(worstSeverity([alert("a"), alert("b", { severity: "warning" }), alert("c")])).toBe("warning");
		expect(worstSeverity([alert("a", { severity: "critical" }), alert("b", { severity: "warning" })])).toBe("critical");
	});

	it("posts an alert action and replaces the alerts from the reply without touching the rest", async () => {
		const { client, f } = setup({ "/api/control/alert": () => json({ alerts: [{ id: "left", name: "Left", severity: "warning", startedAt: 2 }] }) });
		client.control = { ...control, alerts: [alert("a1")] };
		const before = client.control;
		const listener = vi.fn();
		client.subscribe(listener);
		expect(await client.postAlert({ id: "a1", action: "ack" })).toBe(true);
		const call = f.calls.find((x) => x.url.endsWith("/api/control/alert"))!;
		expect(JSON.parse(String(call.init?.body))).toEqual({ id: "a1", action: "ack" });
		expect(call.init?.headers).toEqual({ "Content-Type": "application/json", "X-Dashboard-Control": "1" });
		expect(client.control?.alerts.map((a) => a.id)).toEqual(["left"]);
		expect(client.control?.shown).toBe("strip");
		expect(before.alerts.map((a) => a.id)).toEqual(["a1"]); // replaced immutably
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("sends a rule id for a test alert", async () => {
		const { client, f } = setup({ "/api/control/alert": () => json({ alerts: [] }) });
		expect(await client.postAlert({ ruleId: "r1", action: "test" })).toBe(true);
		expect(JSON.parse(String(f.calls.at(-1)!.init?.body))).toEqual({ ruleId: "r1", action: "test" });
	});

	it("returns false and keeps the alerts when the server refuses or the request fails", async () => {
		const refused = setup({ "/api/control/alert": () => json({ error: "unknown" }, 400) });
		refused.client.control = { ...control, alerts: [alert("a1")] };
		expect(await refused.client.postAlert({ id: "gone", action: "dismiss" })).toBe(false);
		expect(refused.client.control.alerts.map((a) => a.id)).toEqual(["a1"]);
		const broken = setup({
			"/api/control/alert": () => {
				throw new Error("down");
			},
		});
		expect(await broken.client.postAlert({ id: "a1", action: "ack" })).toBe(false);
	});
});

describe("touch", () => {
	it("posts the profile when given and an empty body otherwise, and applies the returned state", async () => {
		const { client, f } = setup({ "/api/control/touch": () => json({ ...control, shown: "main" }) });
		expect(await client.postTouch("main")).toMatchObject({ shown: "main" });
		expect(JSON.parse(String(f.calls.at(-1)!.init?.body))).toEqual({ profile: "main" });
		await client.postTouch(undefined);
		expect(JSON.parse(String(f.calls.at(-1)!.init?.body))).toEqual({});
		expect(f.calls.at(-1)!.url).toBe("http://dash:3922/api/control/touch");
		expect(client.control?.shown).toBe("main");
	});
});

describe("mute and kiosk controls", () => {
	const feed = (raw: unknown) => {
		const { client, c } = setup();
		client.start();
		c.find("/events/control")!.options.onMessage(JSON.stringify(raw));
		return client;
	};

	it("parses mutedUntil, and the per-profile kiosk fields when present", () => {
		const client = feed({
			...control,
			mutedUntil: 1234,
			profiles: { main: { page: "p1", rotating: false, override: null, dim: 0.6, island: true, islandOverride: "off", reload: 3 } },
		});
		expect(client.control?.mutedUntil).toBe(1234);
		expect(client.control?.profiles.main).toMatchObject({ dim: 0.6, island: true, islandOverride: "off" });
	});

	it("takes a missing or malformed mutedUntil as not muted, and tolerates older servers without the kiosk fields", () => {
		expect(feed({ profile: null, shown: null, profiles: {} }).control?.mutedUntil).toBeNull();
		expect(feed({ ...control, mutedUntil: "soon" }).control?.mutedUntil).toBeNull();
		expect(feed({ ...control, mutedUntil: Number.NaN }).control?.mutedUntil).toBeNull();
		expect(feed({ ...control, mutedUntil: 99 }).control?.profiles.main?.dim).toBeUndefined();
	});

	it("posts mute minutes, 0 to unmute, and stores mutedUntil with the alerts from the reply", async () => {
		const { client, f } = setup({ "/api/control/alert": () => json({ alerts: [], mutedUntil: 5000 }) });
		client.control = control;
		expect(await client.postMute(30)).toBe(true);
		expect(JSON.parse(String(f.calls.at(-1)!.init?.body))).toEqual({ action: "mute", minutes: 30 });
		expect(client.control?.mutedUntil).toBe(5000);
		expect(control.mutedUntil).toBeNull(); // replaced immutably
		const off = setup({ "/api/control/alert": () => json({ alerts: [], mutedUntil: null }) });
		off.client.control = { ...control, mutedUntil: 5000 };
		expect(await off.client.postMute(0)).toBe(true);
		expect(JSON.parse(String(off.f.calls.at(-1)!.init?.body))).toEqual({ action: "mute", minutes: 0 });
		expect(off.client.control?.mutedUntil).toBeNull();
	});

	it("keeps the stored mutedUntil when the alert reply does not carry one", async () => {
		const { client } = setup({ "/api/control/alert": () => json({ alerts: [] }) });
		client.control = { ...control, mutedUntil: 5000 };
		await client.postAlert({ id: "a1", action: "ack" });
		expect(client.control?.mutedUntil).toBe(5000);
	});

	it("posts kiosk bodies, leaving out profile and level when undefined", async () => {
		const { client, f } = setup({ "/api/control/kiosk": () => json(control) });
		const last = () => JSON.parse(String(f.calls.at(-1)!.init?.body));
		expect(await client.postReload(undefined)).toEqual(control);
		expect(f.calls.at(-1)!.url).toBe("http://dash:3922/api/control/kiosk");
		expect(f.calls.at(-1)!.init?.headers).toEqual({ "Content-Type": "application/json", "X-Dashboard-Control": "1" });
		expect(last()).toEqual({ action: "reload" });
		await client.postReload("main");
		expect(last()).toEqual({ action: "reload", profile: "main" });
		await client.postDim(undefined, "toggle");
		expect(last()).toEqual({ action: "dim", state: "toggle" });
		await client.postDim("main", "on", 0.4);
		expect(last()).toEqual({ action: "dim", profile: "main", state: "on", level: 0.4 });
		await client.postIsland(undefined, "toggle");
		expect(last()).toEqual({ action: "island", state: "toggle" });
		await client.postIsland("main", "saved");
		expect(last()).toEqual({ action: "island", profile: "main", state: "saved" });
		await client.postKiosk({ action: "reload" });
		expect(last()).toEqual({ action: "reload" });
	});

	it("returns null for a refused kiosk post", async () => {
		const { client } = setup({ "/api/control/kiosk": () => new Response("bad", { status: 400 }) });
		expect(await client.postReload(undefined)).toBeNull();
	});

	it("reports the mute left, 0 when not muted or expired", () => {
		const { client } = setup();
		expect(client.mutedFor(1000)).toBe(0); // no state yet
		client.control = control;
		expect(client.mutedFor(1000)).toBe(0);
		client.control = { ...control, mutedUntil: 5000 };
		expect(client.mutedFor(1000)).toBe(4000);
		expect(client.mutedFor(5000)).toBe(0);
		expect(client.mutedFor(9000)).toBe(0);
		vi.useFakeTimers();
		vi.setSystemTime(2000);
		expect(client.mutedFor()).toBe(3000);
		vi.useRealTimers();
	});
});
