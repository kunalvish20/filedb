import mongoose, { Schema } from "mongoose";
const PrintHistorySchema = new Schema({
    syncId: { type: String, unique: true, sparse: true, index: true },
    jobLabel: { type: String, required: true },
    printerId: { type: Schema.Types.ObjectId, ref: "Printer", default: null, index: true },
    usage: [
        {
            filamentId: { type: Schema.Types.ObjectId, ref: "Filament", required: true },
            // GH #280: `spoolId` is intentionally ref-less — a spool is a
            // subdocument of a Filament, not a top-level collection, so it
            // cannot be a Mongoose `ref`. Existence is validated at write
            // time by the POST /api/print-history handler (pass 1 confirms
            // an explicit spoolId belongs to the filament before any
            // mutation); the hybrid-sync engine nulls it on cross-side
            // remap. All writes funnel through that route.
            spoolId: { type: Schema.Types.ObjectId, default: null },
            grams: { type: Number, required: true, min: 0 },
            // GH #1074: grams actually removed from the spool (see IPrintHistory).
            // Declared for real — strict mode would silently strip it from
            // snapshot-restored rows otherwise (same reasoning as syncId, #361).
            // No `min: 0`: the value is server-computed, and a schema validator
            // would brick saves of legacy docs carrying unexpected values that
            // arrived through paths bypassing the routes (hybrid sync, restore) —
            // the DELETE refund guards the value at read time instead.
            debitedGrams: { type: Number, default: null },
        },
    ],
    startedAt: { type: Date, required: true, default: Date.now, index: true },
    source: {
        type: String,
        enum: ["manual", "prusaslicer", "orcaslicer", "bambu", "other"],
        default: "manual",
    },
    notes: { type: String, default: "" },
    _deletedAt: { type: Date, default: null },
    _purged: { type: Boolean, default: false, index: true },
}, { timestamps: true });
// Index for common query patterns: "this printer's prints in the last N days"
PrintHistorySchema.index({ printerId: 1, startedAt: -1 });
// GH #955: back the `?filamentId=` list query (filter on the usage.filamentId
// multikey + the startedAt:-1 sort) with one index. Legal as a compound index
// because only usage.filamentId is an array field (startedAt is scalar).
PrintHistorySchema.index({ "usage.filamentId": 1, startedAt: -1 });
const PrintHistory = mongoose.models.PrintHistory || mongoose.model("PrintHistory", PrintHistorySchema);
export default PrintHistory;
