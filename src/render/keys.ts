// Pure renderers for the page-control keys: theme in, 144x144 SVG string out.

import type { ThemeTokens } from "../studio";
import { palette, type Palette } from "./color";
import { glyph } from "./icons";
import { fit, textEl, wrap } from "./text";

const SIZE = 144;

function frame(fill: string, inner: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="${SIZE}" height="${SIZE}" fill="${fill}"/>${inner}</svg>`;
}

/** Colours for a key that can be filled with the primary colour (active) or sit on the card colour. */
function tone(p: Palette, active: boolean) {
	return active ? { bg: p.primary, icon: p.primaryFg, text: p.primaryFg } : { bg: p.card, icon: p.primary, text: p.cardFg };
}

function caption(name: string, color: string, y = 120): string {
	const f = fit(name, 128, 24, 14);
	return textEl(f.text, { x: 72, y, size: f.size, fill: color });
}

/** The studio cannot be reached. */
export function offlineKey(theme: ThemeTokens = {}): string {
	const p = palette(theme);
	return frame(p.muted, glyph("wifi-off", 42, 22, 60, p.mutedFg) + textEl("Offline", { x: 72, y: 120, size: 22, fill: p.mutedFg }));
}

export interface PageKeyInput {
	theme: ThemeTokens;
	icon?: string;
	name: string;
	active: boolean;
}

export function pageKey(input: PageKeyInput): string {
	const p = palette(input.theme);
	const t = tone(p, input.active);
	return frame(t.bg, glyph(input.icon, 42, 18, 60, t.icon) + caption(input.name, t.text));
}

export interface NavKeyInput {
	theme: ThemeTokens;
	direction: "next" | "prev";
	pageName: string;
}

export function navKey(input: NavKeyInput): string {
	const p = palette(input.theme);
	const arrow = input.direction === "next" ? "chevron-right" : "chevron-left";
	return frame(p.card, glyph(arrow, 36, 14, 72, p.primary, 2.5) + caption(input.pageName, p.cardFg));
}

export interface ProfileKeyInput {
	theme: ThemeTokens;
	name: string;
	active: boolean;
}

export function profileKey(input: ProfileKeyInput): string {
	const p = palette(input.theme);
	const t = tone(p, input.active);
	const lines = wrap(input.name, 11, 2);
	const text = lines.map((line, i) => textEl(line, { x: 72, y: (lines.length === 1 ? 104 : 94) + i * 26, size: 24, fill: t.text })).join("");
	return frame(t.bg, glyph("layers", 50, 14, 44, t.icon) + text);
}

export interface RotateKeyInput {
	theme: ThemeTokens;
	rotating: boolean;
	/** The profile has fewer than two pages: nothing to rotate. */
	disabled: boolean;
	/** The profile's saved setting, shown when a runtime override differs from it. */
	override: "on" | "off" | null;
	saved: boolean;
}

export function rotateSubtitle(input: Pick<RotateKeyInput, "rotating" | "disabled" | "override" | "saved">): string {
	if (input.disabled) return "1 page";
	if (input.override) return `saved: ${input.saved ? "on" : "off"}`;
	return input.rotating ? "rotating" : "paused";
}

export function rotateKey(input: RotateKeyInput): string {
	const p = palette(input.theme);
	if (input.disabled) {
		return frame(p.muted, glyph("pause", 42, 18, 60, p.mutedFg) + textEl(rotateSubtitle(input), { x: 72, y: 120, size: 20, fill: p.mutedFg }));
	}
	const t = tone(p, input.rotating);
	return frame(t.bg, glyph(input.rotating ? "play" : "pause", 42, 18, 60, t.icon) + textEl(rotateSubtitle(input), { x: 72, y: 120, size: 20, fill: t.text }));
}
