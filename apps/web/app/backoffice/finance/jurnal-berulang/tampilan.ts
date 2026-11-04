import type { StatusTone } from "@/components/ui/status-pill";

/** Nada pil keadaan templat (`jurnalBerulang.keadaan.<KEADAAN>`). Murni. */
export function nadaKeadaanTemplat(k: string): StatusTone {
  switch (k) {
    case "AKTIF":
      return "settled";
    case "MENUNGGU_PERSETUJUAN":
      return "waiting";
    case "DIHENTIKAN":
      return "inactive";
    default:
      return "inactive";
  }
}
