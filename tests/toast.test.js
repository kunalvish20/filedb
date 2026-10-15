import { describe, it, expect } from "vitest";
import { computeToastDuration } from "@/components/Toast";
describe("computeToastDuration", () => {
    it("honours a minimum duration for short success messages", () => {
        expect(computeToastDuration("ok")).toBe(4000);
        expect(computeToastDuration("")).toBe(4000);
    });
    it("scales with message length for medium-length success messages", () => {
        // 100 chars * 60ms = 6000ms — within [4000, 10000] bounds
        const msg = "a".repeat(100);
        expect(computeToastDuration(msg)).toBe(6000);
    });
    it("caps success messages at 10 seconds", () => {
        const msg = "a".repeat(500);
        expect(computeToastDuration(msg)).toBe(10000);
    });
    it("holds error messages longer by default", () => {
        expect(computeToastDuration("oops", "error")).toBe(6000);
        expect(computeToastDuration("a".repeat(100), "error")).toBe(6000);
        // 200 * 60 = 12000 — within [6000, 15000] error bounds
        expect(computeToastDuration("a".repeat(200), "error")).toBe(12000);
    });
    it("caps error messages at 15 seconds", () => {
        const msg = "a".repeat(500);
        expect(computeToastDuration(msg, "error")).toBe(15000);
    });
});
