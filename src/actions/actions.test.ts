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
import { StudioClient, type ActiveAlert, type ControlState, type StudioConfig } from "../studio";
import { ExtrasClient, type AgentSession } from "../extras";
import { DataApi } from "../data-api";
import type { Deps } from "../runtime";
import { palette } from "../render/color";
import { fakeConnector, fakeFetch, flush, json } from "../test-utils";
import { Agents } from "./agents";
import { Alerts } from "./alerts";
import { AutoRotate, HOLD_MS } from "./auto-rotate";
import { GoToPage } from "./go-to-page";
import { PageCycler, ROTATE_THROTTLE_MS } from "./page-cycler";
import { PauseRotation } from "./pause-rotation";
import { SensorDial } from "./sensor-dial";
import { REPAINT_MS, SensorValue } from "./sensor-value";
import { NextPage, PrevPage } from "./step-page";
import { SwitchProfile } from "./switch-profile";
import { TestAlert } from "./test-alert";

const config: StudioConfig = {
	version: 3,
	activeProfile: "main",
	theme: { primary: "200 80% 50%" },
	alertRules: [
		{ id: "r1", name: "CPU hot", severity: "critical" },
		{ id: "r2", name: "Disk low", severity: "warning" },
	],
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
	alerts: [],
	...patch,
});

