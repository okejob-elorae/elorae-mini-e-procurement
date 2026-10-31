import { idKomisiSpg, SUMBER_OPERASIONAL, type SumberOperasional } from "./aturan";

/*
 * Kait pasca-commit untuk aksi server — KHUSUS SERVER, TIDAK PERNAH MELEMPAR.
 * Dipanggil SESUDAH penulis dokumennya berhasil; jurnal yang gagal menjadi
 * `JOURNAL_PENDING`, tidak pernah menggagalkan aksinya.
 *
 * Mesin jurnalnya dimuat saat dipanggil (impor dinamis), bukan saat modul aksi
 * dimuat: aksi bisa diuji dengan tiruan `@elorae/db` yang tidak memuat seluruh
 * klien, dan kegagalan memuat pun tertangkap di sini.
 *
 * Yang menyentuh apa:
 * - kiriman titipan / pesanan konsinyasi disetujui → jurnal pindah ke toko;
 * - hitungan gudang dari toko konsinyasi → lewat `kaitReturBerubah` (lapangan);
 * - kunci/buka kunci siklus → jurnal siklus + gaji SPG siklus itu;
 * - gaji SPG dibayar, pembayaran toko dicatat/dibatalkan → jurnal masing-masing;
 * - komisi SPG toko putus ditetapkan/dibayar;
 * - keputusan barang hilang (putuskan/ubah/batal), potongan beban sales;
 * - keputusan gudang rusak, penyesuaian stok manual, retur pemasok selesai;
 * - biaya perjalanan disetujui/dibayar.
 */

/**
 * Di bawah vitest kait ini MATI kecuali tesnya menyalakannya sendiri
 * (`JURNAL_OPERASIONAL_KAIT_UJI=1`): tes aksi lain (biaya perjalanan,
 * penyesuaian stok, konsinyasi, …) memanggil aksi aslinya terhadap basis data
 * bersama, dan kait yang menyala di sana memposting jurnal ke akun dev atau
 * menulis `JOURNAL_PENDING` untuk dokumen yang lalu dihapus tesnya — sisa
 * yang tidak dibersihkan siapa pun. Sama dengan kait barang hilang
 * (`catatHilangDari*`) yang juga dilewati di bawah vitest.
 */
function kaitMati(): boolean {
  return Boolean(process.env.VITEST) && process.env.JURNAL_OPERASIONAL_KAIT_UJI !== "1";
}

function aman(nama: string, fn: () => Promise<unknown>): Promise<void> {
  if (kaitMati()) return Promise.resolve();
  return fn().then(
    () => undefined,
    (e) => console.error(`[jurnal-operasional] kait ${nama} gagal`, e),
  );
}

async function posting(sumber: SumberOperasional, id: string, userId: string) {
  const { postingJurnalOperasionalAman } = await import("./tertunda");
  return postingJurnalOperasionalAman(sumber, id, userId);
}

function satu(nama: string, sumber: SumberOperasional, id: string | null | undefined, userId: string): Promise<void> {
  if (!id) return Promise.resolve();
  return aman(nama, () => posting(sumber, id, userId));
}

export function kaitKirimTitipan(shipmentId: string, userId: string): Promise<void> {
  return satu("kirim titipan", SUMBER_OPERASIONAL.KIRIM_KONSI, shipmentId, userId);
}

/** Pesanan lapangan disetujui — hanya konsinyasi yang dijurnal (penulisnya menyaring). */
export function kaitPesananKonsiDisetujui(orderId: string, userId: string): Promise<void> {
  return satu("pesanan konsinyasi", SUMBER_OPERASIONAL.PESANAN_KONSI, orderId, userId);
}

/** Hitungan gudang (NRI) berubah — pasangan konsinyasi dari jurnal retur toko putus. */
export function kaitReturKonsi(nriIds: readonly string[], userId: string): Promise<void> {
  return aman("retur konsinyasi", async () => {
    for (const id of new Set(nriIds.filter(Boolean))) await posting(SUMBER_OPERASIONAL.RETUR_KONSI, id, userId);
  });
}

/** Siklus dikunci / kuncinya dibuka: penjualan siklus + gaji SPG siklus itu. */
export function kaitSiklusKonsi(cycleId: string, userId: string): Promise<void> {
  return aman("siklus konsinyasi", async () => {
    await posting(SUMBER_OPERASIONAL.SIKLUS_KONSI, cycleId, userId);
    await posting(SUMBER_OPERASIONAL.KOMISI_KONSI, cycleId, userId);
  });
}

export function kaitBayarGajiKonsi(commissionId: string, userId: string): Promise<void> {
  return satu("gaji SPG konsinyasi", SUMBER_OPERASIONAL.BAYAR_GAJI_KONSI, commissionId, userId);
}

export function kaitBayarTokoKonsi(paymentId: string, userId: string): Promise<void> {
  return satu("pembayaran toko konsinyasi", SUMBER_OPERASIONAL.BAYAR_TOKO_KONSI, paymentId, userId);
}

export function kaitKomisiSpg(storeId: string, periode: string, userId: string): Promise<void> {
  return aman("komisi SPG", async () => {
    await posting(SUMBER_OPERASIONAL.KOMISI_SPG, idKomisiSpg(storeId, periode), userId);
  });
}

export function kaitBayarKomisiSpg(commissionId: string, userId: string): Promise<void> {
  return satu("bayar komisi SPG", SUMBER_OPERASIONAL.BAYAR_KOMISI_SPG, commissionId, userId);
}

export function kaitBarangHilang(lossId: string, userId: string): Promise<void> {
  return satu("barang hilang", SUMBER_OPERASIONAL.BARANG_HILANG, lossId, userId);
}

/** Potongan beban SALES yang baru ditulis (`tandaiSalesDipotong`): satu jurnal per baris potongan. */
export function kaitPotongSales(refId: string, userId: string): Promise<void> {
  return aman("potongan sales", async () => {
    const { prisma } = await import("@elorae/db");
    const baris = await prisma.stockLossDeduction.findMany({ where: { refType: "KomisiSalesman", refId }, select: { id: true } });
    for (const b of baris) await posting(SUMBER_OPERASIONAL.POTONG_SALES, b.id, userId);
  });
}

export function kaitGudangRusak(gerakId: string, userId: string): Promise<void> {
  return satu("gudang rusak", SUMBER_OPERASIONAL.GUDANG_RUSAK, gerakId, userId);
}

export function kaitStokManual(adjustmentId: string, userId: string): Promise<void> {
  return satu("stok manual", SUMBER_OPERASIONAL.STOK_MANUAL, adjustmentId, userId);
}

export function kaitReturPemasok(returnId: string, userId: string): Promise<void> {
  return satu("retur pemasok", SUMBER_OPERASIONAL.RETUR_PEMASOK, returnId, userId);
}

/** Biaya perjalanan disetujui atau dibayar: jurnal persetujuan dulu (bila belum ada), lalu pembayaran. */
export function kaitBiayaPerjalanan(claimId: string, keadaan: "DISETUJUI" | "DIBAYAR", userId: string): Promise<void> {
  return aman("biaya perjalanan", async () => {
    await posting(SUMBER_OPERASIONAL.BIAYA_PERJALANAN, claimId, userId);
    if (keadaan === "DIBAYAR") await posting(SUMBER_OPERASIONAL.BAYAR_BIAYA_PERJALANAN, claimId, userId);
  });
}
