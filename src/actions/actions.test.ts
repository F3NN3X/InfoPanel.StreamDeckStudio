import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@elgato/streamdeck", () => {
	class SingletonAction {}
	return {
		action: () => (target: unknown) => target,
		SingletonAction,
		default: { ui: { sendToPropertyInspector: vi.fn() }, logger: { info: vi.fn() } },
	};
});

import streamDeck from "@elgato/streamdeck";
import { StudioClient, type ControlState, type StudioConfig } from "../studio";
import { DataApi } from "../data-api";
import type { Deps } from "../runtime";
import { palette } from "../render/color";
import { fakeConnector, fakeFetch, flush, json } from "../test-utils";
import { AutoRotate, HOLD_MS } from "./auto-rotate";
import { GoToPage } from "./go-to-page";
import { PageCycler, ROTATE_THROTTLE_MS } from "./page-cycler";
import { REPAINT_MS, SensorValue } from "./sensor-value";
import { NextPage, PrevPage } from "./step-page";
import { SwitchProfile } from "./switch-profile";

const config: StudioConfig = {
	version: 3,
	activeProfile: "main",
	theme: { primary: "200 80% 50%" },
	profiles: [
		{
			id: "main",
			name: "Main",
			rotate: { enabled: true },
			pages: [
				{ id: "p1", name: "Overview", icon: "layout-dashboard" },
				{ id: "p2", name: "Gaming", icon: "gamepad-2" },
				{ id: "p3", name: "Music" },
			],
		},
		{ id: "solo", name: "Solo", pages: [{ id: "s1", name: "Only" }] },
	],
};

const P = palette(config.theme);

const control = (patch: Partial<ControlState> = {}): ControlState => ({
	profile: null,
	shown: "main",
	profiles: {
		main: { page: "p2", rotating: false, override: null },
		solo: { page: "s1", rotating: false, override: null },
	},
	...patch,
});

/** A studio client that is online with the config and control state loaded. */
async function onlineDeps(state: ControlState = control()) {
	const posts: { path: string; body: unknown }[] = [];
	let reply: Response | (() => Response) = json(state);
	const f = fakeFetch({
		"/api/config": () => json(config),
		"/api/control": () => json(state),
		"/api/control/page": (init) => record("page", init),
		"/api/control/profile": (init) => record("profile", init),
		"/api/control/rotate": (init) => record("rotate", init),
	});
	function record(path: string, init?: RequestInit) {
		posts.push({ path, body: JSON.parse(String(init?.body)) });
		return typeof reply === "function" ? reply() : reply.clone();
	}
	const c = fakeConnector();
	const studio = new StudioClient({ getBaseUrl: () => "http://d", fetch: f.fetch, connect: c.connect });
	const dataApi = new DataApi({ getBaseUrl: () => "http://s", fetch: f.fetch, connect: c.connect });
	await studio.refetchConfig();
	studio.control = state;
	const deps: Deps = { studio, dataApi };
	return {
		deps,
		posts,
		connector: c,
		goOnline: () => {
			const stream = c.find("/events/control");
			if (stream) stream.options.onOpen!();
			else studio.online = true; // nothing started yet: pretend the stream was open already
		},
		failPosts: () => (reply = new Response("bad", { status: 400 })),
		studio,
		dataApi,
	};
}

function keyAction(id = "k1") {
	return {
		id,
		isKey: () => true,
		isDial: () => false,
		setImage: vi.fn(async (_image: string) => {}),
		showOk: vi.fn(async () => {}),
		showAlert: vi.fn(async () => {}),
		getSettings: vi.fn(async () => ({})),
	};
}

function dialAction(id = "d1") {
	return {
		id,
		isKey: () => false,
		isDial: () => true,
		setFeedback: vi.fn(async (_payload: unknown) => {}),
		showAlert: vi.fn(async () => {}),
	};
}

const appear = (a: { action: unknown; settings: object }, instance: { onWillAppear?: (ev: never) => unknown }) =>
	instance.onWillAppear!({ action: a.action, payload: { settings: a.settings } } as never);

const decode = (call: unknown[]) => decodeURIComponent(String(call[0]).replace("data:image/svg+xml,", ""));

beforeEach(() => vi.mocked(streamDeck.ui.sendToPropertyInspector).mockClear());

