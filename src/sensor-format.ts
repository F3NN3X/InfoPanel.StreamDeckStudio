// Pure helpers for the sensor key: number formatting, threshold severity, the sparkline path and the bar fill.

export type Severity = "normal" | "warn" | "crit";

/** A setting that may arrive as a number or a typed string; blank or invalid is undefined. */
export function toNumber(value: unknown): number | undefined {
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value !== "string" || value.trim() === "") return undefined;
	const n = Number(value.replace(",", "."));
	return Number.isFinite(n) ? n : undefined;
}

/** Fixed `decimals` when set (0-6), else enough to show about three significant digits. */
export function formatValue(value: number, decimals?: unknown): string {
	const fixed = toNumber(decimals);
	if (fixed !== undefined) return value.toFixed(Math.min(6, Math.max(0, Math.round(fixed))));
	const abs = Math.abs(value);
	const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
	return String(Number(value.toFixed(digits)));
}

/** `invert` means lower is worse: crit at or below `crit`, warn at or below `warn`. */
export function severity(value: number | undefined, warn: unknown, crit: unknown, invert = false): Severity {
	if (value === undefined) return "normal";
	const w = toNumber(warn);
	const c = toNumber(crit);
	const past = (limit: number | undefined) => limit !== undefined && (invert ? value <= limit : value >= limit);
	if (past(c)) return "crit";
	if (past(w)) return "warn";
	return "normal";
}

/** A polyline path through `values` scaled into the box; "" with fewer than two points, flat when all equal. */
export function sparklinePath(values: readonly number[], x: number, y: number, width: number, height: number): string {
	if (values.length < 2) return "";
	const min = Math.min(...values);
	const max = Math.max(...values);
	const span = max - min;
	return values
		.map((v, i) => {
			const px = x + (i / (values.length - 1)) * width;
			const py = span === 0 ? y + height / 2 : y + height - ((v - min) / span) * height;
			return `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`;
		})
		.join(" ");
}

/** Where the bar of a bar-style sensor tops out: the `barMax` setting, else 100 for percent and degree units. */
export function barMaxOf(setting: unknown, unit: string | undefined): number | undefined {
	return toNumber(setting) ?? (unit === "%" || unit?.includes("°") ? 100 : undefined);
}

/** How full a bar from 0 to `max` is, clamped to 0..1; undefined without a value or a positive max. */
export function barFraction(value: number | undefined, max: number | undefined): number | undefined {
	if (value === undefined || max === undefined || max <= 0) return undefined;
	return Math.min(1, Math.max(0, value / max));
}
