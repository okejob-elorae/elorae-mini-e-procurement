import type { StatusTone } from "@/components/ui/status-pill";
import type { KeadaanBebanSpg } from "@/lib/spg/beban-spg";
import type { KeadaanUangRetur, StatusReturPembeli } from "@/lib/spg/retur-pembeli-status";

/** Nada status laporan retur pembeli di layar kantor (daftar dan rincian). */
export const NADA_STATUS_RETUR_PEMBELI: Record<StatusReturPembeli, StatusTone> = {
  MENUNGGU: "waiting",
  DISETUJUI: "settled",
  DITOLAK: "attention",
  DIBATALKAN: "inactive",
};

/** Nada keadaan uang pembeli: uang yang telanjur keluar atau dibebankan menarik perhatian. */
export const NADA_UANG_RETUR_PEMBELI: Record<KeadaanUangRetur, StatusTone> = {
  MENUNGGU_BELUM: "inactive",
  MENUNGGU_SUDAH: "attention",
  SILAKAN_KEMBALIKAN: "waiting",
  SUDAH_DIKEMBALIKAN: "settled",
  JANGAN_KEMBALIKAN: "inactive",
  DIBEBANKAN: "attention",
  DITARIK: "inactive",
};

/** Nada keadaan beban SPG di kartu beban. */
export const NADA_BEBAN_SPG: Record<KeadaanBebanSpg, StatusTone> = {
  TERBUKA: "attention",
  DIUTANGKAN: "attention",
  MENUNGGU_KEPUTUSAN_BARANG: "waiting",
  DIBELI_SPG: "settled",
  KEMBALI_STOK: "settled",
  BATAL: "inactive",
};
