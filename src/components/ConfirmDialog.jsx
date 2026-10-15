"use client";
import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "@/i18n/TranslationProvider";
const ConfirmContext = createContext(null);
export function useConfirm() {
    const ctx = useContext(ConfirmContext);
    if (!ctx) {
        // Tests / storybook may render components outside the provider.
        // Fall back to native confirm so behaviour stays usable rather than
        // silently no-op.
        return (opts) => {
            const msg = typeof opts === "string" ? opts : opts.message;
            return Promise.resolve(typeof window !== "undefined" ? window.confirm(msg) : false);
        };
    }
    return ctx;
}
export default function ConfirmProvider({ children }) {
    // Codex P2 on PR #351: the cancel-button fallback used to be the
    // English literal "Cancel"; callers never pass `cancelLabel`, so the
    // fallback was effectively the production label and shipped in every
    // non-English locale. Pull both fallbacks (cancel + ok) from the
    // shared `common.*` translation keys so they follow the active locale.
    const { t } = useTranslation();
    const [pending, setPending] = useState(null);
    const confirmBtnRef = useRef(null);
    // Codex P2 round 2: needed for the Tab-key focus trap below — the
    // confirm-button ref alone wasn't enough to cycle focus between the
    // two buttons.
    const cancelBtnRef = useRef(null);
    const confirm = useCallback((arg) => {
        const opts = typeof arg === "string" ? { message: arg } : arg;
        return new Promise((resolve) => {
            // If a previous prompt is still open, resolve it as a cancel so the
            // caller's promise doesn't dangle.
            setPending((prev) => {
                if (prev)
                    prev.resolve(false);
                return { opts, resolve };
            });
        });
    }, []);
    const decide = useCallback((answer) => {
        setPending((prev) => {
            if (prev)
                prev.resolve(answer);
            return null;
        });
    }, []);
    // Focus the confirm button when the dialog opens; Esc cancels from
    // anywhere. Codex P1 on PR #351 round 1: the previous document-level
    // handler ALSO mapped Enter→decide(true) unconditionally, so a keyboard
    // user who tabbed to Cancel and hit Enter still confirmed the
    // destructive action (and `preventDefault` suppressed the focused
    // button's normal activation). Enter is now left to the browser —
    // autoFocus on the confirm button means Enter naturally triggers it
    // when nothing else has been focused; on a different focused button
    // (e.g. Cancel), pressing Enter activates THAT button.
    //
    // Codex P2 round 2: aria-modal="true" on its own doesn't trap Tab —
    // after the two buttons, focus escapes to background page controls
    // while the overlay is still up. Cycle Tab/Shift+Tab between the two
    // buttons so focus stays inside the dialog until it's dismissed.
    //
    // GH #1081: capture the invoking element BEFORE focusing the confirm
    // button and restore it on cleanup — every other modal in the codebase
    // does this (GH #320), but this one dropped focus to <body> on close,
    // sending keyboard/SR users back to the top of the document after the
    // app's most common interaction. The `document.contains` guard covers
    // the confirm path where the triggering control was removed (a deleted
    // row) — restoring focus to a detached node is a silent no-op that
    // still leaves focus on <body>, so we only restore when it's live.
    useEffect(() => {
        if (!pending)
            return;
        const prevFocus = document.activeElement;
        confirmBtnRef.current?.focus();
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                decide(false);
                return;
            }
            if (e.key === "Tab") {
                const focusables = [cancelBtnRef.current, confirmBtnRef.current].filter((el) => el != null);
                if (focusables.length === 0)
                    return;
                const active = document.activeElement;
                const idx = active ? focusables.indexOf(active) : -1;
                // Focus is outside the modal — yank it back to the first focusable.
                if (idx === -1) {
                    e.preventDefault();
                    focusables[0].focus();
                    return;
                }
                const dir = e.shiftKey ? -1 : 1;
                const next = (idx + dir + focusables.length) % focusables.length;
                e.preventDefault();
                focusables[next].focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            if (prevFocus && document.contains(prevFocus))
                prevFocus.focus?.();
        };
    }, [pending, decide]);
    return (<ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (<div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" 
        // Codex P2 round 2: when the caller doesn't pass a `title`,
        // `aria-labelledby` used to be `undefined` and there was no
        // accessible name at all — screen readers announced an unnamed
        // dialog. Fall back to a translated `aria-label` so the dialog
        // always has a name. The message text is reachable separately
        // via `aria-describedby`.
        aria-labelledby={pending.opts.title ? "confirm-title" : undefined} aria-label={pending.opts.title ? undefined : t("common.confirmDialog")} aria-describedby="confirm-message" onClick={(e) => {
                // Outside-click = cancel
                if (e.target === e.currentTarget)
                    decide(false);
            }}>
          <div className="w-full max-w-md mx-4 rounded-lg bg-white dark:bg-gray-800 border border-border dark:border-border shadow-xl p-5">
            {pending.opts.title && (<h2 id="confirm-title" className="text-base font-semibold mb-2">
                {pending.opts.title}
              </h2>)}
            <p id="confirm-message" className="text-sm text-gray-700 dark:text-gray-200 whitespace-pre-wrap break-words">
              {pending.opts.message}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              {!pending.opts.hideCancel && (<button ref={cancelBtnRef} type="button" onClick={() => decide(false)} className="px-4 py-1.5 rounded border border-border dark:border-border text-sm hover:bg-gray-100 dark:hover:bg-gray-700">
                  {pending.opts.cancelLabel ?? t("common.cancel")}
                </button>)}
              <button ref={confirmBtnRef} type="button" onClick={() => decide(true)} className={`px-4 py-1.5 rounded text-white text-sm ${pending.opts.destructive
                ? "bg-red-600 hover:bg-red-700"
                : "ui-primary hover:opacity-90"}`}>
                {pending.opts.confirmLabel ?? t("common.ok")}
              </button>
            </div>
          </div>
        </div>)}
    </ConfirmContext.Provider>);
}
