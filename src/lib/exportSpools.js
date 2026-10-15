import dbConnect from "@/lib/mongodb";
import Filament from "@/models/Filament";
import Location from "@/models/Location";
import { resolveFilament } from "@/lib/resolveFilament";
export const SPOOL_EXPORT_COLUMNS = [
    // Round-trippable columns first — these match `/api/spools/import` exactly.
    { key: "filament", header: "filament" },
    { key: "vendor", header: "vendor" },
    { key: "label", header: "label" },
    { key: "totalWeight", header: "totalWeight" },
    { key: "lotNumber", header: "lotNumber" },
    { key: "purchaseDate", header: "purchaseDate" },
    { key: "openedDate", header: "openedDate" },
    { key: "location", header: "location" },
    // Export-only context columns.
    { key: "type", header: "type" },
    { key: "color", header: "color" },
    { key: "spoolWeight", header: "spoolWeight" },
    { key: "netFilamentWeight", header: "netFilamentWeight" },
    { key: "retired", header: "retired" },
    { key: "dryCyclesCount", header: "dryCyclesCount" },
    { key: "lastDriedAt", header: "lastDriedAt" },
    { key: "usedGrams", header: "usedGrams" },
    { key: "createdAt", header: "createdAt" },
    { key: "instanceId", header: "instanceId" },
    { key: "filamentId", header: "filamentId" },
    { key: "spoolId", header: "spoolId" },
    // Parent/variant context — matches the filament-level export columns.
    // GH #515.3: header text aligns with exportFilaments.ts's
    // "Parent" / "Variant Count" — pre-fix the spool exporter emitted
    // camelCase headers while filament-export used Title-Case. Schema
    // keys stay camelCase to match the SpoolExportRow interface; only
    // the CSV header text shifts. Filament-export tests pin
    // `parentName` and `variantCount` as object keys but not header
    // text, so this is shape-safe.
    { key: "parentName", header: "Parent" },
    { key: "variantCount", header: "Variant Count" },
];
function isoDateOnly(d) {
    if (!d)
        return null;
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime()))
        return null;
    return date.toISOString().slice(0, 10);
}
function isoDateTime(d) {
    if (!d)
        return null;
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime()))
        return null;
    return date.toISOString();
}
export async function getSpoolExportRows() {
    await dbConnect();
    const [filaments, locations] = await Promise.all([
        Filament.find({ _deletedAt: null }).sort({ name: 1 }).lean(),
        Location.find({ _deletedAt: null }).lean(),
    ]);
    // Build parent lookup so variants resolve inherited filament-level fields
    // (vendor, type, spoolWeight, netFilamentWeight). Spool-level fields are
    // never inherited — they belong to the spool subdoc itself.
    const parentMap = new Map();
    for (const f of filaments) {
        if (!f.parentId) {
            parentMap.set(f._id.toString(), f);
        }
    }
    // Count variants per parent for the variantCount column. A spool belonging
    // to a parent that has variants gets the count; variants and standalones
    // get 0. Built once and looked up by filament id below.
    const variantCountByParent = new Map();
    for (const f of filaments) {
        if (f.parentId) {
            const key = f.parentId.toString();
            variantCountByParent.set(key, (variantCountByParent.get(key) ?? 0) + 1);
        }
    }
    const locationNameById = new Map();
    for (const l of locations) {
        locationNameById.set(l._id.toString(), l.name);
    }
    const rows = [];
    for (const filament of filaments) {
        const parentDoc = filament.parentId
            ? parentMap.get(filament.parentId.toString())
            : undefined;
        const resolved = filament.parentId
            ? resolveFilament(filament, parentDoc)
            : filament;
        for (const spool of filament.spools || []) {
            // Sum grams used (positive deltas only — the schema enforces grams >= 0).
            const usedGrams = (spool.usageHistory || []).reduce((sum, u) => sum + (u.grams || 0), 0);
            // Latest dry cycle by date — entries are pushed chronologically by the
            // UI but tolerate manual reordering by picking the max explicitly.
            let lastDried = null;
            for (const c of spool.dryCycles || []) {
                const d = c.date instanceof Date ? c.date : new Date(c.date);
                if (Number.isNaN(d.getTime()))
                    continue;
                if (!lastDried || d > lastDried)
                    lastDried = d;
            }
            const locationName = spool.locationId
                ? locationNameById.get(spool.locationId.toString()) ?? null
                : null;
            rows.push({
                filament: filament.name,
                vendor: resolved.vendor ?? "",
                type: resolved.type ?? "",
                color: filament.color ?? "",
                label: spool.label ?? "",
                totalWeight: typeof spool.totalWeight === "number" ? spool.totalWeight : null,
                spoolWeight: typeof resolved.spoolWeight === "number" ? resolved.spoolWeight : null,
                netFilamentWeight: typeof resolved.netFilamentWeight === "number"
                    ? resolved.netFilamentWeight
                    : null,
                lotNumber: spool.lotNumber ?? null,
                purchaseDate: isoDateOnly(spool.purchaseDate),
                openedDate: isoDateOnly(spool.openedDate),
                location: locationName,
                retired: !!spool.retired,
                dryCyclesCount: (spool.dryCycles || []).length,
                lastDriedAt: isoDateTime(lastDried),
                usedGrams,
                createdAt: isoDateTime(spool.createdAt),
                // #732 Phase 5: the SPOOL's own id (per-spool identity), not the
                // filament-level id — so a spool CSV round-trips each roll's id.
                instanceId: spool.instanceId ?? "",
                filamentId: filament._id.toString(),
                spoolId: spool._id ? spool._id.toString() : "",
                parentName: parentDoc?.name ?? null,
                variantCount: variantCountByParent.get(filament._id.toString()) ?? 0,
            });
        }
    }
    return rows;
}
