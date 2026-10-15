import mongoose, { Schema } from "mongoose";
const BedTypeSchema = new Schema({
    name: { type: String, required: true },
    syncId: { type: String, unique: true, sparse: true, index: true },
    material: { type: String, required: true, index: true },
    notes: { type: String, default: "" },
    _deletedAt: { type: Date, default: null },
}, { timestamps: true });
// Partial unique index: enforce unique names only among non-deleted documents
BedTypeSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { _deletedAt: null } });
const BedType = mongoose.models.BedType || mongoose.model("BedType", BedTypeSchema);
export default BedType;
