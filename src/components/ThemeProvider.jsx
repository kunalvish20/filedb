"use client";
import { createContext, useCallback, useContext, useEffect, useState, } from "react";
import { THEME_STORAGE_KEY } from "@/lib/themeInitScript";
const ThemeContext = createContext({
    preference: "system",
    resolved: "light",
    setPreference: () => { },
});
function isValidPreference(v) {
    return v === "light" || v === "dark" || v === "system";
}
/** Read the stored preference, defaulting to "system". SSR-safe. */
function readStoredPreference() {
    if (typeof window === "undefined")
        return "system";
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (isValidPreference(raw))
            return raw;
    }
    catch {
        // localStorage may be disabled (e.g. private mode) — fall through
    }
    return "system";
}
/** Resolve a preference to concrete theme given the OS media query state. */
function resolveFor(pref, systemDark) {
    if (pref === "dark")
        return "dark";
    if (pref === "light")
        return "light";
    return systemDark ? "dark" : "light";
}
export default function ThemeProvider({ children }) {
    // GH #1007 F2: seed to SSR-safe constants and read localStorage + matchMedia
    // in a mount effect — mirroring the GH #639 fix in useCurrency /
    // TranslationProvider. Seeding these in the useState initializers runs during
    // hydration, so a stored non-"system" theme made the client's first render
    // (which highlights `preference` in ThemeSection) disagree with the server's
    // "system" render → a React 19 hydration mismatch + full client re-render on
    // every /settings/ui visit.
    const [preference, setPreferenceState] = useState("system");
    // systemDark tracks the OS media query so `resolved` is a pure derivation
    // of (preference, systemDark) rather than a DOM-read side effect.
    const [systemDark, setSystemDark] = useState(false);
    // Gate the <html> class-application effect until the real preference is read,
    // so React doesn't briefly overwrite the anti-FOUC inline script's class with
    // the default-derived theme during the hydration frame (a visible flash).
    const [hydrated, setHydrated] = useState(false);
    const resolved = resolveFor(preference, systemDark);
    // Seed preference + systemDark from client-only sources, post-hydration.
    useEffect(() => {
        /* eslint-disable react-hooks/set-state-in-effect -- one-shot post-hydration seed from localStorage/matchMedia */
        setPreferenceState(readStoredPreference());
        if (typeof window !== "undefined" && window.matchMedia) {
            setSystemDark(window.matchMedia("(prefers-color-scheme: dark)").matches);
        }
        setHydrated(true);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, []);
    // Apply the resolved theme to <html>. Side effect only — no state write.
    // Skipped until hydrated so the inline anti-FOUC script's class stands during
    // the hydration frame (before the stored preference has been read).
    useEffect(() => {
        if (!hydrated)
            return;
        const html = document.documentElement;
        if (resolved === "dark")
            html.classList.add("dark");
        else
            html.classList.remove("dark");
    }, [resolved, hydrated]);
    // Subscribe once to media-query changes so systemDark stays current.
    // Using the callback form of setSystemDark avoids the set-state-in-effect
    // lint rule (we read event.matches on each change, no derivation needed).
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia)
            return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const handler = (e) => setSystemDark(e.matches);
        mq.addEventListener?.("change", handler);
        return () => mq.removeEventListener?.("change", handler);
    }, []);
    const setPreference = useCallback((p) => {
        setPreferenceState(p);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, p);
        }
        catch {
            // ignore
        }
    }, []);
    return (<ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>);
}
export function useTheme() {
    return useContext(ThemeContext);
}
