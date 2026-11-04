/**
 * Aturan MURNI pesanan konsinyasi LAMA yang cadangan stoknya masih ditahan (keputusan pemilik
 * no. 9, 2026-11-01). Tanpa impor sama sekali: komponen klien boleh memakainya, dan dites tanpa
 * basis data. Pemuatnya di `pesanan-lama.ts`, penulisnya di `pesanan-lama-writer.ts`.
 *
 * Pesanan seperti itu disetujui dengan aturan tim yang paling awal (persetujuan hanya
 * MENCADANGKAN, qtyOnHand tidak dikurangi), sebelum alur pengiriman per antaran sampai ke
 * produksi. Barangnya biasanya sudah lama sampai di toko; sistem masih menghitungnya di gudang
 * sendiri (dicadangkan) dan belum di toko. Yang mengisi "sudah sampai" hanya orang DI toko:
 * SPG toko itu, atau — untuk toko tanpa SPG — salesman pemegang toko yang sedang check-in di
 * sana. Kantor tidak pernah mengonfirmasi; kantor hanya boleh menutup sisanya "tidak jadi dikirim".
 */

export const KUNCI_PESANAN_LAMA_SEBELUM = "konsi.pesananLamaSebelum";

/**
 * Saat alur pengiriman per antaran sampai ke produksi: merge PR #318
 * (`20260923000000_konsi_transfer_at_shipment_completion`) ke master, 2026-09-23 23:50:47 WIB,
 * dibaca dari riwayat first-parent master. Setiap push ke master dirilis otomatis, dan aplikasi
 * baru baru melayani SESUDAH rilisnya selesai, jadi tidak ada pesanan aturan baru yang disetujui
 * sebelum saat ini. Pesanan yang disetujui sesudahnya memakai alur pengiriman biasa.
 */
export const BAWAAN_PESANAN_LAMA_SEBELUM = new Date("2026-09-23T16:50:47.000Z");

/**
 * `SystemSetting["konsi.pesananLamaSebelum"]`: tanggal-waktu ISO (`2026-09-23T16:50:47Z`, dengan
 * zona waktu) atau tanggal saja (`2026-09-24` = tengah malam WIB). Isian kosong atau tidak terbaca
 * kembali ke bawaan — batas ini hanya menyaring, jadi salah ketik tidak boleh membuka tombol
 * "sudah sampai" untuk pesanan baru.
 */
export function bacaBatasPesananLama(nilai: string | null | undefined): Date {
  const mentah = typeof nilai === "string" ? nilai.trim() : "";
  if (mentah === "") return BAWAAN_PESANAN_LAMA_SEBELUM;
  if (/^\d{4}-\d{2}-\d{2}$/.test(mentah)) {
    const d = new Date(`${mentah}T00:00:00+07:00`);
    if (Number.isNaN(d.getTime())) return BAWAAN_PESANAN_LAMA_SEBELUM;
    // Tanggal yang bergulir (2026-02-31 → 3 Maret) bukan tanggal yang dimaksud.
    const balik = new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
    return balik !== mentah ? BAWAAN_PESANAN_LAMA_SEBELUM : d;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(mentah)) return BAWAAN_PESANAN_LAMA_SEBELUM;
  const d = new Date(mentah);
  return Number.isNaN(d.getTime()) ? BAWAAN_PESANAN_LAMA_SEBELUM : d;
}

/**
 * Sisa satu baris pesanan lama yang masih bisa dikonfirmasi sampai: yang belum diserahkan ke toko
 * menurut barisnya (dipesan − terkirim − dibatalkan) DAN yang masih ditahan cadangannya (qty −
 * terpakai). Yang lebih kecil yang dipakai — keduanya seharusnya sama, dan bila tidak, penulis
 * hanya boleh menarik yang benar-benar masih dicadangkan. Tanpa cadangan RESERVED = 0.
 */
export function sisaBarisLama(
  baris: { qty: number; deliveredQty: number; cancelledQty: number },
  cadangan: { qty: number; consumedQty: number } | null,
): number {
  if (!cadangan) return 0;
  const menurutBaris = baris.qty - baris.deliveredQty - baris.cancelledQty;
  const menurutCadangan = Math.floor(cadangan.qty - cadangan.consumedQty);
  const sisa = Math.min(menurutBaris, menurutCadangan);
  return Number.isFinite(sisa) && sisa > 0 ? sisa : 0;
}

/** Siapa yang mengonfirmasi barang pesanan lama sudah sampai di toko ini. */
export type PeranPenerimaLama = "SPG" | "SALESMAN";

/**
 * Siapa yang DIHARAPKAN mengonfirmasi, untuk layar kantor dan HP: SPG toko (toko ber-SPG), salesman
 * pemegang toko (toko tanpa SPG), atau tidak ada — toko tanpa SPG dan tanpa pemegang, yang hanya
 * bisa dibereskan dengan memberi tokonya pemegang (atau menutup sisanya).
 */
export type PenerimaDiharapkan = PeranPenerimaLama | "TANPA_PENERIMA";

export function penerimaDiharapkan(toko: { jumlahSpg: number; pemegangTokoId: string | null }): PenerimaDiharapkan {
  if (toko.jumlahSpg > 0) return "SPG";
  return toko.pemegangTokoId ? "SALESMAN" : "TANPA_PENERIMA";
}

