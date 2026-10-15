import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Runtime drift guard for the Electron IPC contract in the JavaScript build.
 * It verifies that every channel invoked by preload exists in the Electron
 * main-process source and that the label/TSPL printer bridges stay symmetric.
 */
const ELECTRON_DIR = join(__dirname, "..", "electron");
const PRELOAD = readFileSync(join(ELECTRON_DIR, "preload.js"), "utf8");

function mainProcessStringLiterals() {
  const out = new Set();
  for (const entry of readdirSync(ELECTRON_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    if (entry.name === "preload.js") continue;
    const src = readFileSync(join(ELECTRON_DIR, entry.name), "utf8");
    for (const m of src.matchAll(/["']([^"'\\\n]+)["']/g)) out.add(m[1]);
  }
  return out;
}

function contextBridgeKeys() {
  const start = PRELOAD.indexOf("exposeInMainWorld");
  expect(start).toBeGreaterThan(-1);
  const open = PRELOAD.indexOf("{", start);
  const keys = [];
  let depth = 0;
  let lineStart = open;
  for (let i = open; i < PRELOAD.length; i++) {
    const ch = PRELOAD[i];
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") {
      depth--;
      if (depth === 0) break;
    } else if (ch === "\n") {
      lineStart = i + 1;
      continue;
    }
    if (depth === 1 && i === lineStart) {
      const line = PRELOAD.slice(i, PRELOAD.indexOf("\n", i));
      const m = line.match(/^\s*([a-zA-Z_$][\w$]*)\s*:/);
      if (m) keys.push(m[1]);
    }
  }
  return keys;
}

describe("Electron IPC contract parity", () => {
  it("every channel preload invokes is registered somewhere under electron/", () => {
    const literals = mainProcessStringLiterals();
    const invoked = [...PRELOAD.matchAll(/ipcRenderer\.invoke\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(invoked.length).toBeGreaterThan(20);
    expect(invoked.filter((c) => !literals.has(c))).toEqual([]);
  });

  it("exposes a substantial runtime bridge surface", () => {
    const keys = contextBridgeKeys();
    expect(keys.length).toBeGreaterThan(20);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("both label printers expose a complete, symmetric channel set", () => {
    const literals = mainProcessStringLiterals();
    const preloadKeys = new Set(contextBridgeKeys());
    for (const verb of ["get-device-path", "set-device-path", "print"]) {
      expect(literals.has(`label-printer-${verb}`)).toBe(true);
      expect(literals.has(`tspl-printer-${verb}`)).toBe(true);
    }
    for (const method of ["GetDevicePath", "SetDevicePath", "Print"]) {
      expect(preloadKeys.has(`labelPrinter${method}`)).toBe(true);
      expect(preloadKeys.has(`tsplPrinter${method}`)).toBe(true);
    }
    expect(preloadKeys.has("tsplPrinterListDevices")).toBe(false);
  });
});
