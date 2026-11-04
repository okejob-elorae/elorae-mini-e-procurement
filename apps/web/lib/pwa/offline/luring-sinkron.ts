import { checkInLuringAction, checkOutLuringAction } from "@/app/pwa/stores/actions";
import { catatOpnameAction, terimaKirimanAction } from "@/app/actions/spg-stok";
import { catatReturPembeliAction, catatUangDikembalikanAction } from "@/app/actions/spg-retur";
import { ajukanMutasiAction, kirimMutasiAction } from "@/app/actions/spg-mutasi";
import { unggahFoto } from "@/lib/foto/unggah";
import { unggahFotoReturPembeli } from "@/lib/spg/foto-retur-pembeli-klien";
import type { JenisFotoReturPembeli } from "@/lib/spg/foto-retur-pembeli-kunci";
import {
  pwaDb,
  type FotoR2Tertunda,
  type FotoTertunda,
  type PendingMutasiAjuan,
  type PendingMutasiKirim,
  type PendingSpgRefund,
  type PendingSpgReturn,
  type PendingStoreOpname,
  type PendingStoreReceipt,
} from "./db";
import { nasibUnggah } from "./laporan-classify";
import {
  AJUAN_MUTASI_DITOLAK,
  AJUAN_MUTASI_HILANG,
  KUNJUNGAN_DITOLAK,
  nasibKode,
  nasibReturPembeli,
  type NasibLuring,
} from "./luring-klasifikasi";
import {
  bacaCatatanTerkirim,
  catatKunjunganTerkirim,
  KUNCI_KUNJUNGAN_TERKIRIM,
  lupakanKunjunganTerkirim,
} from "./luring-kunjungan";
import {
  muatanAjuanMutasi,
  muatanCheckin,
  muatanCheckout,
  muatanKirimMutasi,
  muatanOpname,
  muatanReturPembeli,
  muatanTerima,
  muatanUangKembali,
} from "./luring-muatan";
import { keadaanAjuanMutasi, keadaanCheckinTertahan } from "./luring-tergantung";

/**
 * Penyinkron antrean "tanpa sinyal" untuk kunjungan dan pekerjaan stok SPG
 * (termasuk mutasi antar toko: ajuan dan tanda dikirim).
 *
 * Tiga langkah, dipasang `setupOrderSync` pada urutan:
 *   check-in → (pesanan, foto, laporan, bukti terima, nota SPG) → stok → check-out.
 * Check-in dulu supaya pekerjaan yang terikat kunjungannya dikenali server;
 * check-out paling akhir supaya hasil kunjungan salesman ("ada transaksi?")
 * dinilai sesudah transaksinya sampai.
 *
 * Setiap langkah berkunci-jalan; baris "syncing" yang tertinggal (aplikasi
 * ditutup di tengah kiriman) ikut diambil lagi. Kiriman ulang aman: setiap
 * baris membawa kuncinya sendiri (`localId`).
 */

export type HasilKirimLuring = { terkirim: number; gagal: number; sibuk: boolean };
const SIBUK: HasilKirimLuring = { terkirim: 0, gagal: 0, sibuk: true };
const DIAMBIL = ["pending", "syncing"] as const;

type Tabel =
  | "pendingCheckins"
  | "pendingCheckouts"
  | "pendingStoreReceipts"
  | "pendingStoreOpnames"
  | "pendingSpgReturns"
  | "pendingSpgRefunds"
  | "pendingMutasiAjuan"
  | "pendingMutasiKirim";

/** Tulis nasib satu baris; kembalikan +1 untuk ringkasan. */
async function tetapkan(
  tabel: Tabel,
  baris: { localId: string; attempts: number },
  nasib: NasibLuring,
  alasan: string,
  hasil: HasilKirimLuring,
  tambahan: Record<string, unknown> = {},
): Promise<void> {
  if (nasib === "evict") {
    await pwaDb[tabel].delete(baris.localId);
    hasil.terkirim += 1;
    return;
  }
  await pwaDb[tabel].update(baris.localId, {
    syncState: nasib === "terminal" ? "failed" : "pending",
    error: alasan || undefined,
    attempts: baris.attempts + 1,
    ...tambahan,
  });
  if (nasib === "terminal") hasil.gagal += 1;
}

// ─── Check-in ────────────────────────────────────────────────────────────────

let jalanCheckin = false;

