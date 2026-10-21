import { describe, expect, it } from "vitest";
import { hslToHex, palette } from "./color";
import { hasIcon, iconBody, svgDataUrl } from "./icons";
import { navKey, offlineKey, pageKey, profileKey, rotateKey, rotateSubtitle } from "./keys";
import { sensorKey } from "./sensor";
import { cyclerFeedback, stepTarget } from "./strip";
import { escapeXml, fit, truncate, wrap } from "./text";

const theme = { background: "240 10% 3.9%", primary: "200 80% 50%", "primary-foreground": "0 0% 100%", card: "0 0% 10%", foreground: "0 0% 98%" };
const P = palette(theme);

describe("colour", () => {
	it("converts shadcn HSL triplets to hex", () => {
		expect(hslToHex("0 0% 98%")).toBe("#fafafa");
		expect(hslToHex("240 10% 3.9%")).toBe("#09090b");
		expect(hslToHex("hsl(0, 100%, 50%)")).toBe("#ff0000");
		expect(hslToHex("120 100% 25%")).toBe("#008000");
		expect(hslToHex("nonsense")).toBeUndefined();
		expect(hslToHex(undefined)).toBeUndefined();
	});

	it("falls back per token to the dark defaults and card to background", () => {
		const bare = palette({});
		expect(bare.primary).toBe("#fafafa");
		expect(bare.destructive).toMatch(/^#[0-9a-f]{6}$/);
		expect(palette({ background: "0 0% 100%" }).card).toBe("#ffffff");
		expect(palette({ primary: "bad" }).primary).toBe("#fafafa");
	});
});

describe("text", () => {
	it("escapes XML", () => {
		expect(escapeXml(`<a & "b">`)).toBe("&lt;a &amp; &quot;b&quot;&gt;");
	});

	it("truncates with an ellipsis and shrinks before truncating", () => {
		expect(truncate("short", 10)).toBe("short");
		expect(truncate("a very long page name", 8)).toBe("a very…");
		expect(fit("Main", 128, 24, 14)).toEqual({ text: "Main", size: 24 });
		const mid = fit("Performance", 128, 24, 14);
		expect(mid.size).toBeLessThan(24);
		expect(mid.text).toBe("Performance");
		const long = fit("An extremely long studio page name", 128, 24, 14);
		expect(long.size).toBe(14);
		expect(long.text.endsWith("…")).toBe(true);
	});

	it("wraps words into lines and truncates the overflow", () => {
		expect(wrap("Strip 1920x550", 11, 2)).toEqual(["Strip", "1920x550"]);
		expect(wrap("one two three four five six", 8, 2)).toHaveLength(2);
		expect(wrap("one two three four five six", 8, 2)[1]!.endsWith("…")).toBe(true);
		expect(wrap("", 8, 2)).toEqual([]);
	});
});

describe("icons", () => {
	it("looks icons up case-insensitively and falls back for unknown names", () => {
		expect(hasIcon("gamepad-2")).toBe(true);
		expect(hasIcon("Gamepad-2")).toBe(true);
		expect(hasIcon("no-such-icon")).toBe(false);
		expect(iconBody("no-such-icon")).toBe(iconBody("circle-help"));
		expect(iconBody(undefined)).toBe(iconBody("circle-help"));
		expect(iconBody("gamepad-2")).not.toBe(iconBody("circle-help"));
	});

	it("encodes an SVG as a data URL", () => {
		expect(svgDataUrl("<svg/>")).toBe("data:image/svg+xml,%3Csvg%2F%3E");
	});
});

describe("page-control keys", () => {
	it("is a 144x144 SVG with the page name and icon", () => {
		const svg = pageKey({ theme, icon: "gamepad-2", name: "Gaming", active: false });
		expect(svg).toContain('width="144" height="144"');
		expect(svg).toContain(">Gaming</text>");
		expect(svg).toContain(iconBody("gamepad-2"));
	});

	it("fills with the primary colour when active and uses the card colour when not", () => {
		const active = pageKey({ theme, name: "A", active: true });
		const idle = pageKey({ theme, name: "A", active: false });
		expect(active).toContain(`<rect width="144" height="144" fill="${P.primary}"/>`);
		expect(active).toContain(`fill="${P.primaryFg}"`);
		expect(idle).toContain(`<rect width="144" height="144" fill="${P.card}"/>`);
		expect(idle).toContain(`stroke="${P.primary}"`);
		expect(active).not.toBe(idle);
	});

	it("truncates long names and escapes markup", () => {
		const svg = pageKey({ theme, name: "A page with a really very long name <b>", active: false });
		expect(svg).toContain("…");
		expect(svg).not.toContain("<b>");
		expect(pageKey({ theme, name: "R&D", active: false })).toContain("R&amp;D");
	});

	it("draws the fallback glyph for an unknown icon", () => {
		expect(pageKey({ theme, icon: "nope", name: "x", active: false })).toContain(iconBody("circle-help"));
	});

	it("draws the offline key muted with a disconnected glyph", () => {
		const svg = offlineKey(theme);
		expect(svg).toContain(P.muted);
		expect(svg).toContain(iconBody("wifi-off"));
		expect(svg).toContain(">Offline</text>");
	});

	it("shows the arrow and the current page on next / prev", () => {
		const next = navKey({ theme, direction: "next", pageName: "Main" });
		const prev = navKey({ theme, direction: "prev", pageName: "Main" });
		expect(next).toContain(iconBody("chevron-right"));
		expect(prev).toContain(iconBody("chevron-left"));
		expect(next).toContain(">Main</text>");
	});

	it("wraps a profile name and marks the active profile", () => {
		const svg = profileKey({ theme, name: "Strip 1920x550", active: true });
		expect(svg).toContain(">Strip</text>");
		expect(svg).toContain(">1920x550</text>");
		expect(svg).toContain(`fill="${P.primary}"`);
	});

	it("labels the rotate key and dims it with fewer than two pages", () => {
		const base = { theme, rotating: true, disabled: false, override: null, saved: false } as const;
		expect(rotateSubtitle(base)).toBe("rotating");
		expect(rotateSubtitle({ ...base, rotating: false })).toBe("paused");
		expect(rotateSubtitle({ ...base, override: "off", saved: true })).toBe("saved: on");
		expect(rotateSubtitle({ ...base, override: "on", saved: false })).toBe("saved: off");
		expect(rotateSubtitle({ ...base, disabled: true })).toBe("1 page");
		expect(rotateKey(base)).toContain(iconBody("play"));
		expect(rotateKey({ ...base, rotating: false })).toContain(iconBody("pause"));
		expect(rotateKey({ ...base, disabled: true })).toContain(`fill="${P.muted}"`);
	});
});

describe("touch strip", () => {
	it("builds the feedback payload with position, bar and rotating mark", () => {
		const f = cyclerFeedback({ theme, offline: false, pageName: "Gaming", icon: "gamepad-2", index: 2, total: 4, rotating: true });
		expect(f.name).toEqual({ value: "Gaming", color: P.fg });
		expect(f.pos).toEqual({ value: "2 / 4", color: P.mutedFg });
		expect(f.bar).toEqual({ value: 50, bar_fill_c: P.primary });
		expect(String(f.icon)).toContain("data:image/svg+xml");
		expect(String(f.mark)).toContain("data:image/svg+xml");
		expect(cyclerFeedback({ theme, offline: false, pageName: "x", index: 1, total: 1, rotating: false }).mark).toBe("");
	});

	it("clamps the position and shows offline", () => {
		expect(cyclerFeedback({ theme, offline: false, index: 9, total: 3, rotating: false }).pos).toMatchObject({ value: "3 / 3" });
		const off = cyclerFeedback({ theme, offline: true, index: 1, total: 1, rotating: true });
		expect(off.name).toMatchObject({ value: "Offline" });
		expect(off.mark).toBe("");
	});

	it("steps through the pages by the summed ticks, wrapping both ways", () => {
		const ids = ["a", "b", "c"];
		expect(stepTarget(ids, "a", 1)).toBe("b");
		expect(stepTarget(ids, "c", 1)).toBe("a");
		expect(stepTarget(ids, "a", -1)).toBe("c");
		expect(stepTarget(ids, "b", 5)).toBe("a");
		expect(stepTarget(ids, "b", -4)).toBe("a");
		expect(stepTarget(ids, undefined, 1)).toBe("b");
		expect(stepTarget(ids, "gone", 1)).toBe("b");
		expect(stepTarget([], "a", 1)).toBeUndefined();
	});
});

describe("sensor key", () => {
	const base = { theme, label: "CPU Load", value: "91.4", unit: "%", severity: "normal", history: [1, 2, 3] } as const;

	it("shows label, value, unit and a sparkline in the severity colour", () => {
		const normal = sensorKey(base);
		expect(normal).toContain(">CPU Load</text>");
		expect(normal).toContain("91.4");
		expect(normal).toContain(">%</tspan>");
		expect(normal).toContain("<path");
		expect(normal).toContain(`fill="${P.primary}"`);
		expect(sensorKey({ ...base, severity: "warn" })).toContain(`fill="${P.warn}"`);
		expect(sensorKey({ ...base, severity: "crit" })).toContain(`fill="${P.destructive}"`);
	});

	it("draws a dash until a reading arrives and skips a one-point sparkline", () => {
		const waiting = sensorKey({ ...base, value: undefined, history: [4] });
		expect(waiting).toContain("—");
		expect(waiting).not.toContain("<path");
	});
});
