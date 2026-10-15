"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => { };
const getClientSnapshot = () => typeof window !== "undefined" && !!window.electronAPI;
const getServerSnapshot = () => false;
export function useIsElectron() {
    return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
