"use client";

import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import type { SesiSeret } from "./useSeretUrut";

/**
 * Label kecil yang mengikuti penunjuk selama seretan (`useSeretUrut`), supaya
 * jari yang menutupi butir tetap tahu apa yang sedang dibawa. Dipasang ke
 * `document.body`: di dalam dialog, induk yang di-`transform` membuat
 * `position: fixed` tidak lagi menempel ke layar. Tidak pernah menangkap
 * pointer, jadi `elementFromPoint` tetap melihat daftar di bawahnya.
 */
export function HantuSeret({
  sesi,
  label,
  keterangan,
}: {
  sesi: SesiSeret<unknown> | null;
  label: string;
  /** Baris kedua, mis. "Posisi 2 dari 5". */
  keterangan?: string | null;
}) {
  if (!sesi || typeof document === "undefined") return null;
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[100] max-w-[260px] rounded-md border bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-lg"
      style={{ transform: `translate(${sesi.x + 14}px, ${sesi.y + 14}px)` }}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </span>
      {keterangan ? <span className="block text-xs text-muted-foreground">{keterangan}</span> : null}
    </div>,
    document.body,
  );
}
