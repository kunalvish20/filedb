import { describe, expect, it } from "vitest";
import { formatIndianRupees, INDIAN_CURRENCY } from "@/lib/currency";

describe("Indian rupee formatting", () => {
    it("uses the rupee symbol and Indian lakh/crore grouping", () => {
        expect(INDIAN_CURRENCY.code).toBe("INR");
        expect(formatIndianRupees(123456.78)).toBe("₹1,23,456.78");
        expect(formatIndianRupees(12345678.9)).toBe("₹1,23,45,678.90");
    });

    it("preserves rupee amounts and displays two decimal places", () => {
        expect(formatIndianRupees(999)).toBe("₹999.00");
        expect(formatIndianRupees(0)).toBe("₹0.00");
        expect(formatIndianRupees(12.345)).toBe("₹12.35");
        expect(formatIndianRupees(-500.5)).toBe("-₹500.50");
    });
});