/** A studio client that is online with the config and control state loaded. */
async function onlineDeps(state: ControlState = control()) {
	const posts: { path: string; body: unknown }[] = [];
	let reply: Response | (() => Response) = json(state);
	let failing = false;
	let alertsAfter: ActiveAlert[] = state.alerts;
	const f = fakeFetch({
		"/api/config": () => json({ ...config, alerts: { enabled: true, rules: config.alertRules } }), // the Studio nests the rules
		"/api/control": () => json(state),
		"/api/control/page": (init) => record("page", init),
		"/api/control/profile": (init) => record("profile", init),
		"/api/control/rotate": (init) => record("rotate", init),
		"/api/control/touch": (init) => record("touch", init),
		"/api/control/alert": (init) => {
			posts.push({ path: "alert", body: JSON.parse(String(init?.body)) });
			return failing ? new Response("bad", { status: 400 }) : json({ alerts: alertsAfter });
		},
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
	const extras = new ExtrasClient({ getBaseUrl: () => "http://d", fetch: f.fetch, connect: c.connect });
	const deps: Deps = { studio, dataApi, extras };
	return {
		deps,
		posts,
		connector: c,
		goOnline: () => {
			const stream = c.find("/events/control");
			if (stream) stream.options.onOpen!();
			else studio.online = true; // nothing started yet: pretend the stream was open already
		},
		failPosts: () => {
			reply = new Response("bad", { status: 400 });
			failing = true;
		},
		/** What the server answers to the next alert post. */
		setAlertsAfter: (alerts: ActiveAlert[]) => (alertsAfter = alerts),
		extras,
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
	it("posts next and prev and shows the page each one goes to", async () => {
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
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">Music</text>");
		const b = keyAction("k2");
		appear({ action: b, settings: {} }, prev);
		expect(decode(b.setImage.mock.calls[0]!)).toContain(">Overview</text>");
	});

	it("wraps the names at either end and follows page changes", async () => {
		const t = await onlineDeps(control({ profiles: { main: { page: "p3", rotating: false, override: null }, solo: { page: "s1", rotating: false, override: null } } }));
		t.goOnline();
		const next = new NextPage(t.deps);
		const prev = new PrevPage(t.deps);
		const a = keyAction();
		const b = keyAction("k2");
		appear({ action: a, settings: {} }, next);
		appear({ action: b, settings: {} }, prev);
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(">Overview</text>");
		expect(decode(b.setImage.mock.calls.at(-1)!)).toContain(">Gaming</text>");
		t.studio.control = control({ profiles: { main: { page: "p1", rotating: false, override: null }, solo: { page: "s1", rotating: false, override: null } } });
		(t.studio as unknown as { notify: () => void }).notify();
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(">Gaming</text>");
		expect(decode(b.setImage.mock.calls.at(-1)!)).toContain(">Music</text>");
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
		const key = new SensorValue({
			studio,
			dataApi: new DataApi({ getBaseUrl: () => "http://s", fetch: f.fetch, connect: c.connect }),
			extras: new ExtrasClient({ getBaseUrl: () => "http://d", fetch: f.fetch, connect: c.connect }),
		});
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

const alertOf = (id: string, patch: Partial<ActiveAlert> = {}): ActiveAlert => ({
	id,
	ruleId: "r1",
	name: `Alert ${id}`,
	severity: "info",
	text: "",
	startedAt: 1,
	acknowledged: false,
	...patch,
});

const rotatingState = (rotating: boolean) => control({ profiles: { main: { page: "p1", rotating, override: null }, solo: { page: "s1", rotating: false, override: null } } });

describe("alerts key", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const press = async (key: Alerts, a: ReturnType<typeof keyAction>, holdMs: number) => {
		key.onKeyDown({ action: a, payload: { settings: {} } } as never);
		vi.advanceTimersByTime(holdMs);
		await key.onKeyUp({ action: a, payload: { settings: {} } } as never);
	};

	it("shows a muted bell on a card while nothing is active, and counts only visible alerts", async () => {
		const t = await onlineDeps(control({ alerts: [alertOf("acked", { acknowledged: true }), alertOf("quiet", { quiet: true })] }));
		t.goOnline();
		const key = new Alerts(t.deps);
		const a = keyAction();
		appear({ action: a, settings: {} }, key);
		const svg = decode(a.setImage.mock.calls[0]!);
		expect(svg).toContain(`<rect width="144" height="144" fill="${P.card}"/>`);
		expect(svg).toContain(">No alerts</text>");
	});

	it("fills by the worst severity with the count and the newest name, and follows the control state", async () => {
		const t = await onlineDeps(
			control({
				alerts: [
					alertOf("old", { startedAt: 1, severity: "critical" }),
					alertOf("new", { startedAt: 5, severity: "warning", name: "Disk low" }),
					alertOf("acked", { startedAt: 9, severity: "critical", acknowledged: true }),
				],
			}),
		);
		t.goOnline();
		const key = new Alerts(t.deps);
		const a = keyAction();
		appear({ action: a, settings: {} }, key);
		const svg = decode(a.setImage.mock.calls[0]!);
		expect(svg).toContain(`<rect width="144" height="144" fill="${P.destructive}"/>`);
		expect(svg).toContain(">2</text>");
		expect(svg).toContain(">Disk low</text>");

		t.studio.control = control({ alerts: [alertOf("w", { severity: "warning" })] });
		(t.studio as unknown as { notify: () => void }).notify();
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(`<rect width="144" height="144" fill="${P.warn}"/>`);
		t.studio.control = control({ alerts: [alertOf("i")] });
		(t.studio as unknown as { notify: () => void }).notify();
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(`<rect width="144" height="144" fill="${P.primary}"/>`);
	});

	it("shows the offline face while the studio is unreachable", async () => {
		const t = await onlineDeps(control({ alerts: [alertOf("a")] }));
		const key = new Alerts(t.deps);
		const a = keyAction();
		appear({ action: a, settings: {} }, key);
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">Offline</text>");
	});

	it("acknowledges the newest visible alert on a short press and repaints from the reply", async () => {
		const t = await onlineDeps(control({ alerts: [alertOf("old", { startedAt: 1 }), alertOf("new", { startedAt: 5 }), alertOf("newer-acked", { startedAt: 9, acknowledged: true })] }));
		t.goOnline();
		t.setAlertsAfter([alertOf("old", { startedAt: 1 }), alertOf("new", { startedAt: 5, acknowledged: true })]);
		const key = new Alerts(t.deps);
		const a = keyAction();
		appear({ action: a, settings: {} }, key);
		await press(key, a, HOLD_MS - 1);
		expect(t.posts).toEqual([{ path: "alert", body: { id: "new", action: "ack" } }]);
		expect(a.showOk).not.toHaveBeenCalled();
		expect(a.showAlert).not.toHaveBeenCalled();
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(">Alert old</text>"); // the face changed, no tick
	});

	it("dismisses the newest non-quiet alert on a hold, acknowledged or not", async () => {
		const t = await onlineDeps(control({ alerts: [alertOf("visible", { startedAt: 1 }), alertOf("acked", { startedAt: 5, acknowledged: true }), alertOf("quiet", { startedAt: 9, quiet: true })] }));
		t.goOnline();
		const key = new Alerts(t.deps);
		const a = keyAction();
		await press(key, a, HOLD_MS);
		expect(t.posts).toEqual([{ path: "alert", body: { id: "acked", action: "dismiss" } }]);
		expect(a.showAlert).not.toHaveBeenCalled();
		expect(a.showOk).not.toHaveBeenCalled();
	});

	it("alerts when there is nothing to act on, offline, or when the post fails", async () => {
		const t = await onlineDeps(control({ alerts: [alertOf("acked", { acknowledged: true }), alertOf("quiet", { quiet: true })] }));
		const key = new Alerts(t.deps);
		const a = keyAction();
		t.studio.control = control({ alerts: [alertOf("x")] });
		await press(key, a, 0); // offline, with an alert that would be acknowledged
		expect(a.showAlert).toHaveBeenCalledTimes(1);
		expect(t.posts).toEqual([]);
		t.studio.control = control({ alerts: [alertOf("acked", { acknowledged: true }), alertOf("quiet", { quiet: true })] });
		t.goOnline();
		await press(key, a, 0); // an acknowledged alert and a quiet one: nothing visible to acknowledge
		expect(a.showAlert).toHaveBeenCalledTimes(2);
		t.studio.control = control({ alerts: [alertOf("quiet", { quiet: true })] });
		await press(key, a, HOLD_MS); // only quiet alerts: nothing to dismiss
		expect(a.showAlert).toHaveBeenCalledTimes(3);
		expect(t.posts).toEqual([]);
		t.studio.control = control({ alerts: [alertOf("x")] });
		t.failPosts();
		await press(key, a, 0);
		expect(a.showAlert).toHaveBeenCalledTimes(4);
		expect(t.posts).toHaveLength(1);
	});
});

describe("test alert key", () => {
	it("tints the flask by the rule severity and names the rule", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new TestAlert(t.deps);
		const a = keyAction();
		appear({ action: a, settings: { rule: "r1" } }, key);
		const svg = decode(a.setImage.mock.calls[0]!);
		expect(svg).toContain(">CPU hot</text>");
		expect(svg).toContain(`stroke="${P.destructive}"`);
	});

	it("asks for a rule when none is set or the rule is gone", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new TestAlert(t.deps);
		const a = keyAction("a");
		const b = keyAction("b");
		appear({ action: a, settings: {} }, key);
		appear({ action: b, settings: { rule: "deleted" } }, key);
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">Pick a rule</text>");
		expect(decode(b.setImage.mock.calls[0]!)).toContain(">Pick a rule</text>");
	});

	it("posts the rule as a test alert and confirms with showOk", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new TestAlert(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { rule: "r2" } } } as never);
		expect(t.posts).toEqual([{ path: "alert", body: { ruleId: "r2", action: "test" } }]);
		expect(a.showOk).toHaveBeenCalledTimes(1);
		expect(a.showAlert).not.toHaveBeenCalled();
	});

	it("alerts without a rule, offline, or when the server refuses", async () => {
		const t = await onlineDeps();
		const key = new TestAlert(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { rule: "r1" } } } as never); // offline
		t.goOnline();
		await key.onKeyDown({ action: a, payload: { settings: {} } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(2);
		expect(t.posts).toEqual([]);
		t.failPosts();
		await key.onKeyDown({ action: a, payload: { settings: { rule: "nope" } } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(3);
		expect(a.showOk).not.toHaveBeenCalled();
	});

	it("serves the rules to the inspector and still answers the profile requests", async () => {
		const t = await onlineDeps();
		const key = new TestAlert(t.deps);
		const a = keyAction();
		await key.onSendToPlugin({ action: a, payload: { event: "getRules" } } as never);
		expect(streamDeck.ui.sendToPropertyInspector).toHaveBeenLastCalledWith({
			event: "getRules",
			items: [
				{ label: "CPU hot", value: "r1" },
				{ label: "Disk low", value: "r2" },
			],
		});
		await key.onSendToPlugin({ action: a, payload: { event: "getProfiles" } } as never);
		expect(vi.mocked(streamDeck.ui.sendToPropertyInspector).mock.calls.at(-1)![0]).toMatchObject({ event: "getProfiles" });
	});
});

