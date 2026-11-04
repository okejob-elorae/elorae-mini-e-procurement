"use client";

import { cn } from "@/lib/utils";

/**
 * Batang perbandingan sederhana (alasan kunjungan, tanda check-in). Bukan
 * grafik bersumbu: yang dicari mata adalah alasan yang menonjol, bukan angka
 * pastinya — angkanya ditulis di sebelah kanan.
 */
export function GrafikBatang({
  baris,
  kosong,
}: {
  baris: { kunci: string; label: string; jumlah: number; nada?: "hijau" | "kuning" | "utama" }[];
  kosong: string;
}) {
  if (baris.length === 0) return <p className="text-sm text-muted-foreground">{kosong}</p>;
  const puncak = Math.max(1, ...baris.map((b) => b.jumlah));
  const total = baris.reduce((s, b) => s + b.jumlah, 0);
  return (
    <ul className="space-y-3">
      {baris.map((b) => (
        <li key={b.kunci} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{b.label}</span>
            <span className="tabular-nums">
              {b.jumlah}
              <span className="ml-2 text-xs text-muted-foreground">{Math.round((b.jumlah / Math.max(1, total)) * 100)}%</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                b.nada === "hijau" ? "bg-emerald-500" : b.nada === "kuning" ? "bg-amber-500" : "bg-primary",
              )}
              style={{ width: `${Math.max(2, (b.jumlah / puncak) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
