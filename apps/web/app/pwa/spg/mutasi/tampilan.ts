import type { HasilMutasiAksi } from "@/app/actions/spg-mutasi";
import type { TerjemahDinamis } from "@/lib/i18n/dinamis";
import type { StatusMutasi } from "@/lib/spg/mutasi-aturan";

/**
 * Warna pil status mutasi — dipakai HP dan layar kantor, supaya "Dikirim" dan
 * "Diterima" terlihat sama di kedua tempat.
 */
export const NADA_STATUS_MUTASI: Record<StatusMutasi, string> = {
  DIAJUKAN: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DISETUJUI: "bg-primary/15 text-foreground",
  DIKIRIM: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  DITERIMA: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  DITOLAK: "bg-destructive/10 text-destructive",
  DIBATALKAN: "bg-muted text-muted-foreground",
  DIKEMBALIKAN: "bg-muted text-muted-foreground",
};

export const nadaStatusMutasi = (s: string): string => NADA_STATUS_MUTASI[s as StatusMutasi] ?? "bg-muted text-muted-foreground";

/** Kode galat aksi mutasi → kalimat. Siklus terkunci menyebut nomornya. */
export function pesanGagalMutasi(r: { code: string; noKonsi?: string[]; kurang?: Extract<HasilMutasiAksi, { ok: false }>["kurang"] }, td: TerjemahDinamis): string {
  if (r.code === "SIKLUS_TERKUNCI") return td("err.SIKLUS_TERKUNCI", { siklus: (r.noKonsi ?? []).join(", ") });
  if (r.code === "SALDO_KURANG") {
    return td("err.SALDO_KURANG", { baris: (r.kurang ?? []).map((k) => td("kurangBaris", { nama: k.productName, tersedia: k.tersedia, qty: k.qty })).join(", ") });
  }
  const dikenal = [
    "FORBIDDEN",
    "NO_ASSIGNED_STORE",
    "NO_ACTIVE_VISIT",
    "VALIDATION",
    "TIDAK_DITEMUKAN",
    "SUDAH_DIPUTUSKAN",
    "BELUM_DISETUJUI",
    "TANPA_KUNJUNGAN",
    "KUNCI_WAJIB",
    "KUNCI_DIPAKAI",
    "MUTASI_NONAKTIF",
    "ALASAN_WAJIB",
    "TEKS_TERLALU_PANJANG",
    "TOKO_TIDAK_DITEMUKAN",
    "TUJUAN_TIDAK_DITEMUKAN",
    "TUJUAN_SAMA",
    "ARAH_DITOLAK",
    "TUJUAN_TANPA_SPG",
    "BUKU_BELUM_DIMULAI",
    "TANPA_BARIS",
    "TERLALU_BANYAK_BARIS",
    "JUMLAH_TIDAK_VALID",
    "BARANG_TIDAK_DIKENAL",
    "VARIAN_TIDAK_DIKENAL",
    "MILIK_SENDIRI",
    "TIDAK_ADA_SELISIH",
    "KIRIMAN_TIDAK_DITEMUKAN",
    "SUDAH_DITERIMA",
    "LEBIH_DARI_DIKIRIM",
    "MASIH_DITUNGGU_SPG",
    // Dari antrean HP (ajuan / tanda dikirim yang dicatat tanpa sinyal).
    "KUNJUNGAN_TIDAK_SAH",
    "KUNJUNGAN_DITOLAK",
    "WAKTU_TIDAK_VALID",
    "MUTASI_DITOLAK",
    "MUTASI_DIBATALKAN",
    "SUDAH_DIKIRIM",
    "AJUAN_DITOLAK",
    "AJUAN_TIDAK_ADA",
  ];
  return td(dikenal.includes(r.code) ? `err.${r.code}` : "err.GENERIC");
}