describe("pause rotation key", () => {
	it("shows the pause caption while the profile rotates and a muted face otherwise", async () => {
		const on = await onlineDeps(rotatingState(true));
		on.goOnline();
		const a = keyAction();
		appear({ action: a, settings: {} }, new PauseRotation(on.deps));
		const svg = decode(a.setImage.mock.calls[0]!);
		expect(svg).toContain(">Pause 30 s</text>");
		expect(svg).toContain(`<rect width="144" height="144" fill="${P.card}"/>`);

		const off = await onlineDeps(rotatingState(false));
		off.goOnline();
		const b = keyAction();
		appear({ action: b, settings: {} }, new PauseRotation(off.deps));
		expect(decode(b.setImage.mock.calls[0]!)).toContain(">Not rotating</text>");
		expect(decode(b.setImage.mock.calls[0]!)).toContain(`<rect width="144" height="144" fill="${P.muted}"/>`);
	});

	it("shows the real hold: the profile's rotate period when it is longer than 30 s", async () => {
		const t = await onlineDeps(rotatingState(true));
		t.goOnline();
		t.studio.config = { ...config, profiles: config.profiles.map((p) => (p.id === "main" ? { ...p, rotate: { enabled: true, seconds: 90 } } : p)) };
		const a = keyAction();
		appear({ action: a, settings: {} }, new PauseRotation(t.deps));
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">Pause 90 s</text>");
		t.studio.config = { ...config, profiles: config.profiles.map((p) => (p.id === "main" ? { ...p, rotate: { enabled: true, seconds: 10 } } : p)) };
		const b = keyAction("k2");
		appear({ action: b, settings: {} }, new PauseRotation(t.deps));
		expect(decode(b.setImage.mock.calls[0]!)).toContain(">Pause 30 s</text>");
	});

	it("posts a touch for the chosen profile, or none, and confirms with showOk", async () => {
		const t = await onlineDeps(rotatingState(true));
		t.goOnline();
		const key = new PauseRotation(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: {} } } as never);
		await key.onKeyDown({ action: a, payload: { settings: { profile: "main" } } } as never);
		expect(t.posts).toEqual([
			{ path: "touch", body: {} },
			{ path: "touch", body: { profile: "main" } },
		]);
		expect(a.showOk).toHaveBeenCalledTimes(2);
		expect(a.showAlert).not.toHaveBeenCalled();
	});

	it("alerts without posting when the profile is not rotating or the studio is offline", async () => {
		const t = await onlineDeps(rotatingState(true));
		const key = new PauseRotation(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: {} } } as never); // offline, though rotating
		expect(t.posts).toEqual([]);
		t.studio.control = rotatingState(false);
		t.goOnline();
		await key.onKeyDown({ action: a, payload: { settings: {} } } as never); // not rotating
		expect(a.showAlert).toHaveBeenCalledTimes(2);
		expect(t.posts).toEqual([]);
		expect(a.showOk).not.toHaveBeenCalled();
	});

	it("alerts when the server refuses", async () => {
		const t = await onlineDeps(rotatingState(true));
		t.goOnline();
		t.failPosts();
		const a = keyAction();
		await new PauseRotation(t.deps).onKeyDown({ action: a, payload: { settings: {} } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
		expect(a.showOk).not.toHaveBeenCalled();
	});
});

