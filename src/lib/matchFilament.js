import Filament from "@/models/Filament";
export function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * #955.12: matchFilament runs on the hot scan path (desktop SSE bus + the
 * mobile scanner) and returns lean filament docs verbatim. A spool's
 * `photoDataUrl` can be a ~5 MB data URL, and `usageHistory` / `dryCycles` grow
 * unbounded — none of which any match consumer reads. The desktop scan handler,
 * the scan-bus publish route, and the mobile app all read only identity fields
 * (`_id`/`name`/`vendor`/`type`/`color`) off `match`/`candidates` plus the
 * matched spool's `_id`/`instanceId`/`label`; the mobile app fetches full spool
 * detail from the SEPARATE `/api/filaments/{id}` endpoint. So every match query
 * prunes these three heavy subfields to keep a scan from pulling megabytes per
 * read.
 *
 * PURE exclusion on purpose: it keeps every other field (top-level `instanceId`
 * for the decode route's `matchedBy` check, and `spools[].instanceId`/`label`
 * for `toMatchedSpool`) — a mixed include/exclude projection would drop them.
 */
const MATCH_PROJECTION = "-spools.photoDataUrl -spools.usageHistory -spools.dryCycles";
function toMatchedSpool(spool) {
    return {
        _id: String(spool._id),
        instanceId: String(spool.instanceId ?? ""),
        label: typeof spool.label === "string" ? spool.label : "",
    };
}
export async function matchFilament(query) {
    const name = query.name || null;
    const vendor = query.vendor || null;
    const type = query.type || null;
    const instanceId = query.instanceId || null;
    // 0. Instance-ID match — the strongest signal we have. An exact instance-ID
    //    match is unambiguous: return the filament directly and skip the
    //    name/vendor/type fallback.
    if (instanceId) {
        // 0a. SPOOL-level instanceId (#732) — the durable per-spool identity is
        //     resolved FIRST (exact-case, then CI), and the matched spool is
        //     reported so callers know which roll was scanned. The dot-notation
        //     query matches the FILAMENT if ANY spool matches, so re-scan the
        //     subdocs to find which one (and its _id/label). A filament with
        //     multiple spools sharing an id picks the first by array order
        //     (creation order); only a CROSS-filament collision is ambiguous.
        const spoolExact = (await Filament.find({
            "spools.instanceId": instanceId,
            _deletedAt: null,
        })
            .select(MATCH_PROJECTION)
            .limit(2)
            .lean());
        const exactPairs = spoolExact.flatMap((f) => {
            const s = (f.spools ?? []).find((sp) => sp.instanceId === instanceId);
            return s ? [{ filament: f, spool: s }] : [];
        });
        if (exactPairs.length === 1) {
            return {
                match: exactPairs[0].filament,
                candidates: [],
                matchedSpool: toMatchedSpool(exactPairs[0].spool),
            };
        }
        if (exactPairs.length > 1) {
            return { match: null, candidates: exactPairs.map((p) => p.filament), matchedSpool: null };
        }
        const spoolCi = (await Filament.find({
            "spools.instanceId": { $regex: `^${escapeRegex(instanceId)}$`, $options: "i" },
            _deletedAt: null,
        })
            .select(MATCH_PROJECTION)
            .limit(2)
            .lean());
        const lowerId = instanceId.toLowerCase();
        // Like the exact tier, this picks the first lowercase-equal spool by array
        // order when a single filament has multiple case-only-colliding spool ids
        // (only a CROSS-filament collision below is ambiguous). Unreachable from
        // auto-generated lowercase-hex ids; reachable only via deliberate manual
        // entry, where the filament still resolves and only which spool is reported
        // is arbitrary.
        const ciPairs = spoolCi.flatMap((f) => {
            const s = (f.spools ?? []).find((sp) => typeof sp.instanceId === "string" && sp.instanceId.toLowerCase() === lowerId);
            return s ? [{ filament: f, spool: s }] : [];
        });
        if (ciPairs.length === 1) {
            return {
                match: ciPairs[0].filament,
                candidates: [],
                matchedSpool: toMatchedSpool(ciPairs[0].spool),
            };
        }
        if (ciPairs.length > 1) {
            return { match: null, candidates: ciPairs.map((p) => p.filament), matchedSpool: null };
        }
        // 0b. FILAMENT-level instanceId — the transitional fallback (#732). The
        //     label / NFC writers still encode the filament id until Phase 3, so
        //     this MUST stay until those writers move AND no field tag carries a
        //     filament id any longer. See the ISpool.instanceId contract in
        //     src/models/Filament.ts. matchedSpool is null here (no spool hit).
        //
        // 1. Exact-case match first — unambiguous, fast, and deterministic when
        //    the query case matches what's stored (the common case).
        const exact = await Filament.findOne({
            instanceId,
            _deletedAt: null,
        })
            .select(MATCH_PROJECTION)
            .lean();
        if (exact) {
            return { match: exact, candidates: [], matchedSpool: null };
        }
        // 2. Case-insensitive fallback for legacy case drift. The partial unique
        //    index on instanceId is case-sensitive (so "ABC" and "abc" can both
        //    exist), but if the CI fallback turns up exactly ONE row that's still
        //    an unambiguous match — only multiple CI hits are genuinely ambiguous.
        //    Cap the find at 2 to detect "more than one" without scanning the DB.
        const ciMatches = await Filament.find({
            instanceId: { $regex: `^${escapeRegex(instanceId)}$`, $options: "i" },
            _deletedAt: null,
        })
            .select(MATCH_PROJECTION)
            .limit(2)
            .lean();
        if (ciMatches.length === 1) {
            return { match: ciMatches[0], candidates: [], matchedSpool: null };
        }
        if (ciMatches.length > 1) {
            // Ambiguous — case-only collision in legacy data. Surface as candidates
            // instead of returning an arbitrary row.
            return { match: null, candidates: ciMatches, matchedSpool: null };
        }
        // No match → fall through so the caller can still get name / vendor / type
        // suggestions if they supplied those alongside.
    }
    // 1. Name match. GH #954: the name partial-unique index is case-SENSITIVE
    //    (src/models/Filament.ts — no collation), so two active filaments
    //    differing only by case ("PLA Black" vs "pla black") can coexist. A bare
    //    case-insensitive findOne returned whichever Mongo yielded first as a
    //    CONFIDENT match — the SSE scan bus then auto-selects a possibly-wrong
    //    PrusaSlicer preset silently. Mirror the instanceId tier above: exact case
    //    first (deterministic in the common case, and not demoted to "ambiguous"
    //    just because a case-variant sibling exists), then a case-insensitive
    //    fallback that only auto-matches when it's unambiguous. Same class as the
    //    GH #896 vendor-substring fix.
    if (name) {
        // 1a. Exact-case — a confident match even when a case-variant sibling exists.
        const exact = await Filament.findOne({ name, _deletedAt: null })
            .select(MATCH_PROJECTION)
            .lean();
        if (exact) {
            return { match: exact, candidates: [], matchedSpool: null };
        }
        // 1b. Case-insensitive fallback for legacy case drift. Cap at 2 to detect
        //     "more than one" without scanning the DB. One hit → confident match;
        //     multiple → case-only collision, surface as candidates.
        const ciMatches = await Filament.find({
            name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
            _deletedAt: null,
        })
            .select(MATCH_PROJECTION)
            .limit(2)
            .lean();
        if (ciMatches.length === 1) {
            return { match: ciMatches[0], candidates: [], matchedSpool: null };
        }
        if (ciMatches.length > 1) {
            return { match: null, candidates: ciMatches, matchedSpool: null };
        }
    }
    // 2. Vendor + type match. A confident auto-match requires BOTH to agree.
    // GH #896: anchor the vendor regex to a full-string match (`^…$`), matching
    // the name + type tiers. Unanchored, a scanned vendor was a SUBSTRING match
    // ("Sun" → "Sunlu"), so a substring collision yielding a single vendor+type
    // hit silently auto-resolved to a DIFFERENT vendor's filament with no chooser.
    // (The vendor-ONLY suggestions tier below stays unanchored — it only ever
    // returns `candidates`, so substring there is harmless.)
    const vendorTypeMatches = vendor && type
        ? await Filament.find({
            vendor: { $regex: `^${escapeRegex(vendor)}$`, $options: "i" },
            type: { $regex: `^${escapeRegex(type)}$`, $options: "i" },
            _deletedAt: null,
        })
            .select(MATCH_PROJECTION)
            .sort({ name: 1 })
            .limit(5)
            .lean()
        : [];
    // Exactly one vendor+type hit → confident match. More than one → hand them
    // back as candidates for the user to disambiguate.
    if (vendorTypeMatches.length === 1) {
        return { match: vendorTypeMatches[0], candidates: [], matchedSpool: null };
    }
    if (vendorTypeMatches.length > 1) {
        return { match: null, candidates: vendorTypeMatches, matchedSpool: null };
    }
    // 3. Vendor-only fallback — suggestions ONLY, never an auto-match. The type
    //    didn't agree (or none was supplied), so the most we can do is surface
    //    the vendor's filaments for the user to pick from.
    if (vendor) {
        const vendorMatches = await Filament.find({
            vendor: { $regex: escapeRegex(vendor), $options: "i" },
            _deletedAt: null,
        })
            .select(MATCH_PROJECTION)
            .sort({ name: 1 })
            .limit(5)
            .lean();
        return { match: null, candidates: vendorMatches, matchedSpool: null };
    }
    return { match: null, candidates: [], matchedSpool: null };
}
