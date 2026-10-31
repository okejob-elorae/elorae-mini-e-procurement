import type { StatusTukar } from "@/lib/salesman/tukar-barang";

/**
 * Warna pil status tukar barang — dipakai HP dan layar kantor, supaya
 * "Disetujui" dan "Selesai" terlihat sama di kedua tempat.
 */
export const NADA_STATUS_TUKAR: Record<StatusTukar, string> = {
  DIAJUKAN: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DISETUJUI: "bg-primary/15 text-foreground",
  DITOLAK: "bg-destructive/10 text-destructive",
  SELESAI: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  DIBATALKAN: "bg-muted text-muted-foreground",
};

export const nadaStatusTukar = (s: string): string =>
  NADA_STATUS_TUKAR[s as StatusTukar] ?? "bg-muted text-muted-foreground";
