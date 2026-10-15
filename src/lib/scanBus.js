import { EventEmitter } from "node:events";
const GLOBAL_KEY = "__filamentDbScanBus__";
function getState() {
    const g = globalThis;
    if (!g[GLOBAL_KEY]) {
        const emitter = new EventEmitter();
        // SSE clients (PrusaSlicer + the desktop renderer + any dev tools) all
        // listen at once. Default cap of 10 is too low and triggers a noisy
        // MaxListenersExceededWarning under normal use.
        emitter.setMaxListeners(0);
        g[GLOBAL_KEY] = { emitter, last: null };
    }
    return g[GLOBAL_KEY];
}
const SCAN_EVENT = "scan";
export function publishScan(event) {
    const state = getState();
    state.last = event;
    state.emitter.emit(SCAN_EVENT, event);
}
export function subscribeScans(handler) {
    const state = getState();
    state.emitter.on(SCAN_EVENT, handler);
    return () => {
        state.emitter.off(SCAN_EVENT, handler);
    };
}
export function getLastScan() {
    return getState().last;
}
/** Test-only: drop the last cached scan and any active listeners. */
export function resetScanBusForTests() {
    const state = getState();
    state.emitter.removeAllListeners(SCAN_EVENT);
    state.last = null;
}
