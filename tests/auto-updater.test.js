import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
/**
 * GH #154 regression guard. `initAutoUpdater()` is invoked from
 * `createWindow()` in electron/main.js. On macOS, closing the window sets
 * `mainWindow = null` but the app stays running; clicking the dock icon
 * fires `app.on("activate")` → `createWindow()` → `initAutoUpdater()`
 * AGAIN. Before the fix, the second call hit
 *   Error: Attempted to register a second handler for 'update-get-status'
 * and crashed the app on every reopen.
 */
// Stub out the electron + electron-updater modules at the module-graph
// level — they don't load in a Node test env. Vitest hoists vi.mock so
// these run before the auto-updater import below.
const handleSpy = vi.fn();
const onSpy = vi.fn();
const readFileSpy = vi.fn();
const openExternalSpy = vi.fn();
const checkForUpdatesSpy = vi.fn();
const appMock = { isPackaged: false };
vi.mock("node:fs", () => ({ readFileSync: readFileSpy }));
vi.mock("electron", () => ({
    app: appMock,
    BrowserWindow: class {
    },
    dialog: { showMessageBox: vi.fn() },
    ipcMain: {
        handle: handleSpy,
    },
    shell: { openExternal: openExternalSpy },
}));
vi.mock("electron-updater", () => ({
    autoUpdater: {
        autoDownload: false,
        autoInstallOnAppQuit: true,
        on: onSpy,
        checkForUpdates: checkForUpdatesSpy,
        downloadUpdate: vi.fn(),
        quitAndInstall: vi.fn(),
    },
}));
/**
 * Each fake window gets its OWN send spy. Sharing one would let a
 * regression that still emits to the previous window slip through —
 * `win2.webContents.send` and `win1.webContents.send` would be the
 * same mock and any call would satisfy either assertion.
 *
 * `isDestroyed` mirrors the real BrowserWindow / webContents API —
 * `emit()` consults it before sending (GH #239). Defaults to a live
 * window; tests flip it to simulate a closed one.
 */
function makeWin() {
    return {
        webContents: { send: vi.fn(), isDestroyed: () => false },
        isDestroyed: () => false,
    };
}
describe("initAutoUpdater — idempotency", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let initAutoUpdater;
    beforeEach(async () => {
        // Reset module cache so the `initialized` flag inside the module
        // starts false for each test. Without this, the first test's
        // initialized=true bleeds into the next test.
        vi.resetModules();
        handleSpy.mockClear();
        onSpy.mockClear();
        appMock.isPackaged = false;
        initAutoUpdater = (await import("../electron/auto-updater")).initAutoUpdater;
    });
    afterEach(() => {
        vi.clearAllMocks();
    });
    it("registers each IPC handler exactly once across multiple calls", () => {
        const win1 = makeWin();
        const win2 = makeWin();
        const win3 = makeWin();
        initAutoUpdater(win1);
        initAutoUpdater(win2);
        initAutoUpdater(win3);
        // 4 distinct ipcMain.handle channels: get-status, check, download,
        // install, open-release-page → 5 total. Each must be registered once.
        const channels = handleSpy.mock.calls.map((c) => c[0]);
        expect(channels).toEqual([
            "update-get-status",
            "update-check",
            "update-download",
            "update-install",
            "update-open-release-page",
        ]);
        // Exactly one registration per channel — no duplicate.
        expect(handleSpy).toHaveBeenCalledTimes(5);
    });
    it("redirects future emits to the new window and stops emitting to the old one", () => {
        const win1 = makeWin();
        const win2 = makeWin();
        initAutoUpdater(win1);
        // The first init emits initial idle state into win1.
        const win1CallsAfterFirstInit = win1.webContents.send.mock.calls.length;
        expect(win1CallsAfterFirstInit).toBeGreaterThan(0);
        initAutoUpdater(win2);
        // Re-init should immediately re-emit the current state into the NEW
        // window so the renderer sees a value without waiting for the next
        // status change.
        expect(win2.webContents.send).toHaveBeenCalledWith("update-status", expect.objectContaining({ state: "idle" }));
        // And — the actual GH #154 regression guard — the old window must
        // not receive any new emits after re-init. Two distinct send spies
        // are required to verify this; with the previous shared-spy setup a
        // regression that still targeted win1 would have been invisible.
        expect(win1.webContents.send.mock.calls.length).toBe(win1CallsAfterFirstInit);
    });
    it("does not emit to a destroyed window (GH #239)", () => {
        // On macOS the app keeps running after the window is closed; a
        // periodic update check still fires emit(). Touching webContents on
        // a destroyed window throws "Object has been destroyed" — emit()
        // must short-circuit instead.
        const win = makeWin();
        win.isDestroyed = () => true;
        expect(() => initAutoUpdater(win)).not.toThrow();
        expect(win.webContents.send).not.toHaveBeenCalled();
    });
});

