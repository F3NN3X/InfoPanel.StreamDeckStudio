// Items for the property inspectors' sdpi-select datasources (`{ event, items }` replies).

import type { JsonObject } from "@elgato/utils";
import type { StudioClient } from "../studio";
import type { SensorInfo } from "../data-api";

export type SdpiItem = { label: string; value: string; disabled?: boolean };
export type SdpiGroup = { label: string; children: SdpiItem[] };

export const SHOWN = "";

/** Profiles, led by the "shown" entry (page keys) or "Auto" (switch-profile). */
export function profileItems(studio: StudioClient, lead: "shown" | "auto" | null): SdpiItem[] {
	const items = (studio.config?.profiles ?? []).map((p) => ({ label: p.name || p.id, value: p.id }));
	if (lead === "shown") return [{ label: "Shown profile", value: SHOWN }, ...items];
	if (lead === "auto") return [{ label: "Auto (clear override)", value: SHOWN }, ...items];
	return items;
}

/** Pages of the chosen profile (the shown one when blank). */
export function pageItems(studio: StudioClient, profile: string | undefined): SdpiItem[] {
	return studio.pagesOf(studio.resolveProfile(profile)).map((p) => ({ label: p.name || p.id, value: p.id }));
}

/**
 * Sensors grouped by source, filtered by a case-insensitive substring of key or name. The selected key
 * always stays in the list so the select keeps showing it.
 */
export function sensorItems(sensors: readonly SensorInfo[], filter: string | undefined, selected: string | undefined): SdpiGroup[] {
	const needle = filter?.trim().toLowerCase() ?? "";
	const groups = new Map<string, SdpiItem[]>();
	for (const s of sensors) {
		const label = s.name ? `${s.name} (${s.key})` : s.key;
		if (needle && s.key !== selected && !label.toLowerCase().includes(needle)) continue;
		const source = s.source || "other";
		groups.set(source, [...(groups.get(source) ?? []), { label, value: s.key }]);
	}
	return [...groups].map(([label, children]) => ({ label, children }));
}

/** The request a datasource sends: `{ event }`. */
export const eventOf = (payload: unknown): string | undefined => {
	const event = (payload as JsonObject | undefined)?.event;
	return typeof event === "string" ? event : undefined;
};
