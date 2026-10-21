// The plugin-wide clients and the connection settings (global settings) that point them at the servers.

import { StudioClient } from "./studio";
import { DataApi } from "./data-api";
import { ExtrasClient } from "./extras";

export const DEFAULT_STUDIO_URL = "http://127.0.0.1:3922";
export const DEFAULT_DATA_API_URL = "http://127.0.0.1:3921";

export type ConnectionSettings = {
	studioUrl?: string;
	dataApiUrl?: string;
};

export interface Deps {
	studio: StudioClient;
	dataApi: DataApi;
	extras: ExtrasClient;
}

let connection: ConnectionSettings = {};

const urlOf = (value: string | undefined, fallback: string) => value?.trim() || fallback;

export const studio = new StudioClient({ getBaseUrl: () => urlOf(connection.studioUrl, DEFAULT_STUDIO_URL) });
export const dataApi = new DataApi({ getBaseUrl: () => urlOf(connection.dataApiUrl, DEFAULT_DATA_API_URL) });
export const extras = new ExtrasClient({ getBaseUrl: () => urlOf(connection.studioUrl, DEFAULT_STUDIO_URL) });
export const runtime: Deps = { studio, dataApi, extras };

/** Apply the global settings; clients reconnect only when their URL actually changed. */
export function applyConnection(settings: ConnectionSettings | undefined): void {
	const next = settings ?? {};
	const studioChanged = urlOf(next.studioUrl, DEFAULT_STUDIO_URL) !== urlOf(connection.studioUrl, DEFAULT_STUDIO_URL);
	const dataApiChanged = urlOf(next.dataApiUrl, DEFAULT_DATA_API_URL) !== urlOf(connection.dataApiUrl, DEFAULT_DATA_API_URL);
	connection = next;
	if (studioChanged) {
		studio.reconnect();
		extras.reconnect();
	}
	if (dataApiChanged) dataApi.reconnect();
}
