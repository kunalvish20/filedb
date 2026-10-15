import crypto from "crypto";
import mongoose, { Schema } from "mongoose";
function generateSlug() {
    // 9 bytes → 12 base64url chars, URL-safe and collision-resistant enough
    // for personal-scale sharing (no auth / no spam risk). Strip padding.
    return crypto.randomBytes(9).toString("base64url").replace(/=+$/, "");
}
const SharedCatalogSchema = new Schema({
    // Slug is unique only among non-deleted rows so a soft-deleted slug
    // can be reused if the random-base64url generator ever collides on
    // a republish. Same partial-unique pattern Location and BedType use.
    // Field-level `index: true` is intentionally omitted — the
    // schema.index() call below owns the index and adding another would
    // create a duplicate-name collision.
    slug: { type: String, required: true, default: generateSlug },
    syncId: { type: String, unique: true, sparse: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: "" },
    payload: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, default: null, index: true },
    viewCount: { type: Number, default: 0, min: 0 },
    _deletedAt: { type: Date, default: null },
    _purged: { type: Boolean, default: false, index: true },
}, { timestamps: true });
SharedCatalogSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { _deletedAt: null } });
const SharedCatalog = mongoose.models.SharedCatalog ||
    mongoose.model("SharedCatalog", SharedCatalogSchema);
export default SharedCatalog;
