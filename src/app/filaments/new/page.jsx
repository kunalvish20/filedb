"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import FilamentForm from "@/app/filaments/FilamentForm";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";
import { useNfcContext } from "@/components/NfcProvider";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { useTranslation } from "@/i18n/TranslationProvider";
function NewFilamentContent() {
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const confirm = useConfirm();
    const { isElectron, status: nfcStatus, tagReadResult, dismissTagRead } = useNfcContext();
    const { t } = useTranslation();
    const [initialData, setInitialData] = useState(undefined);
    const [formKey, setFormKey] = useState(0);
    const [titleKey, setTitleKey] = useState("new.title");
    const { dirtyRef, onDirtyChange, showUnsavedDialog, handleBack, navigate, confirmNav, cancelNav, } = useUnsavedChanges("/");
    // Pending populate-from action (held while confirmation is shown)
    const pendingPopulateRef = useRef(null);
    // INI picker state
    const [iniFilaments, setIniFilaments] = useState(null);
    const iniFileRef = useRef(null);
    const iniDialogRef = useRef(null);
    // Declared up here (used by the focus-trap effect below + guardPopulate).
    const [showPopulateDialog, setShowPopulateDialog] = useState(false);
    // #682: focus-trap the INI profile picker like the app's other dialogs —
    // move focus in on open, cycle Tab/Shift+Tab within it, Escape to close, and
    // restore focus to the trigger on close. Suspended while the unsaved-changes
    // confirmation is open (guardPopulate keeps the picker mounted underneath it)
    // so the trap doesn't steal Tab back from that nested dialog (Codex on #688).
    useEffect(() => {
        if (!iniFilaments || showPopulateDialog)
            return;
        const previouslyFocused = document.activeElement;
        const focusables = () => Array.from(iniDialogRef.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute("disabled"));
        focusables()[0]?.focus();
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setIniFilaments(null);
                return;
            }
            if (e.key === "Tab") {
                const f = focusables();
                if (f.length === 0)
                    return;
                e.preventDefault();
                const idx = f.indexOf(document.activeElement);
                const next = e.shiftKey
                    ? idx <= 0
                        ? f.length - 1
                        : idx - 1
                    : idx === f.length - 1
                        ? 0
                        : idx + 1;
                f[next].focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("keydown", onKey);
            previouslyFocused?.focus?.();
        };
    }, [iniFilaments, showPopulateDialog]);
    // Prusament QR state
    const [prusamentInput, setPrusamentInput] = useState("");
    const [prusamentOpen, setPrusamentOpen] = useState(false);
    const [prusamentLoading, setPrusamentLoading] = useState(false);
    const prusamentRef = useRef(null);
    // Clone picker state
    const [cloneSearch, setCloneSearch] = useState("");
    const [cloneOptions, setCloneOptions] = useState([]);
    const [cloneOpen, setCloneOpen] = useState(false);
    const [cloneHighlight, setCloneHighlight] = useState(-1);
    const cloneRef = useRef(null);
    // Parent loading for ?parentId= or ?cloneId= query param
    const parentId = searchParams.get("parentId");
    const cloneId = searchParams.get("cloneId");
    const [parentLoading, setParentLoading] = useState(!!parentId || !!cloneId);
    /** Guard populate-from actions: if dirty, stash the action and show confirm dialog */
    const guardPopulate = (action) => {
        if (dirtyRef.current) {
            pendingPopulateRef.current = action;
            setShowPopulateDialog(true);
        }
        else {
            action();
        }
    };
    const handleSubmit = async (data) => {
        // "+ Add Filament" registers a spool you own — you only add a filament to
        // the DB because you have it. So always create exactly one spool on create:
        // its gross weight is the entered initial weight, else net + tare, else
        // unknown.
        if (!Array.isArray(data.spools) || data.spools.length === 0) {
            const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
            const total = num(data.totalWeight);
            const ownNet = num(data.netFilamentWeight);
            const ownTare = num(data.spoolWeight);
            const isVariant = typeof data.parentId === "string" && data.parentId !== "";
            // A variant leaves Net / Empty Spool blank to inherit them — FilamentForm
            // keeps parent placeholders out of submitted state, so data.netFilament-
            // Weight / spoolWeight are null even when the parent has values. Fetch the
            // SELECTED parent (by current data.parentId — the picker can swap it after
            // a ?parentId= open, so a cached doc may be stale; Codex P2 rounds 2/4/5)
            // and fill in whichever of net/tare the variant left blank.
            let effNet = ownNet;
            let effTare = ownTare;
            if (isVariant && (effNet == null || effTare == null)) {
                try {
                    const r = await fetch(`/api/filaments/${encodeURIComponent(data.parentId)}?raw=true`);
                    if (r.ok) {
                        const parent = await r.json();
                        if (effNet == null)
                            effNet = num(parent?.netFilamentWeight);
                        if (effTare == null)
                            effTare = num(parent?.spoolWeight);
                    }
                }
                catch {
                    /* leave effNet/effTare as-is — falls through to unknown / 0-pin */
                }
            }
            // Gross: explicit initial weight, else net + tare (0 when no tare), else
            // unknown. When derived from net the tare is baked in so remaining
            // resolves back to net.
            let gross;
            let derivedFromNet = false;
            if (total != null) {
                gross = total;
            }
            else if (effNet != null) {
                gross = effNet + (effTare ?? 0);
                derivedFromNet = true;
            }
            else {
                gross = null;
            }
            // Pin spoolWeight=0 ONLY when the gross was DERIVED FROM NET and there's
            // no tare: net is filament-only, so net + 0 means remaining = net (and
            // getRemainingGrams would otherwise read a null-tare spooled filament as
            // "untracked", hiding the weight). When the user ENTERED the gross
            // (Initial Weight) with an unknown tare, the gross includes the spool
            // mass — pinning 0 would overstate remaining by the tare, so leave it
            // null and let it stay untracked until the tare is known (Codex P2 r6).
            // effTare == null already implies ownTare == null (effTare ?? own).
            if (derivedFromNet && effTare == null) {
                data.spoolWeight = 0;
            }
            data.totalWeight = null;
            data.spools = [{ label: "", totalWeight: gross }];
        }
        const post = (payload) => fetch("/api/filaments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        let res = await post(data);
        // GH #605 (Phase 2b): creating the FIRST variant of a parent that still
        // carries its own color/spools turns that parent into a template — the
        // server moves the color + spools onto a new sibling variant, and 409s
        // until the client explicitly opts in. Show the consequences (the 409
        // names the would-be variant + spool count), then retry with the
        // promoteParent flag on confirm.
        if (res.status === 409) {
            const conflict = await res.json().catch(() => null);
            if (conflict?.error !== "parent_promotion_required") {
                toast(conflict?.error || t("new.toast.createFailed"), "error");
                return;
            }
            const ok = await confirm({
                title: t("new.promote.title"),
                message: t("new.promote.message", {
                    parent: String(conflict.parentName ?? ""),
                    variant: String(conflict.variantName ?? ""),
                    count: conflict.spoolCount ?? 0,
                }),
                confirmLabel: t("new.promote.confirm"),
            });
            if (!ok)
                return;
            res = await post({ ...data, promoteParent: true });
        }
        if (res.ok) {
            const created = await res.json();
            toast(t("new.toast.created"));
            navigate(`/filaments/${created._id}`);
        }
        else {
            const body = await res.json().catch(() => null);
            toast(body?.error || t("new.toast.createFailed"), "error");
        }
    };
    // Initialize from NFC query params
    useEffect(() => {
        if (searchParams.get("from_nfc")) {
            const nozzleMax = searchParams.get("nozzle") ? Number(searchParams.get("nozzle")) : null;
            const nozzleMin = searchParams.get("nozzleMin") ? Number(searchParams.get("nozzleMin")) : null;
            const bedMax = searchParams.get("bed") ? Number(searchParams.get("bed")) : null;
            const bedMin = searchParams.get("bedMin") ? Number(searchParams.get("bedMin")) : null;
            const weight = searchParams.get("weight") ? Number(searchParams.get("weight")) : null;
            // Nominal net (weight) vs actual remaining net + tare (Codex P2 r7 #706).
            const actualWeight = searchParams.get("actualWeight") ? Number(searchParams.get("actualWeight")) : null;
            const emptySpool = searchParams.get("emptySpool") ? Number(searchParams.get("emptySpool")) : null;
            // Syncing external URL state into form initial data. Can't be derived
            // because the form is controlled elsewhere via formKey remounts.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setInitialData({
                name: searchParams.get("name") || "",
                vendor: searchParams.get("vendor") || "",
                type: searchParams.get("type") || "PLA",
                color: searchParams.get("color") || "#808080",
                // GH #477: NFC tag's secondary slots arrive comma-separated;
                // FilamentForm reads `initialData.secondaryColors` and surfaces
                // them in the multi-color editor. Empty/blank entries filtered
                // out so a tag with sparse slots doesn't produce empty strings
                // that fail the hex validator at save time.
                ...(searchParams.get("secondaryColors")
                    ? {
                        secondaryColors: searchParams
                            .get("secondaryColors")
                            .split(",")
                            .map((c) => c.trim())
                            .filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)),
                    }
                    : {}),
                density: searchParams.get("density") ? Number(searchParams.get("density")) : null,
                diameter: searchParams.get("diameter") ? Number(searchParams.get("diameter")) : 1.75,
                temperatures: {
                    nozzle: nozzleMax,
                    nozzleFirstLayer: nozzleMin ?? nozzleMax,
                    bed: bedMax,
                    bedFirstLayer: bedMin ?? bedMax,
                },
                ...(weight != null ? { netFilamentWeight: weight } : {}),
                // actualWeight is the tag's NET remaining, so pin a 0 tare when the tag
                // carries no emptySpool — else the derived spool reads as untracked
                // (null spoolWeight) and hides the entered remaining (Codex P2 r7/r8).
                ...(emptySpool != null
                    ? { spoolWeight: emptySpool }
                    : actualWeight != null
                        ? { spoolWeight: 0 }
                        : {}),
                ...(actualWeight != null ? { totalWeight: actualWeight + (emptySpool ?? 0) } : {}),
                ...(searchParams.get("colorName") ? { colorName: searchParams.get("colorName") } : {}),
                ...(searchParams.get("shoreA") ? { shoreHardnessA: Number(searchParams.get("shoreA")) } : {}),
                ...(searchParams.get("shoreD") ? { shoreHardnessD: Number(searchParams.get("shoreD")) } : {}),
                ...(searchParams.get("maxVolumetricSpeed")
                    ? { maxVolumetricSpeed: Number(searchParams.get("maxVolumetricSpeed")) }
                    : {}),
                ...(searchParams.get("optTags") ? { optTags: searchParams.get("optTags").split(",").map(Number) } : {}),
                settings: {
                    ...(searchParams.get("chamber")
                        ? { chamber_temperature: searchParams.get("chamber") }
                        : {}),
                    ...(searchParams.get("country")
                        ? { filament_notes: `"Origin: ${searchParams.get("country")}"` }
                        : {}),
                },
            });
            setTitleKey("new.fromNfc");
            setFormKey((k) => k + 1);
        }
    }, [searchParams]);
    // Initialize from ?parentId= query param
    //
    // Two things happen here:
    //   1. We pre-fill `vendor` + `type` because those are almost always
    //      shared between a parent and its variants — typing them again is
    //      a papercut, not an inheritance violation (they're trivially
    //      re-derivable, and the form already does this when the user picks
    //      a parent manually via the dropdown).
    //   2. We attach the full parent doc as `_parent` so FilamentForm can
    //      render the parent's values as faded placeholders on every
    //      inheritable input. The form must NOT copy these into form state
    //      on save — placeholders are display-only. That preserves the
    //      GH #106 dynamic-inheritance design: a blank input on the variant
    //      stays blank in the database and resolves to the parent's current
    //      value at read time via resolveFilament().
    useEffect(() => {
        if (parentId) {
            const ac = new AbortController();
            fetch(`/api/filaments/${parentId}?raw=true`, { signal: ac.signal })
                .then((r) => (r.ok ? r.json() : null))
                .then((parent) => {
                if (parent) {
                    setInitialData({
                        parentId,
                        vendor: parent.vendor || "",
                        type: parent.type || "",
                        _parent: parent,
                    });
                    setTitleKey("new.addColorVariant");
                    setFormKey((k) => k + 1);
                }
            })
                .catch((err) => {
                if (err instanceof DOMException && err.name === "AbortError")
                    return;
            })
                .finally(() => setParentLoading(false));
            return () => ac.abort();
        }
    }, [parentId]);
    // Initialize from ?cloneId= query param (full clone from detail page).
    // Only copy identification fields (name, color, vendor, type) so the new
    // variant inherits all settings (calibration, temps, gcode, …) from the
    // parent. Spreading the whole resolved doc would persist parent values as
    // explicit overrides on the variant and silently sever inheritance — same
    // failure mode as GH #106 / GH #115.
    useEffect(() => {
        if (cloneId) {
            const ac = new AbortController();
            fetch(`/api/filaments/${cloneId}`, { signal: ac.signal })
                .then((r) => (r.ok ? r.json() : null))
                .then((filament) => {
                if (filament) {
                    const parentId = filament.parentId || filament._id;
                    setInitialData({
                        parentId,
                        name: `${filament.name} (${t("new.copySuffix")})`,
                        color: filament.color || "#808080",
                        colorName: filament.colorName || null,
                        vendor: filament.vendor || "",
                        type: filament.type || "PLA",
                    });
                    setTitleKey("new.cloneTitle");
                    setFormKey((k) => k + 1);
                }
            })
                .catch((err) => {
                if (err instanceof DOMException && err.name === "AbortError")
                    return;
            })
                .finally(() => setParentLoading(false));
            return () => ac.abort();
        }
    }, [cloneId, t]);
    // Fetch clone options
    useEffect(() => {
        const ac = new AbortController();
        fetch("/api/filaments/parents", { signal: ac.signal })
            .then((r) => r.json())
            .then(setCloneOptions)
            .catch((err) => {
            if (err instanceof DOMException && err.name === "AbortError")
                return;
        });
        return () => ac.abort();
    }, []);
    // Close dropdowns on outside click
    useEffect(() => {
        function handleClick(e) {
            if (cloneRef.current && !cloneRef.current.contains(e.target)) {
                setCloneOpen(false);
            }
            if (prusamentRef.current && !prusamentRef.current.contains(e.target)) {
                setPrusamentOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);
    // Handle NFC tag read while on this page.
    //
    // NfcProvider intentionally keeps `tagReadResult` alive after the tag
    // is lifted off the reader — the scan-match dialog's action buttons
    // (View Filament / Create New / candidates) need to remain usable
    // after the user dismisses the modal. That design is fine for the
    // dialog; it's wrong for this page, which has no concept of "stale
    // result vs. fresh scan." Without the `tagPresent` gate, clicking
    // "+ Add Filament" any time after a scan-and-lift sequence would
    // pre-fill the form with whatever was last scanned — even when the
    // user has clearly moved on.
    //
    // `tagPresent` is read through a ref rather than the deps array
    // (codex round-1 P1 on PR #354). The naive form — listing
    // `nfcStatus.tagPresent` as a dep — re-runs this effect on every
    // present↔absent transition with whatever `tagReadResult` is
    // currently in scope. `electron/main.ts` emits `nfc-status-changed`
    // immediately when a tag is detected, BEFORE the async tag read
    // completes; during that window the effect would re-fire with
    // `tagPresent=true` and the PREVIOUS tag's `tagReadResult`, prefilling
    // the form from stale data. Routing the read through a ref means the
    // prefill effect only runs when `tagReadResult` itself changes, but
    // can still consult the latest tag-presence state at that moment.
    const tagPresentRef = useRef(nfcStatus.tagPresent);
    useEffect(() => {
        tagPresentRef.current = nfcStatus.tagPresent;
    }, [nfcStatus.tagPresent]);
    useEffect(() => {
        if (!tagReadResult?.data)
            return;
        if (!tagPresentRef.current)
            return;
        const data = tagReadResult.data;
        // Syncing NFC tag payload into form initial data — same pattern as above.
        setInitialData({
            name: data.materialName || "",
            vendor: data.brandName || "",
            type: data.materialType || "PLA",
            color: data.color || "#808080",
            density: data.density ?? null,
            diameter: data.diameter ?? 1.75,
            temperatures: {
                nozzle: data.nozzleTemp ?? null,
                nozzleFirstLayer: data.nozzleTempMin ?? data.nozzleTemp ?? null,
                bed: data.bedTemp ?? null,
                bedFirstLayer: data.bedTempMin ?? data.bedTemp ?? null,
            },
            // weightGrams is the tag's NOMINAL net capacity; actualWeightGrams is the
            // current remaining net. Carry the tare (emptySpoolWeight) and, when the
            // tag reports actual remaining, prefill Initial Weight with the on-scale
            // gross (actual + tare) so the auto-created spool reflects a partially
            // used roll instead of a full one (Codex P2 r7 on #706).
            ...(data.weightGrams != null ? { netFilamentWeight: data.weightGrams } : {}),
            // actualWeightGrams is NET remaining, so pin a 0 tare when the tag carries
            // no emptySpoolWeight — else the spool reads as untracked (null
            // spoolWeight) and hides the remaining (Codex P2 r7/r8).
            ...(data.emptySpoolWeight != null
                ? { spoolWeight: data.emptySpoolWeight }
                : data.actualWeightGrams != null
                    ? { spoolWeight: 0 }
                    : {}),
            ...(data.actualWeightGrams != null
                ? { totalWeight: data.actualWeightGrams + (data.emptySpoolWeight ?? 0) }
                : {}),
            settings: {
                ...(data.chamberTemp != null ? { chamber_temperature: String(data.chamberTemp) } : {}),
                ...(data.countryOfOrigin ? { filament_notes: `"Origin: ${data.countryOfOrigin}"` } : {}),
            },
        });
        setTitleKey("new.fromNfc");
        setFormKey((k) => k + 1);
        dismissTagRead();
        toast(t("new.toast.populatedFromNfc"));
        // `nfcStatus.tagPresent` is read via `tagPresentRef` (see the block
        // above) and intentionally omitted from this dep array.
    }, [tagReadResult, dismissTagRead, toast, t]);
    // Handle INI file selection
    const handleIniFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        e.target.value = ""; // reset so same file can be re-selected
        const formData = new FormData();
        formData.append("file", file);
        // GH #640: a dropped connection used to reject silently — no toast,
        // unhandled rejection. Same toast as the non-2xx path.
        try {
            const res = await fetch("/api/filaments/parse-ini", {
                method: "POST",
                body: formData,
            });
            if (!res.ok) {
                const body = await res.json().catch(() => null);
                toast(body?.error || t("new.toast.iniParseFailed"), "error");
                return;
            }
            const { filaments } = await res.json();
            if (filaments.length === 1) {
                // Single profile — populate directly
                guardPopulate(() => applyIniFilament(filaments[0]));
            }
            else {
                // Multiple profiles — show picker
                setIniFilaments(filaments);
            }
        }
        catch {
            toast(t("new.toast.iniParseFailed"), "error");
        }
    };
    const applyIniFilament = (f) => {
        setInitialData(f);
        setTitleKey("new.fromIni");
        setFormKey((k) => k + 1);
        setIniFilaments(null);
        toast(t("new.toast.populatedFromIni"));
    };
    // Handle Prusament QR lookup
    const handlePrusament = async () => {
        const input = prusamentInput.trim();
        if (!input)
            return;
        if (dirtyRef.current) {
            guardPopulate(() => { handlePrusamentFetch(input); });
            return;
        }
        handlePrusamentFetch(input);
    };
    const handlePrusamentFetch = async (input) => {
        setPrusamentLoading(true);
        try {
            // Extract spoolId from URL or use as-is
            let spoolId = input;
            if (input.includes("spoolId=")) {
                try {
                    spoolId = new URL(input).searchParams.get("spoolId") || input;
                }
                catch { /* use as-is */ }
            }
            const res = await fetch(`/api/prusament?spoolId=${encodeURIComponent(spoolId)}`);
            const data = await res.json();
            if (!res.ok) {
                toast(data.error || t("new.toast.prusamentFetchFailed"), "error");
                return;
            }
            setInitialData({
                name: data.productName || "",
                vendor: "Prusament",
                type: data.material || "PLA",
                color: data.colorHex || "#808080",
                diameter: data.diameter ?? 1.75,
                // Prusament quotes USD; enter the actual purchase cost in INR.
                cost: null,
                temperatures: {
                    nozzle: data.nozzleTempMax ?? null,
                    nozzleFirstLayer: data.nozzleTempMin ?? data.nozzleTempMax ?? null,
                    bed: data.bedTempMax ?? null,
                    bedFirstLayer: data.bedTempMin ?? data.bedTempMax ?? null,
                },
                spoolWeight: data.spoolWeight ?? null,
                netFilamentWeight: data.netWeight ?? null,
                totalWeight: data.totalWeight ?? null,
            });
            setTitleKey("new.fromPrusament");
            setFormKey((k) => k + 1);
            setPrusamentOpen(false);
            setPrusamentInput("");
            toast(t("new.toast.populatedFromPrusament"));
        }
        catch {
            toast(t("new.toast.prusamentFetchFailed"), "error");
        }
        finally {
            setPrusamentLoading(false);
        }
    };
    // Handle clone selection
    const handleClone = async (id) => {
        setCloneOpen(false);
        setCloneSearch("");
        if (dirtyRef.current) {
            guardPopulate(() => { handleCloneFetch(id); });
            return;
        }
        handleCloneFetch(id);
    };
    const handleCloneFetch = async (id) => {
        // GH #640: network failure used to reject silently with no toast.
        let filament;
        try {
            const res = await fetch(`/api/filaments/${id}`);
            if (!res.ok) {
                toast(t("new.toast.loadFailed"), "error");
                return;
            }
            filament = await res.json();
        }
        catch {
            toast(t("new.toast.loadFailed"), "error");
            return;
        }
        // See the cloneId useEffect above for why we whitelist instead of spread.
        const parentId = filament.parentId || filament._id;
        setInitialData({
            parentId,
            name: `${filament.name} (${t("new.copySuffix")})`,
            color: filament.color || "#808080",
            colorName: filament.colorName || null,
            vendor: filament.vendor || "",
            type: filament.type || "PLA",
        });
        setTitleKey("new.cloneTitle");
        setFormKey((k) => k + 1);
        toast(t("new.toast.populatedFromClone"));
    };
    const filteredClones = cloneOptions.filter((f) => !cloneSearch ||
        f.name.toLowerCase().includes(cloneSearch.toLowerCase()) ||
        f.vendor.toLowerCase().includes(cloneSearch.toLowerCase())).slice(0, 20);
    if ((parentId || cloneId) && parentLoading) {
        return (<main id="main-content" className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-4">
          <Link href="/" className="text-foreground hover:underline text-sm">
            &larr; {t("detail.back")}
          </Link>
        </div>
        <h1 className="text-2xl font-bold mb-6">{t(titleKey)}</h1>
        <p className="text-gray-500">{t("new.loadingParent")}</p>
      </main>);
    }
    return (<main id="main-content" className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-4">
        <Link href="/" className="text-foreground hover:underline text-sm" onClick={handleBack}>
          &larr; {t("detail.back")}
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">{t(titleKey)}</h1>

      {/* Populate-from toolbar */}
      {!parentId && (<div className="mb-6 rounded-xl border border-border bg-gray-50 p-4 dark:bg-gray-900/50">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t("new.populateFrom")}</h2>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("new.quickSetupDescription")}</p>
            </div>
            <span className="rounded-full border border-border bg-white px-2.5 py-1 text-xs font-medium text-foreground dark:bg-gray-800">{t("new.inrPrices")}</span>
          </div>
          <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-3">
            {/* NFC */}
            {isElectron && (<div className="col-span-full mb-1 flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${nfcStatus.tagPresent ? "bg-green-500" : nfcStatus.readerConnected ? "bg-yellow-500" : "bg-gray-500"}`}/>
                <span className="text-sm text-gray-400">
                  {nfcStatus.tagPresent
                    ? t("new.nfc.tagDetected")
                    : nfcStatus.readerConnected
                        ? t("new.nfc.placeTag")
                        : t("new.nfc.noReader")}
                </span>
              </div>)}

            {/* Prusament QR */}
            <div ref={prusamentRef} className="relative">
              <button type="button" onClick={() => { setCloneOpen(false); setPrusamentOpen((o) => !o); }} aria-expanded={prusamentOpen} aria-controls="prusament-lookup" className="flex h-full w-full items-start gap-2.5 rounded-lg border border-border bg-white p-3 text-left text-sm text-foreground transition-colors hover:border-orange-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 dark:bg-gray-800">
                <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z"/>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 14.625v2.625m3.375-2.625v2.625M16.875 20.25h-3.375v-3.375"/>
                </svg>
                <span><span className="block font-medium">{t("new.prusamentQr")}</span><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{t("new.prusamentDescription")}</span></span>
              </button>
              {prusamentOpen && (<div id="prusament-lookup" className="absolute left-0 z-50 mt-2 w-80 max-w-[calc(100vw-4rem)] bg-white dark:bg-gray-800 border border-border dark:border-border rounded-lg shadow-lg p-3">
                  <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1.5">{t("new.prusament.inputLabel")}</label>
                  <div className="flex gap-2">
                    <input type="text" value={prusamentInput} onChange={(e) => setPrusamentInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") {
                e.preventDefault();
                handlePrusament();
            } }} placeholder={t("new.prusament.inputPlaceholder")} className="min-w-0 flex-1 px-2.5 py-1.5 bg-white dark:bg-gray-900 border border-border dark:border-border rounded text-sm text-gray-900 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-500" autoFocus/>
                    <button type="button" onClick={handlePrusament} disabled={prusamentLoading || !prusamentInput.trim()} className="px-3 py-1.5 text-sm bg-orange-600 text-white rounded hover:bg-orange-700 disabled:opacity-50">
                      {prusamentLoading ? "..." : t("new.prusament.fetch")}
                    </button>
                  </div>
                </div>)}
            </div>

            {/* INI file */}
            <input ref={iniFileRef} type="file" accept=".ini" onChange={handleIniFile} className="hidden"/>
            <button type="button" onClick={() => iniFileRef.current?.click()} className="flex h-full w-full items-start gap-2.5 rounded-lg border border-border bg-white p-3 text-left text-sm text-foreground transition-colors hover:border-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500 dark:bg-gray-800">
              <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <span><span className="block font-medium">{t("new.loadFromIni")}</span><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{t("new.iniDescription")}</span></span>
            </button>

            {/* Clone */}
            <div ref={cloneRef} className="relative">
              <button type="button" onClick={() => { setPrusamentOpen(false); setCloneOpen((o) => !o); }} aria-expanded={cloneOpen} aria-controls="clone-filament-picker" className="flex h-full w-full items-start gap-2.5 rounded-lg border border-border bg-white p-3 text-left text-sm text-foreground transition-colors hover:border-gray-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:bg-gray-800">
                <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
                <span><span className="block font-medium">{t("new.cloneExisting")}</span><span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{t("new.cloneDescription")}</span></span>
              </button>
              {cloneOpen && (<div id="clone-filament-picker" className="absolute left-0 z-50 mt-2 w-80 max-w-[calc(100vw-4rem)] sm:left-auto sm:right-0 bg-white dark:bg-gray-800 border border-border dark:border-border rounded-lg shadow-lg">
                  <input className="w-full px-3 py-2 bg-transparent border-b border-border dark:border-border text-sm text-gray-900 dark:text-gray-100 outline-none placeholder-gray-400 dark:placeholder-gray-500" placeholder={t("new.clone.searchPlaceholder")} value={cloneSearch} onChange={(e) => { setCloneSearch(e.target.value); setCloneHighlight(-1); }} onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setCloneHighlight((h) => Math.min(h + 1, filteredClones.length - 1));
                    }
                    else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setCloneHighlight((h) => Math.max(h - 1, 0));
                    }
                    else if (e.key === "Enter" && cloneHighlight >= 0 && filteredClones[cloneHighlight]) {
                        e.preventDefault();
                        handleClone(filteredClones[cloneHighlight]._id);
                    }
                    else if (e.key === "Escape") {
                        setCloneOpen(false);
                    }
                }} autoFocus role="combobox" aria-expanded={true} aria-controls="clone-listbox" aria-autocomplete="list" aria-activedescendant={cloneHighlight >= 0 ? `clone-opt-${cloneHighlight}` : undefined}/>
                  <ul id="clone-listbox" role="listbox" className="max-h-48 overflow-y-auto">
                    {filteredClones.map((f, i) => (<li key={f._id} id={`clone-opt-${i}`} role="option" aria-selected={i === cloneHighlight} className={`px-3 py-2 cursor-pointer text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-sm ${i === cloneHighlight ? "bg-gray-200 dark:bg-gray-600" : ""}`} onMouseDown={(e) => {
                        e.preventDefault();
                        handleClone(f._id);
                    }}>
                        <div className="w-4 h-4 rounded-full border border-gray-500 flex-shrink-0" style={{ backgroundColor: f.color }}/>
                        <span className="flex-1 truncate">{f.name}</span>
                        <span className="text-gray-500 dark:text-gray-400 text-xs flex-shrink-0">{f.vendor}</span>
                      </li>))}
                    {filteredClones.length === 0 && (<li className="px-3 py-2 text-gray-500 text-sm">{t("new.clone.noResults")}</li>)}
                  </ul>
                </div>)}
            </div>
          </div>
        </div>)}

      {/* INI profile picker modal */}
      {iniFilaments && (<>
          <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setIniFilaments(null)}/>
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div ref={iniDialogRef} role="dialog" aria-modal="true" aria-label={t("new.ini.selectProfile")} className="bg-white dark:bg-gray-900 border border-border dark:border-border rounded-lg shadow-2xl max-w-lg w-full mx-4 p-6 pointer-events-auto max-h-[80vh] flex flex-col">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">{t("new.ini.selectProfile")}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t("new.ini.profileCount", { count: iniFilaments.length })}</p>
              <ul className="overflow-y-auto flex-1 space-y-1">
                {iniFilaments.map((f, i) => (<li key={i}>
                    <button type="button" className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 text-sm" onClick={() => guardPopulate(() => applyIniFilament(f))}>
                      <div className="w-4 h-4 rounded-full border border-gray-500 flex-shrink-0" style={{ backgroundColor: f.color || "#808080" }}/>
                      <span className="text-gray-900 dark:text-white flex-1 truncate">{f.name}</span>
                      <span className="text-gray-500 dark:text-gray-400 text-xs">{f.vendor} · {f.type}</span>
                    </button>
                  </li>))}
              </ul>
              <div className="flex justify-end mt-4">
                <button type="button" onClick={() => setIniFilaments(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-border dark:border-border rounded hover:border-gray-400 dark:hover:border-gray-500">
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        </>)}

      <FilamentForm key={formKey} initialData={initialData} onSubmit={handleSubmit} onDirtyChange={onDirtyChange}/>

      {showUnsavedDialog && (<UnsavedChangesDialog onCancel={cancelNav} onDiscard={confirmNav}/>)}

      {showPopulateDialog && (<UnsavedChangesDialog onCancel={() => { setShowPopulateDialog(false); pendingPopulateRef.current = null; }} onDiscard={() => {
                setShowPopulateDialog(false);
                dirtyRef.current = false;
                pendingPopulateRef.current?.();
                pendingPopulateRef.current = null;
            }}/>)}
    </main>);
}
export default function NewFilament() {
    // GH #638: the Suspense fallback was hardcoded English. The provider
    // mounts above this component (ClientProviders in the root layout), so
    // t() is available here.
    const { t } = useTranslation();
    return (<Suspense fallback={<p className="p-8 text-gray-500">{t("common.loading")}</p>}>
      <NewFilamentContent />
    </Suspense>);
}
