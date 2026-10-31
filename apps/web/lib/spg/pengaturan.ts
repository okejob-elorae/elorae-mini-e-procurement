/**
 * Pengaturan SPG tahap 2, disimpan di `SystemSetting` (JSON) — tanpa tabel
 * baru. Setiap pembaca murni dan selalu mengembalikan nilai yang bisa dipakai:
 * isian rusak atau belum pernah diatur jatuh ke nilai bawaan di bawah ini, yang
 * diubah pemilik di Pengaturan → SPG (`/backoffice/settings/spg`).
 *
 * Tidak mengimpor Prisma: layar HP (klien) memakai pembaca yang sama untuk
 * pratinjau, server yang memutuskan.
 */

export const KUNCI_DISKON_MANUAL = "spg.diskonManual";
export const KUNCI_SHIFT = "spg.shift";
export const KUNCI_KOMISI_PUTUS = "spg.komisiPutus";
export const KUNCI_TITIP_PESAN = "spg.titipPesan";
export const KUNCI_TUTUP_HARI = "spg.tutupHari";
export const KUNCI_BARANG_HILANG = "spg.barangHilang";

function bacaObjek(nilai: string | null | undefined): Record<string, unknown> | null {
  if (!nilai) return null;
  try {
    const x = JSON.parse(nilai);
    return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const angkaDalam = (v: unknown, min: number, maks: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= maks ? v : null;

// ---------------------------------------------------------------------------
// Diskon manual di konter
// ---------------------------------------------------------------------------

/**
 * Bawaan MATI: SPG tidak bisa memberi potongan sendiri sampai kantor
 * menyalakannya. Kalau dinyalakan, potongan per nota dibatasi persen dari nilai
 * bersih nota dan alasannya wajib diisi. `bagianTokoPersen` = bagian toko
 * konsinyasi dari diskon manual (bawaan 0 = ditanggung penuh Elorae).
 */
export type AturanDiskonManualSpg = { aktif: boolean; maksPersen: number; alasanWajib: boolean; bagianTokoPersen: number };
export const DISKON_MANUAL_BAWAAN: AturanDiskonManualSpg = { aktif: false, maksPersen: 10, alasanWajib: true, bagianTokoPersen: 0 };

export function bacaDiskonManual(nilai: string | null | undefined): AturanDiskonManualSpg {
  const o = bacaObjek(nilai);
  if (!o) return DISKON_MANUAL_BAWAAN;
  return {
    aktif: o.aktif === true,
    maksPersen: angkaDalam(o.maksPersen, 0, 100) ?? DISKON_MANUAL_BAWAAN.maksPersen,
    alasanWajib: o.alasanWajib !== false,
    bagianTokoPersen: angkaDalam(o.bagianTokoPersen, 0, 100) ?? DISKON_MANUAL_BAWAAN.bagianTokoPersen,
  };
}

// ---------------------------------------------------------------------------
// Shift SPG
// ---------------------------------------------------------------------------

export type JenisShift = { kode: string; label: string; mulai: string; selesai: string };
export type AturanShift = { daftar: JenisShift[]; toleransiTerlambatMenit: number };

export const SHIFT_BAWAAN: AturanShift = {
  daftar: [
    { kode: "PAGI", label: "Pagi", mulai: "10:00", selesai: "18:00" },
    { kode: "SIANG", label: "Siang", mulai: "14:00", selesai: "22:00" },
    { kode: "PENUH", label: "Penuh", mulai: "10:00", selesai: "22:00" },
  ],
  toleransiTerlambatMenit: 15,
};

const JAM = /^([01]\d|2[0-3]):[0-5]\d$/;
const KODE = /^[A-Z0-9_]{1,20}$/;

export function shiftSah(s: unknown): s is JenisShift {
  if (!s || typeof s !== "object") return false;
  const x = s as Record<string, unknown>;
  return (
    typeof x.kode === "string" &&
    KODE.test(x.kode) &&
    x.kode !== "LIBUR" &&
    typeof x.label === "string" &&
    x.label.trim().length > 0 &&
    x.label.length <= 40 &&
    typeof x.mulai === "string" &&
    JAM.test(x.mulai) &&
    typeof x.selesai === "string" &&
    JAM.test(x.selesai)
  );
}

export function bacaAturanShift(nilai: string | null | undefined): AturanShift {
  const o = bacaObjek(nilai);
  if (!o) return SHIFT_BAWAAN;
  const daftar = Array.isArray(o.daftar) ? o.daftar.filter(shiftSah) : [];
  const unik = daftar.filter((s, i) => daftar.findIndex((t) => t.kode === s.kode) === i);
  return {
    daftar: unik.length > 0 ? unik.map((s) => ({ ...s, label: s.label.trim() })) : SHIFT_BAWAAN.daftar,
    toleransiTerlambatMenit: angkaDalam(o.toleransiTerlambatMenit, 0, 240) ?? SHIFT_BAWAAN.toleransiTerlambatMenit,
  };
}

// ---------------------------------------------------------------------------
// Komisi SPG di toko PUTUS
// ---------------------------------------------------------------------------

/**
 * Keputusan pemilik 2026-10-03: SPG di toko putus juga mendapat komisi, sebesar
 * potong yang IA SENDIRI jual (`PER_SPG`, bawaan) × `Item.commissionPerPcs`,
 * bersih dari barang yang dikembalikan pembeli. `BAGI_RATA` (komisi toko dibagi
 * rata antar SPG, aturan konsinyasi) tetap bisa dipilih kantor.
 */
export type DasarKomisi = "BAGI_RATA" | "PER_SPG";
export type AturanKomisiPutus = { aktif: boolean; dasar: DasarKomisi };
export const KOMISI_PUTUS_BAWAAN: AturanKomisiPutus = { aktif: true, dasar: "PER_SPG" };

export function bacaKomisiPutus(nilai: string | null | undefined): AturanKomisiPutus {
  const o = bacaObjek(nilai);
  if (!o) return KOMISI_PUTUS_BAWAAN;
  return {
    aktif: o.aktif !== false,
    dasar: o.dasar === "BAGI_RATA" ? "BAGI_RATA" : "PER_SPG",
  };
}

// ---------------------------------------------------------------------------
// Titip pesan (pembeli minta dikabari)
// ---------------------------------------------------------------------------

/** Berapa hari barang yang sudah datang disimpankan untuk pembeli sesudah dikabari. */
export type AturanTitipPesan = { hariSimpan: number };
export const TITIP_PESAN_BAWAAN: AturanTitipPesan = { hariSimpan: 3 };

export function bacaTitipPesan(nilai: string | null | undefined): AturanTitipPesan {
  const o = bacaObjek(nilai);
  return { hariSimpan: angkaDalam(o?.hariSimpan, 1, 30) ?? TITIP_PESAN_BAWAAN.hariSimpan };
}

// ---------------------------------------------------------------------------
// Laporan tutup hari
// ---------------------------------------------------------------------------

/**
 * Isian tambahan di laporan tutup hari. Bawaan: jumlah pengunjung dan total
 * kasir DITANYAKAN tapi boleh kosong; foto struk kasir tidak wajib.
 */
export type AturanTutupHari = { tanyaPengunjung: boolean; tanyaTotalKasir: boolean; wajibFoto: boolean };
export const TUTUP_HARI_BAWAAN: AturanTutupHari = { tanyaPengunjung: true, tanyaTotalKasir: true, wajibFoto: false };

export function bacaTutupHari(nilai: string | null | undefined): AturanTutupHari {
  const o = bacaObjek(nilai);
  if (!o) return TUTUP_HARI_BAWAAN;
  return {
    tanyaPengunjung: o.tanyaPengunjung !== false,
    tanyaTotalKasir: o.tanyaTotalKasir !== false,
    wajibFoto: o.wajibFoto === true,
  };
}

// ---------------------------------------------------------------------------
// Barang hilang
// ---------------------------------------------------------------------------

/**
 * Barang hilang (keputusan pemilik 2026-10-03): Elorae memutuskan siapa yang
 * menanggung — toko, SPG, sales, Elorae, atau dibagi. Bagian SPG/sales
 * dipotong dari gaji/komisinya.
 *
 * - `dasarNilai`: nilai per potong. Bawaan `HARGA_TERIMA` = harga barang itu
 *   saat terakhir DITERIMA toko tersebut (pemilik: "SPG bisa di-charge
 *   berdasarkan nominal value barang yang mereka terima") — harga bersih nota
 *   kiriman putus, atau harga kiriman konsinyasi; kalau toko belum pernah
 *   menerimanya (atau catatan tanpa toko), harga jual Elorae. Pilihan lain:
 *   harga jual Elorae (`Item.sellingPrice`), HPP (`InventoryValue.avgCost`),
 *   atau harga eceran di toko.
 * - `maksPotongPersen`: potongan beban paling banyak sekian persen dari
 *   gaji/komisi SATU pembayaran (bawaan 50%); sisanya dicicil di pembayaran
 *   berikutnya — gaji tidak pernah habis karena satu kejadian.
 * - `dariOpname`: opname toko konsinyasi yang KURANG otomatis membuka catatan
 *   barang hilang untuk diputuskan kantor (bawaan nyala).
 *
 * Keringanan diskon pegawai TIDAK punya persen bawaan: pemilik mengetik
 * persennya sendiri di formulir keputusan setiap kali (2026-10-03, "keringanan
 * berapa persen bisa saya isi sendiri saja"). Isian lama yang masih membawa
 * `diskonPegawaiPersen` diabaikan.
 */
export type DasarNilaiHilang = "HARGA_TERIMA" | "HARGA_ELORAE" | "HPP" | "ECERAN";
export type AturanBarangHilang = {
  dasarNilai: DasarNilaiHilang;
  maksPotongPersen: number;
  dariOpname: boolean;
};
export const BARANG_HILANG_BAWAAN: AturanBarangHilang = {
  dasarNilai: "HARGA_TERIMA",
  maksPotongPersen: 50,
  dariOpname: true,
};

const DASAR_NILAI_DIKENAL: readonly string[] = ["HARGA_TERIMA", "HARGA_ELORAE", "HPP", "ECERAN"];

/**
 * Urutan kunci di objek yang dikembalikan SAMA dengan `validasiAturanBarangHilang`
 * — aksi simpan membandingkan JSON keduanya.
 */
export function bacaBarangHilang(nilai: string | null | undefined): AturanBarangHilang {
  const o = bacaObjek(nilai);
  if (!o) return BARANG_HILANG_BAWAAN;
  const dasar =
    typeof o.dasarNilai === "string" && DASAR_NILAI_DIKENAL.includes(o.dasarNilai)
      ? (o.dasarNilai as DasarNilaiHilang)
      : BARANG_HILANG_BAWAAN.dasarNilai;
  return {
    dasarNilai: dasar,
    maksPotongPersen: angkaDalam(o.maksPotongPersen, 0, 100) ?? BARANG_HILANG_BAWAAN.maksPotongPersen,
    dariOpname: o.dariOpname !== false,
  };
}
