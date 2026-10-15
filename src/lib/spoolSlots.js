import mongoose from "mongoose";
/**
 * Resolve `spoolId` to the printer + slot that currently holds it, or
 * `null` when the spool is in no slot. If bad data has the spool in more
 * than one slot, the first hit wins — `assignSpoolToSlot` self-heals the
 * rest on the next write.
 */
export async function findSpoolSlot(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PrinterModel, spoolId) {
    const printers = (await PrinterModel.find({
        _deletedAt: null,
        "amsSlots.spoolId": spoolId,
    })
        .select("_id name amsSlots")
        .lean());
    const target = String(spoolId);
    for (const printer of printers) {
        // GH #277: guard the legacy missing-amsSlots array. The query filter
        // (`amsSlots.spoolId`) keeps this safe today, but every other
        // iteration site in this module guards with `|| []` — match the
        // convention so a refactor of the filter or a `amsSlots: null` doc
        // can't surface a TypeError here.
        for (const slot of printer.amsSlots || []) {
            if (slot.spoolId && String(slot.spoolId) === target) {
                return {
                    printerId: String(printer._id),
                    printerName: printer.name,
                    slotId: String(slot._id),
                    slotName: slot.slotName,
                    filamentId: slot.filamentId ? String(slot.filamentId) : null,
                };
            }
        }
    }
    return null;
}
/**
 * Assign `spoolId` to `target` (a printer + slot), or clear it everywhere
 * when `target` is null.
 *
 * The spool is first cleared out of every slot on every printer — a spool
 * is one physical object, so "put it in slot B" means "take it out of
 * slot A". This also self-heals the bad-data case where a spool somehow
 * occupies two slots. The clear + set run sequentially without a
 * transaction: each is idempotent, and a failure between them leaves the
 * spool merely unassigned (the safe direction), never double-assigned.
 *
 * `target.printerId` / `target.slotId` are assumed already validated by
 * the caller (the route checks the printer + slot exist).
 */
export async function assignSpoolToSlot(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PrinterModel, spoolId, target, 
// GH #1041: the spool's OWNING filament. A slot carries TWO parallel refs
// (filamentId = loaded filament, spoolId = tracked spool) and PrinterForm
// renders slots keyed on filamentId — so a spool-side assignment that
// writes only spoolId is present in the data but UNRENDERABLE on the
// printer side (the spool select is disabled while filamentId is null).
// Both refs are maintained together from here on.
filamentId) {
    const spoolObjId = new mongoose.Types.ObjectId(String(spoolId));
    // Clear pass: the slot was TRACKING this spool, and the physical spool —
    // i.e. the loaded filament — is leaving with it, so both refs clear
    // ("currently-loaded" semantics per the schema docblock). "Any spool"
    // slots (filamentId set, spoolId null) never match this filter and keep
    // their dedication.
    await PrinterModel.updateMany({ _deletedAt: null, "amsSlots.spoolId": spoolObjId }, { $set: { "amsSlots.$[s].spoolId": null, "amsSlots.$[s].filamentId": null } }, { arrayFilters: [{ "s.spoolId": spoolObjId }] });
    if (target) {
        // Assign pass: when the owning filament is known, write it alongside —
        // silently replacing whatever filament the slot previously showed (the
        // newly-assigned spool IS what is physically loaded now; matches this
        // helper's existing self-healing posture of stealing the spool from any
        // other slot without prompting).
        const set = { "amsSlots.$.spoolId": spoolObjId };
        if (filamentId != null) {
            set["amsSlots.$.filamentId"] = new mongoose.Types.ObjectId(String(filamentId));
        }
        await PrinterModel.updateOne({
            _id: target.printerId,
            _deletedAt: null,
            "amsSlots._id": target.slotId,
        }, { $set: set });
    }
}
/**
 * GH #631 — validate every non-null `amsSlots[].spoolId` in a printer
 * create/update body before it is written verbatim.
 *
 * The dedicated assignment route (PUT /api/spools/[spoolId]/assignment)
 * verifies the spool exists on an active filament and rejects retired
 * spools — "enforced here too so a direct API call can't bypass it". The
 * printer POST/PUT *was* such a bypass: `update.amsSlots = body.amsSlots`
 * let a retired or nonexistent spoolId land in a slot. This mirrors the
 * assignment route's checks for each slot.
 *
 * Returns an error message naming the offending slot, or null when every
 * slot ref is valid. Non-array input (legacy bodies without amsSlots, or
 * an explicit null) passes through — the schema handles shape errors.
 */
