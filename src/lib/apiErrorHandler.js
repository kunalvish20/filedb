import { NextResponse } from "next/server";
/**
 * Extracts a human-readable error message from an unknown error value.
 */
export function getErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}
/**
 * Creates a standardized JSON error response.
 */
export function errorResponse(error, status, detail) {
    return NextResponse.json(detail ? { error, detail } : { error }, { status });
}
/**
 * True when an error is a MongoDB duplicate-key error (code 11000) —
 * e.g. a `create` that collided with a partial-unique index. Useful for
 * retry-on-duplicate logic where a concurrent insert raced this one.
 */
export function isDuplicateKeyError(err) {
    return (typeof err === "object" &&
        err !== null &&
        "code" in err &&
        err.code === 11000);
}
/**
 * Checks if an error is a MongoDB duplicate-key error (code 11000).
 * Returns a formatted 409 response if so, otherwise null.
 */
export function handleDuplicateKeyError(err, entityName) {
    if (isDuplicateKeyError(err)) {
        const keyValue = err.keyValue;
        const field = keyValue ? Object.keys(keyValue)[0] : "field";
        const value = keyValue ? Object.values(keyValue)[0] : "unknown";
        return errorResponse(`A ${entityName} with that ${field} already exists: "${value}"`, 409);
    }
    return null;
}
/**
 * True when a message text matches a known client-input rejection — pre-update
 * hooks (`tdsUrl must be a valid http(s) URL`) and the shared SSRF guard
 * (`assertExternalUrl` rejections from src/lib/externalUrlGuard.ts). Used both
 * for thrown Errors (see `isClientInputError`) and for failure objects whose
 * error is returned as a string (e.g. tdsExtractor result.error).
 *
 * `Invalid URL:` is colon-anchored on purpose. `assertExternalUrl` re-throws
 * its constructor failure as `Invalid URL: <input>` so it matches here, while
 * the bare `new URL(...)` constructor (used by the TDS redirect resolver in
 * src/lib/tdsExtractor.ts when the upstream Location header is malformed)
 * throws just `Invalid URL`. The bare form is an upstream/bad-gateway
 * failure, not user input, and must NOT be mapped to 400 (Codex P2 on PR
 * #167).
 */
export function isClientInputErrorMessage(message) {
    return /must be a valid|Disallowed URL scheme|private\/internal address|URL hostname does not resolve|URL has no hostname|Invalid URL:/i.test(message);
}
/**
 * True when an error is a client-input rejection rather than a server fault —
 * Mongoose schema validators (`ValidationError`), Mongoose ObjectId-cast
 * rejections (`CastError` — fired when a route's path param like `{id}` is
 * not a parseable ObjectId — GH #202), our pre-update hooks (`tdsUrl must
 * be a valid http(s) URL`), and the shared SSRF guard (`assertExternalUrl`
 * rejections from src/lib/externalUrlGuard.ts).
 *
 * Used by route handlers to distinguish 4xx-worthy "your input was bad"
 * from 5xx "the server crashed". Without this, validators throw a generic
 * Error and the catch-all returns 500/502, which is wrong for monitoring
 * (alerts on legitimate user-input rejections) and bad UX (renderers can't
 * branch on "show form error" vs "show server error").
 */
export function isClientInputError(err) {
    if (!(err instanceof Error))
        return false;
    if (err.name === "ValidationError")
        return true; // Mongoose validators
    if (err.name === "CastError")
        return true; // Mongoose ObjectId/cast rejections (GH #202)
    return isClientInputErrorMessage(err.message);
}
/**
 * Wrap a try/catch in a route handler — if the error is client-input, return
 * a 400 with the message; otherwise return the supplied 5xx fallback. Keeps
 * the handler-level catch idiomatic without per-call branching.
 */
export function errorResponseFromCaught(err, fallbackMessage, fallbackStatus = 500) {
    if (isClientInputError(err)) {
        return errorResponse(getErrorMessage(err), 400);
    }
    return errorResponse(fallbackMessage, fallbackStatus, getErrorMessage(err));
}
/**
 * GH #504: Mongoose `Error.VersionError` is the optimistic-concurrency
 * signal — two writers raced the same document version. Surface it as
 * 409 so the caller can re-fetch and retry against the fresh state
 * (instead of seeing a generic 500). `print-history`'s POST handler
 * has had this branch since GH #224; this helper lifts the pattern so
 * every `.save()` site can share it without duplicating message copy.
 *
 * Pass the caught error AND an optional context label for the message.
 * Returns the 409 NextResponse on a VersionError, or null when the
 * caller should fall through to its existing generic-error branch.
 *
 * Usage:
 *   } catch (err) {
 *     const conflict = handleVersionError(err);
 *     if (conflict) return conflict;
 *     return errorResponseFromCaught(err, "Failed to ...");
 *   }
 */
