"use client";
import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useNfc } from "@/hooks/useNfc";
import { createScanMatchHandler, } from "@/lib/scanMatchHandler";
const NfcContext = createContext(null);
/**
 * Fire-and-forget POST to /api/scan/publish so SSE subscribers (the
 * PrusaSlicer / OrcaSlicer FilamentDB module) can react to the scan.
 * Failure is intentionally silent — the user-visible tag dialog must not
 * wait on this, and any error here is logged for diagnostics only.
 */
function publishScan(decoded, match, candidates, matchedSpool) {
    const body = {
        filament: match,
        candidates,
        // #732: the spool the scan resolved to (null for a filament-level/heuristic
        // match), so SSE subscribers can act per-spool.
        matchedSpool,
        decoded: {
            materialName: decoded.materialName,
            brandName: decoded.brandName,
            materialType: decoded.materialType,
            color: decoded.color,
            spoolUid: decoded.spoolUid,
            tagSource: decoded.tagSource,
        },
    };
    void fetch("/api/scan/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }).catch((err) => {
        console.warn("[nfc] scan publish failed", err);
    });
}
export function useNfcContext() {
    const ctx = useContext(NfcContext);
    if (!ctx) {
        // Return a safe default for non-Electron / outside provider
        return {
            isElectron: false,
            status: { readerConnected: false, readerName: null, tagPresent: false, tagUid: null, lastError: null },
            writing: false,
            writeError: null,
            writeTag: async () => { },
            tagReadResult: null,
            loadedTagName: null,
            dialogOpen: false,
            dismissTagRead: () => { },
            reopenTagRead: () => { },
            notifyTagWritten: () => { },
            notifyTagErased: () => { },
        };
    }
    return ctx;
}
function pickLoadedName(result) {
    // Prefer the matched DB filament's name (what the user thinks of as
    // "what's loaded"), then fall back to the tag's declared material
    // name for unmatched-but-decoded tags.
    return result.match?.name ?? result.data?.materialName ?? null;
}
/**
 * GH #451: returns true when the currently-focused element is a
 * text-entry surface (input, textarea, or contenteditable). Used to
 * suppress the NFC auto-open dialog mid-typing so we don't steal focus
 * from a user filling out a form when a teammate scans a tag.
 *
 * Duck-typed (`tagName` + attribute reads) rather than `instanceof
 * HTMLInputElement` so it stays unit-testable without a DOM env — the
 * project's vitest config doesn't carry jsdom. Safe to call with `null`
 * (returns false).
 */