describe("agents key", () => {
	const session = (key: string, patch: Partial<AgentSession> = {}): AgentSession => ({ key, agent: "claude", project: key, state: "working", since: 1, ...patch });
	type T = Awaited<ReturnType<typeof onlineDeps>>;

	/** Brings both streams up (the studio control stream and the extras stream) once the keys have appeared. */
	const up = (t: T) => {
		t.goOnline();
		t.connector.find("/events/extras")?.options.onOpen!();
	};
	const send = (t: T, sessions: AgentSession[]) => t.connector.find("/events/extras")!.options.onMessage(JSON.stringify({ agents: { sessions } }));
	const fill = (svg: string) => svg.match(/<rect[^>]*fill="(#[0-9a-f]{6})"/)![1];

	it("prefers waiting over working over idle", async () => {
		const t = await onlineDeps();
		const key = new Agents(t.deps);
		const a = keyAction();
		appear({ action: a, settings: {} }, key);
		up(t);
		send(t, []);
		const idle = decode(a.setImage.mock.calls.at(-1)!);
		expect(idle).toContain(">Idle</text>");
		expect(fill(idle)).toBe(P.muted);

		send(t, [session("a"), session("b"), session("c", { state: "done" })]);
		const working = decode(a.setImage.mock.calls.at(-1)!);
		expect(fill(working)).toBe(P.card);
		expect(working).toContain(">2</text>");
		expect(working).toContain(">working</text>");

		send(t, [session("a"), session("b", { state: "waiting", project: "infopanel", since: 5 })]);
		const waiting = decode(a.setImage.mock.calls.at(-1)!);
		expect(fill(waiting)).toBe(P.warn);
		expect(waiting).toContain(">infopanel</text>");
		expect(waiting).not.toContain("waiting</text>");

		send(t, [
			session("a", { state: "waiting", project: "old", since: 1 }),
			session("b", { state: "waiting", project: "newest", since: 9 }),
			session("c", { state: "waiting", project: "mid", since: 4 }),
		]);
		const many = decode(a.setImage.mock.calls.at(-1)!);
		expect(many).toContain(">newest</text>");
		expect(many).toContain(">3 waiting</text>");
	});

	it("filters by agent", async () => {
		const t = await onlineDeps();
		const key = new Agents(t.deps);
		const claude = keyAction("claude");
		const codex = keyAction("codex");
		const both = keyAction("both");
		appear({ action: claude, settings: { agent: "claude" } }, key);
		appear({ action: codex, settings: { agent: "codex" } }, key);
		appear({ action: both, settings: { agent: "" } }, key);
		up(t);
		send(t, [session("a", { agent: "claude" }), session("b", { agent: "codex", state: "waiting", project: "porting" }), session("c", { agent: "claude" })]);
		expect(decode(claude.setImage.mock.calls.at(-1)!)).toContain(">2</text>");
		expect(decode(codex.setImage.mock.calls.at(-1)!)).toContain(">porting</text>");
		expect(fill(decode(both.setImage.mock.calls.at(-1)!))).toBe(P.warn);
		send(t, [session("a", { agent: "claude" })]);
		expect(decode(codex.setImage.mock.calls.at(-1)!)).toContain(">Idle</text>");
	});

	it("shows the offline face while the extras stream or the studio is down, then recovers", async () => {
		const t = await onlineDeps();
		const key = new Agents(t.deps);
		const a = keyAction();
		appear({ action: a, settings: {} }, key);
		expect(decode(a.setImage.mock.calls[0]!)).toContain(">Offline</text>");
		t.goOnline(); // studio only
		send(t, [session("a")]);
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(">Offline</text>");
		t.connector.find("/events/extras")!.options.onOpen!();
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(">working</text>");
		t.connector.find("/events/extras")!.options.onClose!();
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(">Offline</text>");
	});

	it("starts and stops both clients with the keys", async () => {
		const t = await onlineDeps();
		const key = new Agents(t.deps);
		const a = keyAction("a");
		const b = keyAction("b");
		appear({ action: a, settings: {} }, key);
		appear({ action: b, settings: {} }, key);
		expect(t.connector.open()).toHaveLength(3); // control, config, extras
		key.onWillDisappear({ action: { id: "a" } } as never);
		expect(t.connector.open()).toHaveLength(3);
		key.onWillDisappear({ action: { id: "b" } } as never);
		expect(t.connector.open()).toHaveLength(0);
		const painted = a.setImage.mock.calls.length + b.setImage.mock.calls.length;
		(t.extras as unknown as { notify: () => void }).notify();
		(t.studio as unknown as { notify: () => void }).notify();
		expect(a.setImage.mock.calls.length + b.setImage.mock.calls.length).toBe(painted); // no listener is left behind
	});

	it("opens the configured page on press, and does nothing without one", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const key = new Agents(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { agent: "claude" } } } as never);
		expect(t.posts).toEqual([]);
		expect(a.showAlert).not.toHaveBeenCalled();
		await key.onKeyDown({ action: a, payload: { settings: { page: "p3", profile: "main" } } } as never);
		await key.onKeyDown({ action: a, payload: { settings: { page: "p1", profile: "" } } } as never);
		expect(t.posts).toEqual([
			{ path: "page", body: { profile: "main", page: "p3" } },
			{ path: "page", body: { page: "p1" } },
		]);
		t.failPosts();
		await key.onKeyDown({ action: a, payload: { settings: { page: "p3" } } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
	});

	it("alerts on a page press while the studio is offline, and follows the profile in the page select", async () => {
		const t = await onlineDeps();
		const key = new Agents(t.deps);
		const a = keyAction();
		await key.onKeyDown({ action: a, payload: { settings: { page: "p3" } } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
		appear({ action: a, settings: {} }, key);
		key.onDidReceiveSettings({ action: a, payload: { settings: { profile: "solo" } } } as never);
		expect(vi.mocked(streamDeck.ui.sendToPropertyInspector).mock.calls.at(-1)![0]).toMatchObject({ event: "getPages", items: [{ value: "s1" }] });
	});
});

describe("sensor value bar style", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const reading = (t: Awaited<ReturnType<typeof onlineDeps>>, sensors: Record<string, object>) =>
		t.connector.find("/events?prefix=")!.options.onMessage(JSON.stringify({ timestamp: 1, sensors, removed: [] }));
	const barFill = (svg: string, color: string) => svg.includes(`height="12" rx="6" fill="${color}"`);

	it("draws a bar for a percent sensor without a max and no sparkline", async () => {
		const t = await onlineDeps();
		const key = new SensorValue(t.deps);
		const a = keyAction();
		appear({ action: a, settings: { sensor: "system.cpu.load", style: "bar" } }, key);
		reading(t, { "system.cpu.load": { value: 25, unit: "%" } });
		const svg = decode(a.setImage.mock.calls.at(-1)!);
		expect(svg).toContain(`width="28" height="12" rx="6" fill="${P.primary}"`); // 25 % of 112
		expect(svg).not.toContain("<path");
	});

	it("uses the bar max setting, the severity colour and clamps", async () => {
		const t = await onlineDeps();
		const key = new SensorValue(t.deps);
		const a = keyAction();
		appear({ action: a, settings: { sensor: "gpu.fan.speed", style: "bar", barMax: "2000", warn: 1000, crit: 1500 } }, key);
		reading(t, { "gpu.fan.speed": { value: 1000, unit: "rpm" } });
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(`width="56" height="12" rx="6" fill="${P.warn}"`);
		await vi.advanceTimersByTimeAsync(REPAINT_MS);
		reading(t, { "gpu.fan.speed": { value: 5000, unit: "rpm" } });
		await vi.advanceTimersByTimeAsync(REPAINT_MS);
		expect(decode(a.setImage.mock.calls.at(-1)!)).toContain(`width="112" height="12" rx="6" fill="${P.destructive}"`);
	});

	it("falls back to the sparkline without a bar max, and draws no bar in the default style", async () => {
		const t = await onlineDeps();
		const key = new SensorValue(t.deps);
		const a = keyAction("a");
		appear({ action: a, settings: { sensor: "gpu.fan.speed", style: "bar" } }, key);
		reading(t, { "gpu.fan.speed": { value: 1000, unit: "rpm" } });
		await vi.advanceTimersByTimeAsync(REPAINT_MS);
		reading(t, { "gpu.fan.speed": { value: 1200, unit: "rpm" } });
		await vi.advanceTimersByTimeAsync(REPAINT_MS);
		const fallback = decode(a.setImage.mock.calls.at(-1)!);
		expect(fallback).toContain("<path");
		expect(barFill(fallback, P.primary)).toBe(false);

		const c = keyAction("c");
		appear({ action: c, settings: { sensor: "gpu.fan.speed", barMax: "2000" } }, key); // max set, but sparkline style
		const sparkline = decode(c.setImage.mock.calls.at(-1)!);
		expect(sparkline).toContain("<path");
		expect(barFill(sparkline, P.primary)).toBe(false);
	});
});

