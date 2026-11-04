import type { StatusPermintaan } from "@/lib/spg/kantor-queries";

/** Warna lencana status permintaan SPG — sama dengan daftar permintaan di layar stok SPG. */
export function nadaStatusPermintaan(status: StatusPermintaan): string {
  switch (status) {
    case "BARU":
      return "bg-primary/15 text-primary";
    case "DIPROSES":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "SELESAI":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    case "DITOLAK":
      return "bg-destructive/15 text-destructive";
  }
}
