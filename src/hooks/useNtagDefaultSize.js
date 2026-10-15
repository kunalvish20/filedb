"use client";
import { useEffect, useSyncExternalStore } from "react";
import { isNtagSizeName } from "@/lib/ntagVersion";
const STORAGE_KEY = "filamentdb-ntag-default-size";
const DEFAULT = "ask";
/** Coerce any stored/legacy value to a valid NtagDefaultSize. */
function normalize(v) {
    return v === "ask" || isNtagSizeName(v) ? v : DEFAULT;
}
let store = null;
let hydrated = false; // electron-store hydration runs once per session
const listeners = new Set();
function readInitial() {
    if (typeof window === "undefined")
        return DEFAULT;
    try {
        return normalize(localStorage.getItem(STORAGE_KEY));
    }
    catch {
        return DEFAULT;
    }
}
function getSnapshot() {
    if (store === null)
        store = readInitial();
    return store;
}
function getServerSnapshot() {
    return DEFAULT;
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
function persist(value) {
    const api = typeof window !== "undefined" ? window.electronAPI : undefined;
    if (api?.saveConfig) {
        api.saveConfig({ ntagDefaultSize: value }).catch(() => { });
    }
    else {
        try {
            localStorage.setItem(STORAGE_KEY, value);
        }
        catch {
            // ignore — quota / disabled storage
        }
    }
}
/** Set the global default: normalize, persist, notify all instances. */
export function setNtagDefaultSize(next) {
    store = normalize(next);
    persist(store);
    emit();
}
export function useNtagDefaultSize() {
    const defaultSize = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    // One-time electron-store hydration (overrides the localStorage seed on
    // desktop). Module-scoped so it runs once regardless of instance count.
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
            if (c.ntagDefaultSize !== undefined) {
                store = normalize(c.ntagDefaultSize);
                emit();
            }
        })
            .catch(() => { });
    }, []);
    return { defaultSize, setDefaultSize: setNtagDefaultSize };
}
