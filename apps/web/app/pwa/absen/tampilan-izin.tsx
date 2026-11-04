import { CalendarOff, Palmtree, Thermometer } from "lucide-react";
import type { JenisIzin, StatusIzin } from "@/lib/salesman/izin";

/**
 * Ikon jenis dan warna status izin/sakit/cuti — dipakai HP, laporan absensi
 * kantor, dan antrean izin, supaya "Sakit" dan "Ditolak" terlihat sama di semua
 * tempat. Ikon lewat `switch` (bukan peta komponen) — lihat catatan yang sama
 * di `app/pwa/biaya/tampilan.tsx`.
 */
export function IkonJenisIzin({ jenis, className }: { jenis: string; className?: string }) {
  switch (jenis) {
    case "SAKIT":
      return <Thermometer className={className} aria-hidden />;
    case "CUTI":
      return <Palmtree className={className} aria-hidden />;
    default:
      return <CalendarOff className={className} aria-hidden />;
  }
}

/** Kelas pil jenis — hari izin di riwayat absen memakai warna yang sama. */
export const NADA_JENIS_IZIN: Record<JenisIzin, string> = {
  IZIN: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  SAKIT: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  CUTI: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
};

export const nadaJenisIzin = (j: string): string => NADA_JENIS_IZIN[j as JenisIzin] ?? "bg-muted text-muted-foreground";

export const NADA_STATUS_IZIN: Record<StatusIzin, string> = {
  DIAJUKAN: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DISETUJUI: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  DITOLAK: "bg-destructive/10 text-destructive",
  DIBATALKAN: "bg-muted text-muted-foreground",
};

export const nadaStatusIzin = (s: string): string => NADA_STATUS_IZIN[s as StatusIzin] ?? "bg-muted text-muted-foreground";
