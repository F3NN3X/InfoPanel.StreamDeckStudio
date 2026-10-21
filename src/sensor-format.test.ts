import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageItems, profileItems, sensorItems } from "./actions/datasource";
import { StudioClient, type StudioConfig } from "./studio";
import { barFraction, barMaxOf, formatValue, severity, sparklinePath, toNumber } from "./sensor-format";
import { fakeConnector, fakeFetch, json } from "./test-utils";
import { throttle } from "./throttle";

describe("formatValue", () => {
	it("uses fixed decimals when given", () => {
		expect(formatValue(91.456, 1)).toBe("91.5");
		expect(formatValue(91.456, "0")).toBe("91");
		expect(formatValue(3, 2)).toBe("3.00");
		expect(formatValue(1, 99)).toBe("1.000000");
		expect(formatValue(1.5, -2)).toBe("2");
	});

	it("picks about three significant digits otherwise and drops trailing zeros", () => {
		expect(formatValue(4567.8)).toBe("4568");
		expect(formatValue(91.44)).toBe("91.4");
		expect(formatValue(12)).toBe("12");
		expect(formatValue(3.14159)).toBe("3.14");
		expect(formatValue(2)).toBe("2");
		expect(formatValue(-0.5)).toBe("-0.5");
	});
});

describe("toNumber", () => {
	it("reads numbers and typed strings, ignoring blanks and junk", () => {
		expect(toNumber(5)).toBe(5);
		expect(toNumber(" 7,5 ")).toBe(7.5);
		expect(toNumber("")).toBeUndefined();
		expect(toNumber("abc")).toBeUndefined();
		expect(toNumber(undefined)).toBeUndefined();
		expect(toNumber(Number.NaN)).toBeUndefined();
	});
});

describe("severity", () => {
	it("goes warn then crit as the value rises", () => {
		expect(severity(50, 70, 90)).toBe("normal");
		expect(severity(70, 70, 90)).toBe("warn");
		expect(severity(89.9, "70", "90")).toBe("warn");
		expect(severity(90, 70, 90)).toBe("crit");
	});

	it("inverts for lower-is-worse", () => {
		expect(severity(50, 30, 10, true)).toBe("normal");
		expect(severity(30, 30, 10, true)).toBe("warn");
		expect(severity(10, 30, 10, true)).toBe("crit");
		expect(severity(5, 30, 10, true)).toBe("crit");
	});

	it("handles missing thresholds and values", () => {
		expect(severity(99, undefined, undefined)).toBe("normal");
		expect(severity(99, "", 95)).toBe("crit");
		expect(severity(99, 80, "")).toBe("warn");
		expect(severity(undefined, 1, 2)).toBe("normal");
	});
});

describe("sparklinePath", () => {
	it("needs two points", () => {
		expect(sparklinePath([], 0, 0, 10, 10)).toBe("");
		expect(sparklinePath([1], 0, 0, 10, 10)).toBe("");
	});

	it("scales into the box with the highest value on top", () => {
		expect(sparklinePath([0, 5, 10], 10, 100, 100, 20)).toBe("M10.0 120.0 L60.0 110.0 L110.0 100.0");
	});

	it("draws a flat line mid-box when all values are equal", () => {
		expect(sparklinePath([7, 7, 7], 0, 0, 20, 10)).toBe("M0.0 5.0 L10.0 5.0 L20.0 5.0");
	});
});

describe("throttle", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("runs the first call at once and collapses the rest to one run per gap (4/s at 250 ms)", () => {
		const gate = throttle(250);
		const runs: number[] = [];
		for (let i = 0; i < 20; i++) {
			gate.call(() => runs.push(i));
			vi.advanceTimersByTime(50);
		}
		vi.advanceTimersByTime(250);
		// 1 s of calls: one run at t=0, then one per 250 ms, always with the latest function
		expect(runs.length).toBeLessThanOrEqual(5);
		expect(runs[0]).toBe(0);
		expect(runs.at(-1)).toBe(19);
	});

	it("cancel drops the pending run", () => {
		const gate = throttle(250);
		const fn = vi.fn();
		gate.call(() => {});
		gate.call(fn);
		gate.cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
	});
});

