import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import dbConnect from "@/lib/mongodb";
import { GET } from "@/app/api/health/route";

vi.mock("@/lib/mongodb", () => ({ default: vi.fn() }));

beforeEach(() => {
    vi.stubEnv("MONGODB_URI", "mongodb://127.0.0.1/health-test");
    vi.mocked(dbConnect).mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("database readiness", () => {
    it("reports missing configuration without attempting a connection", async () => {
        vi.stubEnv("MONGODB_URI", "");
        const response = await GET();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: "unconfigured" });
        expect(dbConnect).not.toHaveBeenCalled();
        expect(response.headers.get("cache-control")).toBe("no-store");
    });

    it("only reports ready after a database ping succeeds", async () => {
        const command = vi.fn().mockResolvedValue({ ok: 1 });
        vi.mocked(dbConnect).mockResolvedValue({ connection: { db: { command } } });
        const response = await GET();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: "ready" });
        expect(command).toHaveBeenCalledWith({ ping: 1 }, { maxTimeMS: 5000 });
    });

    it("does not expose a connection string when connecting fails", async () => {
        vi.mocked(dbConnect).mockRejectedValue(new Error("mongodb://user:secret@private-host/database"));
        const response = await GET();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: "unavailable" });
    });

    it("reports unavailable when a cached connection can no longer ping", async () => {
        const command = vi.fn().mockRejectedValue(new Error("Connection lost"));
        vi.mocked(dbConnect).mockResolvedValue({ connection: { db: { command } } });
        const response = await GET();
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ status: "unavailable" });
    });
});
