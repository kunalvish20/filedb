import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

function request(key) {
    return new NextRequest("http://localhost:3456/api/filaments", {
        headers: key ? { authorization: `Bearer ${key}` } : {},
    });
}

afterEach(() => vi.unstubAllEnvs());

describe("spilofila API-key configuration", () => {
    it("uses the new key name and branded authentication realm", () => {
        vi.stubEnv("SPILOFILA_API_KEY", "new-key");
        vi.stubEnv("FILAMENTDB_API_KEY", "legacy-key");
        expect(proxy(request("new-key")).status).toBe(200);
        const rejected = proxy(request("legacy-key"));
        expect(rejected.status).toBe(401);
        expect(rejected.headers.get("www-authenticate")).toBe('Bearer realm="spilofila"');
    });

    it("keeps existing deployments protected with the legacy key name", () => {
        vi.stubEnv("SPILOFILA_API_KEY", "");
        vi.stubEnv("FILAMENTDB_API_KEY", "legacy-key");
        expect(proxy(request()).status).toBe(401);
        expect(proxy(request("legacy-key")).status).toBe(200);
    });

    it("leaves local deployments accessible when neither key is configured", () => {
        vi.stubEnv("SPILOFILA_API_KEY", "");
        vi.stubEnv("FILAMENTDB_API_KEY", "");
        expect(proxy(request()).status).toBe(200);
    });
});
