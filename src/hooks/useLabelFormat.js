"use client";
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_LABEL_FORMAT, normalizeLabelFormat, } from "@/lib/labelFormat";
/**
 * useLabelFormat — the global label-formatting config (GH #592).
 *
 * Backed by a module-level store via useSyncExternalStore so every mounted
 * instance shares live state: editing the format in LabelFormatEditor is
 * immediately visible to LabelPrinterSettings' test print and to the
 * PrintLabelDialog on the same page, not just after a remount (Codex P3 on
 * PR #593).
 *
 * Persistence mirrors useCurrency: electron-store (via the generic
 * getConfig/saveConfig bridge) is the source of truth on desktop; a
 * localStorage copy serves SSR / web-mode users (the web `.bin` download
 * path honors the format too). Stored as a JSON string under key
 * `labelFormat` (electron-store) / `filamentdb-label-format` (localStorage).
 */
const STORAGE_KEY = "filamentdb-label-format";
let store = null;
let hydrated = false; // electron-store hydration runs once per session
const listeners = new Set();
function readInitial() {
    if (typeof window === "undefined")
        return DEFAULT_LABEL_FORMAT;
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved)
            return normalizeLabelFormat(JSON.parse(saved));
    }
    catch {
        // localStorage unavailable / corrupt JSON → default
    }
    return DEFAULT_LABEL_FORMAT;
}
function getSnapshot() {
    if (store === null)
        store = readInitial();
    return store;
}
function getServerSnapshot() {
    return DEFAULT_LABEL_FORMAT;
}
function subscribe(cb) {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}
function emit() {
    for (const l of listeners)
        l();
}
function persist(fmt) {
    const json = JSON.stringify(fmt);
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (api?.saveConfig) {
        api.saveConfig({ labelFormat: json }).catch(() => { });
    }
    else {
        try {
            localStorage.setItem(STORAGE_KEY, json);
        }
        catch {
            // ignore — quota / disabled storage
        }
    }
}
/** Update the global format: normalize, persist, and notify all instances. */
export function setLabelFormat(next) {
    store = normalizeLabelFormat(next);
    persist(store);
    emit();
}
export function useLabelFormat() {
    const format = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    // One-time electron-store hydration (overrides the localStorage seed on
    // desktop). Module-scoped so it runs once regardless of how many instances
    // mount; the emit() updates every subscriber.
    useEffect(() => {
        if (hydrated)
            return;
        hydrated = true;
        const api = window.electronAPI;
        if (!api?.getConfig)
            return;
        api
            .getConfig()
            .then((cfg) => {
            const c = cfg;
            if (typeof c.labelFormat === "string") {
                try {
                    store = normalizeLabelFormat(JSON.parse(c.labelFormat));
                    emit();
                }
                catch {
                    /* corrupt stored value → keep current */
                }
            }
        })
            .catch(() => { });
    }, []);
    return { format, setFormat: setLabelFormat };
}
