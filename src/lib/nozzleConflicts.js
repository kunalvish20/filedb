/**
 * Find any nozzles in `incomingIds` that are already in another active
 * printer's `installedNozzles`. The `excludePrinterId` arg is the
 * printer being edited (so its own current refs don't trip the check on
 * a PUT that's leaving an existing assignment alone).
 *
 * Returns an empty array when there's no conflict.
 */
export async function findNozzleConflicts(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PrinterModel, 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
NozzleModel, incomingIds, excludePrinterId) {
    if (!incomingIds || incomingIds.length === 0)
        return [];
    const incomingStr = incomingIds.map((x) => String(x));
    // Filter: any active printer (other than the one being edited) that has
    // any of these nozzles in its installedNozzles. One round-trip.
    const filter = {
        _deletedAt: null,
        installedNozzles: { $in: incomingIds },
    };
    if (excludePrinterId)
        filter._id = { $ne: excludePrinterId };
    const otherPrinters = (await PrinterModel.find(filter)
        .select("_id name installedNozzles")
        .lean());
    if (otherPrinters.length === 0)
        return [];
    // Build a (nozzleId → otherPrinter) map. If a nozzle is somehow in
    // *multiple* other printers (existing data bug), surface the first
    // one — the migration will clean the rest up.
    const claimedBy = new Map();
    for (const p of otherPrinters) {
        for (const nid of p.installedNozzles || []) {
            const key = String(nid);
            if (incomingStr.includes(key) && !claimedBy.has(key)) {
                claimedBy.set(key, { _id: String(p._id), name: p.name });
            }
        }
    }
    if (claimedBy.size === 0)
        return [];
    // Hydrate nozzle names for the UI prompt. Single batched query.
    const nozzles = (await NozzleModel.find({
        _id: { $in: Array.from(claimedBy.keys()) },
    })
        .select("_id name")
        .lean());
    const nozzleNameById = new Map(nozzles.map((n) => [String(n._id), n.name]));
    return Array.from(claimedBy.entries()).map(([nozzleId, other]) => ({
        nozzleId,
        nozzleName: nozzleNameById.get(nozzleId) ?? null,
        otherPrinterId: other._id,
        otherPrinterName: other.name,
    }));
}
/**
 * Thrown by the printer-form parents when the printer save endpoint
 * returns 409 with a `conflicts[]` payload. The form catches this
 * specific class to open the move-or-clone resolution modal instead of
 * a generic error toast.
 */
export class NozzleConflictError extends Error {
    constructor(conflicts) {
        super("Nozzle is already installed in another printer");
        this.name = "NozzleConflictError";
        this.conflicts = conflicts;
    }
}
/** Regex-escape a string for safe embedding in a RegExp / Mongo `$regex`
 * (names like "0.4mm" contain a `.` that would otherwise match any char). */
export function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * A `$regex` / RegExp source that matches exactly a nozzle's base name,
 * OR that base name followed by a numbered clone suffix (" #<digits>")
 * — and nothing else.
 *
 * GH #298: anchored at BOTH ends. A prefix-only anchor (`^base`) made
 * cloning "E3D" pull in unrelated siblings like "E3D V6" / "E3D Revo",
 * and a peer such as "E3D Revo #5" pushed the clone counter to "#6"
 * for a completely different nozzle.
 */
export function clonePeerNamePattern(baseName) {
    return `^${escapeRegExp(baseName)}( #\\d+)?$`;
}
/**
 * Pick the next available "Name #N" for a clone of an existing nozzle.
 * Only the exact base name and its numbered clones ("Name #N") count;
 * unrelated siblings are ignored (GH #298). If no clones exist yet
 * returns "<baseName> #2" (the original is implicitly "#1").
 */
export function nextCloneName(baseName, existingNames) {
    // Matches ONLY "<baseName> #<digits>" exactly — both ends anchored.
    const cloneSuffixRe = new RegExp(`^${escapeRegExp(baseName)} #(\\d+)$`);
    let maxN = 1; // the original counts as #1
    for (const name of existingNames) {
        const m = cloneSuffixRe.exec(name);
        if (m) {
            const n = parseInt(m[1], 10);
            if (Number.isFinite(n) && n > maxN)
                maxN = n;
        }
    }
    return `${baseName} #${maxN + 1}`;
}
