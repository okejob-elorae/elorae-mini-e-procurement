import type { StatusTone } from "@/components/ui/status-pill";
import type { StatusReturPembeli } from "@/lib/spg/retur-pembeli-status";

/** Nada status laporan retur pembeli di layar kantor (daftar dan rincian). */
export const NADA_STATUS_RETUR_PEMBELI: Record<StatusReturPembeli, StatusTone> = {
  MENUNGGU: "waiting",
  DISETUJUI: "settled",
  DITOLAK: "attention",
  DIBATALKAN: "inactive",
};