describe("go to page", () => {
	it("draws the page, active only while the control state shows it, and repaints only on change", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new GoToPage(t.deps);
		const a = keyAction();
		appear({ action: a, settings: { page: "p2" } }, key);
		expect(t.studio.online).toBe(true);
		expect(a.setImage).toHaveBeenCalledTimes(1);
		const svg = decode(a.setImage.mock.calls[0]!);
		expect(svg).toContain(">Gaming</text>");
		expect(svg).toContain(`<rect width="144" height="144" fill="${P.primary}"/>`); // filled: p2 is the active page

		// a notification with identical inputs must not reach the key
		t.studio.control = control();
		t.studio.subscribe(() => {});
		(t.studio as unknown as { notify: () => void }).notify();
		expect(a.setImage).toHaveBeenCalledTimes(1);

		// another page becomes active: the face changes
		t.studio.control = control({ profiles: { main: { page: "p1", rotating: false, override: null }, solo: { page: "s1", rotating: false, override: null } } });
		(t.studio as unknown as { notify: () => void }).notify();
		expect(a.setImage).toHaveBeenCalledTimes(2);
		expect(decode(a.setImage.mock.calls[1]!)).not.toBe(svg);
	});

	it("posts the chosen page to the chosen profile on press", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new GoToPage(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { page: "p3", profile: "main" } } } as never);
		expect(t.posts).toEqual([{ path: "page", body: { profile: "main", page: "p3" } }]);
		expect(a.showAlert).not.toHaveBeenCalled();
		expect(a.showOk).not.toHaveBeenCalled();
	});

	it("omits the profile for 'shown' and alerts on failure, offline or without a page", async () => {
		const t = await onlineDeps();
		const key = new GoToPage(t.deps);
		const offline = keyAction();
		await key.onKeyDown({ action: offline, payload: { settings: { page: "p1" } } } as never);
		expect(offline.showAlert).toHaveBeenCalledTimes(1);
		expect(t.posts).toEqual([]);

		t.goOnline();
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { page: "p1", profile: "" } } } as never);
		expect(t.posts).toEqual([{ path: "page", body: { page: "p1" } }]);
		await key.onKeyDown({ action: a, payload: { settings: {} } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
		t.failPosts();
		await key.onKeyDown({ action: a, payload: { settings: { page: "p1" } } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(2);
	});

	it("shows the offline face while the studio is unreachable, then recovers", async () => {
		const t = await onlineDeps();
		const key = new GoToPage(t.deps);
		const a = keyAction();
		appear({ action: a, settings: { page: "p1" } }, key);
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">Offline</text>");
		t.goOnline();
		expect(decode(a.setImage.mock.calls[1]!)).toContain(">Overview</text>");
	});

	it("starts the client for the first key and stops it with the last", async () => {
		const t = await onlineDeps();
		const key = new GoToPage(t.deps);
		const a = keyAction("a");
		const b = keyAction("b");
		appear({ action: a, settings: {} }, key);
		appear({ action: b, settings: {} }, key);
		expect(t.connector.open()).toHaveLength(2);
		key.onWillDisappear({ action: { id: "a" } } as never);
		expect(t.connector.open()).toHaveLength(2);
		key.onWillDisappear({ action: { id: "b" } } as never);
		expect(t.connector.open()).toHaveLength(0);
	});

	it("answers the inspector's datasource requests and follows the profile", async () => {
		const t = await onlineDeps();
		const key = new GoToPage(t.deps);
		const a = keyAction();
		a.getSettings.mockResolvedValue({ profile: "solo" });
		await key.onSendToPlugin({ action: a, payload: { event: "getPages" } } as never);
		expect(streamDeck.ui.sendToPropertyInspector).toHaveBeenLastCalledWith({ event: "getPages", items: [{ label: "Only", value: "s1" }] });
		await key.onSendToPlugin({ action: a, payload: { event: "getProfiles" } } as never);
		expect(vi.mocked(streamDeck.ui.sendToPropertyInspector).mock.calls.at(-1)![0]).toMatchObject({ event: "getProfiles" });
		appear({ action: a, settings: { profile: "solo" } }, key);
		key.onDidReceiveSettings({ action: a, payload: { settings: { profile: "main" } } } as never);
		expect(vi.mocked(streamDeck.ui.sendToPropertyInspector).mock.calls.at(-1)![0]).toMatchObject({
			event: "getPages",
			items: [{ value: "p1" }, { value: "p2" }, { value: "p3" }],
		});
	});
});

