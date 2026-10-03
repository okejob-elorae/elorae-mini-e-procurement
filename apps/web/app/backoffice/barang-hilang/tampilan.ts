import type { Penanggung, StatusHilang } from "@/lib/spg/hilang";

/** Warna lencana status barang hilang (kantor). */
export function nadaStatusHilang(s: StatusHilang): string {
  switch (s) {
    case "TERBUKA":
      return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
    case "DITETAPKAN":
      return "bg-sky-500/15 text-sky-800 dark:text-sky-300";
    case "SELESAI":
      return "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300";
    case "DIBATALKAN":
      return "bg-muted text-muted-foreground";
  }
}

export function nadaPenanggung(b: Penanggung): string {
  switch (b) {
    case "TOKO":
      return "bg-violet-500/15 text-violet-800 dark:text-violet-300";
    case "SPG":
      return "bg-rose-500/15 text-rose-800 dark:text-rose-300";
    case "SALES":
      return "bg-orange-500/15 text-orange-800 dark:text-orange-300";
    case "ELORAE":
      return "bg-muted text-muted-foreground";
  }
}
