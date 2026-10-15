export function buildFilamentGroups(
/** The full fetched list (server-filtered when a search/type/vendor filter
 *  is active). Source of truth for a shown family's variants + the chip. */
allFilaments, 
/** The post-filter set that decides which top-level rows are shown. */
visibleFilaments, opts = {}) {
    const enrich = opts.enrichVariant ?? ((v) => v);
    const parentLookup = opts.parentLookup;
    // Every variant of each parent, from the full set — this is exactly the set
    // the chip counts, so a rendered group must match it one-for-one.
    const allVariantsByParent = new Map();
    for (const f of allFilaments) {
        if (f.parentId) {
            const arr = allVariantsByParent.get(f.parentId);
            if (arr)
                arr.push(f);
            else
                allVariantsByParent.set(f.parentId, [f]);
        }
    }
    const groups = [];
    const groupedParentIds = new Set();
    const standalone = [];
    // A visible non-variant row becomes a group iff the FULL set has variants for
    // it; the group then carries every one of them (in- and out-of-stock alike).
    for (const f of visibleFilaments) {
        if (f.parentId)
            continue; // variants handled via their parent
        const variants = allVariantsByParent.get(f._id);
        if (variants && variants.length > 0) {
            groups.push({ parent: f, variants: variants.map((v) => enrich(v, f)) });
            groupedParentIds.add(f._id);
        }
        else {
            standalone.push(f);
        }
    }
    // Orphaned variants: a visible variant whose parent is NOT a shown group
    // (e.g. the parent was filtered out server-side). Render it standalone, still
    // enriched from its (possibly-hidden) parent so inherited fields resolve.
    for (const f of visibleFilaments) {
        if (!f.parentId)
            continue;
        if (groupedParentIds.has(f.parentId))
            continue; // already inside its group
        standalone.push(enrich(f, parentLookup?.get(f.parentId)));
    }
    return { groups, standalone };
}
