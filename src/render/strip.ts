// Touch-strip feedback for the page cycler (layouts/page-cycler.json: icon, name, bar, pos, mark) and the sensor dial.

import type { FeedbackPayload } from "@elgato/streamdeck";
import type { ThemeTokens } from "../studio";
import type { Severity } from "../sensor-format";
import { palette } from "./color";
import { iconSvg, svgDataUrl } from "./icons";
import { truncate } from "./text";

export interface CyclerInput {
	theme: ThemeTokens;
	offline: boolean;
	pageName?: string;
	icon?: string;
	/** 1-based position of the current page. */
	index: number;
	total: number;
	rotating: boolean;
}

export function cyclerFeedback(input: CyclerInput): FeedbackPayload {
	const p = palette(input.theme);
	if (input.offline) {
		return {
			icon: svgDataUrl(iconSvg("wifi-off", 36, p.mutedFg)),
			name: { value: "Offline", color: p.mutedFg },
			bar: { value: 0, bar_fill_c: p.muted },
			pos: { value: "", color: p.mutedFg },
			mark: "",
		};
	}
	const total = Math.max(1, input.total);
	const index = Math.min(total, Math.max(1, input.index));
	return {
		icon: svgDataUrl(iconSvg(input.icon, 36, p.primary)),
		name: { value: truncate(input.pageName ?? "", 14), color: p.fg },
		bar: { value: Math.round((index / total) * 100), bar_fill_c: p.primary },
		pos: { value: `${index} / ${total}`, color: p.mutedFg },
		mark: input.rotating ? svgDataUrl(iconSvg("refresh-cw", 24, p.primary)) : "",
	};
}

/** The page after moving `ticks` steps from `current`, wrapping; undefined when there are no pages. */
export function stepTarget(pageIds: readonly string[], current: string | undefined, ticks: number): string | undefined {
	if (pageIds.length === 0) return undefined;
	const at = Math.max(0, current ? pageIds.indexOf(current) : 0);
	return pageIds[(((at + ticks) % pageIds.length) + pageIds.length) % pageIds.length];
}

export interface SensorStripInput {
	theme: ThemeTokens;
	offline: boolean;
	label: string;
	/** Formatted value, or undefined while no reading has arrived. */
	value?: string;
	unit?: string;
	severity: Severity;
	/** How full the bar is (0..1); undefined draws it empty. */
	bar?: number;
}

/** Feedback for layouts/sensor-dial.json: label, value + unit, bar. */
export function sensorFeedback(input: SensorStripInput): FeedbackPayload {
	const p = palette(input.theme);
	if (input.offline) {
		return { label: { value: "Offline", color: p.mutedFg }, value: { value: "", color: p.mutedFg }, bar: { value: 0, bar_fill_c: p.muted } };
	}
	const color = input.severity === "crit" ? p.destructive : input.severity === "warn" ? p.warn : p.primary;
	return {
		label: { value: truncate(input.label, 24), color: p.mutedFg },
		value: { value: input.value === undefined ? "—" : `${input.value}${input.unit ? ` ${input.unit}` : ""}`, color: input.value === undefined ? p.mutedFg : color },
		bar: { value: Math.round((input.bar ?? 0) * 100), bar_fill_c: color },
	};
}
