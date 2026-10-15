let pending = null;
export function setPendingScan(scan) {
    pending = scan;
}
/** Read the pending scan without consuming it (safe during render). */
export function peekPendingScan() {
    return pending;
}
/** Clear the hand-off — call from an event handler, never during render. */
export function clearPendingScan() {
    pending = null;
}
