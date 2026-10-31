/**
 * Hasil kunjungan salesman — murni, satu tempat untuk server (check-out), HP
 * (lembar "Kenapa tidak ada transaksi?") dan layar kantor (riwayat kunjungan).
 *
 * Kunjungan yang menghasilkan transaksi dicatat `TRANSAKSI` OTOMATIS oleh
 * server — salesman tidak pernah memilihnya sendiri, supaya angka "kunjungan
 * yang jadi transaksi" tidak bisa diklaim tanpa dokumen di belakangnya.
 * `TRANSAKSI_TERTUNDA` dipakai bila dokumennya masih di antrean HP (tanpa sinyal)
 * saat check-out: server belum bisa membuktikannya, jadi dibedakan dan kantor
 * bisa mencocokkannya nanti.
 *
 * SPG TIDAK punya hasil kunjungan: check-in mereka adalah absensi di toko tetap.
 */

export const ALASAN_TANPA_TRANSAKSI = [
  "TOKO_TUTUP",
  "PEMILIK_TIDAK_ADA",
  "STOK_MASIH_BANYAK",
  "HARGA",
  "PESAING",
  "MASALAH_BAYAR",
  "PESAN_LEWAT_WA",
  "KUNJUNGAN_RUTIN",
  "LAINNYA",
] as const;

export type AlasanTanpaTransaksi = (typeof ALASAN_TANPA_TRANSAKSI)[number];
export type KodeHasil = "TRANSAKSI" | "TRANSAKSI_TERTUNDA" | AlasanTanpaTransaksi;

/** Urutan tampil: transaksi dulu, lalu alasan sesuai daftar. */
export const KODE_HASIL: readonly KodeHasil[] = ["TRANSAKSI", "TRANSAKSI_TERTUNDA", ...ALASAN_TANPA_TRANSAKSI];

/** Alasan yang wajib disertai catatan — "lainnya" tanpa penjelasan tidak berarti apa-apa. */
export const ALASAN_WAJIB_CATATAN: readonly AlasanTanpaTransaksi[] = ["LAINNYA"];

export const CATATAN_HASIL_MAKS = 500;

export function adalahAlasan(x: unknown): x is AlasanTanpaTransaksi {
  return typeof x === "string" && (ALASAN_TANPA_TRANSAKSI as readonly string[]).includes(x);
}

export function adalahKodeHasil(x: unknown): x is KodeHasil {
  return typeof x === "string" && (KODE_HASIL as readonly string[]).includes(x);
}

export type MasukanHasil = {
  /** Pengguna ber-`assignedStoreId` — check-in = absensi, bukan kunjungan jualan. */
  spg: boolean;
  /** Server menemukan dokumen transaksi dari kunjungan ini. */
  adaTransaksi: boolean;
  /** HP melaporkan dokumen kunjungan ini masih di antrean luring. */
  transaksiTertunda: boolean;
  /** Setelan pemilik `salesman.hasilKunjungan.alasanWajib`. */
  alasanWajib: boolean;
  /** Dikirim HP — belum dipercaya, diperiksa di sini. */
  alasan?: unknown;
  catatan?: unknown;
};

export type PutusanHasil =
  | { ok: true; outcome: KodeHasil | null; outcomeNote: string | null }
  | { ok: false; code: "HASIL_WAJIB" | "HASIL_TIDAK_SAH" | "CATATAN_WAJIB" };

const TANPA_HASIL: PutusanHasil = { ok: true, outcome: null, outcomeNote: null };

function rapikanCatatan(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim().slice(0, CATATAN_HASIL_MAKS);
  return t === "" ? null : t;
}

export function putuskanHasilCheckout(m: MasukanHasil): PutusanHasil {
  if (m.spg) return TANPA_HASIL;
  if (m.adaTransaksi) return { ok: true, outcome: "TRANSAKSI", outcomeNote: null };
  if (m.transaksiTertunda) return { ok: true, outcome: "TRANSAKSI_TERTUNDA", outcomeNote: null };

  const dikirim = m.alasan !== undefined && m.alasan !== null && m.alasan !== "";
  if (!dikirim) return m.alasanWajib ? { ok: false, code: "HASIL_WAJIB" } : TANPA_HASIL;
  if (!adalahAlasan(m.alasan)) return { ok: false, code: "HASIL_TIDAK_SAH" };

  const catatan = rapikanCatatan(m.catatan);
  if (ALASAN_WAJIB_CATATAN.includes(m.alasan) && catatan === null) return { ok: false, code: "CATATAN_WAJIB" };
  return { ok: true, outcome: m.alasan, outcomeNote: catatan };
}

type KeadaanAntre = "pending" | "syncing" | "failed";

/** Potongan antrean HP yang relevan — hanya kolom yang dibaca, supaya mudah diuji. */
export type AntreanTransaksi = {
  pesanan: { visitId: string | null; storeId: string; syncState: KeadaanAntre | string }[];
  klaim: { storeId: string; capturedAt: number; syncState: KeadaanAntre | string }[];
  retur: { storeId: string; capturedAt: number; syncState: KeadaanAntre | string }[];
};

/**
 * Apakah HP masih menyimpan transaksi dari kunjungan ini yang belum sampai ke
 * server. Pesanan terikat `visitId`; klaim bayar dan retur hanya punya toko,
 * jadi dibatasi waktu sejak check-in. Baris `failed` tidak dihitung — ia belum
 * tentu pernah sampai.
 */
export function adaTransaksiDiAntrean(
  antrean: AntreanTransaksi,
  acuan: { visitId: string; storeId: string; sejakMs: number },
): boolean {
  const hidup = (s: string) => s !== "failed";
  if (antrean.pesanan.some((p) => p.visitId === acuan.visitId && hidup(p.syncState))) return true;
  const cocok = (r: { storeId: string; capturedAt: number; syncState: string }) =>
    r.storeId === acuan.storeId && r.capturedAt >= acuan.sejakMs && hidup(r.syncState);
  return antrean.klaim.some(cocok) || antrean.retur.some(cocok);
}

export type KodeRingkasan = KodeHasil | "KOSONG";
export type RingkasanHasil = { total: number; transaksi: number; perKode: { kode: KodeRingkasan; jumlah: number }[] };

const URUT_RINGKASAN: readonly KodeRingkasan[] = [...KODE_HASIL, "KOSONG"];

/**
 * Ringkasan hasil kunjungan salesman yang sudah selesai. Kunjungan yang masih
 * terbuka dan absensi SPG tidak dihitung; hasil kosong atau kode tak dikenal
 * (mis. kunjungan sebelum fitur ini, atau ditutup otomatis) jadi `KOSONG`.
 */
export function ringkasHasil(kunjungan: { outcome: string | null; selesai: boolean; spg: boolean }[]): RingkasanHasil {
  const hitung = new Map<KodeRingkasan, number>();
  let total = 0;
  for (const k of kunjungan) {
    if (!k.selesai || k.spg) continue;
    total += 1;
    const kode: KodeRingkasan = adalahKodeHasil(k.outcome) ? k.outcome : "KOSONG";
    hitung.set(kode, (hitung.get(kode) ?? 0) + 1);
  }
  const transaksi = (hitung.get("TRANSAKSI") ?? 0) + (hitung.get("TRANSAKSI_TERTUNDA") ?? 0);
  const perKode = [...hitung.entries()]
    .map(([kode, jumlah]) => ({ kode, jumlah }))
    .sort((a, b) => b.jumlah - a.jumlah || URUT_RINGKASAN.indexOf(a.kode) - URUT_RINGKASAN.indexOf(b.kode));
  return { total, transaksi, perKode };
}
