// Studio theme tokens (shadcn HSL triplets such as "240 10% 3.9%") to hex colours for SVG.

import type { ThemeTokens } from "../studio";

/** The studio's dark default, used for any token the config does not set. */
const DEFAULT_TOKENS: ThemeTokens = {
	background: "240 10% 3.9%",
	foreground: "0 0% 98%",
	primary: "0 0% 98%",
	"primary-foreground": "240 5.9% 10%",
	card: "240 10% 3.9%",
	"card-foreground": "0 0% 98%",
	muted: "240 3.7% 15.9%",
	"muted-foreground": "240 5% 64.9%",
	border: "240 3.7% 15.9%",
	destructive: "0 62.8% 30.6%",
};

export const WARN_COLOR = "#f59e0b";

/** "240 10% 3.9%" (or "hsl(240, 10%, 3.9%)") to "#09090b"; undefined when it is not an HSL triplet. */
export function hslToHex(value: string | undefined): string | undefined {
	const parts = value?.match(/-?\d*\.?\d+/g);
	if (!parts || parts.length < 3) return undefined;
	const h = (((Number(parts[0]) % 360) + 360) % 360) / 360;
	const s = Math.min(1, Math.max(0, Number(parts[1]) / 100));
	const l = Math.min(1, Math.max(0, Number(parts[2]) / 100));
	const a = s * Math.min(l, 1 - l);
	const channel = (n: number) => {
		const k = (n + h * 12) % 12;
		const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(v * 255).toString(16).padStart(2, "0");
	};
	return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export interface Palette {
	bg: string;
	fg: string;
	primary: string;
	primaryFg: string;
	card: string;
	cardFg: string;
	muted: string;
	mutedFg: string;
	border: string;
	destructive: string;
	warn: string;
}

export function palette(theme: Partial<ThemeTokens> = {}): Palette {
	const pick = (key: string, fallbackKey?: string): string =>
		hslToHex(theme[key]) ?? (fallbackKey ? hslToHex(theme[fallbackKey]) : undefined) ?? hslToHex(DEFAULT_TOKENS[key]) ?? "#000000";
	return {
		bg: pick("background"),
		fg: pick("foreground"),
		primary: pick("primary"),
		primaryFg: pick("primary-foreground"),
		card: pick("card", "background"),
		cardFg: pick("card-foreground", "foreground"),
		muted: pick("muted"),
		mutedFg: pick("muted-foreground"),
		border: pick("border"),
		destructive: pick("destructive"),
		warn: WARN_COLOR,
	};
}