describe("packaged update configuration", () => {
    let initAutoUpdater;
    const trustedEvent = {
        senderFrame: { parent: null, url: `http://localhost:${process.env.PORT || "3456"}` },
    };
    const handler = (channel) => handleSpy.mock.calls.find(([name]) => name === channel)[1];
    beforeEach(async () => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.useFakeTimers();
        appMock.isPackaged = true;
        readFileSpy.mockImplementation(() => { throw new Error("ENOENT"); });
        checkForUpdatesSpy.mockResolvedValue(null);
        initAutoUpdater = (await import("../electron/auto-updater")).initAutoUpdater;
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.clearAllMocks();
        appMock.isPackaged = false;
    });
    it("keeps a build without a feed idle and never polls or opens a release page", async () => {
        const win = makeWin();
        initAutoUpdater(win);
        expect(await handler("update-get-status")(trustedEvent)).toEqual({ state: "idle", configured: false });
        for (const channel of ["update-check", "update-download", "update-install", "update-open-release-page"]) {
            expect(await handler(channel)(trustedEvent)).toEqual({ ok: false, error: "updates-not-configured" });
        }
        await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
        expect(checkForUpdatesSpy).not.toHaveBeenCalled();
        expect(openExternalSpy).not.toHaveBeenCalled();
        expect(onSpy).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
        const replacementWindow = makeWin();
        initAutoUpdater(replacementWindow);
        expect(replacementWindow.webContents.send).toHaveBeenCalledWith("update-status", { state: "idle", configured: false });
        expect(handleSpy).toHaveBeenCalledTimes(5);
    });
    it("ignores a malformed update configuration without scheduling checks", () => {
        readFileSpy.mockReturnValue("provider: [");
        initAutoUpdater(makeWin());
        expect(onSpy).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
    it("uses only the configured repository for release links and scheduled checks", async () => {
        readFileSpy.mockReturnValue("provider: github\nowner: example-maintainer\nrepo: maintained-inventory\n");
        initAutoUpdater(makeWin());
        expect(await handler("update-get-status")(trustedEvent)).toEqual({ state: "idle", configured: true });
        await handler("update-open-release-page")(trustedEvent);
        expect(openExternalSpy).toHaveBeenLastCalledWith("https://github.com/example-maintainer/maintained-inventory/releases/latest");
        const availableListener = onSpy.mock.calls.find(([name]) => name === "update-available")[1];
        availableListener({ version: "2.0.0/beta" });
        await handler("update-open-release-page")(trustedEvent);
        expect(openExternalSpy).toHaveBeenLastCalledWith("https://github.com/example-maintainer/maintained-inventory/releases/tag/v2.0.0%2Fbeta");
        await vi.advanceTimersByTimeAsync(20 * 1000);
        expect(checkForUpdatesSpy).toHaveBeenCalledTimes(1);
        expect(await handler("update-check")(trustedEvent)).toEqual({ ok: true });
        expect(checkForUpdatesSpy).toHaveBeenCalledTimes(2);
    });
    it("still rejects an untrusted release-page request when updates are disabled", async () => {
        initAutoUpdater(makeWin());
        await expect(handler("update-open-release-page")({ senderFrame: { parent: null, url: "https://example.com" } })).rejects.toThrow("untrusted origin");
        expect(openExternalSpy).not.toHaveBeenCalled();
    });
});
