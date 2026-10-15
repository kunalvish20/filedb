"use client";
import { INDIAN_CURRENCY, formatIndianRupees } from "@/lib/currency";

export const CURRENCIES = [INDIAN_CURRENCY];

export function getCurrencySymbol() {
    return INDIAN_CURRENCY.symbol;
}

/**
 * This India-focused app uses INR throughout, including the initial server
 * render. Legacy saved currency and device/language preferences cannot change
 * prices away from rupees or the Indian lakh/crore grouping.
 */
export function useCurrency() {
    return {
        currency: INDIAN_CURRENCY.code,
        symbol: INDIAN_CURRENCY.symbol,
        format: formatIndianRupees,
    };
}
