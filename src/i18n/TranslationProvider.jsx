"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { DEFAULT_LOCALE, LOCALES } from "./index";
import { interpolate } from "./interpolate";
import en from "./locales/en.json";
import de from "./locales/de.json";
const dictionaries = {
    en: en,
    de: de,
};
const TranslationContext = createContext({
    locale: DEFAULT_LOCALE,
    setLocale: () => { },
    t: (key) => key,
});
const STORAGE_KEY = "filamentdb-locale";
function isValidLocale(value) {
    return typeof value === "string" && LOCALES.some((l) => l.code === value);
}
function readStoredLocale() {
    if (typeof window === "undefined")
        return DEFAULT_LOCALE;
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (isValidLocale(saved)) {
            return saved;
        }
    }
    catch {
        // localStorage may not be available
    }
    return DEFAULT_LOCALE;
}
export function TranslationProvider({ children }) {
    const [locale, setLocaleState] = useState(DEFAULT_LOCALE);
    // GH #639: read the persisted locale on mount instead of in a lazy
    // useState initializer. localStorage is undefined during SSR, so the
    // initializer made the server render `en` while the first client render
    // produced the stored locale — a React 19 hydration mismatch (console
    // error + full client re-render) on every page load for a non-default
    // web user. Mirrors the CollapsibleSection pattern: default during SSR,
    // one post-hydration sync render; the brief default-locale flash on web
    // is the accepted trade-off.
    useEffect(() => {
        const stored = readStoredLocale();
        if (stored !== DEFAULT_LOCALE)
            // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration sync from localStorage
            setLocaleState(stored);
    }, []);
    // In Electron, electron-store is the source of truth — override the
    // localStorage value (this async IPC read resolves after the synchronous
    // localStorage sync above, so it always wins).
    useEffect(() => {
        const api = window.electronAPI;
        if (api?.getConfig) {
            api.getConfig().then((cfg) => {
                const saved = cfg.locale;
                if (isValidLocale(saved)) {
                    setLocaleState(saved);
                }
            }).catch(() => { });
        }
    }, []);
    // Update document lang attribute when locale changes
    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);
    const setLocale = useCallback((code) => {
        setLocaleState(code);
        // Persist to electron-store or localStorage
        const api = window.electronAPI;
        if (api?.saveConfig) {
            api.saveConfig({ locale: code }).catch(() => { });
        }
        else {
            localStorage.setItem(STORAGE_KEY, code);
        }
    }, []);
    const t = useCallback((key, params) => {
        const value = dictionaries[locale]?.[key] ?? dictionaries.en?.[key] ?? key;
        // GH #1007 F1: interpolate() inserts each value literally (function
        // replacement) so `$`-patterns in user data can't corrupt the output.
        return interpolate(value, params);
    }, [locale]);
    return (<TranslationContext value={{ locale, setLocale, t }}>
      {children}
    </TranslationContext>);
}
export function useTranslation() {
    return useContext(TranslationContext);
}
