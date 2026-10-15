/**
 * Pure helpers for the user-defined currency list (GH #140).
 *
 * Currency entries are persisted as a JSON-serialized array of
 * `{ code, symbol, name }`. Splitting these helpers out of `useCurrency.ts`
 * keeps validation and storage parsing testable without React or DOM
 * dependencies.
 */
const CODE_RE = /^[A-Z][A-Z0-9]{1,5}$/;
const SYMBOL_MAX = 4;
/** Normalise a code candidate: trim + uppercase. */
export function normaliseCode(raw) {
    return raw.trim().toUpperCase();
}
/** Normalise a symbol candidate: trim only. Symbols are case-significant. */
export function normaliseSymbol(raw) {
    return raw.trim();
}
/**
 * Validate a custom-currency candidate against:
 *   - shape rules (non-empty code 2–6 chars, alpha + digits, starts alpha;
 *     non-empty symbol ≤ 4 chars)
 *   - collisions with the supplied built-in code list
 *   - duplicates against the supplied existing-custom list (matched on code)
 *
 * Returns null on success, or a ValidationError discriminator. Callers map
 * the discriminator to a localised string — keeping it as an enum lets the
 * tests assert specific failure modes without coupling to UI copy.
 */
export function validateCustomCurrency(entry, builtInCodes, existingCustom) {
    const code = entry.code;
    const symbol = entry.symbol;
    if (!code)
        return "code-empty";
    if (code.length < 2)
        return "code-too-short";
    if (code.length > 6)
        return "code-too-long";
    if (!CODE_RE.test(code))
        return "code-invalid-chars";
    if (builtInCodes.includes(code))
        return "code-collides-builtin";
    if (existingCustom.some((c) => c.code === code))
        return "code-duplicate";
    if (!symbol)
        return "symbol-empty";
    if (symbol.length > SYMBOL_MAX)
        return "symbol-too-long";
    return null;
}
/** Append a custom currency to the list. Caller is responsible for calling
 * `validateCustomCurrency` first; this helper trusts its input. */
export function addCustomCurrency(list, entry) {
    return [...list, entry];
}
/** Remove a custom currency by code. Match is case-insensitive on code so
 * the caller can pass user input without normalising first. */
export function removeCustomCurrency(list, code) {
    const target = code.trim().toUpperCase();
    return list.filter((c) => c.code !== target);
}
/**
 * Parse the JSON blob persisted to storage back into a CustomCurrency[].
 * Robust against bad shapes — anything missing required fields, duplicates,
 * or built-in collisions is dropped. Returns an empty array on any failure.
 *
 * The defensive filter keeps a corrupted prefs file from poisoning the UI.
 */
export function parseCustomCurrencies(json, builtInCodes) {
    if (!json)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(json);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed))
        return [];
    const seen = new Set(builtInCodes);
    const out = [];
    for (const raw of parsed) {
        if (!raw || typeof raw !== "object")
            continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = raw;
        const code = typeof r.code === "string" ? normaliseCode(r.code) : "";
        const symbol = typeof r.symbol === "string" ? normaliseSymbol(r.symbol) : "";
        const name = typeof r.name === "string" ? r.name : "";
        if (!code || !symbol)
            continue;
        if (seen.has(code))
            continue; // skip dupes & built-in collisions
        if (!CODE_RE.test(code))
            continue;
        if (symbol.length > SYMBOL_MAX)
            continue;
        seen.add(code);
        out.push({ code, symbol, name });
    }
    return out;
}
/** JSON-serialize the list for storage. Dual to parseCustomCurrencies. */
export function serializeCustomCurrencies(list) {
    return JSON.stringify(list);
}
