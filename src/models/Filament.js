import crypto from "crypto";
import mongoose, { Schema } from "mongoose";
import { isEncodableOptTag } from "@/lib/openprinttag";
import { MAX_SPOOL_TEXT_LENGTH } from "@/lib/validateSpoolBody";
/** Generate a random 5-byte hex instance ID (10 hex chars), matching Prusament's format.
 * Exported (#732) so the spool-create routes that write via `$push` — which
 * bypasses Mongoose schema defaults — can stamp a spool `instanceId` explicitly. */
export function generateInstanceId() {
    return crypto.randomBytes(5).toString("hex");
}
/** Reject anything but http(s). Empty/null are allowed (field is optional).
 * Used both as the schema validator (catches save/create) and via the
 * pre('updateOne'|'findOneAndUpdate'|'updateMany') hooks below — Mongoose
 * skips schema validators on bare update queries unless the caller passes
 * `runValidators: true`, and the CSV/atlas-import paths don't, so the hook
 * is what actually keeps a `javascript:`/`file:` URL out of storage on the
 * import-update branch. */
function isValidTdsUrl(v) {
    if (v == null || v === "")
        return true;
    try {
        const proto = new URL(v).protocol;
        return proto === "http:" || proto === "https:";
    }
    catch {
        return false;
    }
}
/** GH #503 / #632: the one hex shape we store for colors. Shared by the
 * schema validators on `color` / `secondaryColors` AND the pre-update
 * hooks below (bare update queries skip schema validators). */
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
/** `color` is nullable per the OpenPrintTag spec (coextruded materials
 * have a null primary); anything non-null must be `#RRGGBB`. */
function isValidColor(v) {
    return v == null || (typeof v === "string" && HEX_COLOR_RE.test(v));
}
/** GH #634: optTags entries are CBOR unsigned ints on the wire — a
 * negative entry makes the encoder throw, a fractional one would silently
 * encode a different tag id, and a value above 2^32-1 truncates to its low
 * 32 bits in the encoder's `>>>` arithmetic (Codex P2 on PR #650).
 * Sanitize on assignment rather than with a rejecting validator: a hard
 * validator would block ANY later `save()` on a legacy doc that already
 * carries a bad tag — including the print-history and manual-spool-usage
 * paths, which load a Filament, mutate `spools`/`usageHistory`, and call
 * `save()` without touching optTags. A setter drops invalid entries
 * whenever the array is actually written (API edits, NFC prefill) while
 * leaving an unrelated save untouched. `isEncodableOptTag` is shared with
 * the encoder so the schema and the wire agree on what's kept. */
