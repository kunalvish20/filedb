import dbConnect from "@/lib/mongodb";
import Filament from "@/models/Filament";
import { resolveFilament } from "@/lib/resolveFilament";
import { getSpoolCount } from "@/lib/inventoryStats";
export const EXPORT_COLUMNS = [
    { key: "name", header: "Name" },
    { key: "vendor", header: "Vendor" },
    { key: "type", header: "Type" },
    { key: "color", header: "Color" },
    // GH #477: multi-color hexes joined with commas. Round-trips through
    // the importer's split-on-comma + per-entry hex validation.
    { key: "secondaryColors", header: "Secondary Colors" },
    { key: "diameter", header: "Diameter (mm)" },
    { key: "cost", header: "Cost" },
    { key: "density", header: "Density (g/cm³)" },
    { key: "nozzleTemp", header: "Nozzle Temp (°C)" },
    { key: "nozzleFirstLayerTemp", header: "Nozzle First Layer (°C)" },
    { key: "bedTemp", header: "Bed Temp (°C)" },
    { key: "bedFirstLayerTemp", header: "Bed First Layer (°C)" },
    { key: "maxVolumetricSpeed", header: "Max Vol. Speed (mm³/s)" },
    { key: "spoolWeight", header: "Spool Weight (g)" },
    { key: "netFilamentWeight", header: "Net Filament Weight (g)" },
    { key: "spoolCount", header: "Spools" },
    { key: "dryingTemperature", header: "Drying Temp (°C)" },
    { key: "dryingTime", header: "Drying Time (min)" },
    { key: "transmissionDistance", header: "HueForge TD" },
    { key: "glassTempTransition", header: "Glass Transition Tg (°C)" },
    { key: "heatDeflectionTemp", header: "Heat Deflection HDT (°C)" },
    { key: "shoreHardnessA", header: "Shore A" },
    { key: "shoreHardnessD", header: "Shore D" },
    { key: "minPrintSpeed", header: "Min Print Speed (mm/s)" },
    { key: "maxPrintSpeed", header: "Max Print Speed (mm/s)" },
    { key: "colorName", header: "Color Name" },
    { key: "spoolType", header: "Spool Type" },
    { key: "nozzleRangeMin", header: "Nozzle Range Min (°C)" },
    { key: "nozzleRangeMax", header: "Nozzle Range Max (°C)" },
    { key: "standbyTemp", header: "Standby Temp (°C)" },
    { key: "tdsUrl", header: "TDS URL" },
    { key: "instanceId", header: "Instance ID" },
    // Parent/variant relationship — empty for roots, populated for variants
    // (Parent) and parents (Variant Count). Placed at the end so existing
    // consumers that read columns by header index keep working.
    { key: "parentName", header: "Parent" },
    { key: "variantCount", header: "Variant Count" },
    // GH #954: color arrangement + finish tags, comma-separated numeric ids.
    // Appended last so header-index consumers keep working.
    { key: "optTags", header: "Tags" },
];
export async function getExportRows() {
    await dbConnect();
    const filaments = await Filament.find({ _deletedAt: null })
        .sort({ name: 1 })
        .lean();
    // Build parent lookup for variant resolution
    const parentMap = new Map();
    for (const f of filaments) {
        if (!f.parentId) {
            parentMap.set(f._id.toString(), f);
        }
    }
    // Count variants per parent for the Variant Count column. A separate map
    // because parentMap above only indexes roots/parents; we need to count
    // how many filaments reference each id as their parentId.
    const variantCountByParent = new Map();
    for (const f of filaments) {
        if (f.parentId) {
            const key = f.parentId.toString();
            variantCountByParent.set(key, (variantCountByParent.get(key) ?? 0) + 1);
        }
    }
    return filaments.map((filament) => {
        const parentDoc = filament.parentId
            ? parentMap.get(filament.parentId.toString())
            : undefined;
        const resolved = filament.parentId
            ? resolveFilament(filament, parentDoc)
            : filament;
        return {
            name: resolved.name,
            vendor: resolved.vendor,
            type: resolved.type,
            color: resolved.color,
            secondaryColors: (resolved.secondaryColors ?? []).join(","),
            diameter: resolved.diameter,
            cost: resolved.cost ?? null,
            density: resolved.density ?? null,
            nozzleTemp: resolved.temperatures?.nozzle ?? null,
            nozzleFirstLayerTemp: resolved.temperatures?.nozzleFirstLayer ?? null,
            bedTemp: resolved.temperatures?.bed ?? null,
            bedFirstLayerTemp: resolved.temperatures?.bedFirstLayer ?? null,
            maxVolumetricSpeed: resolved.maxVolumetricSpeed ?? null,
            spoolWeight: resolved.spoolWeight ?? null,
            netFilamentWeight: resolved.netFilamentWeight ?? null,
            // GH #955: delegate to the single source of truth so the export count
            // can't drift from the UI. getSpoolCount excludes retired spools and
            // returns the filtered count first (an all-retired array yields 0, not a
            // fall-through to the legacy totalWeight branch).
            spoolCount: getSpoolCount({
                spools: resolved.spools,
                spoolWeight: resolved.spoolWeight ?? null,
                netFilamentWeight: resolved.netFilamentWeight ?? null,
                totalWeight: resolved.totalWeight ?? null,
            }),
            dryingTemperature: resolved.dryingTemperature ?? null,
            dryingTime: resolved.dryingTime ?? null,
            transmissionDistance: resolved.transmissionDistance ?? null,
            glassTempTransition: resolved.glassTempTransition ?? null,
            heatDeflectionTemp: resolved.heatDeflectionTemp ?? null,
            shoreHardnessA: resolved.shoreHardnessA ?? null,
            shoreHardnessD: resolved.shoreHardnessD ?? null,
            minPrintSpeed: resolved.minPrintSpeed ?? null,
            maxPrintSpeed: resolved.maxPrintSpeed ?? null,
            colorName: resolved.colorName ?? null,
            spoolType: resolved.spoolType ?? null,
            nozzleRangeMin: resolved.temperatures?.nozzleRangeMin ?? null,
            nozzleRangeMax: resolved.temperatures?.nozzleRangeMax ?? null,
            standbyTemp: resolved.temperatures?.standby ?? null,
            tdsUrl: resolved.tdsUrl ?? null,
            instanceId: filament.instanceId ?? "",
            // Read parentName from the source `filament` (not `resolved`) because
            // resolveFilament doesn't mutate name fields. The variant count
            // applies to whatever this row's _id is — variants always 0, roots
            // are 0 unless they have variants pointing at them.
            parentName: parentDoc?.name ?? null,
            variantCount: variantCountByParent.get(filament._id.toString()) ?? 0,
            // GH #954: resolved so a variant exports its EFFECTIVE tags (matching
            // secondaryColors), keeping the round-trip's arrangement/finish intact.
            optTags: (resolved.optTags ?? []).join(","),
        };
    });
}
