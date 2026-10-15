"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { mmToDots, qrModuleCount } from "@/lib/tsplEncoder";
/**
 * On-screen preview of a TSPL LabelDocument — the SAME document `render()`
 * serializes for the printer, mapped to SVG. That shared input is what keeps
 * preview and print from drifting: there is no second layout pass, only a
 * second painter.
 *
 * Fidelity notes, in decreasing order of exactness:
 *   - Geometry (positions, box/bar/reverse rects, QR placement + module
 *     count) is exact — it comes from the document, in dots.
 *   - TEXT uses the browser's monospace font stretched to TSPL's per-font
 *     advance width via `textLength`, so line LENGTH and truncation are
 *     exact even though glyph shapes differ from the printer's ROM font.
 *   - The QR is a real symbol (the `qrcode` package, same ECC + payload).
 *     The firmware does its own encoding, so module patterns can differ;
 *     version/size agree via the shared capacity tables.
 *   - BARCODE renders as stylized stripes of the correct overall WIDTH
 *     (11 modules/char + 35 overhead), not a scannable Code 128 — the
 *     printed one comes from the firmware.
 */
/** TSPL internal font cell sizes in dots, per the TSC manual; 1–5 confirmed
 *  by the stage-03 hardware probe. 6–8 are approximations. */
const FONT_DOTS = {
    "1": { w: 8, h: 12 },
    "2": { w: 12, h: 20 },
    "3": { w: 16, h: 24 },
    "4": { w: 24, h: 32 },
    "5": { w: 32, h: 48 },
    "6": { w: 14, h: 19 },
    "7": { w: 21, h: 27 },
    "8": { w: 14, h: 25 },
};
/** Deterministic pseudo-Code128 stripe pattern so the preview's barcode
 *  LOOKS like a barcode of the right width without pretending to scan. */
function stripePattern(content, modules) {
    const bars = [];
    let seed = 0;
    for (let i = 0; i < content.length; i++)
        seed = (seed * 31 + content.charCodeAt(i)) >>> 0;
    for (let m = 0; m < modules; m++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        bars.push(m < 2 || m >= modules - 2 ? true : (seed >>> 16) % 3 !== 0);
    }
    return bars;
}
export default function TsplLabelPreview({ doc, ariaLabel }) {
    const widthDots = mmToDots(doc.spec.widthMm, doc.spec.dpi);
    const heightDots = mmToDots(doc.spec.heightMm, doc.spec.dpi);
    // QR data URLs render async (the qrcode package is Promise-based), keyed by
    // payload+ecc so a re-render with the same QR reuses the resolved image.
    const [qrImages, setQrImages] = useState({});
    const qrCommands = doc.commands.filter((c) => c.kind === "qrcode");
    const qrKeys = qrCommands.map((q) => `${q.ecc}:${q.content}`).join("\0");
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const next = {};
            for (const q of qrCommands) {
                const key = `${q.ecc}:${q.content}`;
                try {
                    // margin: 0 — the document's x/y is the SYMBOL origin (the
                    // template reserves the quiet zone as separate whitespace), so a
                    // library-drawn margin would double it up.
                    next[key] = await QRCode.toDataURL(q.content, {
                        errorCorrectionLevel: q.ecc,
                        margin: 0,
                        scale: 4,
                    });
                }
                catch {
                    /* payload the lib can't encode — the slot renders as an outline */
                }
            }
            if (!cancelled)
                setQrImages(next);
        })();
        return () => {
            cancelled = true;
        };
        // qrKeys is the serialized dependency of everything the loop reads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [qrKeys]);
    return (<svg viewBox={`0 0 ${widthDots} ${heightDots}`} role="img" aria-label={ariaLabel} className="w-full h-auto max-h-[60vh] bg-white rounded border border-border dark:border-border">
      {doc.commands.map((cmd, i) => {
            switch (cmd.kind) {
                case "text": {
                    const font = FONT_DOTS[cmd.font] ?? FONT_DOTS["3"];
                    const w = font.w * cmd.xScale;
                    const h = font.h * cmd.yScale;
                    return (<text key={i} x={cmd.x} y={cmd.y} fontSize={h} fontFamily="ui-monospace, Menlo, Consolas, monospace" dominantBaseline="text-before-edge" textLength={cmd.content.length * w} lengthAdjust="spacingAndGlyphs" fill="#111" xmlSpace="preserve" transform={cmd.rotation ? `rotate(${cmd.rotation} ${cmd.x} ${cmd.y})` : undefined}>
                {cmd.content}
              </text>);
                }
                case "box":
                    return (<rect key={i} x={cmd.x0 + cmd.thickness / 2} y={cmd.y0 + cmd.thickness / 2} width={cmd.x1 - cmd.x0 - cmd.thickness} height={cmd.y1 - cmd.y0 - cmd.thickness} fill="none" stroke="#111" strokeWidth={cmd.thickness}/>);
                case "bar":
                    return <rect key={i} x={cmd.x} y={cmd.y} width={cmd.width} height={cmd.height} fill="#111"/>;
                case "reverse":
                    // The printer XORs the region; approximating as a translucent
                    // dark overlay keeps underlying text visible like the print.
                    return (<rect key={i} x={cmd.x} y={cmd.y} width={cmd.width} height={cmd.height} fill="#111" opacity={0.75}/>);
                case "qrcode": {
                    const modules = qrModuleCount(cmd.content, cmd.ecc);
                    const size = (modules ?? 21) * cmd.cell;
                    const img = qrImages[`${cmd.ecc}:${cmd.content}`];
                    return img ? (<image key={i} href={img} x={cmd.x} y={cmd.y} width={size} height={size} preserveAspectRatio="none" style={{ imageRendering: "pixelated" }}/>) : (<rect key={i} x={cmd.x} y={cmd.y} width={size} height={size} fill="none" stroke="#999" strokeDasharray="8 6"/>);
                }
                case "barcode": {
                    const modules = 11 * cmd.content.length + 35;
                    const bars = stripePattern(cmd.content, modules);
                    return (<g key={i}>
                {bars.map((on, m) => on ? (<rect key={m} x={cmd.x + m * cmd.narrow} y={cmd.y} width={cmd.narrow} height={cmd.height} fill="#111"/>) : null)}
                {cmd.humanReadable !== 0 && (<text x={cmd.x + (modules * cmd.narrow) / 2} y={cmd.y + cmd.height + 4} fontSize={20} fontFamily="ui-monospace, Menlo, Consolas, monospace" dominantBaseline="text-before-edge" textAnchor="middle" fill="#111">
                    {cmd.content}
                  </text>)}
              </g>);
                }
                case "bitmap":
                    return (<rect key={i} x={cmd.x} y={cmd.y} width={cmd.widthBytes * 8} height={cmd.heightDots} fill="#ccc"/>);
                default:
                    return null;
            }
        })}
    </svg>);
}