function sanitizeOptTags(arr) {
    if (!Array.isArray(arr))
        return [];
    return arr.filter(isEncodableOptTag);
}
const FilamentSchema = new Schema({
    name: { type: String, required: true },
    syncId: { type: String, unique: true, sparse: true, index: true },
    // GH #302: NOT a field-level `unique: true` — that builds a plain
    // unique index that collides with soft-delete / `_purged` tombstone
    // rows (a snapshot restore / re-import can E11000 against a hidden
    // tombstone). The partial-unique index registered below scopes
    // uniqueness to non-deleted documents, matching the `name` index.
    instanceId: { type: String, default: generateInstanceId },
    vendor: { type: String, required: true, index: true },
    type: { type: String, required: true, index: true },
    // GH #477: `color` is the OpenPrintTag spec's `primary_color` (key 19),
    // which the spec explicitly allows to be null for coextruded / rainbow
    // filaments where there's no single primary. Default stays "#808080"
    // so existing rows + every single-color filament keep current behavior;
    // null is only written when the user opts into the multi-color
    // "Coextruded" arrangement.
    //
    // GH #503: schema-level hex validator (matching the per-entry
    // validator on `secondaryColors` immediately below). The previous
    // posture relied on "validated on writes via the route handlers"
    // — that claim wasn't true: the POST handler called `Filament.create`
    // without inspecting `color`, the PUT used `runValidators: true`
    // against a no-op validator, the CSV importer wrote `row.color`
    // straight through, and the round-trip ate garbage on OpenPrintTag
    // / slicer exports. Allow null per the spec; otherwise enforce
    // `#RRGGBB`.
    color: {
        type: String,
        default: "#808080",
        validate: {
            validator: isValidColor,
            message: "color must be a #RRGGBB hex string or null",
        },
    },
    // GH #477: spec keys 20–24 (`secondary_color_0..4`). Hex validation
    // applied per-entry; max-5 cap matches the spec exactly. Defaulting
    // to an empty array (vs undefined) so the read path never needs a
    // null guard.
    secondaryColors: {
        type: [String],
        default: () => [],
        validate: [
            {
                validator: (arr) => Array.isArray(arr) && arr.length <= 5,
                message: "secondaryColors may not exceed 5 entries (OpenPrintTag spec limit)",
            },
            {
                validator: (arr) => arr.every((c) => typeof c === "string" && HEX_COLOR_RE.test(c)),
                message: "Each secondaryColors entry must be a #RRGGBB hex string",
            },
        ],
    },
    colorName: { type: String, default: null },
    // GH #337: physically nonsensical values (negative diameter / density /
    // cost, out-of-range temperatures) used to be silently accepted and
    // flowed straight into slicer bundles. Add `min` (and reasonable `max`
    // on temperatures) validators so the API rejects them with 400 instead
    // of corrupting downstream math. `null` is still allowed for the
    // optional fields — the validators only fire when a value is supplied.
    cost: { type: Number, default: null, min: [0, "cost must be >= 0"] },
    density: { type: Number, default: null, min: [0, "density must be >= 0"] },
    diameter: { type: Number, default: 1.75, min: [0.01, "diameter must be > 0"] },
    temperatures: {
        nozzle: { type: Number, default: null, min: [0, "temperature must be >= 0"], max: [600, "temperature must be <= 600"] },
        nozzleFirstLayer: { type: Number, default: null, min: [0, "temperature must be >= 0"], max: [600, "temperature must be <= 600"] },
        nozzleRangeMin: { type: Number, default: null, min: [0, "temperature must be >= 0"], max: [600, "temperature must be <= 600"] },
        nozzleRangeMax: { type: Number, default: null, min: [0, "temperature must be >= 0"], max: [600, "temperature must be <= 600"] },
        bed: { type: Number, default: null, min: [0, "temperature must be >= 0"], max: [300, "temperature must be <= 300"] },
        bedFirstLayer: { type: Number, default: null, min: [0, "temperature must be >= 0"], max: [300, "temperature must be <= 300"] },
        standby: { type: Number, default: null, min: [0, "temperature must be >= 0"], max: [600, "temperature must be <= 600"] },
    },
    // GH #281: `bedTypeTemps[].bedType` is deliberately free text, NOT a
    // BedType ObjectId ref. It holds a slicer bed-surface *key* (e.g.
    // PrusaSlicer's "Textured PEI" / "Smooth PEI" strings) for the
    // per-surface temperature table that round-trips through INI export
    // — a slicer-export concern with no DB identity. `calibrations[]
    // .bedType` below is the separate, ref-counted concept: a pointer
    // into the shared BedType catalog for calibration data. The two are
    // intentionally distinct representations; do not conflate them.
    bedTypeTemps: [
        {
            bedType: { type: String, required: true },
            temperature: { type: Number, default: null, min: 0, max: 300 },
            firstLayerTemperature: { type: Number, default: null, min: 0, max: 300 },
        },
    ],
    maxVolumetricSpeed: { type: Number, default: null, min: 0 },
    compatibleNozzles: [{ type: Schema.Types.ObjectId, ref: "Nozzle" }],
    calibrations: [
        {
            printer: { type: Schema.Types.ObjectId, ref: "Printer", default: null },
            nozzle: { type: Schema.Types.ObjectId, ref: "Nozzle", required: true },
            bedType: { type: Schema.Types.ObjectId, ref: "BedType", default: null },
            extrusionMultiplier: { type: Number, default: null, min: 0 },
            maxVolumetricSpeed: { type: Number, default: null, min: 0 },
            pressureAdvance: { type: Number, default: null, min: 0 },
            retractLength: { type: Number, default: null, min: 0 },
            retractSpeed: { type: Number, default: null, min: 0 },
            retractLift: { type: Number, default: null, min: 0 },
            nozzleTemp: { type: Number, default: null, min: 0, max: 600 },
            nozzleTempFirstLayer: { type: Number, default: null, min: 0, max: 600 },
            bedTemp: { type: Number, default: null, min: 0, max: 300 },
            bedTempFirstLayer: { type: Number, default: null, min: 0, max: 300 },
            chamberTemp: { type: Number, default: null, min: 0, max: 300 },
            fanMinSpeed: { type: Number, default: null, min: 0, max: 100 },
            fanMaxSpeed: { type: Number, default: null, min: 0, max: 100 },
            fanBridgeSpeed: { type: Number, default: null, min: 0, max: 100 },
        },
    ],
    presets: [
        {
            label: { type: String, required: true },
            extrusionMultiplier: { type: Number, default: null, min: 0 },
            temperatures: {
                nozzle: { type: Number, default: null, min: 0, max: 600 },
                nozzleFirstLayer: { type: Number, default: null, min: 0, max: 600 },
                bed: { type: Number, default: null, min: 0, max: 300 },
                bedFirstLayer: { type: Number, default: null, min: 0, max: 300 },
            },
        },
    ],
    spools: [
        {
            // #732: each spool gets its own 5-byte hex id (default-generated).
            instanceId: { type: String, default: generateInstanceId },
            // GH #953: bound the free-form spool text fields. The dedicated spool
            // routes cap these via validateSpoolBody, but that runs only on the API
            // surface; this schema `maxlength` is the backstop for every path that
            // reaches Mongoose validation (embedded-spool create, CSV import save,
            // snapshot restore) so an unbounded string can't persist and bloat the
            // /api/filaments list projection, exports, and sync payloads.
            label: {
                type: String,
                default: "",
                maxlength: [
                    MAX_SPOOL_TEXT_LENGTH,
                    `label must be ${MAX_SPOOL_TEXT_LENGTH} characters or fewer`,
                ],
            },
            totalWeight: { type: Number, default: null, min: 0 },
            lotNumber: {
                type: String,
                default: null,
                maxlength: [
                    MAX_SPOOL_TEXT_LENGTH,
                    `lotNumber must be ${MAX_SPOOL_TEXT_LENGTH} characters or fewer`,
                ],
            },
            purchaseDate: { type: Date, default: null },
            openedDate: { type: Date, default: null },
            createdAt: { type: Date, default: Date.now },
            // v1.11 additions
            locationId: { type: Schema.Types.ObjectId, ref: "Location", default: null },
            photoDataUrl: { type: String, default: null },
            retired: { type: Boolean, default: false },
            dryCycles: [
                {
                    date: { type: Date, required: true },
                    tempC: { type: Number, default: null, min: 0, max: 300 },
                    durationMin: { type: Number, default: null, min: 0 },
                    notes: { type: String, default: "" },
                },
            ],
            usageHistory: [
                {
                    grams: { type: Number, required: true, min: 0 },
                    jobLabel: { type: String, default: "" },
                    date: { type: Date, required: true, default: Date.now },
                    source: {
                        type: String,
                        enum: ["manual", "slicer", "job", "nfc"],
                        default: "manual",
                    },
                    // Index so the undo path's `usageHistory.jobId === entry._id`
                    // filter doesn't full-scan every spool's array.
                    jobId: { type: Schema.Types.ObjectId, ref: "PrintHistory", default: null, index: true },
                    // GH #1074: grams actually removed from the spool at debit time
                    // (see IUsageEntry). No `min: 0` on purpose — server-computed,
                    // and a validator would brick later saves of docs that acquired
                    // unexpected values through sync/restore paths.
                    debitedGrams: { type: Number, default: null },
                },
            ],
        },
    ],
    spoolWeight: { type: Number, default: null, min: 0 },
    netFilamentWeight: { type: Number, default: null, min: 0 },
    totalWeight: { type: Number, default: null, min: 0 },
    lowStockThreshold: { type: Number, default: null, min: 0 },
    dryingTemperature: { type: Number, default: null, min: 0, max: 300 },
    // GH #634: cap drying time at one week of minutes. The OpenPrintTag
    // encoder writes this as a CBOR uint — without an upper bound,
    // values ≥ 2^32 wrap in the encoder's `>>>` arithmetic. 10080 (7
    // days) is far beyond any real drying cycle and mirrors the
    // temperature fields' "sane domain max" posture (GH #337).
    dryingTime: { type: Number, default: null, min: 0, max: [10080, "dryingTime must be <= 10080 minutes (7 days)"] },
    transmissionDistance: { type: Number, default: null, min: 0 },
    glassTempTransition: { type: Number, default: null, min: -50, max: 500 },
    heatDeflectionTemp: { type: Number, default: null, min: -50, max: 500 },
    shoreHardnessA: { type: Number, default: null, min: 0, max: 100 },
    shoreHardnessD: { type: Number, default: null, min: 0, max: 100 },
    shrinkageXY: { type: Number, default: null, min: 0, max: 100 },
    shrinkageZ: { type: Number, default: null, min: 0, max: 100 },
    minPrintSpeed: { type: Number, default: null, min: 0 },
    maxPrintSpeed: { type: Number, default: null, min: 0 },
    spoolType: { type: String, default: null },
    // GH #634: optTags ride the OpenPrintTag `tags` enum_array as CBOR
    // unsigned ints. A stored negative entry made `encodeCBORUint` throw
    // (500-ing the .bin export and failing NFC writes); a fractional one
    // would truncate into a *different* tag id. Validate at the edge.
    optTags: {
        type: [Number],
        default: [],
        set: sanitizeOptTags,
    },
    tdsUrl: {
        type: String,
        default: null,
        validate: {
            validator: isValidTdsUrl,
            message: "tdsUrl must be a valid http(s) URL",
        },
    },
    inherits: { type: String, default: null },
    parentId: { type: Schema.Types.ObjectId, ref: "Filament", default: null, index: true },
    settings: { type: Schema.Types.Mixed, default: {} },
    // GH #605 round 10: durable promotion marker pair (see the IFilament
    // docblocks). Declared as real schema paths — strict mode strips unknown
    // keys, so an undeclared $set would silently no-op — but server-owned:
    // the POST/PUT handlers strip both from client bodies (the syncId /
    // openprinttagSnapshot posture) and the atlas import's allow-list
    // (GH #255) never carries them. Only src/lib/promoteParent.ts writes
    // them. No dedicated index: resume lookups filter on the already-indexed
    // `parentId` first.
    promotionInFlight: {
        type: new Schema({
            token: { type: String, required: true },
            at: { type: Date, required: true },
        }, { _id: false }),
        default: null,
    },
    promotedByToken: { type: String, default: null },
    // GH #607: OpenPrintTag re-sync provenance (see the IFilament docblock).
    // Kept out of `settings` so it never renders in the scalar settings
    // table or leaks into slicer exports.
    openprinttagSnapshot: { type: Schema.Types.Mixed, default: null },
    _deletedAt: { type: Date, default: null },
    _purged: { type: Boolean, default: false, index: true },
}, {
    timestamps: true,
    // GH #224: enable Mongoose optimistic concurrency on Filament so the
    // print-history POST path detects two near-simultaneous jobs racing on
    // the same filament's spool debits. Without `__v`-based version
    // checking, both saves would commit and last-writer-wins silently
    // loses one job's grams debit. With this enabled, the second save
    // throws VersionError and the route surfaces 409 so the caller can
    // retry against the fresh state.
    //
    // This is a behaviour change for any other Filament write — `save()`
    // now refuses if the in-memory version is stale. Lean updates
    // (`updateOne`, `findOneAndUpdate`) are unaffected; OCC is enforced
    // only on the doc-level `save()` path, which the print-history
    // handler is the heaviest user of.
    optimisticConcurrency: true,
});
// Partial unique index: enforce unique names only among non-deleted documents
FilamentSchema.index({ name: 1 }, { unique: true, partialFilterExpression: { _deletedAt: null } });
// GH #302: instanceId is unique only among non-deleted documents — see
// the field definition above. Scoping to `_deletedAt: null` keeps a
// re-imported / restored filament from colliding with a tombstone row
// that still carries the same instanceId.
FilamentSchema.index({ instanceId: 1 }, { unique: true, partialFilterExpression: { _deletedAt: null } });
// Composite index for common filter queries (vendor + type)
FilamentSchema.index({ vendor: 1, type: 1 });
// #732: the QR/NFC match path resolves a scanned id against spools[].instanceId
// (matchFilament's spool tiers) BEFORE the top-level instanceId fallback. This
// multikey index keeps that lookup bounded as inventories grow — without it a
// scan-by-spool-id (and every CI-regex miss) would collection-scan. Non-unique
// (spool ids aren't globally unique-enforced; the matcher handles collisions)
// and not scoped to non-deleted, so a trashed filament's spool tag still
// resolves for restore/awareness.
FilamentSchema.index({ "spools.instanceId": 1 });
// Ensure instanceId is always set before saving
FilamentSchema.pre("save", function () {
    if (!this.instanceId) {
        this.instanceId = generateInstanceId();
    }
});
// Validate tdsUrl on every update path. Mongoose runs schema validators
// only on save() / create() by default; bare updateOne / findOneAndUpdate
// (used by the CSV import path in src/lib/importFilaments.ts) skip them
// unless the caller passes `runValidators: true`. Hook them all here so
// an imported javascript:/file: URL can't bypass the scheme guard.
function validateTdsUrlInUpdate() {
    const update = this.getUpdate();
    if (!update)
        return;
    const $set = (update.$set ?? {});
    // tdsUrl can appear as either a top-level key (replacement-style update)
    // or under $set (the form import / CSV import / atlas import paths use)
    for (const candidate of [update.tdsUrl, $set.tdsUrl]) {
        if (candidate === undefined)
            continue;
        if (!isValidTdsUrl(candidate)) {
            throw new Error("tdsUrl must be a valid http(s) URL");
        }
    }
}
FilamentSchema.pre("updateOne", validateTdsUrlInUpdate);
FilamentSchema.pre("updateMany", validateTdsUrlInUpdate);
FilamentSchema.pre("findOneAndUpdate", validateTdsUrlInUpdate);
// GH #632: same treatment for the GH #503 hex validators on color /
// secondaryColors. Bare update queries (the OPT import's conditional-set
// path was a live bypass; sync/backfill tooling is another) skip schema
// validators, so a malformed hex could persist and then break downstream
// consumers (parseHexColor returns null → NFC writes silently drop the
// color; swatches render garbage). Mirrors validateTdsUrlInUpdate:
// covers both the top-level (replacement-style) and `$set` shapes.
// `null` color stays valid — coextruded materials have a null primary.
function validateColorsInUpdate() {
    const update = this.getUpdate();
    if (!update)
        return;
    const $set = (update.$set ?? {});
    for (const candidate of [update.color, $set.color]) {
        if (candidate === undefined)
            continue;
        if (!isValidColor(candidate)) {
            throw new Error("color must be a #RRGGBB hex string or null");
        }
    }
    for (const candidate of [update.secondaryColors, $set.secondaryColors]) {
        if (candidate === undefined)
            continue;
        if (!Array.isArray(candidate)) {
            throw new Error("secondaryColors must be an array of #RRGGBB hex strings");
        }
        if (candidate.length > 5) {
            throw new Error("secondaryColors may not exceed 5 entries (OpenPrintTag spec limit)");
        }
        if (!candidate.every((c) => typeof c === "string" && HEX_COLOR_RE.test(c))) {
            throw new Error("Each secondaryColors entry must be a #RRGGBB hex string");
        }
    }
}
FilamentSchema.pre("updateOne", validateColorsInUpdate);
FilamentSchema.pre("updateMany", validateColorsInUpdate);
FilamentSchema.pre("findOneAndUpdate", validateColorsInUpdate);
const Filament = mongoose.models.Filament || mongoose.model("Filament", FilamentSchema);
/**
 * Backfill instanceId for any existing filaments that don't have one.
 * Safe to call multiple times — only updates documents missing the field.
 * Uses batched bulkWrite for performance instead of one-at-a-time saves.
 */
