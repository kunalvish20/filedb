"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "@/i18n/TranslationProvider";
import { useToast } from "@/components/Toast";
function formatValue(v) {
    if (v == null)
        return "—";
    if (Array.isArray(v))
        return v.length === 0 ? "—" : v.join(", ");
    return String(v);
}
export default function OptResyncDialog({ filamentId, onApplied, onClose }) {
    const { t } = useTranslation();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);
    const [selected, setSelected] = useState(new Set());
    const [applying, setApplying] = useState(false);
    const dialogRef = useRef(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/filaments/${filamentId}/openprinttag/check`);
                const body = (await res.json());
                if (cancelled)
                    return;
                if (!res.ok) {
                    setError(t("resync.error"));
                }
                else {
                    setData(body);
                    // Default-check the safe (adopt) changes only.
                    setSelected(new Set((body.changes ?? []).filter((c) => c.kind === "adopt").map((c) => c.field)));
                }
            }
            catch {
                if (!cancelled)
                    setError(t("resync.error"));
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [filamentId, t]);
    // Escape to close + Tab focus trap (mirrors ConfirmDialog's mechanics).
    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
                return;
            }
            if (e.key !== "Tab" || !dialogRef.current)
                return;
            const focusables = Array.from(dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'));
            if (focusables.length === 0)
                return;
            const active = document.activeElement;
            const idx = active ? focusables.indexOf(active) : -1;
            e.preventDefault();
            const dir = e.shiftKey ? -1 : 1;
            const next = idx < 0 ? 0 : (idx + dir + focusables.length) % focusables.length;
            focusables[next].focus();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);
    const toggle = useCallback((field) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(field))
                next.delete(field);
            else
                next.add(field);
            return next;
        });
    }, []);
    const handleApply = useCallback(async () => {
        const fields = [...selected];
        if (fields.length === 0) {
            toast(t("resync.none"), "error");
            return;
        }
        setApplying(true);
        try {
            const res = await fetch(`/api/filaments/${filamentId}/openprinttag/sync`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ fields }),
            });
            if (!res.ok) {
                toast(t("resync.applyFailed"), "error");
                return;
            }
            toast(t("resync.applied", { count: fields.length }), "success");
            onApplied();
            onClose();
        }
        catch {
            toast(t("resync.applyFailed"), "error");
        }
        finally {
            setApplying(false);
        }
    }, [selected, filamentId, toast, t, onApplied, onClose]);
    const changes = data?.changes ?? [];
    const hasConflicts = changes.some((c) => c.kind === "conflict");
    return (<div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={t("resync.title")} onClick={onClose}>
      <div ref={dialogRef} className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border dark:border-border">
          <h2 className="text-lg font-semibold">{t("resync.title")}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label={t("common.close")}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          {loading && <p className="text-sm text-gray-500">{t("resync.checking")}</p>}
          {!loading && error && <p className="text-sm text-red-500">{error}</p>}
          {!loading && !error && data && !data.linked && (<p className="text-sm text-gray-500">{t("resync.notLinked")}</p>)}
          {!loading && !error && data?.linked && data.found === false && (<p className="text-sm text-amber-600 dark:text-amber-400">{t("resync.materialGone")}</p>)}
          {!loading && !error && data?.found && changes.length === 0 && (<p className="text-sm text-green-600 dark:text-green-400">{t("resync.upToDate")}</p>)}

          {!loading && !error && changes.length > 0 && (<>
              {data?.materialName && (<p className="text-xs text-gray-500 mb-3">
                  {t("resync.source", { name: data.materialName })}
                </p>)}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b border-border dark:border-border">
                    <th className="py-1 pr-2 w-8"/>
                    <th className="py-1 pr-2">{t("resync.colField")}</th>
                    <th className="py-1 pr-2">{t("resync.colCurrent")}</th>
                    <th className="py-1 pr-2">{t("resync.colIncoming")}</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => (<tr key={c.field} className="border-b border-gray-100 dark:border-border/50">
                      <td className="py-1.5 pr-2 align-top">
                        <input type="checkbox" checked={selected.has(c.field)} onChange={() => toggle(c.field)} aria-label={t(c.labelKey)}/>
                      </td>
                      <td className="py-1.5 pr-2 align-top">
                        <span>{t(c.labelKey)}</span>
                        {c.kind === "conflict" && (<span className="ml-1.5 text-[10px] uppercase font-semibold text-amber-600 dark:text-amber-400">
                            {t("resync.conflictBadge")}
                          </span>)}
                      </td>
                      <td className="py-1.5 pr-2 align-top text-gray-500 font-mono text-xs break-all">
                        {formatValue(c.current)}
                      </td>
                      <td className="py-1.5 pr-2 align-top font-mono text-xs break-all">
                        {formatValue(c.incoming)}
                      </td>
                    </tr>))}
                </tbody>
              </table>
              {hasConflicts && (<p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                  {t("resync.conflictHint")}
                </p>)}
            </>)}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border dark:border-border">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-border dark:border-border hover:bg-gray-100 dark:hover:bg-gray-700">
            {t("resync.cancel")}
          </button>
          {changes.length > 0 && (<button type="button" onClick={handleApply} disabled={applying || selected.size === 0} className="px-3 py-1.5 text-sm rounded ui-primary text-white hover:opacity-90 disabled:bg-gray-400 dark:disabled:bg-gray-700 disabled:cursor-not-allowed">
              {t("resync.apply", { count: selected.size })}
            </button>)}
        </div>
      </div>
    </div>);
}