export async function findInvalidSlotSpoolRef(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
FilamentModel, amsSlots) {
    if (!Array.isArray(amsSlots))
        return null;
    // GH #631 (Codex P2 on #646): a spool occupies at most one slot. The
    // per-slot checks below validate each occurrence independently, so the
    // SAME spoolId in two slots of one payload would pass — and the route's
    // follow-up `clearSpoolsFromOtherPrinters` deliberately excludes the
    // current printer, so it wouldn't self-heal. Reject the duplicate here.
    const seenSpoolIds = new Set();
    for (let i = 0; i < amsSlots.length; i++) {
        const slot = amsSlots[i];
        const spoolId = slot?.spoolId;
        if (spoolId == null)
            continue; // empty slot — nothing to validate
        const slotLabel = typeof slot?.slotName === "string" && slot.slotName
            ? `"${slot.slotName}"`
            : `#${i + 1}`;
        if (!mongoose.isValidObjectId(spoolId)) {
            return `Slot ${slotLabel}: spoolId is not a valid id`;
        }
        // Canonicalize before the duplicate check (Codex P2 round 2 on #646):
        // ObjectId hex is case-insensitive and Mongoose casts e.g. lowercase
        // and uppercase forms to the SAME id, but `String(spoolId)` preserves
        // the original casing — so two slots with the same id in different
        // case would slip past a raw-string Set. Normalize to canonical hex.
        const spoolKey = new mongoose.Types.ObjectId(String(spoolId)).toHexString();
        if (seenSpoolIds.has(spoolKey)) {
            return `Slot ${slotLabel}: the same spool cannot occupy more than one slot`;
        }
        seenSpoolIds.add(spoolKey);
        // Same lookup as the assignment route: the spool must exist on an
        // active filament, and the positional projection surfaces the matched
        // subdocument so the retired flag can be checked too.
        const filament = (await FilamentModel.findOne({ _deletedAt: null, "spools._id": spoolId }, { "spools.$": 1 }).lean());
        if (!filament) {
            return `Slot ${slotLabel}: spool not found`;
        }
        if (filament.spools?.[0]?.retired) {
            return `Slot ${slotLabel}: retired spools cannot be assigned to a printer slot`;
        }
    }
    return null;
}
/**
 * Clear every spool in `spoolIds` out of every printer's slots EXCEPT
 * `exceptPrinterId`. Called after a printer is saved through PrinterForm —
 * which can independently set `amsSlots[].spoolId` — so the one-slot
 * invariant holds no matter which form did the write.
 */
export async function clearSpoolsFromOtherPrinters(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
PrinterModel, spoolIds, exceptPrinterId) {
    const ids = spoolIds
        .filter(Boolean)
        .map((s) => new mongoose.Types.ObjectId(String(s)));
    if (ids.length === 0)
        return;
    await PrinterModel.updateMany({
        _id: { $ne: exceptPrinterId },
        _deletedAt: null,
        "amsSlots.spoolId": { $in: ids },
    }, 
    // GH #1041: null the loaded filament alongside the tracked spool — the
    // spool physically moved to the other printer, so leaving filamentId
    // behind showed a phantom loaded filament on the losing printer.
    { $set: { "amsSlots.$[s].spoolId": null, "amsSlots.$[s].filamentId": null } }, { arrayFilters: [{ "s.spoolId": { $in: ids } }] });
}
