"use client";
import { createContext, useContext, useState, useCallback } from "react";
import { useTranslation } from "@/i18n/TranslationProvider";
const ToastContext = createContext(null);
export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx)
        return { toast: () => { } };
    return ctx;
}
let nextId = 0;
/**
 * Compute a readable auto-dismiss duration based on message length.
 *
 * Rationale: a 4-second fixed duration was too short for longer success
 * messages (import summaries, multi-action confirmations) but overkill for
 * short acknowledgments. Rough estimate: ~60 words per minute reading speed
 * ≈ 200 ms per character as a lower bound, clamped to a reasonable range.
 *
 * Errors are held longer because the user typically needs to read and act.
 */
export function computeToastDuration(message, type = "success") {
    const minMs = type === "error" ? 6000 : 4000;
    const maxMs = type === "error" ? 15000 : 10000;
    const perCharMs = 60;
    return Math.max(minMs, Math.min(maxMs, message.length * perCharMs));
}
export default function ToastProvider({ children }) {
    const { t } = useTranslation();
    const [toasts, setToasts] = useState([]);
    const toast = useCallback((message, type = "success", opts = {}) => {
        const id = ++nextId;
        setToasts((prev) => {
            const next = [...prev, { id, message, type }];
            // Cap visible toasts at 5 — drop oldest when exceeded
            return next.length > 5 ? next.slice(-5) : next;
        });
        const duration = opts.duration !== undefined ? opts.duration : computeToastDuration(message, type);
        if (duration > 0) {
            setTimeout(() => {
                setToasts((prev) => prev.filter((entry) => entry.id !== id));
            }, duration);
        }
    }, []);
    const dismiss = useCallback((id) => {
        setToasts((prev) => prev.filter((entry) => entry.id !== id));
    }, []);
    return (<ToastContext.Provider value={{ toast }}>
      {children}
      {/* GH #343 (#2): toast container was `max-w-sm` (~384px) with a
         * single non-wrapping flex row, so long error strings like "Cannot
         * delete this nozzle — it is referenced by 3 filaments. Remove it
         * from those filaments first." truncated at the viewport edge. The
         * message column now wraps and the container widens on roomy
         * viewports. `items-start` keeps the dismiss × aligned to the first
         * line of a multi-line message. */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-md md:max-w-lg">
        {toasts.map((toastEntry) => (<div key={toastEntry.id} 
        // GH #442: only errors warrant `role="alert"` (assertive
        // — interrupts SR output). Success and info are routine
        // confirmations; `role="status"` (polite) lets the SR
        // finish what it's reading before announcing.
        role={toastEntry.type === "error" ? "alert" : "status"} aria-live={toastEntry.type === "error" ? "assertive" : "polite"} className={`px-4 py-3 rounded-lg shadow-lg text-sm text-white flex items-start gap-2 animate-slide-in ${toastEntry.type === "success"
                ? "bg-green-600"
                : toastEntry.type === "error"
                    ? "bg-red-600"
                    : "ui-primary"}`}>
            <span className="flex-1 whitespace-pre-wrap break-words">{toastEntry.message}</span>
            <button onClick={() => dismiss(toastEntry.id)} className="text-white/70 hover:text-white text-lg leading-none" aria-label={t("common.dismiss")}>
              &times;
            </button>
          </div>))}
      </div>
    </ToastContext.Provider>);
}
