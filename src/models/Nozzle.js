import mongoose, { Schema } from "mongoose";
const NozzleSchema = new Schema({
    name: { type: String, required: true },
    syncId: { type: String, unique: true, sparse: true, index: true },
    // GH #337: positive diameters only — a 0 or negative nozzle diameter is
    // physically meaningless and silently corrupts volumetric / flow math
    // and slicer exports downstream.
    diameter: {
        type: Number,
        required: true,
        index: true,
        min: [0.01, "diameter must be greater than zero"],
    },
    type: { type: String, required: true, index: true },
    highFlow: { type: Boolean, default: false },
    hardened: { type: Boolean, default: false },
    notes: { type: String, default: "" },
    _deletedAt: { type: Date, default: null },
}, { timestamps: true });
// Partial unique index: enforce unique names only among non-deleted documents
NozzleSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { _deletedAt: null } });
const Nozzle = mongoose.models.Nozzle || mongoose.model("Nozzle", NozzleSchema);
export default Nozzle;
