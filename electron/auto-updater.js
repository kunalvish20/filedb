import { app, dialog, ipcMain, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { assertTrustedSender } from "./ipc-security";
import { classifyUpdateError, } from "../src/lib/updateErrorMessage";
let mainWindow = null;
let currentState = { state: "idle" };
/** GH #946 (Codex): main.ts's `diag`, injected via initAutoUpdater so update
 *  errors reach main.log. A plain console.* in the main process is NOT
 *  mirrored to main.log (only the embedded server's stdout is). Falls back to
 *  console.error when absent (unit tests / older callers). */
let diagLog = null;
/** Tracks whether initAutoUpdater has done its one-time setup (IPC handlers,
 * autoUpdater listeners, periodic-check timers) for this process. The
 * function is called from `createWindow()` in electron/main.ts, which on
 * macOS runs every time the user clicks the dock icon after closing the
 * window. Without this guard the second call hits
 * `Error: Attempted to register a second handler for 'update-get-status'`
 * and crashes the app on reopen (GH #154). */
let initialized = false;
let updatesConfigured = false;
let releasesUrl = null;
function readUpdateConfiguration() {
    try {
        const config = parse(readFileSync(join(process.resourcesPath ?? "", "app-update.yml"), "utf8"));
        return config && typeof config.provider === "string" && config.provider.trim() ? config : null;
    }
    catch {
        // Builds without a publish target deliberately have no update feed.
        return null;
    }
}
function emit(update) {
    currentState = { ...currentState, ...update };
    // The window may have been closed since this reference was captured —
    // on macOS the app keeps running and the periodic check still fires.
    // Touching `webContents` on a destroyed window throws "Object has been
    // destroyed" (GH #239), so verify the window is still alive first.
    if (mainWindow &&
        !mainWindow.isDestroyed() &&
        !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send("update-status", currentState);
    }
}
/**
 * GH #946: emit an error state with a mapped `errorKind` (so the renderer can
 * show a friendly, localized line) and a short stack-free `detail`, while the
 * FULL raw error goes to the log for debugging. Returns the detail so the IPC
 * handlers can pass it back to their caller.
 */
function emitError(err) {
    const { kind, detail } = classifyUpdateError(err);
    // Full raw error (incl. stack) → main.log via the injected diag logger, so a
    // packaged user's support log keeps it. The user only ever sees `detail` +
    // the localized message keyed on `kind`.
    const raw = err instanceof Error ? (err.stack ?? err.message) : String(err);
    (diagLog ?? ((m) => console.error(m)))(`[auto-updater] update error [${kind}]: ${raw}`);
    emit({ state: "error", errorKind: kind, error: detail });
    return detail;
}
export function initAutoUpdater(win, log) {
    // Always refresh the window reference — the previous window may have
    // been closed and the renderer for the new window needs to receive
    // future status events.
    mainWindow = win;
    // GH #946: capture the diagnostic logger (main.ts's `diag`) so update errors
    // land in main.log. Refreshed on every call; harmless if unchanged.
    if (log)
        diagLog = log;
    if (initialized) {
        // Re-emit the current state into the new window so the renderer's
        // initial getSyncStatus() / status listener attaches to a fresh value
        // instead of waiting for the next tick.
        emit({});
        return;
    }
    initialized = true;
    const updateConfig = app.isPackaged ? readUpdateConfiguration() : null;
    updatesConfigured = Boolean(updateConfig);
    if (updateConfig?.provider === "github" &&
        typeof updateConfig.owner === "string" && /^[\w.-]+$/.test(updateConfig.owner) &&
        typeof updateConfig.repo === "string" && /^[\w.-]+$/.test(updateConfig.repo)) {
        releasesUrl = `https://github.com/${updateConfig.owner}/${updateConfig.repo}/releases`;
    }
    // IPC surface is registered unconditionally so the dev-mode renderer can
    // still call update-get-status (and friends) without crashing with
    // "No handler registered". In dev, the mutating handlers short-circuit
    // with a "dev-mode" error instead of touching the real updater, which
    // electron-updater refuses to run when app.isPackaged is false.
    // GH #623: read-only, but gated like its siblings (#434) — the state
    // carries version/release-notes/error text, and an open getter was an
    // undocumented asymmetry vs. the trusted-sender posture everywhere else.
    ipcMain.handle("update-get-status", (event) => {
        assertTrustedSender(event, "update-get-status");
        return currentState;
    });
    // GH #434: update-check and update-download were gated only on
    // `app.isPackaged`. In a release build a sub-frame could drive
    // both unconditionally — checking is free but `update-download`
    // pulls the full installer payload, which is bandwidth abuse
    // against the user. Defence-in-depth: trust only the top-level
    // app frame, same as the install handler.
    ipcMain.handle("update-check", async (event) => {
        assertTrustedSender(event, "update-check");
        if (!app.isPackaged)
            return { ok: false, error: "dev-mode" };
        if (!updatesConfigured)
            return { ok: false, error: "updates-not-configured" };
        // GH #433: don't re-check while a download is in flight or an
        // update is sitting ready to install. `autoUpdater.checkForUpdates()`
        // re-emits `update-available` / `update-not-available`, which would
        // overwrite the in-progress `downloading` / `ready` state in
        // `currentState` and blow away the progress UI. The download itself
        // continues internally but the renderer briefly sees a stale state.
        if (currentState.state === "downloading" || currentState.state === "ready") {
            return { ok: true, skipped: currentState.state };
        }
        try {
            await autoUpdater.checkForUpdates();
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: emitError(err) };
        }
    });
    ipcMain.handle("update-download", async (event) => {
        assertTrustedSender(event, "update-download");
        if (!app.isPackaged)
            return { ok: false, error: "dev-mode" };
        if (!updatesConfigured)
            return { ok: false, error: "updates-not-configured" };
        if (currentState.state !== "available")
            return { ok: false, error: "No update available" };
        try {
            await autoUpdater.downloadUpdate();
            return { ok: true };
        }
        catch (err) {
            return { ok: false, error: emitError(err) };
        }
    });
    ipcMain.handle("update-install", async (evt, strings) => {
        // GH #299: update-install restarts the app — only the app's own
        // top-level frame may invoke it.
        assertTrustedSender(evt, "update-install");
        if (!app.isPackaged)
            return { ok: false, error: "dev-mode" };
        if (!updatesConfigured)
            return { ok: false, error: "updates-not-configured" };
        if (currentState.state !== "ready") {
            return { ok: false, error: "No update ready to install" };
        }
        // Strings are optionally passed from the renderer so the OS-native
        // dialog can honour the user's current locale. The renderer owns the
        // i18n catalog; this module has no access to it. English defaults
        // apply when no strings are provided (unit tests, older renderers).
        const version = currentState.version ?? "";
        const message = (strings?.message ?? `Install spilofila v{version}?`).replace("{version}", version);
        const dialogOptions = {
            type: "info",
            title: strings?.title ?? "Install update",
            message,
            detail: strings?.detail ??
                "The app will restart to apply the update. Any unsaved work may be lost.",
            buttons: [
                strings?.installButton ?? "Restart & install",
                strings?.laterButton ?? "Later",
            ],
            defaultId: 0,
            cancelId: 1,
        };
        // Parent the dialog to the window only if it's still alive; a destroyed
        // window throws "Object has been destroyed" (GH #239).
        const liveWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
        const choice = liveWindow
            ? await dialog.showMessageBox(liveWindow, dialogOptions)
            : await dialog.showMessageBox(dialogOptions);
        if (choice.response === 0) {
            setImmediate(() => autoUpdater.quitAndInstall(false, true));
        }
        return { ok: true };
    });
    // Opens the GitHub release page — useful for macOS where unsigned auto-
    // install is blocked by Gatekeeper and the user has to download manually.
    // GH #434: shell.openExternal opens the user's default browser. The URL
    // is built from a server-supplied version string (`currentState.version`)
    // so injection risk is low, but a sub-frame triggering arbitrary tab
    // opens is still a phishing surface — gate on the top-level frame.
    ipcMain.handle("update-open-release-page", async (event) => {
        assertTrustedSender(event, "update-open-release-page");
        if (!releasesUrl)
            return { ok: false, error: "updates-not-configured" };
        const version = currentState.version;
        const url = version
            ? `${releasesUrl}/tag/${encodeURIComponent(`v${version}`)}`
            : `${releasesUrl}/latest`;
        await shell.openExternal(url);
        return { ok: true };
    });
    // Keep builds without a configured publish target idle; no failed checks,
    // polling timers, or inherited release destinations are needed.
    if (!updatesConfigured) {
        emit({ state: "idle", configured: false });
        return;
    }
    emit({ state: "idle", configured: true });
    autoUpdater.autoDownload = false; // prompt the user before eating bandwidth
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
    autoUpdater.on("update-available", (info) => {
        emit({
            state: "available",
            version: info.version,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : info.releaseName,
        });
    });
    autoUpdater.on("update-not-available", () => emit({ state: "not-available" }));
    autoUpdater.on("download-progress", (p) => emit({
        state: "downloading",
        progress: { percent: p.percent, bytesPerSecond: p.bytesPerSecond },
    }));
    autoUpdater.on("update-downloaded", (info) => {
        emit({ state: "ready", version: info.version });
    });
    autoUpdater.on("error", (err) => {
        emitError(err);
    });
    // Check once shortly after startup, then every 6 hours while running.
    // A short initial delay avoids hammering the API while the window is still
    // mounting and lets the user see the app first.
    //
    // GH #433: skip when an update is downloading or ready — re-checking
    // would overwrite the progress state. The IPC `update-check` handler
    // has the same guard.
    const checkUnlessBusy = () => {
        if (currentState.state === "downloading" || currentState.state === "ready") {
            return;
        }
        autoUpdater.checkForUpdates().catch(() => { });
    };
    setTimeout(checkUnlessBusy, 20 * 1000);
    setInterval(checkUnlessBusy, 6 * 60 * 60 * 1000);
}
