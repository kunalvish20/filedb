import mongoose, { Schema } from "mongoose";
const PrinterSchema = new Schema({
    name: { type: String, required: true },
    syncId: { type: String, unique: true, sparse: true, index: true },
    manufacturer: { type: String, required: true, index: true },
    printerModel: { type: String, required: true },
    installedNozzles: [{ type: Schema.Types.ObjectId, ref: "Nozzle" }],
    installedBedTypes: [{ type: Schema.Types.ObjectId, ref: "BedType" }],
    notes: { type: String, default: "" },
    buildVolume: {
        x: { type: Number, default: null, min: 0 },
        y: { type: Number, default: null, min: 0 },
        z: { type: Number, default: null, min: 0 },
    },
    maxFlow: { type: Number, default: null, min: 0 },
    maxSpeed: { type: Number, default: null, min: 0 },
    enclosed: { type: Boolean, default: false },
    autoBedLevel: { type: Boolean, default: false },
    amsSlots: [
        {
            slotName: { type: String, required: true },
            filamentId: { type: Schema.Types.ObjectId, ref: "Filament", default: null },
            // GH #280: `spoolId` is intentionally ref-less. A spool is a
            // *subdocument* of a Filament, not a top-level collection, so
            // Mongoose `ref`/`populate` cannot resolve it. Slot assignment is
            // funnelled through `assignSpoolToSlot` (src/lib/spoolSlots.ts),
            // which is the enforcement point for the "one spool, one slot"
            // invariant; the spool DELETE / retire routes clear stale ids.
            // The hybrid-sync engine additionally nulls this on every
            // cross-side remap (no stable cross-side spool id — see the
            // v1.13 notes in CLAUDE.md), so a dangling id is self-healing.
            spoolId: { type: Schema.Types.ObjectId, default: null },
        },
    ],
    _deletedAt: { type: Date, default: null },
}, { timestamps: true });
// Partial unique index: enforce unique names only among non-deleted documents
PrinterSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { _deletedAt: null } });
// GH #525.3: index the AMS-slot ref fields. spoolSlots.findSpoolSlot,
// assignSpoolToSlot (clear-everywhere), clearSpoolsFromOtherPrinters,
// and the sync-engine repair pass all query into amsSlots.spoolId /
// amsSlots.filamentId on hot paths (every spool DELETE / retire /
// assignment, every filament DELETE, every Printer save, every sync
// cycle). Sparse so docs without amsSlots entries don't bloat the
// index. Personal-use installs have 1-5 printers so the perf delta
// is small; this is defensive hardening for the maker-space case.
PrinterSchema.index({ "amsSlots.spoolId": 1 }, { sparse: true });
PrinterSchema.index({ "amsSlots.filamentId": 1 }, { sparse: true });
const Printer = mongoose.models.Printer || mongoose.model("Printer", PrinterSchema);
export default Printer;
