/**
 * Filament → OpenTag3D forward mapper (the inverse of opentag3d-decode.ts).
 *
 * DB-free / browser-safe (imports only the pure opentag3d + ndef libs), so it
 * runs in the renderer (the detail-page Write button builds the payload) AND in
 * the Electron main process. Produces an `Ot3dValue` field set for
 * `encodeOpenTag3D`, plus the NDEF Type-2 wrapping the NTAG write path needs.
 *
 * Field choices mirror `ot3dToDecodedTag` so write→read round-trips:
 *   - nozzle/bed: `print_temp`/`bed_temp` carry the recommended value, and the
 *     Extended `min/max_print_temp` carry the range when the filament has one.
 *     The decoder reads `nozzleTemp = max_print_temp ?? print_temp`, so a
 *     ranged filament shows min–max and an un-ranged one shows the single value.
 *   - dry_time is HOURS on the tag but MINUTES on the filament (decoder ×60).
 *   - coextruded (null primary + secondaries): `color_1` is left transparent-
 *     black, which the decoder (#895) reads as "no primary".
 *
 * Over-capacity inputs are reported in `notices` (the encoder itself silently
 * truncates) so the UI can warn before writing — e.g. an OpenTag3D
 * `material_base` is only 5 bytes, and there are only 3 secondary-color slots
 * vs OpenPrintTag's 5.
 */
import { encodeOpenTag3D, hexToRgba, OPENTAG3D_MIME, ot3dField, uintCapacity, } from "./opentag3d";
import { buildMediaNdefRecord, buildNdefMessageTlv } from "./ndef";
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;
const utf8Len = (s) => new TextEncoder().encode(s).length;
/**
 * Split a combined filament type into OpenTag3D's separate base + modifier
 * slots, e.g. "PA12-CF" → {base:"PA12", mod:"CF"}, "PC-ABS" → {"PC","ABS"},
 * "TPU 95A" → {"TPU","95A"}, "PLA" → {"PLA",""}. Splits on the FIRST "-" or
 * whitespace run; the remainder (further separators collapsed to spaces) is the
 * modifier. A type with no separator is the base alone. setStr still flags the
 * base/mod if either exceeds its 5-byte slot.
 */
export function splitMaterialType(type) {
    const t = (type ?? "").trim();
    if (!t)
        return { base: "", mod: "" };
    const m = /^(.*?)[\s-]+(.*)$/.exec(t);
    if (!m)
        return { base: t, mod: "" };
    return { base: m[1], mod: m[2].replace(/[\s-]+/g, " ").trim() };
}
/** Set a string field, flagging truncation when it exceeds the tag's byte budget. */
function setStr(out, notices, id, value, label) {
    const v = (value ?? "").trim();
    if (!v)
        return;
    const max = ot3dField(id).length;
    if (utf8Len(v) > max) {
        notices.push(`${label} "${v}" is longer than this tag allows (${max} bytes) and will be truncated.`);
    }
    out[id] = v;
}
function setNum(out, notices, id, value) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        // GH #952: the encoder clamps an over-capacity int to the field max
        // (writeUintBE) rather than silently wrapping — surface a notice so the user
        // knows a value was capped. The written raw value is `real / scaling`; check
        // that against the field's byte capacity.
        const field = ot3dField(id);
        if (field.type === "int") {
            const raw = Math.round(field.scaling ? value / field.scaling : value);
            if (raw > uintCapacity(field.length)) {
                notices.push(`${id} value ${value} exceeds this tag's capacity and will be capped.`);
            }
        }
        out[id] = value;
    }
}
/**
 * Map a filament (+ optional spool/remaining context) to an OpenTag3D field set.
 * Returns the fields for `encodeOpenTag3D` plus any lossy-mapping notices.
 */