export async function flushCheckinTertahan(): Promise<HasilKirimLuring> {
  if (jalanCheckin) return SIBUK;
  jalanCheckin = true;
  const hasil: HasilKirimLuring = { terkirim: 0, gagal: 0, sibuk: false };
  try {
    const daftar = (await pwaDb.pendingCheckins.where("syncState").anyOf([...DIAMBIL]).toArray()).sort((a, b) => a.waktu - b.waktu);
    for (const c of daftar) {
      await pwaDb.pendingCheckins.update(c.localId, { syncState: "syncing" });
      let nasib: NasibLuring;
      let alasan = "";
      let rinci: { jarakMeter?: number; radiusMeter?: number } | null = null;
      try {
        const res = await checkInLuringAction(muatanCheckin(c));
        nasib = nasibKode(res);
        if (res.ok) {
          ingatKunjunganTerkirim({ clientId: c.localId, storeId: c.storeId, storeName: c.storeName, waktu: c.waktu, visitId: res.visitId });
        } else {
          alasan = res.code;
          if (res.code === "DI_LUAR_RADIUS") rinci = { jarakMeter: res.jarakMeter, radiusMeter: res.radiusMeter };
        }
      } catch {
        nasib = "retry";
      }
      await tetapkan("pendingCheckins", c, nasib, alasan, hasil, rinci ? { galatRinci: rinci } : {});
    }
  } finally {
    jalanCheckin = false;
  }
  return hasil;
}

/** Simpan check-in yang baru sampai sebagai kunjungan berjalan di HP — hanya bila ia yang terbaru. */
function ingatKunjunganTerkirim(c: { clientId: string; storeId: string; storeName: string | null; waktu: number; visitId: string }) {
  let lama = null;
  try {
    lama = typeof window === "undefined" ? null : bacaCatatanTerkirim(window.localStorage.getItem(KUNCI_KUNJUNGAN_TERKIRIM));
  } catch {
    lama = null;
  }
  if (!lama || c.waktu >= lama.waktu) catatKunjunganTerkirim(c);
}

// ─── Pekerjaan stok (terima kiriman, opname, barang kembali dari pembeli dan uang kembalinya) ──

let jalanStok = false;

class GagalUnggah extends Error {
  constructor(
    readonly nasib: NasibLuring,
    readonly kode: string,
  ) {
    super(kode);
  }
}

/** Pastikan foto sudah punya URL; unggah kalau masih berkas di HP (pola `laporan-sync.ts`). */
async function pastikanUrl(foto: FotoTertunda | null | undefined, simpan: (f: FotoTertunda) => Promise<void>): Promise<string | null> {
  if (!foto) return null;
  if (foto.url) return foto.url;
  if (!foto.blob) return null;
  try {
    const url = await unggahFoto(new File([foto.blob], foto.nama || "foto.jpg", { type: foto.blob.type || "image/jpeg" }));
    await simpan({ nama: foto.nama, url });
    return url;
  } catch (err) {
    throw new GagalUnggah(nasibUnggah(err), err instanceof Error ? err.message : "GAGAL");
  }
}

/**
 * Pastikan foto R2 retur pembeli sudah punya KUNCI; unggah kalau masih berkas di HP. `tujuan` =
 * kunci formulir laporan (foto barang/struk saat melapor) atau `returnId` (struk saat "uang sudah
 * dikembalikan"). Kunci yang naik disimpan kembali ke baris antrean, jadi percobaan berikutnya
 * tidak mengunggahnya lagi. Galat unggah dipilah seperti `nasibUnggah`: `TypeError` (sinyal) dan
 * `GAGAL` (401/5xx) diulang; kode 4xx lain menghentikan baris itu dengan alasannya.
 */
async function pastikanKunciR2(
  foto: FotoR2Tertunda | null | undefined,
  tujuan: { jenis: JenisFotoReturPembeli } & ({ kunci: string } | { returnId: string }),
  simpan: (f: FotoR2Tertunda) => Promise<void>,
): Promise<string | null> {
  if (!foto) return null;
  if (foto.key) return foto.key;
  if (!foto.blob) return null;
  try {
    const berkas = { berkas: foto.blob, nama: foto.nama || `${tujuan.jenis}.jpg`, jenis: tujuan.jenis };
    const { key } = await unggahFotoReturPembeli(
      "kunci" in tujuan ? { ...berkas, kunci: tujuan.kunci } : { ...berkas, returnId: tujuan.returnId },
    );
    await simpan({ nama: foto.nama, key });
    return key;
  } catch (err) {
    if (err instanceof TypeError) throw new GagalUnggah("retry", "JARINGAN");
    const kode = err instanceof Error && err.message ? err.message : "GAGAL";
    throw new GagalUnggah(kode === "GAGAL" ? "retry" : "terminal", kode);
  }
}