describe("next / previous page", () => {
	it("posts next and prev and shows the current page name", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const next = new NextPage(t.deps);
		const prev = new PrevPage(t.deps);
		const a = keyAction();
		await next.onKeyDown({ action: a, payload: { settings: {} } } as never);
		await prev.onKeyDown({ action: a, payload: { settings: { profile: "main" } } } as never);
		expect(t.posts).toEqual([
			{ path: "page", body: { page: "next" } },
			{ path: "page", body: { profile: "main", page: "prev" } },
		]);
		appear({ action: a, settings: {} }, next);
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">Gaming</text>");
	});

	it("alerts when offline or when the server refuses", async () => {
		const t = await onlineDeps();
		const next = new NextPage(t.deps);
		const a = keyAction();
		await next.onKeyDown({ action: a, payload: { settings: {} } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
		t.goOnline();
		t.failPosts();
		await next.onKeyDown({ action: a, payload: { settings: {} } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(2);
	});
});

describe("switch profile", () => {
	it("sets the override and confirms with showOk", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new SwitchProfile(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { profile: "solo" } } } as never);
		expect(t.posts).toEqual([{ path: "profile", body: { profile: "solo" } }]);
		expect(a.showOk).toHaveBeenCalledTimes(1);
	});

	it("clears the override for Auto and alerts on failure", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new SwitchProfile(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { profile: "" } } } as never);
		expect(t.posts).toEqual([{ path: "profile", body: { profile: null } }]);
		t.failPosts();
		await key.onKeyDown({ action: a, payload: { settings: { profile: "solo" } } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
	});

	it("is active for the overridden profile, and Auto is active without an override", async () => {
		const t = await onlineDeps(control({ profile: "solo" }));
		t.goOnline();
		const key = new SwitchProfile(t.deps);
		const solo = keyAction("s");
		const auto = keyAction("a");
		appear({ action: solo, settings: { profile: "solo" } }, key);
		appear({ action: auto, settings: { profile: "" } }, key);
		const fills = (a: ReturnType<typeof keyAction>) => decode(a.setImage.mock.calls[0]!).match(/<rect[^>]*fill="(#[0-9a-f]{6})"/)![1];
		expect(fills(solo)).not.toBe(fills(auto));
		t.studio.control = control({ profile: null });
		(t.studio as unknown as { notify: () => void }).notify();
		expect(fills(solo)).not.toBe(decode(solo.setImage.mock.calls[1]!).match(/<rect[^>]*fill="(#[0-9a-f]{6})"/)![1]);
	});
});

