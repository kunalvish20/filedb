"use client";
import { useState, useEffect, useCallback } from "react";
const DEFAULT_STATUS = {
    readerConnected: false,
    readerName: null,
    tagPresent: false,
    tagUid: null,
    lastError: null,
};
export function useNfc() {
    const [isElectron] = useState(() => typeof window !== "undefined" &&
        !!window.electronAPI?.nfcGetStatus);
    const [status, setStatus] = useState(DEFAULT_STATUS);
    const [writing, setWriting] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (!isElectron)
            return;
        const api = window.electronAPI;
        // Get initial status
        api.nfcGetStatus().then(setStatus).catch(() => { });
        // Subscribe to status changes
        const unsubStatus = api.onNfcStatusChange((s) => {
            setStatus(s);
        });
        return () => {
            unsubStatus();
        };
    }, [isElectron]);
    const readTag = useCallback(async () => {
        if (!isElectron)
            throw new Error("NFC only available in Electron");
        setError(null);
        try {
            return await window.electronAPI.nfcReadTag();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
    }, [isElectron]);
    const writeTag = useCallback(async (payload, opts = {}) => {
        if (!isElectron)
            throw new Error("NFC only available in Electron");
        setError(null);
        setWriting(true);
        try {
            await window.electronAPI.nfcWriteTag(Array.from(payload), opts.standard, opts.productUrl, opts.ntagSize);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
        finally {
            setWriting(false);
        }
    }, [isElectron]);
    const formatTag = useCallback(async () => {
        if (!isElectron)
            throw new Error("NFC only available in Electron");
        setError(null);
        setWriting(true);
        try {
            await window.electronAPI.nfcFormatTag();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            throw err;
        }
        finally {
            setWriting(false);
        }
    }, [isElectron]);
    return { isElectron, status, writing, error, readTag, writeTag, formatTag };
}