type BarisStok =
  | { jenis: "terima"; baris: PendingStoreReceipt }
  | { jenis: "opname"; baris: PendingStoreOpname }
  | { jenis: "returPembeli"; baris: PendingSpgReturn }
  | { jenis: "uangKembali"; baris: PendingSpgRefund }
  | { jenis: "mutasiAjuan"; baris: PendingMutasiAjuan }
  | { jenis: "mutasiKirim"; baris: PendingMutasiKirim };

const TABEL_STOK: Record<BarisStok["jenis"], Tabel> = {
  terima: "pendingStoreReceipts",
  opname: "pendingStoreOpnames",
  returPembeli: "pendingSpgReturns",
  uangKembali: "pendingSpgRefunds",
  mutasiAjuan: "pendingMutasiAjuan",
  mutasiKirim: "pendingMutasiKirim",
};

/**
 * Barang kembali dari pembeli dari antrean: foto barang (dan foto struk bila uangnya sudah
 * dikembalikan) diunggah dulu ke folder laporan ini (kunci formulir), baru laporannya dikirim.
 */
async function kirimReturPembeli(r: PendingSpgReturn): Promise<HasilSatu> {
  const fotoBarangKey = await pastikanKunciR2(r.fotoBarang, { jenis: "barang", kunci: r.localId }, async (f) => {
    r.fotoBarang = f;
    await pwaDb.pendingSpgReturns.update(r.localId, { fotoBarang: f });
  });
  const fotoStrukKey = r.uangSudahDikembalikan
    ? await pastikanKunciR2(r.fotoStruk, { jenis: "struk", kunci: r.localId }, async (f) => {
        r.fotoStruk = f;
        await pwaDb.pendingSpgReturns.update(r.localId, { fotoStruk: f });
      })
    : null;
  const res = await catatReturPembeliAction(muatanReturPembeli(r, { fotoBarangKey, fotoStrukKey }));
  return { nasib: nasibReturPembeli(res), alasan: res.ok ? "" : res.kode };
}

/** "Uang sudah dikembalikan" dari antrean: foto struk ke folder laporannya, lalu langkahnya. */
async function kirimUangKembali(r: PendingSpgRefund): Promise<HasilSatu> {
  const key = await pastikanKunciR2(r.foto, { jenis: "struk", returnId: r.returnId }, async (f) => {
    r.foto = f;
    await pwaDb.pendingSpgRefunds.update(r.localId, { foto: f });
  });
  /* Fotonya wajib; baris tanpa berkas maupun kunci tidak akan pernah diterima. */
  if (!key) return { nasib: "terminal", alasan: "FOTO_STRUK_WAJIB" };
  const res = await catatUangDikembalikanAction(muatanUangKembali(r, key));
  return { nasib: nasibReturPembeli(res), alasan: res.ok ? "" : res.kode };
}

type HasilSatu = { nasib: NasibLuring; alasan: string; tambahan?: Record<string, unknown> };

/** Penolakan mutasi membawa nomor siklus terkunci dan baris yang melebihi saldo — disimpan untuk alasan di layar. */
function rinciMutasi(res: { noKonsi?: string[]; kurang?: unknown[] }): Record<string, unknown> {
  return { ...(res.noKonsi ? { noKonsi: res.noKonsi } : {}), ...(res.kurang ? { kurang: res.kurang } : {}) };
}

/**
 * Ajuan mutasi dari antrean. Begitu server memberinya id, tanda dikirim yang
 * menunggunya diarahkan ke mutasi itu — SEBELUM barisnya dihapus: kalau HP
 * mati di antaranya, ajuannya terkirim ulang (kunci sama, mutasi sama) dan
 * pengarahannya diulang.
 */
async function kirimAjuanMutasi(r: PendingMutasiAjuan): Promise<HasilSatu> {
  const res = await ajukanMutasiAction(muatanAjuanMutasi(r));
  if (!res.ok) return { nasib: nasibKode(res), alasan: res.code, tambahan: rinciMutasi(res) };
  await pwaDb.pendingMutasiKirim.where("ajuanLocalId").equals(r.localId).modify({ transferId: res.id, docNo: res.docNo, ajuanLocalId: null });
  return { nasib: "evict", alasan: "" };
}