/**
 * Peran pengguna ini untuk toko pesanan, atau null bila ia tidak boleh mengonfirmasi:
 * - SPG yang toko tetapnya toko ini;
 * - salesman pemegang toko (`Store.salesmanId`), HANYA bila toko itu tidak punya SPG — toko ber-SPG
 *   dikonfirmasi SPG-nya, yang menghitung barangnya setiap hari.
 * Orang kantor tidak pernah lolos: ia bukan SPG toko itu dan bukan pemegangnya. SPG toko lain juga
 * tidak — toko tetapnya bukan toko ini.
 */
export function peranPenerimaLama(f: {
  userId: string;
  tokoTetapPengguna: string | null;
  storeId: string;
  jumlahSpg: number;
  pemegangTokoId: string | null;
}): PeranPenerimaLama | null {
  if (!f.userId || !f.storeId) return null;
  if (f.tokoTetapPengguna === f.storeId) return "SPG";
  if (f.tokoTetapPengguna) return null;
  if (f.jumlahSpg === 0 && f.pemegangTokoId === f.userId) return "SALESMAN";
  return null;
}

export type JawabanSampai = { lineId: string; qty: number };

export type PenolakanHitungan = "JUMLAH_TIDAK_VALID" | "LEBIH_DARI_SISA" | "KOSONG";

/**
 * Hitungan dari HP terhadap sisa per baris:
 * - SETIAP baris yang masih bersisa harus dijawab tepat sekali, dengan bilangan bulat ≥ 0, dan
 *   tidak boleh ada baris di luar pesanan ini — layar yang tertinggal dari pesanannya ditolak,
 *   bukan ditebak (`JUMLAH_TIDAK_VALID`);
 * - lebih dari sisanya DITOLAK (`LEBIH_DARI_SISA`): barang yang tidak pernah dicadangkan untuk toko
 *   ini tidak bisa "sampai" lewat pesanan ini;
 * - semuanya nol (`KOSONG`): tidak ada yang sampai — itu bukan konfirmasi; sisanya tetap terbuka
 *   untuk konfirmasi berikutnya atau ditutup kantor "tidak jadi dikirim".
 * Kurang dari sisa BOLEH: sisanya tetap dicadangkan, tanpa catatan barang hilang — riwayat barang
 * pesanan lama tidak bisa diketahui, jadi kekurangannya bukan kehilangan yang bisa dibuktikan.
 */
export function periksaHitunganSampai(
  sisa: ReadonlyMap<string, number>,
  jawaban: readonly JawabanSampai[],
): { ok: true; baris: JawabanSampai[]; total: number } | { ok: false; alasan: PenolakanHitungan } {
  const dilihat = new Set<string>();
  for (const j of jawaban) {
    if (typeof j?.lineId !== "string" || !sisa.has(j.lineId) || dilihat.has(j.lineId)) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
    if (!Number.isInteger(j.qty) || j.qty < 0) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
    dilihat.add(j.lineId);
  }
  if (dilihat.size !== sisa.size) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };
  for (const j of jawaban) {
    if (j.qty > (sisa.get(j.lineId) ?? 0)) return { ok: false, alasan: "LEBIH_DARI_SISA" };
  }
  const baris = jawaban.filter((j) => j.qty > 0).map((j) => ({ lineId: j.lineId, qty: j.qty }));
  const total = baris.reduce((n, b) => n + b.qty, 0);
  if (total === 0) return { ok: false, alasan: "KOSONG" };
  return { ok: true, baris, total };
}

/** Panjang alasan "tidak jadi dikirim" — kolom `FieldSalesOrder.closeReason` bertipe teks. */
export const BATAS_ALASAN_BATAL_KIRIM = 500;

/**
 * Saat angka hitungan sebuah opname toko versi tim (`StoreStocktake`) mewakili rak: `countFinishedAt`,
 * atau `approvedAt` untuk hitungan yang disimpan sebelum kolom itu ada — patokan yang sama dengan
 * `COUNTED_SINCE_MOVE` di transfer antar toko. Bukan `countedAt`: itu saat dokumennya DIBUKA.
 * Null = belum ada angka hitungan.
 */
export function saatHitungOpnameToko(o: { countFinishedAt: Date | null; approvedAt: Date | null }): Date | null {
  return o.countFinishedAt ?? o.approvedAt;
}

/**
 * Saat opname toko paling akhir yang SESUDAH `sejak` (pesanan disetujui), atau null bila tidak ada —
 * untuk peringatan "isi 0 kalau barangnya sudah ikut terhitung" di HP. Saat yang sama dengan
 * `sejak` tidak dihitung: hitungan itu belum bisa memuat barang yang baru disetujui.
 */
export function opnameTokoTerakhirSesudah(sejak: Date, saat: ReadonlyArray<Date | null | undefined>): Date | null {
  let terakhir: Date | null = null;
  for (const s of saat) {
    if (!s || Number.isNaN(s.getTime()) || s.getTime() <= sejak.getTime()) continue;
    if (!terakhir || s.getTime() > terakhir.getTime()) terakhir = s;
  }
  return terakhir;
}