export function filamentToOpenTag3DFields(f, opts = {}) {
    const fields = {};
    const notices = [];
    // ── identity ──
    // OpenTag3D has SEPARATE 5-byte material_base + material_mod slots. A combined
    // type like "PA12-CF" / "PC-ABS" / "TPU 95A" is split on its first separator
    // ("-" or whitespace) → base + modifier, so each fits its slot and round-trips
    // (the decoder rejoins them). Without the split the whole type went into the
    // 5-byte base and "PA12-CF" truncated to "PA12-" (observed on hardware).
    const { base, mod } = splitMaterialType(f.type);
    setStr(fields, notices, "material_base", base, "Material type");
    setStr(fields, notices, "material_mod", mod, "Material modifier");
    setStr(fields, notices, "manufacturer", f.vendor, "Vendor");
    setStr(fields, notices, "color_name", f.colorName, "Color name");
    // ── colors ──
    // Primary: a real hex → color_1. A coextruded filament (null primary +
    // secondaries) leaves color_1 transparent-black, which the decoder reads as
    // "no primary" (#895), so we simply don't set it.
    if (f.color && HEX_RE.test(f.color)) {
        fields.color_1 = hexToRgba(f.color);
    }
    const secondaries = (f.secondaryColors ?? []).filter((c) => typeof c === "string" && HEX_RE.test(c));
    const slots = ["color_2", "color_3", "color_4"]; // OpenTag3D has 3 vs OPT's 5
    secondaries.slice(0, slots.length).forEach((c, i) => {
        fields[slots[i]] = hexToRgba(c);
    });
    if (secondaries.length > slots.length) {
        notices.push(`OpenTag3D has only ${slots.length} secondary-color slots; ${secondaries.length - slots.length} extra color(s) won't be written.`);
    }
    // ── physical ──
    setNum(fields, notices, "target_diameter", f.diameter);
    setNum(fields, notices, "target_weight", f.netFilamentWeight);
    setNum(fields, notices, "density", f.density);
    setNum(fields, notices, "empty_spool_weight", f.spoolWeight);
    // ── temperatures ── recommended on Core, range on Extended (decoder reads
    // nozzleTemp = max_print_temp ?? print_temp).
    const t = f.temperatures ?? {};
    setNum(fields, notices, "print_temp", t.nozzle);
    setNum(fields, notices, "min_print_temp", t.nozzleRangeMin);
    setNum(fields, notices, "max_print_temp", t.nozzleRangeMax);
    setNum(fields, notices, "bed_temp", t.bed);
    // ── drying ── dryingTime is MINUTES; the tag stores HOURS (decoder ×60).
    setNum(fields, notices, "max_dry_temp", f.dryingTemperature);
    if (typeof f.dryingTime === "number" && Number.isFinite(f.dryingTime) && f.dryingTime > 0) {
        fields.dry_time = Math.round(f.dryingTime / 60);
    }
    // ── volumetric speed ── decoder reads maxVolumetricSpeed = max_vso ?? target_vso.
    setNum(fields, notices, "max_vso", f.maxVolumetricSpeed);
    // ── identity / remaining ──
    // The serial drives EXACT per-spool matching on scan (decoder → spoolUid), so
    // a truncated value would read back as a DIFFERENT id and silently mis-match
    // (#927 r6). Unlike the display strings above, OMIT an over-length id (write
    // without it + notice) rather than truncate — auto-generated ids are 10 hex
    // chars and always fit; only a long custom id (the app allows ≤128) trips this.
    const serial = (opts.spoolInstanceId ?? "").trim();
    if (serial) {
        const max = ot3dField("serial").length;
        if (utf8Len(serial) > max) {
            notices.push(`Spool ID "${serial}" is too long for this tag (max ${max} bytes); writing without per-spool matching.`);
        }
        else {
            fields.serial = serial;
        }
    }
    setNum(fields, notices, "measured_filament_weight", opts.actualWeightGrams);
    return { fields, notices };
}
/**
 * Build the full NDEF Type-2 message TLV for an OpenTag3D field set — the bytes
 * an NTAG write path lays down from page 4. Mirrors the dev CLI's
 * encode → media-record → TLV sequence so the two share one code path.
 * `includeExtended` false emits the 112-byte Core image (fits a tiny NTAG213).
 */
export function wrapOpenTag3DType2(fields, opts = {}) {
    const payload = encodeOpenTag3D(fields, { includeExtended: opts.includeExtended ?? true });
    const tlv = buildNdefMessageTlv(buildMediaNdefRecord(OPENTAG3D_MIME, payload));
    return { payload, tlv };
}
