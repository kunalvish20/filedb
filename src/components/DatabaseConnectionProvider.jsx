"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const DatabaseConnectionContext = createContext({ status: "checking", refresh: () => {} });

export function useDatabaseConnection() {
    return useContext(DatabaseConnectionContext);
}

export default function DatabaseConnectionProvider({ children }) {
    const [status, setStatus] = useState("checking");
    const requestRef = useRef(null);
    const refresh = useCallback(async () => {
        if (window.electronAPI)
            return;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
            const body = await response.json();
            if (requestRef.current !== controller)
                return;
            setStatus(response.ok && body.status === "ready"
                ? "ready"
                : body.status === "unconfigured" ? "unconfigured" : "unavailable");
        }
        catch {
            if (requestRef.current === controller)
                setStatus("unavailable");
        }
        finally {
            clearTimeout(timeout);
        }
    }, []);
    useEffect(() => {
        if (window.electronAPI)
            return;
        const initialCheck = setTimeout(refresh, 0);
        const interval = setInterval(refresh, 60000);
        window.addEventListener("online", refresh);
        return () => {
            clearTimeout(initialCheck);
            clearInterval(interval);
            window.removeEventListener("online", refresh);
            requestRef.current?.abort();
            requestRef.current = null;
        };
    }, [refresh]);
    const value = useMemo(() => ({ status, refresh }), [status, refresh]);
    return <DatabaseConnectionContext.Provider value={value}>{children}</DatabaseConnectionContext.Provider>;
}
