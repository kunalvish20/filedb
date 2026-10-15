/**
 * Sorting helpers for the home filament list.
 *
 * Extracted from src/app/page.tsx so the comparator + handleSort
 * contract can be unit-tested without mounting the React component.
 * GH #165 reported a (non-reproducible) "Cost column sorts desc on
 * first click" bug; this module exists so any future refactor that
 * accidentally introduces a per-column polarity bias gets caught
 * by tests/sortFilamentList.test.ts.
 *
 * Behaviour locked in here:
 *   - Clicking a *new* column always sets sortDir = "asc" (no
 *     per-column override — same rule for every column).
 *   - Clicking the *same* column toggles asc ↔ desc.
 *   - getSortValue returns `null` for a missing numeric value, and the
 *     comparator always sorts nulls/blanks LAST regardless of direction
 *     (#575.6) — a filament with no cost shouldn't jump above the cheapest
 *     real one in an ascending sort.
 */
import { getRemainingPct } from "@/lib/inventoryStats";
/** #941: earliest date (across ALL of a filament's spools, retired included —
 * a purchase/open date is a historical fact regardless of retirement) for the
 * given provenance field, as an ISO string. ISO strings compare
 * chronologically, so the comparator can order them directly. Returns null
 * when no spool carries the date (→ sinks to the bottom via `isBlank`). */
export function earliestSpoolDate(spools, field) {
    let earliest = null;
    for (const s of spools ?? []) {
        const v = s?.[field];
        if (typeof v === "string" && v && (earliest === null || v < earliest)) {
            earliest = v;
        }
    }
    return earliest;
}
export function getSortValue(f, key) {
    switch (key) {
        case "name":
            return f.name.toLowerCase();
        case "vendor":
            return f.vendor.toLowerCase();
        case "type":
            return f.type.toLowerCase();
        case "nozzle":
            return f.temperatures.nozzle ?? null;
        case "bed":
            return f.temperatures.bed ?? null;
        case "cost":
            return f.cost ?? null;
        case "remaining":
            return getRemainingPct(f) ?? null;
        case "purchased":
            return earliestSpoolDate(f.spools, "purchaseDate");
        case "opened":
            return earliestSpoolDate(f.spools, "openedDate");
    }
}
/** A value that should sort to the very end (a missing numeric or a blank
 * string), independent of sort direction. */
function isBlank(v) {
    return v === null || v === "";
}
/**
 * Comparator factory. Returns a `(a, b) => number` that sorts
 * filaments by `key` in `dir` direction. Symmetric across every key
 * so the user gets the same first-click behaviour everywhere.
 *
 * Null/blank values always sink to the bottom regardless of `dir` (#575.6),
 * so an ascending Cost sort lists the cheapest *real* price first and parks
 * the un-priced filaments at the end.
 */
export function compareFilaments(key, dir) {
    return (a, b) => {
        const aVal = getSortValue(a, key);
        const bVal = getSortValue(b, key);
        const aBlank = isBlank(aVal);
        const bBlank = isBlank(bVal);
        if (aBlank && bBlank)
            return 0;
        if (aBlank)
            return 1; // a sinks below b
        if (bBlank)
            return -1; // b sinks below a
        if (aVal < bVal)
            return dir === "asc" ? -1 : 1;
        if (aVal > bVal)
            return dir === "asc" ? 1 : -1;
        return 0;
    };
}
/**
 * Compute the next sort state when the user clicks a column header.
 * Same column → toggle direction. Different column → reset to asc.
 */
export function nextSortState(prev, clicked) {
    if (prev.sortKey === clicked) {
        return { sortKey: clicked, sortDir: prev.sortDir === "asc" ? "desc" : "asc" };
    }
    return { sortKey: clicked, sortDir: "asc" };
}
