/**
 * Thin typed client over the spilofila REST API. The app does no business
 * logic — it forwards scans/edits and renders responses. Every request carries
 * the bearer key when one is configured (required only if the server sets
 * SPILOFILA_API_KEY; harmless otherwise).
 */
export class ApiError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'ApiError';
    }
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
async function request(cfg, path, init) {
    const headers = { ...init?.headers };
    if (init?.body)
        headers['content-type'] = 'application/json';
    if (cfg.apiKey)
        headers['authorization'] = `Bearer ${cfg.apiKey}`;
    let res;
    // Fail fast on an unreachable/wrong host instead of hanging the UI forever —
    // RN's fetch has no default timeout. clearTimeout in finally avoids a late
    // abort firing on a slow-but-successful response. (GH #693 review.)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        res = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers, signal: controller.signal });
    }
    catch (e) {
        const aborted = e.name === 'AbortError';
        throw new ApiError(0, aborted
            ? `The server didn't respond. Check the address and that this device is on the same network.`
            : `Can't reach the server. Check the address and that this device is on the same network. (${e.message})`);
    }
    finally {
        clearTimeout(timer);
    }
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (!res.ok) {
        const msg = data && typeof data === 'object' && 'error' in data
            ? String(data.error)
            : `Request failed (${res.status})`;
        throw new ApiError(res.status, msg);
    }
    return data;
}
export function createApi(cfg) {
    return {
        /** Resolve a scanned QR/label instanceId to a filament. */
        matchByInstanceId: (instanceId) => request(cfg, `/api/filaments/match?instanceId=${encodeURIComponent(instanceId)}`),
        /** Full filament detail incl. its spools. */
        getFilament: (id) => request(cfg, `/api/filaments/${encodeURIComponent(id)}`),
        /** Locations for the move-to picker. */
        getLocations: () => request(cfg, '/api/locations'),
        /** Decode raw NFC bytes server-side and get back the tag + a DB match. */
        decodeNfc: (body) => request(cfg, '/api/nfc/decode', {
            method: 'POST',
            body: JSON.stringify(body),
        }),
        /**
         * Create a filament from a decoded tag (mobile Phase 2). The server maps
         * `tagData` (a DecodedOpenPrintTag from decodeNfc) into a filament payload;
         * `overrides` (the user's confirmed name/vendor/type) win. The phone does
         * no field mapping — design rule #1.
         */
        createFromTag: (tagData, overrides, 
        // Grams of filament remaining for the spool to create (default = the
        // tag's net weight). null = don't create a spool (catalog-only). The
        // server converts this to the spool's gross weight using the tag tare.
        spoolRemainingGrams) => request(cfg, '/api/filaments', {
            method: 'POST',
            body: JSON.stringify({ tagData, overrides, spoolRemainingGrams }),
        }),
        /** Update a spool — location, remaining weight, and/or retired (server converts).
         * GH #1027: ?shape=spool asks for just the affected spool back (~200 bytes
         * instead of every sibling spool's photo blob + usage ledger); an older
         * server ignores the param and returns the full filament — see
         * SpoolMutationResponse. */
        updateSpool: (filamentId, spoolId, patch) => request(cfg, `/api/filaments/${encodeURIComponent(filamentId)}/spools/${encodeURIComponent(spoolId)}?shape=spool`, { method: 'PUT', body: JSON.stringify(patch) }),
        /**
         * Resolve a single spool by id to its (inheritance-resolved) filament + the
         * spool itself. Powers spool-level deep links — a label QR's `?spool=` link
         * opens straight to that spool without knowing the parent filament up front.
         */
        getSpool: (spoolId) => request(cfg, `/api/spools/${encodeURIComponent(spoolId)}`),
        /** Log filament usage — decrements the spool's remaining weight by `grams`.
         * GH #1027: ?shape=spool — see updateSpool. */
        logUsage: (filamentId, spoolId, grams, jobLabel) => request(cfg, `/api/filaments/${encodeURIComponent(filamentId)}/spools/${encodeURIComponent(spoolId)}/usage?shape=spool`, { method: 'POST', body: JSON.stringify({ grams, ...(jobLabel ? { jobLabel } : {}) }) }),
        /** Log a dry-box cycle for a spool (temperature / duration / notes).
         * GH #1027: ?shape=spool — see updateSpool. */
        logDryCycle: (filamentId, spoolId, cycle) => request(cfg, `/api/filaments/${encodeURIComponent(filamentId)}/spools/${encodeURIComponent(spoolId)}/dry-cycles?shape=spool`, { method: 'POST', body: JSON.stringify(cycle) }),
    };
}
