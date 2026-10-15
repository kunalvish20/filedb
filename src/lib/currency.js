import { getNumberFormat } from "@/lib/intlCache";

export const INDIAN_CURRENCY = Object.freeze({
    code: "INR",
    symbol: "₹",
    name: "Indian Rupee",
});

/** Amounts are entered in rupees; formatting never converts their value. */
export function formatIndianRupees(value) {
    return getNumberFormat("en-IN", {
        style: "currency",
        currency: INDIAN_CURRENCY.code,
    }).format(value);
}