/** Tanda dikirim dari antrean — baris yang sudah dipastikan punya id mutasi server. */
async function kirimTandaKirim(r: PendingMutasiKirim): Promise<HasilSatu> {
  const muatan = muatanKirimMutasi(r);
  if (!muatan) return { nasib: "terminal", alasan: AJUAN_MUTASI_HILANG };
  const res = await kirimMutasiAction(muatan);
  if (res.ok) return { nasib: "evict", alasan: "" };
  return { nasib: nasibKode(res), alasan: res.code, tambahan: rinciMutasi(res) };
}

async function kirimTerima(r: PendingStoreReceipt): Promise<{ nasib: NasibLuring; alasan: string; noKonsi?: string[] }> {
  // Foto rusak diunggah satu per satu dan URL-nya disimpan kembali ke baris
  // antrean — percobaan berikutnya tidak mengunggah foto yang sama dua kali.
  const urls: (string | null)[] = [];
  for (let i = 0; i < r.diterima.length; i += 1) {
    const d = r.diterima[i];
    urls.push(
      d.qtyDamaged && d.qtyDamaged > 0
        ? await pastikanUrl(d.foto, async (f) => {
            r.diterima[i] = { ...d, foto: f };
            await pwaDb.pendingStoreReceipts.update(r.localId, { diterima: r.diterima });
          })
        : null,
    );
  }
  const res = await terimaKirimanAction(muatanTerima(r, (i) => urls[i] ?? null));
  if (res.ok) return { nasib: "evict", alasan: "" };
  return { nasib: nasibKode(res), alasan: res.code, ...(res.noKonsi ? { noKonsi: res.noKonsi } : {}) };
}

export async function flushStokTertahan(): Promise<HasilKirimLuring> {
  if (jalanStok) return SIBUK;
  jalanStok = true;
  const hasil: HasilKirimLuring = { terkirim: 0, gagal: 0, sibuk: false };
  try {
    const [terima, opname, retur, uangKembali, ajuan, kirim] = await Promise.all([
      pwaDb.pendingStoreReceipts.where("syncState").anyOf([...DIAMBIL]).toArray(),
      pwaDb.pendingStoreOpnames.where("syncState").anyOf([...DIAMBIL]).toArray(),
      pwaDb.pendingSpgReturns.where("syncState").anyOf([...DIAMBIL]).toArray(),
      pwaDb.pendingSpgRefunds.where("syncState").anyOf([...DIAMBIL]).toArray(),
      pwaDb.pendingMutasiAjuan.where("syncState").anyOf([...DIAMBIL]).toArray(),
      pwaDb.pendingMutasiKirim.where("syncState").anyOf([...DIAMBIL]).toArray(),
    ]);
    // Urut waktu kerja di HP, lintas jenis: kiriman yang diterima sebelum
    // opname sampai lebih dulu — begitu juga urutannya di rak. Barang mutasi
    // yang ditandai dikirim sebelum opname keluar dari buku sebelum opname
    // itu dinilai; ajuan mutasi selalu lebih dulu dari tanda dikirimnya.
    const semua: BarisStok[] = [
      ...terima.map((baris) => ({ jenis: "terima" as const, baris })),
      ...opname.map((baris) => ({ jenis: "opname" as const, baris })),
      ...retur.map((baris) => ({ jenis: "returPembeli" as const, baris })),
      ...uangKembali.map((baris) => ({ jenis: "uangKembali" as const, baris })),
      ...ajuan.map((baris) => ({ jenis: "mutasiAjuan" as const, baris })),
      ...kirim.map((baris) => ({ jenis: "mutasiKirim" as const, baris })),
    ].sort((a, b) => a.baris.waktu - b.baris.waktu);

    for (const item of semua) {
      const tabel = TABEL_STOK[item.jenis];
      // Tanda dikirim untuk ajuan yang juga di HP: dibaca ulang — ajuannya bisa
      // baru saja terkirim di putaran ini dan mengisi id mutasinya.
      if (item.jenis === "mutasiKirim") {
        const segar = await pwaDb.pendingMutasiKirim.get(item.baris.localId);
        if (!segar) continue;
        item.baris = segar;
        const keadaan = await keadaanAjuanMutasi(segar);
        if (keadaan === "tunggu") {
          await pwaDb.pendingMutasiKirim.update(segar.localId, { syncState: "pending" });
          continue;
        }
        if (keadaan === "ditolak" || keadaan === "hilang") {
          await tetapkan(tabel, segar, "terminal", keadaan === "ditolak" ? AJUAN_MUTASI_DITOLAK : AJUAN_MUTASI_HILANG, hasil);
          continue;
        }
      }
      // Terikat check-in yang masih di antrean: tunggu; check-in ditolak: berhenti.
      // Retur pembeli dan uang kembalinya tidak butuh check-in.
      if (item.jenis !== "returPembeli" && item.jenis !== "uangKembali") {
        const ikatan = await keadaanCheckinTertahan(item.baris.visitClientId);
        if (ikatan === "tunggu") {
          await pwaDb[tabel].update(item.baris.localId, { syncState: "pending" });
          continue;
        }
        if (ikatan === "ditolak") {
          await tetapkan(tabel, item.baris, "terminal", KUNJUNGAN_DITOLAK, hasil);
          continue;
        }
      }
      await pwaDb[tabel].update(item.baris.localId, { syncState: "syncing" });
      let nasib: NasibLuring;
      let alasan = "";
      let tambahan: Record<string, unknown> = {};
      try {
        if (item.jenis === "terima") {
          const k = await kirimTerima(item.baris);
          nasib = k.nasib;
          alasan = k.alasan;
          if (k.noKonsi) tambahan = { noKonsi: k.noKonsi };
        } else if (item.jenis === "opname") {
          const res = await catatOpnameAction(muatanOpname(item.baris));
          nasib = nasibKode(res);
          if (!res.ok) alasan = res.code;
        } else if (item.jenis === "mutasiAjuan" || item.jenis === "mutasiKirim") {
          const k = item.jenis === "mutasiAjuan" ? await kirimAjuanMutasi(item.baris) : await kirimTandaKirim(item.baris);
          nasib = k.nasib;
          alasan = k.alasan;
          tambahan = k.tambahan ?? {};
        } else if (item.jenis === "uangKembali") {
          const k = await kirimUangKembali(item.baris);
          nasib = k.nasib;
          alasan = k.alasan;
        } else {
          const k = await kirimReturPembeli(item.baris);
          nasib = k.nasib;
          alasan = k.alasan;
        }
      } catch (err) {
        nasib = err instanceof GagalUnggah ? err.nasib : "retry";
        // Hanya foto yang DITOLAK yang punya alasan; sinyal yang putus saat mengunggah cukup diulang.
        if (err instanceof GagalUnggah && nasib === "terminal") alasan = `FOTO_${err.kode}`;
      }
      await tetapkan(tabel, item.baris, nasib, alasan, hasil, tambahan);
    }
  } finally {
    jalanStok = false;
  }
  return hasil;
}