export async function backfillInstanceIds() {
    const docs = await Filament.find({ $or: [{ instanceId: null }, { instanceId: { $exists: false } }] }, { _id: 1 }).lean();
    if (docs.length === 0)
        return 0;
    const ops = docs.map((doc) => ({
        updateOne: {
            filter: { _id: doc._id },
            update: { $set: { instanceId: generateInstanceId() } },
        },
    }));
    const result = await Filament.bulkWrite(ops);
    return result.modifiedCount;
}
/**
 * #732: backfill a per-spool `instanceId` onto every spool that lacks one.
 * Safe to call repeatedly — only fills missing ids (idempotent).
 *
 * Carry-over rule (preserves identity that's already on printed labels /
 * written NFC tags): the FIRST spool of a filament that is missing an id
 * adopts the filament's own `instanceId`, the rest get fresh ids. Skipped when
 * the filament's id is already held by one of its spools (avoid a duplicate).
 * For the common single-spool filament this means its spool simply inherits
 * the filament id, so existing labels/tags keep resolving once the match path
 * (Phase 2) looks at spools.
 *
 * Returns the number of spools assigned an id. Uses positional arrayFilters so
 * a spool's other fields and concurrent edits aren't clobbered.
 */
export async function backfillSpoolInstanceIds() {
    const docs = await Filament.find({
        $or: [
            { spools: { $elemMatch: { instanceId: { $exists: false } } } },
            { spools: { $elemMatch: { instanceId: { $in: [null, ""] } } } },
        ],
    }, { instanceId: 1, "spools._id": 1, "spools.instanceId": 1 }).lean();
    if (docs.length === 0)
        return 0;
    const ops = [];
    for (const doc of docs) {
        const spools = doc.spools ?? [];
        // If a spool already carries the filament's id, don't reuse it.
        const filamentIdTaken = spools.some((s) => s.instanceId && s.instanceId === doc.instanceId);
        let carriedOver = false;
        for (const s of spools) {
            if (s.instanceId)
                continue; // already has one — idempotent skip
            let newId;
            if (!carriedOver && !filamentIdTaken && doc.instanceId) {
                newId = doc.instanceId; // first missing spool adopts the filament id
                carriedOver = true;
            }
            else {
                newId = generateInstanceId();
            }
            ops.push({
                updateOne: {
                    filter: { _id: doc._id },
                    // The array filter also requires the spool to STILL lack an id, so a
                    // concurrent migration (two cold-start requests / two app instances)
                    // or an in-process retry can't overwrite an instanceId another run
                    // already assigned — once a spool is filled this write is a no-op
                    // (query semantics: `$in: [null, ""]` matches missing, null, and "").
                    update: { $set: { "spools.$[s].instanceId": newId } },
                    arrayFilters: [{ "s._id": s._id, "s.instanceId": { $in: [null, ""] } }],
                },
            });
        }
    }
    if (ops.length === 0)
        return 0;
    // Report spools actually filled (modifiedCount), not ops submitted, so the
    // count is accurate when the array-filter guard skips already-filled spools.
    const res = await Filament.bulkWrite(ops);
    return res.modifiedCount ?? 0;
}
/**
 * #732 Phase 4: is `instanceId` already taken — by another spool OR by another
 * filament's top-level id? Used by the spool create/edit routes to keep a
 * user-entered id unique so `matchFilament` resolves it unambiguously.
 *
 * Both halves matter because `matchFilament` resolves spool ids BEFORE the
 * filament-level fallback: a spool id equal to ANOTHER filament's `instanceId`
 * would shadow that filament's existing labels/tags (Codex P2). So we reject
 * collisions with both `spools.instanceId` and the top-level `instanceId`.
 *
 * Exclusions: `excludeSpoolId` lets a spool keep its own id on edit;
 * `ownFilamentId` permits the legitimate Phase-1 carry-over where a spool's id
 * equals ITS OWN filament's top-level id. Scoped to `_deletedAt: null` (mirrors
 * the filament-level partial-unique index — a trashed filament's id may be
 * reused). `$elemMatch` ensures the SAME spool element both carries the id and
 * isn't the excluded one (a dot-path query would match across two elements).
 */
export async function isSpoolInstanceIdTaken(instanceId, excludeSpoolId, ownFilamentId) {
    // 1. Collision with another spool's id.
    const spoolQuery = excludeSpoolId
        ? {
            _deletedAt: null,
            spools: {
                $elemMatch: {
                    instanceId,
                    _id: { $ne: new mongoose.Types.ObjectId(excludeSpoolId) },
                },
            },
        }
        : { _deletedAt: null, "spools.instanceId": instanceId };
    if (await Filament.findOne(spoolQuery, { _id: 1 }).lean())
        return true;
    // 2. Collision with another filament's top-level id (excluding the spool's
    //    own filament, where carry-over legitimately makes them equal).
    const filamentQuery = { _deletedAt: null, instanceId };
    if (ownFilamentId) {
        filamentQuery._id = { $ne: new mongoose.Types.ObjectId(ownFilamentId) };
    }
    if (await Filament.findOne(filamentQuery, { _id: 1 }).lean())
        return true;
    return false;
}
export default Filament;