export function handleVersionError(err) {
    // Use a runtime instanceof check — but lazy-import to avoid pulling
    // mongoose into edge-runtime callers. Mongoose's VersionError extends
    // Error with name "VersionError"; matching on the name is portable
    // and survives across the framework-internal subclass.
    if (err instanceof Error &&
        (err.name === "VersionError" || err.constructor?.name === "VersionError")) {
        return errorResponse("This record was modified by another request. Please retry.", 409);
    }
    return null;
}
export async function assertActiveRefs(model, ids, fieldLabel) {
    if (!ids || ids.length === 0)
        return null;
    const deduped = Array.from(new Set(ids.map(String)));
    const result = model.countDocuments({
        _id: { $in: deduped },
        _deletedAt: null,
    });
    // Both Mongoose Query and a plain Promise resolve to a number — handle
    // either so route-level mocks don't have to fake the .exec() shape.
    const activeCount = await (typeof result.exec === "function"
        ? result.exec()
        : result);
    if (activeCount !== deduped.length) {
        return errorResponse(`One or more ${fieldLabel} no longer exist.`, 400);
    }
    return null;
}
/** 24-hex ObjectId shape — kept local so this module stays mongoose-free and
 * edge-safe (see the handleVersionError lazy-import note). */
const SPOOL_OID_RE = /^[a-f0-9]{24}$/i;
/**
 * GH #953: assert a spool's `locationId` references an existing, ACTIVE
 * (non-soft-deleted) Location. No spool write path validated this — unlike the
 * nozzle/printer/bed-type refs on the filament routes, which flow through
 * assertActiveRefs — so a dangling ref (e.g. a mobile offline-queue move
 * replayed after the referenced location was deleted, or an API retry) persisted
 * and produced a phantom "no location" group in every location-grouped view
 * (/inventory, ?kind= filters silently drop the spool, the home-page
 * "N spools in M locations" stat overcounts).
 *
 * `null`/empty = "no location" and passes. The Location model is injected (same
 * pattern as assertActiveRefs) so this module doesn't import a model and stays
 * edge-safe. Returns a 400 NextResponse on a bad/dangling ref, else null.
 */
export async function assertActiveSpoolLocation(locationModel, locationId) {
    if (locationId === null || locationId === undefined || locationId === "") {
        return null;
    }
    if (typeof locationId !== "string" || !SPOOL_OID_RE.test(locationId)) {
        return errorResponse("Invalid location id", 400);
    }
    const result = locationModel.countDocuments({ _id: locationId, _deletedAt: null });
    const count = await (typeof result.exec === "function"
        ? result.exec()
        : result);
    if (count === 0) {
        return errorResponse("The selected location no longer exists.", 400);
    }
    return null;
}
/** Maximum upload file size (10 MB) */
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
/**
 * Validates a file upload isn't too large. Returns an error response if it is.
 */
export function checkFileSize(file) {
    if (file.size > MAX_UPLOAD_SIZE) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        return errorResponse(`File too large (${sizeMB} MB). Maximum upload size is 10 MB.`, 413);
    }
    return null;
}
/**
 * GH #676: cap a raw (non-multipart) request body via its Content-Length
 * header BEFORE buffering it with `request.text()`/`.json()`, so a huge body
 * can't drive unbounded memory use. Returns a 413 when the declared length
 * exceeds the limit (default `MAX_UPLOAD_SIZE`), else null. A missing/lying
 * Content-Length isn't caught here — callers that need a hard guarantee
 * should additionally check the buffered length.
 */
export function checkContentLength(request, max = MAX_UPLOAD_SIZE) {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > max) {
        const sizeMB = (declared / (1024 * 1024)).toFixed(1);
        // Codex P2 on PR #1090: format a sub-megabyte limit in KB — a 64 KB cap
        // used to render as the nonsensical "Maximum is 0 MB." All pre-existing
        // callers use MB-scale limits, so their messages are unchanged.
        const maxLabel = max < 1024 * 1024
            ? `${Math.round(max / 1024)} KB`
            : `${(max / (1024 * 1024)).toFixed(0)} MB`;
        return errorResponse(`Request body too large (${sizeMB} MB). Maximum is ${maxLabel}.`, 413);
    }
    return null;
}
/**
 * GH #338: short-circuit a route when the body isn't `multipart/form-data`,
 * before the downstream `await request.formData()` throws the runtime's
 * "Content-Type was not one of …" error — which the catch-all error
 * handlers then map to 500. A wrong/missing content type is a CLIENT
 * input error and belongs at 400 with a clear message.
 *
 * Returns `null` when the request is multipart; an `errorResponse(...)`
 * otherwise, ready to short-circuit the handler.
 */
export function assertMultipartFormData(request) {
    const contentType = (request.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("multipart/form-data")) {
        return errorResponse("Upload the file as multipart/form-data (Content-Type: multipart/form-data with a 'file' field).", 400);
    }
    return null;
}
