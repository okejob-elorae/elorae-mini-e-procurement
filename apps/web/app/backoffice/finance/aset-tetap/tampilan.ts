import type { StatusTone } from "@/components/ui/status-pill";

/*
 * Nada pil status aset dan keadaan bulan jadwal penyusutan. Murni, aman untuk
 * klien. Label: `asetTetap.statusAset.<STATUS>` / `asetTetap.keadaan.<KEADAAN>`.
 */

export function nadaStatusAset(status: string): StatusTone {
  if (status === "ACTIVE") return "settled";
  if (status === "DISPOSED") return "inactive";
  return "attention";
}

export function nadaKeadaanBulan(keadaan: string): StatusTone {
  switch (keadaan) {
    case "DIPOSTING":
      return "settled";
    case "BELUM":
      return "waiting";
    case "DITUTUP":
      return "attention";
    case "AKAN_DATANG":
      return "progress";
    default:
      return "inactive";
  }
}
