function isAbortError(err, signal) {
    if (signal.aborted)
        return true;
    if (typeof err === "object" && err !== null && "name" in err) {
        return err.name === "AbortError";
    }
    return false;
}
export function createScanMatchHandler(deps) {
    const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis);
    let seq = 0;
    let inFlight = null;
    return async function handleScan(raw) {
        const mySeq = ++seq;
        inFlight?.abort();
        inFlight = null;
        const event = raw;
        if (event.error) {
            deps.onResult({ error: event.error });
            return;
        }
        if (event.empty) {
            deps.onResult({ empty: true });
            return;
        }
        if (!event.data)
            return;
        const controller = new AbortController();
        inFlight = controller;
        const params = new URLSearchParams();
        // #732: resolve by the written SPOOL id first (the matcher tries spool then
        // filament instanceId), so a desktop scan/read-back of a spool-scoped tag
        // resolves the exact spool/filament even after a rename — matching mobile.
        // Bambu tray UIDs (32 hex) harmlessly won't match a 10-char id and fall
        // through to name/vendor/type below.
        if (event.data.spoolUid)
            params.set("instanceId", event.data.spoolUid);
        if (event.data.materialName)
            params.set("name", event.data.materialName);
        if (event.data.brandName)
            params.set("vendor", event.data.brandName);
        if (event.data.materialType)
            params.set("type", event.data.materialType);
        const commit = (result, match, candidates, matchedSpool) => {
            if (mySeq !== seq)
                return;
            deps.onResult(result);
            deps.onPublish(event.data, match, candidates, matchedSpool);
        };
        try {
            const res = await doFetch(`/api/filaments/match?${params}`, {
                signal: controller.signal,
            });
            if (!res.ok) {
                commit({ data: event.data, match: null, candidates: [], matchedSpool: null }, null, [], null);
                return;
            }
            const parsed = await res.json();
            const match = parsed?.match ?? null;
            const candidates = Array.isArray(parsed?.candidates)
                ? parsed.candidates
                : [];
            const matchedSpool = parsed?.matchedSpool ?? null;
            commit({ data: event.data, match, candidates, matchedSpool }, match, candidates, matchedSpool);
        }
        catch (err) {
            if (isAbortError(err, controller.signal))
                return;
            commit({ data: event.data, match: null, candidates: [], matchedSpool: null }, null, [], null);
        }
    };
}
