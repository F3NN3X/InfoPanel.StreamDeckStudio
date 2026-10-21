import { afterEach, describe, expect, it, vi } from "vitest";
import { applyConnection, dataApi, extras, studio } from "./runtime";

describe("applyConnection", () => {
	afterEach(() => {
		applyConnection(undefined);
		vi.restoreAllMocks();
	});

	it("reconnects the studio and extras clients when the studio URL changes, and only the data api when its URL does", () => {
		applyConnection(undefined);
		const spies = [studio, extras, dataApi].map((client) => vi.spyOn(client, "reconnect").mockImplementation(() => {}));
		const called = () => spies.map((spy) => spy.mock.calls.length);

		applyConnection({ studioUrl: "http://other:1" });
		expect(called()).toEqual([1, 1, 0]);
		applyConnection({ studioUrl: " http://other:1 " });
		expect(called()).toEqual([1, 1, 0]);
		applyConnection({ studioUrl: "http://other:1", dataApiUrl: "http://api:2" });
		expect(called()).toEqual([1, 1, 1]);
	});
});