describe("datasource items", () => {
	const config: StudioConfig = {
		version: 3,
		activeProfile: "a",
		theme: {},
		alertRules: [],
		profiles: [
			{ id: "a", name: "Alpha", pages: [{ id: "p1", name: "Main" }, { id: "p2", name: "" }] },
			{ id: "b", name: "Beta", pages: [{ id: "q1", name: "Only" }] },
		],
	};
	const studio = new StudioClient({ getBaseUrl: () => "http://x", fetch: fakeFetch({ "/api/config": () => json(config) }).fetch, connect: fakeConnector().connect });

	it("lists profiles with the shown / auto lead entry", async () => {
		await studio.refetchConfig();
		expect(profileItems(studio, "shown")).toEqual([
			{ label: "Shown profile", value: "" },
			{ label: "Alpha", value: "a" },
			{ label: "Beta", value: "b" },
		]);
		expect(profileItems(studio, "auto")[0]).toEqual({ label: "Auto (clear override)", value: "" });
		expect(profileItems(studio, null)).toHaveLength(2);
	});

	it("lists the pages of the chosen profile, or the resolved one when blank", () => {
		expect(pageItems(studio, "b")).toEqual([{ label: "Only", value: "q1" }]);
		expect(pageItems(studio, undefined).map((i) => i.value)).toEqual(["p1", "p2"]);
		expect(pageItems(studio, "a")[1]).toEqual({ label: "p2", value: "p2" });
	});

	it("groups sensors by source and filters by key or name, keeping the selected one", () => {
		const sensors = [
			{ key: "system.cpu.load", name: "CPU Load", unit: "%", source: "system" },
			{ key: "system.mem.used", unit: "GB", source: "system" },
			{ key: "spotify.track", unit: "", source: "spotify" },
			{ key: "x.y", unit: "" },
		];
		const all = sensorItems(sensors, "", undefined);
		expect(all.map((g) => g.label)).toEqual(["system", "spotify", "other"]);
		expect(all[0]!.children[0]).toEqual({ label: "CPU Load (system.cpu.load)", value: "system.cpu.load" });
		const cpu = sensorItems(sensors, " CPU ", "spotify.track");
		expect(cpu.flatMap((g) => g.children.map((c) => c.value))).toEqual(["system.cpu.load", "spotify.track"]);
		expect(sensorItems(sensors, "zzz", undefined)).toEqual([]);
	});
});

describe("bar fill", () => {
	it("takes the bar max from the setting, else 100 for percent and degree units", () => {
		expect(barMaxOf("250", "%")).toBe(250);
		expect(barMaxOf(" 8,5 ", "rpm")).toBe(8.5);
		expect(barMaxOf(undefined, "%")).toBe(100);
		expect(barMaxOf("", "°C")).toBe(100);
		expect(barMaxOf("abc", "°F")).toBe(100);
		expect(barMaxOf(undefined, "rpm")).toBeUndefined();
		expect(barMaxOf(undefined, undefined)).toBeUndefined();
	});

	it("runs from 0 to the max, clamped", () => {
		expect(barFraction(50, 100)).toBe(0.5);
		expect(barFraction(0, 100)).toBe(0);
		expect(barFraction(-5, 100)).toBe(0);
		expect(barFraction(150, 100)).toBe(1);
		expect(barFraction(1, 4)).toBe(0.25);
	});

	it("has no fill without a value or a positive max", () => {
		expect(barFraction(undefined, 100)).toBeUndefined();
		expect(barFraction(5, undefined)).toBeUndefined();
		expect(barFraction(5, 0)).toBeUndefined();
		expect(barFraction(5, -10)).toBeUndefined();
	});
});