// ─── Check-out ───────────────────────────────────────────────────────────────

let jalanCheckout = false;

export async function flushCheckoutTertahan(): Promise<HasilKirimLuring> {
  if (jalanCheckout) return SIBUK;
  jalanCheckout = true;
  const hasil: HasilKirimLuring = { terkirim: 0, gagal: 0, sibuk: false };
  try {
    const daftar = (await pwaDb.pendingCheckouts.where("syncState").anyOf([...DIAMBIL]).toArray()).sort((a, b) => a.waktu - b.waktu);
    for (const c of daftar) {
      const ikatan = await keadaanCheckinTertahan(c.visitClientId);
      if (ikatan === "tunggu") {
        await pwaDb.pendingCheckouts.update(c.localId, { syncState: "pending" });
        continue;
      }
      if (ikatan === "ditolak") {
        await tetapkan("pendingCheckouts", c, "terminal", KUNJUNGAN_DITOLAK, hasil);
        continue;
      }
      await pwaDb.pendingCheckouts.update(c.localId, { syncState: "syncing" });
      let nasib: NasibLuring;
      let alasan = "";
      try {
        const res = await checkOutLuringAction(muatanCheckout(c));
        nasib = nasibKode(res);
        if (!res.ok) alasan = res.code;
      } catch {
        nasib = "retry";
      }
      if (nasib === "evict") lupakanBilaSama(c.visitClientId, c.visitId);
      await tetapkan("pendingCheckouts", c, nasib, alasan, hasil);
    }
  } finally {
    jalanCheckout = false;
  }
  return hasil;
}

/** Kunjungan berjalan di HP yang baru saja check-out terkirim tidak lagi berjalan. */
function lupakanBilaSama(visitClientId: string | null, visitId: string | null) {
  try {
    const t = typeof window === "undefined" ? null : bacaCatatanTerkirim(window.localStorage.getItem(KUNCI_KUNJUNGAN_TERKIRIM));
    if (t && (t.clientId === visitClientId || t.visitId === visitId)) lupakanKunjunganTerkirim();
  } catch {
    // Tidak terbaca: catatan itu akan kedaluwarsa sendiri.
  }
}
