import mongoose, { Schema } from "mongoose";
const LocationSchema = new Schema({
    name: { type: String, required: true },
    syncId: { type: String, unique: true, sparse: true, index: true },
    kind: { type: String, default: "shelf", index: true },
    humidity: { type: Number, default: null, min: 0, max: 100 },
    desiccantChangedAt: { type: Date, default: null },
    notes: { type: String, default: "" },
    _deletedAt: { type: Date, default: null },
}, { timestamps: true });
// Partial unique index: enforce unique names only among non-deleted documents
LocationSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { _deletedAt: null } });
const Location = mongoose.models.Location || mongoose.model("Location", LocationSchema);
export default Location;