export function isTypingTarget(el) {
    if (!el)
        return false;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "INPUT") {
        // type="button"/"checkbox"/"radio" etc. are not typing surfaces;
        // only the text-entry input types should suppress the auto-open.
        const t = (el.getAttribute?.("type") ?? "text").toLowerCase();
        const typingTypes = new Set([
            "text", "search", "url", "tel", "email", "password",
            "number", "date", "datetime-local", "month", "week", "time",
        ]);
        return typingTypes.has(t);
    }
    if (tag === "TEXTAREA")
        return true;
    const editable = el.getAttribute?.("contenteditable");
    if (editable != null && editable !== "false" && editable !== "inherit") {
        return true;
    }
    return false;
}
export default function NfcProvider({ children }) {
    const { isElectron, status, writing, error: writeError, writeTag: rawWriteTag } = useNfc();
    const [tagReadResult, setTagReadResult] = useState(null);
    // The dialog and the "current scan" state used to be one flag —
    // dismissing the dialog cleared tagReadResult and the status pill
    // lost its "Loaded: <name>" label. Decouple them: tagReadResult
    // stays put after dismissal so the dialog's action buttons remain
    // usable; dialogOpen controls the modal independently.
    const [dialogOpen, setDialogOpen] = useState(false);
    // Pill display name, kept separate from tagReadResult so the pill
    // can clear immediately when the reader reports no tag present —
    // codex P2 on PR #235 flagged that an A→B swap would leave the pill
    // showing "Loaded: <A>" until B's decode landed because the dialog's
    // tagReadResult lingered intentionally past dismiss. The dialog
    // doesn't suffer from the same bug because the gate is
    // `dialogOpen && tagReadResult` — only a fresh scan re-opens it.
    const [loadedTagName, setLoadedTagName] = useState(null);
    // #571: while a Write NFC is in flight (and briefly after), the always-on
    // background scanner can pop the read "Found in Database" modal —
    // pre-empting the write and hiding the Write button's own progress/result.
    // The main process also schedules a read-back ~2s after a successful write
    // to refresh the tag data, which would otherwise auto-open the read modal
    // right on top of the write. Suppress the auto-open during the write and
    // for a short window after, so the user sees the write flow through. The
    // pill still updates, and notifyTagWritten flips it to the just-written
    // filament, so no information is lost.
    //
    // `writingRef` is set SYNCHRONOUSLY in the wrapped writeTag below — not
    // derived from the `writing` state via an effect. useNfc.writeTag only
    // enqueues `writing=true`, so an effect-driven ref would lag a render; an
    // nfc-tag-detected event arriving in that gap would snapshot a stale
    // `false` and still auto-open the modal (Codex P2 on PR #580).
    const writingRef = useRef(false);
    const suppressReadModalUntilRef = useRef(0);
    // Codex P2 on PR #580 (round 1): the modal-suppression decision must be
    // captured when the raw NFC event ARRIVES, not when createScanMatchHandler
    // commits — the commit happens after an async /api/filaments/match
    // round-trip, so a slow match could let the post-write read-back commit
    // after the suppression window expired and re-pop the modal. This ref holds
    // the decision snapshot taken synchronously on each raw event.
    const eventTimeSuppressedRef = useRef(false);
    // Wrap useNfc's writeTag so the write-in-progress flag flips synchronously,
    // before any scan event can be observed, and the post-write suppression
    // window is armed on completion.
    const writeTag = useCallback(async (payload, opts = {}) => {
        writingRef.current = true;
        setDialogOpen(false); // hide any read modal the background scan opened
        try {
            await rawWriteTag(payload, opts);
        }
        finally {
            // Cover the main process's ~2s post-write read-back so it refreshes
            // the pill without re-popping the read modal.
            suppressReadModalUntilRef.current = Date.now() + 5000;
            writingRef.current = false;
        }
    }, [rawWriteTag]);
    // Clear the pill name as soon as the tag is lifted. We do NOT clear
    // tagReadResult here on purpose — the dialog may still be open and
    // the user may still want to act on its buttons.
    useEffect(() => {
        if (!status.tagPresent)
            setLoadedTagName(null); // eslint-disable-line react-hooks/set-state-in-effect -- pill-clear in response to external reader state
    }, [status.tagPresent]);
    // Listen for auto-read events from the main process. Match-and-publish
    // sequencing (cancel-stale-fetch + ignore-stale-commit) lives in
    // createScanMatchHandler so the race-prone async path is unit-testable
    // and rapid back-to-back scans can't have the older match clobber the
    // newer one.
    useEffect(() => {
        if (!isElectron)
            return;
        const api = window.electronAPI;
        const handler = createScanMatchHandler({
            onResult: (result) => {
                setTagReadResult(result);
                setLoadedTagName(pickLoadedName(result));
                // #571: don't let a background scan (or the post-write read-back)
                // pop the read modal over an in-flight / just-completed write.
                // Suppress if the write window was active at EITHER the raw event's
                // arrival OR now, at commit — two complementary races (Codex P2 on
                // PR #580):
                //   • arrival-time snapshot catches a read-back that arrives during
                //     the window but whose slow match commits after it expires;
                //   • commit-time check catches a scan that arrived BEFORE the write
                //     (snapshot=false) but whose match commits mid-write.
                const writeSuppressed = eventTimeSuppressedRef.current ||
                    writingRef.current ||
                    Date.now() < suppressReadModalUntilRef.current;
                // GH #451: never steal focus from a user actively typing.
                // Auto-opening this modal mid-keystroke is jarring on shared
                // workshop machines where another user might be filling a form
                // while a teammate scans a tag at the reader. The pill update
                // (loadedTagName above) still happens; the user can open the
                // dialog manually from the NFC status if they want to act on
                // the scan.
                if (!writeSuppressed && !isTypingTarget(document.activeElement)) {
                    setDialogOpen(true);
                }
            },
            onPublish: publishScan,
        });
        // Snapshot the write-suppression decision synchronously on the raw event,
        // BEFORE createScanMatchHandler's async match work, then hand off. Only
        // the latest event's handler commits (seq guard inside the sequencer), so
        // the ref reliably reflects the committing event's arrival-time state.
        const unsub = api.onNfcTagRead((raw) => {
            eventTimeSuppressedRef.current =
                writingRef.current || Date.now() < suppressReadModalUntilRef.current;
            return handler(raw);
        });
        return unsub;
    }, [isElectron]);
    const dismissTagRead = useCallback(() => setDialogOpen(false), []);
    // GH #451 follow-up (Codex P2 on PR #475): a typing-suppressed scan
    // still updates tagReadResult, but `dialogOpen` stays false. Expose a
    // reopen path so the user can pull the dialog back up — wired to the
    // NFC pill in the header which becomes clickable while a scan is
    // dismissable.
    const reopenTagRead = useCallback(() => {
        setDialogOpen((prev) => prev); // no-op write — guards against React staleness
        if (tagReadResult != null)
            setDialogOpen(true);
    }, [tagReadResult]);
    // Called by the filament detail page after a successful Write NFC.
    // Synthesises a `tagReadResult` that mirrors what a fresh read would
    // produce, so the pill flips to "Loaded: <name>" right away rather
    // than waiting for the user to lift + replace the tag.
    const notifyTagWritten = useCallback((filament) => {
        setTagReadResult({ match: filament, candidates: [] });
        setLoadedTagName(filament.name);
        // Intentionally not opening the dialog — the user just clicked
        // "Write NFC" on the filament detail page; popping a modal on top
        // of that workflow would be jarring. The pill update is enough.
    }, []);
    // Called by Settings → Erase Tag after a successful erase. The tag is
    // now blank, so clear the pill label and the stale read result rather
    // than reporting the just-erased filament until the user lifts the tag.
    const notifyTagErased = useCallback(() => {
        setLoadedTagName(null);
        setTagReadResult(null);
        setDialogOpen(false);
    }, []);
    return (<NfcContext.Provider value={{
            isElectron,
            status,
            writing,
            writeError,
            writeTag,
            tagReadResult,
            loadedTagName,
            dialogOpen,
            dismissTagRead,
            reopenTagRead,
            notifyTagWritten,
            notifyTagErased,
        }}>
      {children}
    </NfcContext.Provider>);
}