describe("sensor dial", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	const reading = (t: Awaited<ReturnType<typeof onlineDeps>>, sensors: Record<string, object>) =>
		t.connector.find("/events?prefix=")!.options.onMessage(JSON.stringify({ timestamp: 1, sensors, removed: [] }));

	it("sets the strip feedback with label, value + unit and the bar, resending only on change", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const dial = new SensorDial(t.deps);
		const a = dialAction();
		appear({ action: a, settings: { sensor: "system.cpu.load", warn: 70 } }, dial);
		expect(a.setFeedback.mock.calls[0]![0]).toMatchObject({ label: { value: "load" }, value: { value: "—" }, bar: { value: 0 } });
		reading(t, { "system.cpu.load": { value: 80, unit: "%", name: "CPU Load" } });
		expect(a.setFeedback).toHaveBeenCalledTimes(2);
		expect(a.setFeedback.mock.calls[1]![0]).toEqual({
			label: { value: "CPU Load", color: P.mutedFg },
			value: { value: "80 %", color: P.warn },
			bar: { value: 80, bar_fill_c: P.warn },
		});
		await vi.advanceTimersByTimeAsync(REPAINT_MS);
		reading(t, { "system.cpu.load": { value: 80, unit: "%", name: "CPU Load" } });
		await vi.advanceTimersByTimeAsync(REPAINT_MS);
		expect(a.setFeedback).toHaveBeenCalledTimes(2);
	});

	it("uses the bar max setting, and an empty bar without one", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const dial = new SensorDial(t.deps);
		const a = dialAction();
		appear({ action: a, settings: { sensor: "gpu.fan.speed", barMax: 2000 } }, dial);
		reading(t, { "gpu.fan.speed": { value: 500, unit: "rpm" } });
		expect(a.setFeedback.mock.calls.at(-1)![0]).toMatchObject({ bar: { value: 25 } });
		dial.onDidReceiveSettings({ action: a, payload: { settings: { sensor: "gpu.fan.speed" } } } as never);
		expect(a.setFeedback.mock.calls.at(-1)![0]).toMatchObject({ value: { value: "500 rpm" }, bar: { value: 0 } });
	});

	it("goes muted only when there is neither a reading nor the studio, and keeps showing the reading without the studio", async () => {
		const t = await onlineDeps();
		const dial = new SensorDial(t.deps);
		const a = dialAction();
		appear({ action: a, settings: { sensor: "x.y" } }, dial);
		expect(a.setFeedback.mock.calls[0]![0]).toMatchObject({ label: { value: "Offline" } });
		reading(t, { "x.y": { value: 40, unit: "%", name: "Temp" } }); // the studio is still down
		expect(a.setFeedback.mock.calls.at(-1)![0]).toMatchObject({ label: { value: "Temp" }, value: { value: "40 %" } });
	});

	it("opens the configured page on press and touch, alerting on failure and doing nothing without a page", async () => {
		const t = await onlineDeps();
		t.goOnline();
		const dial = new SensorDial(t.deps);
		const a = dialAction();
		await dial.onDialDown({ action: a, payload: { settings: { sensor: "x.y" } } } as never);
		await dial.onTouchTap({ action: a, payload: { settings: { sensor: "x.y" } } } as never);
		expect(t.posts).toEqual([]);
		expect(a.showAlert).not.toHaveBeenCalled();
		await dial.onDialDown({ action: a, payload: { settings: { page: "p3", profile: "main" } } } as never);
		await dial.onTouchTap({ action: a, payload: { settings: { page: "p1" } } } as never);
		expect(t.posts).toEqual([
			{ path: "page", body: { profile: "main", page: "p3" } },
			{ path: "page", body: { page: "p1" } },
		]);
		t.failPosts();
		await dial.onTouchTap({ action: a, payload: { settings: { page: "p3" } } } as never);
		expect(a.showAlert).toHaveBeenCalledTimes(1);
	});

	it("follows a changed sensor, ignores keys and releases everything when the dial goes away", async () => {
		const t = await onlineDeps();
		const dial = new SensorDial(t.deps);
		appear({ action: keyAction(), settings: {} }, dial);
		expect(t.connector.open()).toHaveLength(0);
		const a = dialAction();
		appear({ action: a, settings: { sensor: "spotify.track" } }, dial);
		dial.onDidReceiveSettings({ action: a, payload: { settings: { sensor: "net.up.rate" } } } as never);
		expect(t.connector.connections.find((c) => c.options.url.includes("prefix=spotify."))!.closed).toBe(true);
		expect(t.connector.find("prefix=net.up.")).toBeDefined();
		dial.onWillDisappear({ action: { id: "d1" } } as never);
		expect(t.connector.open()).toHaveLength(0);
	});

	it("answers the inspector's profile and page requests", async () => {
		const t = await onlineDeps();
		const dial = new SensorDial(t.deps);
		const a = { ...dialAction(), getSettings: async () => ({ profile: "solo" }) };
		await dial.onSendToPlugin({ action: a, payload: { event: "getPages" } } as never);
		expect(streamDeck.ui.sendToPropertyInspector).toHaveBeenLastCalledWith({ event: "getPages", items: [{ label: "Only", value: "s1" }] });
		await dial.onSendToPlugin({ action: a, payload: { event: "getProfiles" } } as never);
		expect(vi.mocked(streamDeck.ui.sendToPropertyInspector).mock.calls.at(-1)![0]).toMatchObject({ event: "getProfiles" });
	});
});
