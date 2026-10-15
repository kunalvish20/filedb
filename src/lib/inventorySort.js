/**
 * GH #795 — pure grouping + sorting transforms for the `/inventory` page.
 *
 * The `/api/spools/by-location` aggregation groups spools by Location and
 * already projects everything the client needs per row (filamentType /
 * filamentVendor / filamentName / weights / dates). So group-by Type / Vendor /
 * None and any within-group sort are pure CLIENT transforms over the existing
 * rows — no server-route change. This module flattens the server's
 * location-groups back to a row list, re-buckets by the chosen key, recomputes
 * each group's count + remaining-gram total, and sorts the rows within each
 * group (and the groups themselves).
 *
 * DB-free + UI-free so it's fast to unit-test. Mirrors `sortFilamentList.ts`'s
 * "blanks always sink to the bottom regardless of direction" rule.
 */
/** Stable group keys for the "no value" + "none" buckets. */
export const INVENTORY_NO_GROUP_KEY = "__nogroup__";
export const INVENTORY_ALL_KEY = "__all__";
function isBlank(v) {
    return !v || v.trim() === "";
}
/**
 * Net remaining filament grams for the group TOTAL: gross `totalWeight` minus
 * the empty-spool tare (variant's own `spoolWeight`, else parent's, else a 0g
 * fallback). The 0g fallback matches `/api/spools/by-location`'s own totalGrams
 * math and the page's filtered-group recompute (Codex P2 round 4 on PR #400), so
 * a no-tare legacy row still contributes its gross to the shelf total. `null`
 * only when there's no `totalWeight` at all.
 */
export function inventoryRemainingGrams(row) {
    if (row.totalWeight == null)
        return null;
    const tare = row.spoolWeight ?? row.parentSpoolWeight ?? 0;
    return Math.max(0, row.totalWeight - tare);
}
/**
 * Remaining grams for SORTING — stricter than {@link inventoryRemainingGrams}:
 * `null` when the tare is unknown (no own or parent `spoolWeight`), matching the
 * table's `remainingGrams`, which renders such rows as "—". So a no-tare row
 * sorts as "unknown" and sinks last (the UI + sort contract), rather than its
 * gross weight being mistaken for a real remaining value and ordered among real
 * ones — important now that remaining-weight is the default sort (Codex P2).
 * The group TOTAL still counts the gross via the 0g-tare fallback above; that's
 * a deliberately separate contract.
 */
function remainingForSort(row) {
    if (row.totalWeight == null)
        return null;
    const tare = row.spoolWeight ?? row.parentSpoolWeight ?? null;
    if (tare == null)
        return null;
    return Math.max(0, row.totalWeight - tare);
}
/** Comparable value for a sort key, or `null` when blank/unknown (sinks last). */
function sortValue(row, key) {
    switch (key) {
        case "remaining":
            return remainingForSort(row);
        case "name":
            return isBlank(row.filamentName) ? null : row.filamentName.toLowerCase();
        case "type":
            return isBlank(row.filamentType) ? null : row.filamentType.toLowerCase();
        case "vendor":
            return isBlank(row.filamentVendor) ? null : row.filamentVendor.toLowerCase();
        case "purchase":
        case "opened": {
            const raw = key === "purchase" ? row.purchaseDate : row.openedDate;
            if (!raw)
                return null;
            const t = Date.parse(raw);
            return Number.isNaN(t) ? null : t;
        }
    }
}
function makeRowComparator(key, dir) {
    const mul = dir === "desc" ? -1 : 1;
    return (a, b) => {
        const av = sortValue(a, key);
        const bv = sortValue(b, key);
        // Blanks/unknowns always sink to the bottom regardless of direction
        // (mirrors sortFilamentList.ts), so a missing weight/date doesn't hijack
        // the top of an ascending sort.
        if (av == null && bv == null)
            return 0;
        if (av == null)
            return 1;
        if (bv == null)
            return -1;
        if (typeof av === "number" && typeof bv === "number")
            return (av - bv) * mul;
        return String(av).localeCompare(String(bv)) * mul;
    };
}
/**
 * Regroup + sort the server's location-grouped spools.
 *
 * - `groupBy: "location"` preserves the server grouping (key = locationId, the
 *   Location doc retained); the synthetic "no location" group keeps key
 *   {@link INVENTORY_NO_GROUP_KEY} and sorts last.
 * - `"type"` / `"vendor"` re-bucket by the row's effective field; a blank value
 *   lands in one `INVENTORY_NO_GROUP_KEY` bucket sorted last.
 * - `"none"` collapses everything into a single {@link INVENTORY_ALL_KEY} group.
 *
 * Each group's `count` + `totalGrams` are recomputed from its rows (0g-tare
 * fallback), so totals stay correct under any grouping. Rows within a group are
 * sorted by `sortKey`/`dir`; groups are ordered alphabetically with the
 * no-value bucket last (a single group for "none").
 */
export function groupAndSortInventory(groups, groupBy, sortKey, dir) {
    const buckets = new Map();
    const ensure = (key, label, location, locationId) => {
        let b = buckets.get(key);
        if (!b) {
            b = { key, label, location, locationId, spools: [], count: 0, totalGrams: 0 };
            buckets.set(key, b);
        }
        return b;
    };
    for (const g of groups) {
        for (const row of g.spools) {
            if (groupBy === "location") {
                const key = g.locationId ?? INVENTORY_NO_GROUP_KEY;
                ensure(key, null, g.location, g.locationId).spools.push(row);
            }
            else if (groupBy === "type" || groupBy === "vendor") {
                const raw = groupBy === "type" ? row.filamentType : row.filamentVendor;
                const value = isBlank(raw) ? null : raw;
                const key = value ?? INVENTORY_NO_GROUP_KEY;
                ensure(key, value, null, null).spools.push(row);
            }
            else {
                ensure(INVENTORY_ALL_KEY, null, null, null).spools.push(row);
            }
        }
    }
    const cmp = makeRowComparator(sortKey, dir);
    const out = [...buckets.values()];
    for (const b of out) {
        b.count = b.spools.length;
        b.totalGrams = b.spools.reduce((sum, r) => sum + (inventoryRemainingGrams(r) ?? 0), 0);
        b.spools.sort(cmp);
    }
    // Order groups: the no-value bucket sinks last; otherwise alphabetical by the
    // location name (location mode) or the bucket label (type/vendor). "none" has
    // a single group so the comparator is a no-op there.
    out.sort((a, b) => {
        const aNone = a.key === INVENTORY_NO_GROUP_KEY;
        const bNone = b.key === INVENTORY_NO_GROUP_KEY;
        if (aNone && !bNone)
            return 1;
        if (bNone && !aNone)
            return -1;
        if (groupBy === "location") {
            return (a.location?.name || "").localeCompare(b.location?.name || "");
        }
        return (a.label || "").localeCompare(b.label || "");
    });
    return out;
}
