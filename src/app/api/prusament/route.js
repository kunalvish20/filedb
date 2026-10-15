import { NextResponse } from "next/server";
import { extractSpoolData } from "@/lib/prusament";
import { assertExternalUrl, readBodyCapped, ssrfDispatcher, } from "@/lib/externalUrlGuard";
/** GH #258: cap the Prusament HTML page. A real spool page is well under
 * 1 MB; the cap stops a hostile/compromised response from buffering an
 * unbounded body into memory before the regex/JSON.parse step. */
const MAX_PRUSAMENT_HTML_BYTES = 4 * 1024 * 1024;
/** GH #523: cap on redirect hops, matching tdsExtractor / embed-check. */
const MAX_REDIRECTS = 5;
/**
 * Manually-followed fetch with per-hop SSRF revalidation. Same pattern as
 * `src/lib/tdsExtractor.ts` and `src/app/api/embed-check/route.ts`. Without
 * this, undici's automatic `redirect: "follow"` would silently chase a
 * 3xx Location into RFC1918 / loopback / cloud-metadata space without
 * re-checking the target. The risk on prusament.com specifically is low
 * (hardcoded host) but the asymmetry breaks the invariant that every
 * outbound fetch goes through the SSRF dispatcher.
 */
async function fetchWithSsrfGuard(initialUrl, init) {
    let currentUrl = initialUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertExternalUrl(currentUrl);
        const res = await fetch(currentUrl, {
            ...init,
            redirect: "manual",
            dispatcher: ssrfDispatcher,
        });
        const isRedirect = res.status >= 300 && res.status < 400 && res.status !== 304;
        if (!isRedirect)
            return res;
        const loc = res.headers.get("location");
        res.body?.cancel().catch(() => { });
        if (!loc) {
            throw new Error(`Prusament fetch: HTTP ${res.status} with no Location header`);
        }
        if (hop === MAX_REDIRECTS) {
            throw new Error(`Prusament fetch: too many redirects (>${MAX_REDIRECTS})`);
        }
        currentUrl = new URL(loc, currentUrl).toString();
    }
    // Unreachable — the loop either returns or throws.
    throw new Error("Prusament fetch: redirect loop exited unexpectedly");
}
/**
 * GET /api/prusament?spoolId=<id>
 *
 * Fetches a Prusament spool page and extracts the embedded spoolData JSON.
 */
export async function GET(request) {
    try {
        const spoolId = request.nextUrl.searchParams.get("spoolId")?.trim();
        if (!spoolId) {
            return NextResponse.json({ error: "spoolId query parameter is required" }, { status: 400 });
        }
        // Accept either a bare ID or a full URL
        let cleanId;
        if (spoolId.includes("spoolId=")) {
            try {
                cleanId = new URL(spoolId).searchParams.get("spoolId") ?? spoolId;
            }
            catch {
                return NextResponse.json({ error: "Invalid URL in spoolId parameter" }, { status: 400 });
            }
        }
        else {
            cleanId = spoolId;
        }
        const pageUrl = `https://prusament.com/spool/?spoolId=${encodeURIComponent(cleanId)}`;
        let html;
        try {
            const res = await fetchWithSsrfGuard(pageUrl, {
                headers: { "User-Agent": "spilofila/1.0" },
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok) {
                return NextResponse.json({ error: `Prusament returned HTTP ${res.status}` }, { status: 502 });
            }
            html = (await readBodyCapped(res, MAX_PRUSAMENT_HTML_BYTES)).toString("utf-8");
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : "Network error";
            return NextResponse.json({ error: `Failed to fetch Prusament page: ${msg}` }, { status: 502 });
        }
        // Extract the spoolData JSON from the page.
        let raw;
        try {
            const parsed = extractSpoolData(html);
            if (!parsed) {
                // Check if the page indicates spool not found
                if (html.includes("Spool not found") || html.includes("404")) {
                    return NextResponse.json({ error: `Spool "${cleanId}" not found on Prusament` }, { status: 404 });
                }
                return NextResponse.json({ error: "Could not extract spool data from Prusament page" }, { status: 502 });
            }
            raw = parsed;
        }
        catch {
            return NextResponse.json({ error: "Failed to parse spool data JSON" }, { status: 502 });
        }
        const f = raw.filament;
        const result = {
            spoolId: cleanId,
            productName: f.name,
            material: f.material,
            colorName: f.color_name,
            colorHex: f.color_rgb.startsWith("#") ? f.color_rgb : `#${f.color_rgb}`,
            diameter: 1.75, // Prusament is always 1.75
            diameterAvg: raw.diameter_avg,
            diameterStdDev: raw.standard_deviation ?? null,
            ovality: raw.ovality,
            netWeight: raw.weight,
            spoolWeight: raw.spool_weight,
            totalWeight: raw.weight + raw.spool_weight,
            lengthMeters: raw.length,
            nozzleTempMin: f.he_min,
            nozzleTempMax: f.he_max,
            bedTempMin: f.hb_min,
            bedTempMax: f.hb_max,
            manufactureDate: raw.manufacture_date,
            country: raw.country,
            goodsId: raw.ff_goods_id,
            priceUsd: raw.price_usd ?? null,
            priceEur: raw.price_eur ?? null,
            photoUrl: f.photo_url,
            pageUrl,
        };
        return NextResponse.json(result);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: "Internal server error", detail: message }, { status: 500 });
    }
}
