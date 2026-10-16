import { describe, expect, it } from "vitest";
import { readApiArray } from "@/lib/readApiArray";

describe("API list responses", () => {
    it("keeps successful empty and populated lists", async () => {
        await expect(readApiArray(Response.json([]))).resolves.toEqual([]);
        await expect(readApiArray(Response.json([{ _id: "spool" }]))).resolves.toEqual([{ _id: "spool" }]);
    });

    it("rejects the missing-database error instead of putting it in list state", async () => {
        const response = Response.json({ error: "Database connection failed" }, { status: 500 });
        await expect(readApiArray(response)).rejects.toThrow("Database connection failed");
    });

    it.each([{}, null, "not a list", { error: "Database connection failed" }])("rejects malformed success bodies: %j", async (body) => {
        await expect(readApiArray(Response.json(body))).rejects.toThrow("invalid list response");
    });

    it("rejects an HTML error response", async () => {
        await expect(readApiArray(new Response("<html>Unavailable</html>", { status: 503 }))).rejects.toThrow();
    });
});
