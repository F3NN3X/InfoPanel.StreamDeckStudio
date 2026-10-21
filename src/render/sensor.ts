// Pure renderer for the sensor key: label, value, unit and a sparkline or fill bar on a themed background.

import type { ThemeTokens } from "../studio";
import { sparklinePath, type Severity } from "../sensor-format";
import { palette } from "./color";
import { escapeXml, fit, FONT, textEl } from "./text";

export interface SensorKeyInput {
	theme: ThemeTokens;
	label: string;
	/** Formatted value, or undefined while no reading has arrived. */
	value?: string;
	unit?: string;
	severity: Severity;
	history: readonly number[];
	/** Draw a bar filled this far (0..1) instead of the sparkline. */
	bar?: number;
}

/** A rounded track with a fill from the left, in the area the sparkline uses. */
function bar(fraction: number, track: string, color: string): string {
	const width = Math.round(112 * fraction);
	const fill = width > 0 ? `<rect x="16" y="108" width="${width}" height="12" rx="6" fill="${color}"/>` : "";
	return `<rect x="16" y="108" width="112" height="12" rx="6" fill="${track}"/>${fill}`;
}

export function sensorKey(input: SensorKeyInput): string {
	const p = palette(input.theme);
	const color = input.severity === "crit" ? p.destructive : input.severity === "warn" ? p.warn : p.primary;
	const label = fit(input.label, 128, 20, 13);
	let body: string;
	if (input.value === undefined) {
		body = textEl("—", { x: 72, y: 86, size: 44, fill: p.mutedFg });
	} else {
		const unit = input.unit ?? "";
		const value = fit(input.value, unit ? 100 : 128, 46, 20);
		const unitSize = Math.round(value.size * 0.5);
		const tspan = unit ? `<tspan font-size="${unitSize}" font-weight="500" fill-opacity="0.75" dx="3">${escapeXml(unit)}</tspan>` : "";
		body = `<text x="72" y="84" font-family="${FONT}" font-size="${value.size}" font-weight="700" text-anchor="middle" fill="${color}">${escapeXml(value.text)}${tspan}</text>`;
	}
	const path = input.bar === undefined ? sparklinePath(input.history, 16, 100, 112, 28) : "";
	const spark = input.bar !== undefined ? bar(input.bar, p.muted, color) : path ?`<path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.9"/>` : "";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="${p.card}"/>${textEl(label.text, { x: 72, y: 28, size: label.size, fill: p.mutedFg, weight: 500 })}${body}${spark}</svg>`;
}
