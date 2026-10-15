/**
 * Customizable label formatting model (GH #592).
 *
 * Pure, browser- and Node-safe: the `LabelFormat` config, its defaults /
 * presets / font stacks, a built-in sample filament for the Settings
 * preview, and the `composeLabelLines` text-composition core. No DOM, no
 * Node deps — so the composition logic is unit-testable independently of the
 * canvas renderer (`src/lib/labelBitmap.ts`) that consumes it.
 */
/** Upper bound for the per-field word-wrap (the reporter's "not exceed 3 lines"). */
export const MAX_LINES_PER_FIELD = 3;
/** Default == today's hardcoded output: QR left, the filament name, sans/medium, horizontal, not inverted. */
export const DEFAULT_LABEL_FORMAT = {
    qr: { enabled: true, placement: "left" },
    lines: ["name"],
    font: { family: "sans", size: "m" },
    orientation: "horizontal",
    invert: false,
    maxLinesPerField: 1,
};
/** Curated font families → safe CSS stacks (no bundled fonts; identical across OSes). */
export const FONT_STACKS = {
    sans: "Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    mono: "'Courier New', Courier, monospace",
    condensed: "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
};
/** Base text height in print dots per size. The renderer shrinks below this
 *  as needed so all stacked lines fit the 128-dot print head. */
export const FONT_SIZE_DOTS = { s: 28, m: 40, l: 54 };
/**
 * Named layout presets — applied as a partial over the current format.
 *
 * GH #1007 F3: carry an i18n KEY (not a hardcoded English label) so the editor
 * can translate the preset names — they render untranslated in German Settings
 * otherwise, and the i18n parity test (which only scans literal string-argument
 * translation calls) can never catch a hardcoded string here.
 */
export const LABEL_PRESETS = {
    nameOnly: { labelKey: "settings.labelFormat.preset.nameOnly", patch: { lines: ["name"] } },
    vendorType: { labelKey: "settings.labelFormat.preset.vendorType", patch: { lines: ["vendorType"] } },
    vendorOverType: { labelKey: "settings.labelFormat.preset.vendorOverType", patch: { lines: ["vendor", "type"] } },
    typeColor: { labelKey: "settings.labelFormat.preset.typeColor", patch: { lines: ["type", "colorName"] } },
};
/** Representative filament for the Settings live preview (so it works with no real filament in context). */
export const SAMPLE_FILAMENT = {
    name: "Galaxy Black",
    vendor: "Prusament",
    type: "PLA",
    colorName: "Galaxy Black",
};
const FIELD_VALUE = {
    name: (f) => (f.name ?? "").trim(),
    vendor: (f) => (f.vendor ?? "").trim(),
    type: (f) => (f.type ?? "").trim(),
    vendorType: (f) => [f.vendor, f.type].map((s) => (s ?? "").trim()).filter(Boolean).join(" "),
    colorName: (f) => (f.colorName ?? "").trim(),
};
/**
 * Resolve the ordered, non-empty display strings for a filament under a
 * format. Empty/whitespace fields are dropped so a missing vendor/color
 * doesn't print a blank line.
 */
export function composeLabelLines(filament, format) {
    return format.lines
        .map((id) => FIELD_VALUE[id]?.(filament) ?? "")
        .filter((s) => s.length > 0);
}
/**
 * #745: word-wrap a single field's text into at most `maxLines` lines,
 * BALANCED so each line carries roughly the same number of words, with any
 * remainder going on the FIRST lines (the reporter's "divide words by N,
 * remainder to the first lines"). Pure string math — no width measurement; the
 * canvas renderer shrinks the font so the wrapped lines fit the print head.
 *
 * A single unbreakable token (or maxLines <= 1) returns one line unchanged — a
 * 40-char single word still goes on one line, which is correct for word-wrap.
 */
export function wrapLabelLine(text, maxLines) {
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length <= 1 || maxLines <= 1)
        return [trimmed];
    const lineCount = Math.min(maxLines, words.length);
    const base = Math.floor(words.length / lineCount);
    const rem = words.length % lineCount;
    const out = [];
    let i = 0;
    for (let line = 0; line < lineCount; line++) {
        const take = base + (line < rem ? 1 : 0); // first `rem` lines get one extra
        out.push(words.slice(i, i + take).join(" "));
        i += take;
    }
    return out;
}
/**
 * Like `composeLabelLines`, but each field's value is word-wrapped into up to
 * `format.maxLinesPerField` lines (#745), then flattened top→bottom. With the
 * default `maxLinesPerField === 1` this returns exactly what `composeLabelLines`
 * does, so the un-wrapped path is unchanged.
 */
export function composeWrappedLabelLines(filament, format) {
    const maxLines = format.maxLinesPerField ?? 1;
    return composeLabelLines(filament, format).flatMap((s) => wrapLabelLine(s, maxLines));
}
const FONT_FAMILIES = ["sans", "serif", "mono", "condensed"];
const FONT_SIZES = ["s", "m", "l"];
const FIELD_IDS = ["name", "vendor", "type", "vendorType", "colorName"];
function oneOf(value, allowed, fallback) {
    return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
/**
 * Coerce arbitrary parsed input (persisted JSON, possibly partial or from an
 * older/newer version) into a valid LabelFormat, falling back to the default
 * for any missing/invalid field. Always returns a usable format.
 */
export function normalizeLabelFormat(input) {
    const o = (input ?? {});
    const qr = (o.qr ?? {});
    const font = (o.font ?? {});
    const rawLines = Array.isArray(o.lines) ? o.lines : DEFAULT_LABEL_FORMAT.lines;
    // GH #954: dedupe (a field is either shown or not — never stacked) so a
    // persisted/hand-edited format can't repeat a field N times and overflow the
    // print head. A Set also caps the list at the number of valid field ids.
    const lines = [
        ...new Set(rawLines.filter((l) => typeof l === "string" && FIELD_IDS.includes(l))),
    ];
    return {
        qr: {
            enabled: typeof qr.enabled === "boolean" ? qr.enabled : DEFAULT_LABEL_FORMAT.qr.enabled,
            placement: oneOf(qr.placement, ["left", "right"], DEFAULT_LABEL_FORMAT.qr.placement),
        },
        // Never persist an empty line list — a label with no QR and no text is useless.
        lines: lines.length > 0 ? lines : DEFAULT_LABEL_FORMAT.lines,
        font: {
            family: oneOf(font.family, FONT_FAMILIES, DEFAULT_LABEL_FORMAT.font.family),
            size: oneOf(font.size, FONT_SIZES, DEFAULT_LABEL_FORMAT.font.size),
        },
        orientation: oneOf(o.orientation, ["horizontal", "vertical"], DEFAULT_LABEL_FORMAT.orientation),
        invert: typeof o.invert === "boolean" ? o.invert : DEFAULT_LABEL_FORMAT.invert,
        maxLinesPerField: clampInt(o.maxLinesPerField, 1, MAX_LINES_PER_FIELD, DEFAULT_LABEL_FORMAT.maxLinesPerField),
    };
}
/** Coerce a value to an integer in [min, max]; fall back when not a finite number. */
function clampInt(value, min, max, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}
