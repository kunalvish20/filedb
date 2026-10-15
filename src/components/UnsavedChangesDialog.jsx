"use client";
import { useEffect, useRef } from "react";
import { useTranslation } from "@/i18n/TranslationProvider";
export default function UnsavedChangesDialog({ onCancel, onDiscard }) {
    const { t } = useTranslation();
    const cancelRef = useRef(null);
    const discardRef = useRef(null);
    const dialogRef = useRef(null);
    // GH #522.2: split the effect — capture/restore + initial focus + Tab
    // trap run once on mount; the Escape→onCancel handler tracks the live
    // callback in a separate effect. Pre-fix the whole block was keyed on
    // [onCancel], so a parent re-render with an inline arrow function
    // identity-changed onCancel, fired cleanup (which restored focus to
    // the background), then immediately re-ran the effect (which snapshot
    // the just-restored focus and re-focused the dialog). Net effect:
    // focus bounced between the background field and the dialog's Cancel
    // button on every parent re-render. /filaments/new re-renders on NFC
    // events, so the trigger was real-world. Same fix shape ImportAtlasDialog
    // applied for the identical bug.
    useEffect(() => {
        const previouslyFocused = document.activeElement;
        cancelRef.current?.focus();
        const handleKeyDown = (e) => {
            if (e.key === "Tab") {
                // Simple two-element trap — the two action buttons are the only
                // focusable elements inside this dialog.
                const focusables = [cancelRef.current, discardRef.current].filter((el) => el !== null);
                if (focusables.length === 0)
                    return;
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
                else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            previouslyFocused?.focus?.();
        };
    }, []);
    // Escape handler tracks the live callback so a Cancel-prop change
    // doesn't get stale, but doesn't re-run the focus dance above.
    useEffect(() => {
        const handler = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onCancel();
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, [onCancel]);
    // Clicking the backdrop cancels, same as Escape.
    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget)
            onCancel();
    };
    return (<div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="unsaved-changes-title" aria-describedby="unsaved-changes-message" onClick={handleBackdropClick} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm mx-4">
        <h2 id="unsaved-changes-title" className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">
          {t("edit.unsaved.title")}
        </h2>
        <p id="unsaved-changes-message" className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t("edit.unsaved.message")}
        </p>
        <div className="flex justify-end gap-3">
          <button ref={cancelRef} onClick={onCancel} className="px-4 py-2 text-sm rounded border border-border dark:border-border text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
            {t("edit.unsaved.cancel")}
          </button>
          <button ref={discardRef} onClick={onDiscard} className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700">
            {t("edit.unsaved.discard")}
          </button>
        </div>
      </div>
    </div>);
}