describe("auto-rotate", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("toggles on a short press", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new AutoRotate(t.deps);
		const a = keyAction();
		key.onKeyDown({ action: a, payload: { settings: {} } } as never);
		vi.advanceTimersByTime(HOLD_MS - 1);
		await key.onKeyUp({ action: a, payload: { settings: {} } } as never);
		expect(t.posts).toEqual([{ path: "rotate", body: { state: "toggle" } }]);
		expect(a.showOk).toHaveBeenCalledTimes(1);
	});

	it("restores the saved setting after a one second hold", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new AutoRotate(t.deps);
		const a = keyAction();
		key.onKeyDown({ action: a, payload: { settings: { profile: "main" } } } as never);
		vi.advanceTimersByTime(HOLD_MS);
		await key.onKeyUp({ action: a, payload: { settings: { profile: "main" } } } as never);
		expect(t.posts).toEqual([{ path: "rotate", body: { profile: "main", state: "saved" } }]);
	});

	it("alerts offline, for a profile with one page, and when the POST fails", async () => {
		const t = await onlineDeps();
		const key = new AutoRotate(t.deps);
		const a = keyAction();
		await key.onKeyUp({ action: a, payload: { settings: {} } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
		t.goOnline();
		await key.onKeyUp({ action: a, payload: { settings: { profile: "solo" } } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(2);
		expect(t.posts).toEqual([]);
		t.failPosts();
		await key.onKeyUp({ action: a, payload: { settings: {} } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(3);
	});

	it("shows what is saved when an override is set", async () => {
		const t = await onlineDeps(control({ profiles: { main: { page: "p1", rotating: false, override: "off" }, solo: { page: "s1", rotating: false, override: null } } }));
		t.goOnline();
		const key = new AutoRotate(t.deps);
		const a = keyAction();
		appear({ action: a, settings: {} }, key);
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">saved: on</text>");
	});
});

describe("page cycler", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("sums ticks inside the throttle window into one move and wraps", async () => {
		const t = await onlineDeps(); // on p2 of p1..p3
		t.goOnline();
		const dial = new PageCycler(t.deps);
		const a = dialAction();
		appear({ action: a, settings: {} }, dial);
		dial.onDialRotate({ action: a, payload: { ticks: 1, settings: {} } } as never); // first tick goes at once: p2 -> p3
		await vi.advanceTimersByTimeAsync(0);
		expect(t.posts).toEqual([{ path: "page", body: { page: "p3" } }]);
		t.studio.control = control({ profiles: { main: { page: "p3", rotating: false, override: null }, solo: { page: "s1", rotating: false, override: null } } });
		for (const ticks of [1, 1, 1, -1]) dial.onDialRotate({ action: a, payload: { ticks, settings: {} } } as never);
		await vi.advanceTimersByTimeAsync(ROTATE_THROTTLE_MS);
		expect(t.posts).toHaveLength(2);
		expect(t.posts[1]).toEqual({ path: "page", body: { page: "p2" } }); // p3 + 2 = p2
	});

	it("does nothing when the ticks cancel out", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const dial = new PageCycler(t.deps);
		const a = dialAction();
		appear({ action: a, settings: {} }, dial);
		dial.onDialRotate({ action: a, payload: { ticks: 1, settings: {} } } as never);
		await vi.advanceTimersByTimeAsync(0);
		t.posts.length = 0;
		dial.onDialRotate({ action: a, payload: { ticks: 2, settings: {} } } as never);
		dial.onDialRotate({ action: a, payload: { ticks: -2, settings: {} } } as never);
		await vi.advanceTimersByTimeAsync(ROTATE_THROTTLE_MS);
		expect(t.posts).toEqual([]);
	});

	it("press goes to the first page and touch toggles rotation", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const dial = new PageCycler(t.deps);
		const a = dialAction();
		await dial.onDialDown({ action: a, payload: { settings: { profile: "main" } } } as never);
		await dial.onTouchTap({ action: a, payload: { settings: {} } } as never);
		expect(t.posts).toEqual([
			{ path: "page", body: { profile: "main", page: "p1" } },
			{ path: "rotate", body: { state: "toggle" } },
		]);
		t.failPosts();
		await dial.onTouchTap({ action: a, payload: { settings: {} } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
	});

	it("sets the touch-strip feedback and only resends when it changes", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const dial = new PageCycler(t.deps);
		const a = dialAction();
		appear({ action: a, settings: {} }, dial);
		expect(a.setFeedback).toHaveBeenCalledTimes(1);
		expect(a.setFeedback.mock.calls[0]![0]).toMatchObject({ name: { value: "Gaming" }, pos: { value: "2 / 3" } });
		(t.studio as unknown as { notify: () => void }).notify();
		expect(a.setFeedback).toHaveBeenCalledTimes(1);
	});

	it("ignores keys and stops the client when the dial goes away", async () => {
		const t = await onlineDeps();
		const dial = new PageCycler(t.deps);
		appear({ action: keyAction(), settings: {} }, dial);
		expect(t.connector.open()).toHaveLength(0);
		appear({ action: dialAction(), settings: {} }, dial);
		expect(t.connector.open()).toHaveLength(2);
		dial.onWillDisappear({ action: { id: "d1" } } as never);
		expect(t.connector.open()).toHaveLength(0);
	});
});

describe("sensor value", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const reading = (t: Awaited<ReturnType<typeof onlineDeps>>, sensors: Record<string, object>) =>
		t.connector.find("/events?prefix=")!.options.onMessage(JSON.stringify({ timestamp: 1, sensors, removed: [] }));

	it("subscribes to the sensor's stream and repaints at most four times a second", async () => {
		const t = await onlineDeps();
		const key = new SensorValue(t.deps);
		const a = keyAction();
		appear({ action: a, settings: { sensor: "system.cpu.load", warn: 70, crit: 90 } }, key);
		expect(t.connector.find("/events?prefix=system.cpu.")).toBeDefined();
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">load</text>"); // key tail until the sensor names itself
		expect(decode(a.setImage.mock.calls[0]!)).toContain("—");

		reading(t, { "system.cpu.load": { value: 50, unit: "%", name: "CPU Load" } });
		expect(a.setImage).toHaveBeenCalledTimes(2); // first reading paints at once
		expect(decode(a.setImage.mock.calls[1]!)).toContain("CPU Load");
		for (let i = 0; i < 30; i++) {
			reading(t, { "system.cpu.load": { value: 50 + i, unit: "%", name: "CPU Load" } });
			await vi.advanceTimersByTimeAsync(10);
		}
		await vi.advanceTimersByTimeAsync(REPAINT_MS);
		// 300 ms of readings -> at most one extra repaint per 250 ms
		expect(a.setImage.mock.calls.length).toBeLessThanOrEqual(2 + 3);
		const last = decode(a.setImage.mock.calls.at(-1)!);
		expect(last).toContain("79"); // the latest value wins
	});

	it("colours by threshold, honours invert, label, unit and decimals", async () => {
		const t = await onlineDeps();
		const key = new SensorValue(t.deps);
		const a = keyAction();
		appear({ action: a, settings: { sensor: "gpu.fan.speed", label: "Fan", unit: "rpm", decimals: 1, warn: "30", crit: "10", invert: true } }, key);
		reading(t, { "gpu.fan.speed": { value: 8, unit: "x" } });
		const svg = decode(a.setImage.mock.calls.at(-1)!);
		expect(svg).toContain(">Fan</text>");
		expect(svg).toContain("8.0");
		expect(svg).toContain(">rpm</tspan>");
		expect(svg).toContain(`fill="${P.destructive}"`); // 8 is at or below crit 10 with invert
	});

	it("shows text readings and follows a changed sensor", async () => {
		const t = await onlineDeps();
		const key = new SensorValue(t.deps);
		const a = keyAction();
		appear({ action: a, settings: { sensor: "spotify.track" } }, key);
		reading(t, { "spotify.track": { text: "Engel", unit: "" } });
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain("Engel");
		key.onDidReceiveSettings({ action: a, payload: { settings: { sensor: "net.up.rate" } } } as never);
		expect(t.connector.connections.at(-1)!.options.url).toContain("prefix=net.up.");
		expect(t.connector.connections.find((c) => c.options.url.includes("prefix=spotify."))!.closed).toBe(true);
	});

	it("opens the configured page on press, and does nothing without one", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new SensorValue(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { sensor: "x.y" } } } as never);
		expect(t.posts).toEqual([]);
		await key.onKeyDown({ action: a, payload: { settings: { sensor: "x.y", page: "p3", profile: "main" } } } as never);
		expect(t.posts).toEqual([{ path: "page", body: { profile: "main", page: "p3" } }]);
		t.failPosts();
		await key.onKeyDown({ action: a, payload: { settings: { page: "p3" } } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
	});

	it("serves the sensor list to the inspector, filtered by the typed text", async () => {
		const f = fakeFetch({
			"/api/sensors": () =>
				json({
					timestamp: 1,
					sensors: { "system.cpu.load": { value: 1, unit: "%", source: "system", name: "CPU Load" }, "spotify.track": { text: "x", unit: "", source: "spotify" } },
				}),
		});
		const c = fakeConnector();
		const studio = new StudioClient({ getBaseUrl: () => "http://d", fetch: f.fetch, connect: c.connect });
		const key = new SensorValue({ studio, dataApi: new DataApi({ getBaseUrl: () => "http://s", fetch: f.fetch, connect: c.connect }) });
		const a = keyAction();
		a.getSettings.mockResolvedValue({ sensorFilter: "spot" } as never);
		await key.onSendToPlugin({ action: a, payload: { event: "getSensors" } } as never);
		await flush();
		expect(streamDeck.ui.sendToPropertyInspector).toHaveBeenLastCalledWith({
			event: "getSensors",
			items: [{ label: "spotify", children: [{ label: "spotify.track", value: "spotify.track" }] }],
		});
	});
});
