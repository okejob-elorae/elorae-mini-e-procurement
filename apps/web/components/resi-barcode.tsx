"use client";

import JsBarcode from "jsbarcode";
import { useEffect, useRef, useState } from "react";

const MODULE_WIDTH_PX = 1.6;
/* CODE128 needs a quiet zone of at least ten modules either side, or scanners miss the start/stop bars */
const QUIET_ZONE_PX = MODULE_WIDTH_PX * 10;

type Props = {
  value: string;
  /** Bar height in px; module width stays fixed so the code stays scannable. */
  height?: number;
  className?: string;
};

/**
 * Scannable CODE128 rendering of a resi number. Couriers print resi as CODE128, and it covers
 * every printable ASCII character, so one format fits every marketplace. A value JsBarcode
 * refuses hides the svg rather than rendering a code that scans wrong; callers always print
 * the resi as text beside it. The svg stays mounted while hidden so a later valid value can
 * still render into it.
 */
export function ResiBarcode({ value, height = 48, className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [valid, setValid] = useState(true);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    let ok = true;
    try {
      JsBarcode(svg, value, {
        format: "CODE128",
        height,
        width: MODULE_WIDTH_PX,
        margin: 0,
        marginLeft: QUIET_ZONE_PX,
        marginRight: QUIET_ZONE_PX,
        displayValue: false,
        valid: (result) => {
          ok = result;
        },
      });
    } catch {
      ok = false;
    }
    setValid(ok);
  }, [value, height]);

  const visibility = valid ? "" : "hidden";
  const classes = `h-auto max-w-full ${visibility} ${className ?? ""}`;
  return <svg ref={svgRef} role="img" aria-label={value} className={classes} />;
}
