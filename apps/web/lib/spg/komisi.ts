import { bagiKomisi } from "@/lib/konsinyasi/aturan";
import type { DasarKomisi } from "./pengaturan";

/**
 * Komisi SPG — murni, tanpa basis data. Dipakai tiga tempat yang harus
 * memberi angka SAMA: perkiraan di HP SPG, hitungan langsung di kantor
 * (`/backoffice/komisi-spg`), dan penetapan resmi (`SpgCommission`).
 *
 * Tarif: `Item.commissionPerPcs` × potong terjual BERSIH dalam satu bulan WIB.
 * Bersih = qty nota bulan itu − barang yang dikembalikan pembeli bulan itu,
 * per barang, tidak pernah di bawah nol (pola yang sama dengan perkiraan
 * komisi konsinyasi sejak tahap 1). Barang yang dikembalikan bulan ini dari
 * nota bulan lalu hanya mengurangi barang yang SAMA yang laku bulan ini —
 * komisi bulan lalu sudah ditetapkan dan tidak dibuka lagi diam-diam.
 *
 * Dua dasar (Pengaturan → SPG):
 * - `PER_SPG` (BAWAAN, keputusan pemilik 2026-10-03 "berdasarkan berapa banyak
 *   pcs yang mereka jual"): setiap SPG mendapat komisi dari potong yang ia jual
 *   sendiri (`SpgSale.salesmanId`); barang yang dikembalikan mengurangi penjual
 *   aslinya. SPG yang sudah pindah tetap menerima komisi dari notanya.
 * - `BAGI_RATA`: komisi seluruh toko dibagi rata antar SPG yang bertugas di
 *   toko itu (`User.assignedStoreId`), sisa receh ke SPG pertama menurut nama —
 *   persis `bagiKomisi` milik konsinyasi. SPG yang menjual bulan itu tapi sudah
 *   tidak bertugas di toko itu tidak mendapat bagian (aturan konsinyasi).
 *
 * Potongan (`PotonganKomisi`, mis. beban barang hilang yang ditanggung SPG)
 * dikurangkan dari bagian orangnya SESUDAH dasar dihitung, tidak pernah di
 * bawah nol; yang tidak tertampung dilaporkan sebagai `potonganSisa`, tidak
 * dibuang diam-diam. Belum ada sumbernya: pemanggil meneruskan daftar kosong.
 */

export const JEJAK_KOMISI_SPG = {
  DITETAPKAN: "SPG_COMMISSION_LOCKED",
  DITETAPKAN_ULANG: "SPG_COMMISSION_RELOCKED",
  DIBAYAR: "SPG_COMMISSION_PAID",
  PENGATURAN_DIUBAH: "SPG_COMMISSION_SETTING_UPDATED",
} as const;

export type NamaJejakKomisiSpg = (typeof JEJAK_KOMISI_SPG)[keyof typeof JEJAK_KOMISI_SPG];

/** Satu baris nota bulan itu. */
export type BarisJualKomisi = { salesmanId: string; itemId: string; qty: number; commissionPerPcs: number };
/** Satu baris pengembalian pembeli bulan itu; `salesmanId` = penjual nota aslinya. */
export type BarisKembaliKomisi = { salesmanId: string; itemId: string; qty: number };
/** Orang yang mungkin menerima: SPG yang bertugas di toko itu, penjual bulan itu, atau pemegang baris resmi. */
export type OrangKomisi = { userId: string; nama: string; ditugaskan: boolean };
/** Potongan dari komisi satu SPG untuk bulan itu (rupiah positif). */
export type PotonganKomisi = { userId: string; jumlah: number; keterangan: string };

export type KomisiPerSpg = {
  userId: string;
  nama: string;
  ditugaskan: boolean;
  /** Potong bersih dari nota orang ini sendiri. */
  potong: number;
  /** Bagian sebelum potongan. */
  komisiKotor: number;
  /** Potongan yang benar-benar dikurangkan. */
  potongan: number;
  /** Potongan yang tidak tertampung karena komisinya habis. */
  potonganSisa: number;
  /** Yang dibayar: komisiKotor − potongan. */
  komisi: number;
  /** Mendapat baris resmi saat bulan ini ditetapkan. */
  penerima: boolean;
};

export type HasilKomisiToko = {
  dasar: DasarKomisi;
  /** Potong bersih seluruh toko. */
  potongToko: number;
  /** Komisi kotor: BAGI_RATA seluruh toko, PER_SPG jumlah semua penerima. */
  totalToko: number;
  totalPotongan: number;
  /** Urut: penerima menurut nama (urutan pembagian sisa), lalu yang bukan penerima. */
  perSpg: KomisiPerSpg[];
};

const bulatSen = (n: number) => Math.round(n * 100) / 100;

type Bersih = Map<string, { qty: number; tarif: number }>;

function kurangiKembali(bersih: Bersih, itemId: string, qty: number): void {
  const ada = bersih.get(itemId);
  if (ada) ada.qty -= qty;
}

function ringkas(bersih: Bersih): { potong: number; terjual: { qty: number; commissionPerPcs: number }[] } {
  const terjual = [...bersih.values()].map((b) => ({ qty: Math.max(0, b.qty), commissionPerPcs: b.tarif }));
  return { potong: terjual.reduce((n, b) => n + b.qty, 0), terjual };
}

const urutNama = (a: { nama: string; userId: string }, b: { nama: string; userId: string }) =>
  a.nama.localeCompare(b.nama) || a.userId.localeCompare(b.userId);

export function hitungKomisiToko(input: {
  dasar: DasarKomisi;
  orang: OrangKomisi[];
  jual: BarisJualKomisi[];
  kembali: BarisKembaliKomisi[];
  potongan?: PotonganKomisi[];
}): HasilKomisiToko {
  const toko: Bersih = new Map();
  const perOrang = new Map<string, Bersih>();
  for (const j of input.jual) {
    const t = toko.get(j.itemId);
    if (t) t.qty += j.qty;
    else toko.set(j.itemId, { qty: j.qty, tarif: j.commissionPerPcs });
    let milik = perOrang.get(j.salesmanId);
    if (!milik) perOrang.set(j.salesmanId, (milik = new Map()));
    const m = milik.get(j.itemId);
    if (m) m.qty += j.qty;
    else milik.set(j.itemId, { qty: j.qty, tarif: j.commissionPerPcs });
  }
  for (const k of input.kembali) {
    kurangiKembali(toko, k.itemId, k.qty);
    const milik = perOrang.get(k.salesmanId);
    if (milik) kurangiKembali(milik, k.itemId, k.qty);
  }

  const potonganOrang = new Map<string, number>();
  for (const p of input.potongan ?? []) {
    if (Number.isFinite(p.jumlah) && p.jumlah > 0) potonganOrang.set(p.userId, (potonganOrang.get(p.userId) ?? 0) + p.jumlah);
  }

  // Penjual yang tidak ada di daftar orang tetap dihitung (namanya id-nya) —
  // potongnya tidak boleh hilang hanya karena pemuatnya lupa menyertakannya.
  const orang = new Map(input.orang.map((o) => [o.userId, o]));
  for (const id of perOrang.keys()) if (!orang.has(id)) orang.set(id, { userId: id, nama: id, ditugaskan: false });

  const semuaToko = ringkas(toko);
  const potongSendiri = (userId: string) => ringkas(perOrang.get(userId) ?? new Map());
  const penerimaDengan = (o: OrangKomisi, potong: number, kotor: number): KomisiPerSpg => {
    const k = bulatSen(kotor);
    const minta = bulatSen(potonganOrang.get(o.userId) ?? 0);
    const potongan = Math.min(k, minta);
    return { ...o, potong, komisiKotor: k, potongan, potonganSisa: bulatSen(minta - potongan), komisi: bulatSen(k - potongan), penerima: true };
  };
  const bukanPenerima = (o: OrangKomisi, potong: number): KomisiPerSpg => ({
    ...o,
    potong,
    komisiKotor: 0,
    potongan: 0,
    potonganSisa: bulatSen(potonganOrang.get(o.userId) ?? 0),
    komisi: 0,
    penerima: false,
  });

  const semua = [...orang.values()];
  let perSpg: KomisiPerSpg[];
  let totalToko: number;
  if (input.dasar === "BAGI_RATA") {
    const penerima = semua.filter((o) => o.ditugaskan).sort(urutNama);
    const bagi = bagiKomisi(semuaToko.terjual, penerima.length);
    totalToko = bulatSen(bagi.totalKomisi);
    perSpg = [
      ...penerima.map((o, i) => penerimaDengan(o, potongSendiri(o.userId).potong, bagi.perSpg[i] ?? 0)),
      ...semua
        .filter((o) => !o.ditugaskan)
        .sort(urutNama)
        .map((o) => bukanPenerima(o, potongSendiri(o.userId).potong)),
    ];
  } else {
    const penerima = semua.filter((o) => o.ditugaskan || perOrang.has(o.userId)).sort(urutNama);
    perSpg = [
      ...penerima.map((o) => {
        const r = potongSendiri(o.userId);
        return penerimaDengan(o, r.potong, bagiKomisi(r.terjual, 0).totalKomisi);
      }),
      ...semua
        .filter((o) => !o.ditugaskan && !perOrang.has(o.userId))
        .sort(urutNama)
        .map((o) => bukanPenerima(o, 0)),
    ];
    totalToko = bulatSen(perSpg.reduce((n, p) => n + p.komisiKotor, 0));
  }
  return {
    dasar: input.dasar,
    potongToko: semuaToko.potong,
    totalToko,
    totalPotongan: bulatSen(perSpg.reduce((n, p) => n + p.potongan, 0)),
    perSpg,
  };
}

// ---------------------------------------------------------------------------
// Bulan
// ---------------------------------------------------------------------------

const POLA_PERIODE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function periodeSah(periode: unknown): periode is string {
  return typeof periode === "string" && POLA_PERIODE.test(periode);
}

/** Bulan WIB "2026-09" sebagai rentang instant [awal, akhir). */
export function rentangBulanWib(periode: string): { awal: Date; akhir: Date } {
  const [th, bl] = periode.split("-").map(Number);
  const berikut = bl === 12 ? `${th + 1}-01` : `${th}-${String(bl + 1).padStart(2, "0")}`;
  return { awal: new Date(`${periode}-01T00:00:00+07:00`), akhir: new Date(`${berikut}-01T00:00:00+07:00`) };
}

/** Bulan yang sudah selesai menurut kalender WIB — satu-satunya yang boleh ditetapkan. */
export function bulanSudahSelesai(periode: string, bulanIni: string): boolean {
  return periode < bulanIni;
}

/** `?bulan=lalu`: bulan sebelum bulan WIB berjalan — tautan Beranda yang tetap benar bulan depan. */
export const BULAN_LALU = "lalu";

/** Bulan sebelum `periode` ("2026-01" → "2025-12"). */
export function bulanSebelum(periode: string): string {
  const [th, bl] = periode.split("-").map(Number);
  return bl === 1 ? `${th - 1}-12` : `${th}-${String(bl - 1).padStart(2, "0")}`;
}

/** Parameter `?bulan=`: salah satu pilihan; `lalu` atau selain itu = bulan terakhir yang sudah selesai. */
export function bacaPeriodeKomisi(nilai: string | string[] | undefined, pilihan: readonly string[]): string {
  const x = Array.isArray(nilai) ? nilai[0] : nilai;
  if (x && x !== BULAN_LALU && pilihan.includes(x)) return x;
  return pilihan[1] ?? pilihan[0];
}

// ---------------------------------------------------------------------------
// Penetapan resmi
// ---------------------------------------------------------------------------

export type BarisResmiAda = {
  id: string;
  userId: string;
  unitsSold: number;
  commission: number;
  basis: string;
  paidAt: Date | null;
};

export type IsiResmi = { unitsSold: number; commission: number; basis: DasarKomisi };

export type RencanaTetapkan =
  | { ok: false; code: "SUDAH_DIBAYAR" | "TANPA_SPG" }
  | {
      ok: true;
      tulis: {
        userId: string;
        isi: IsiResmi;
        /** Untuk jejak: bagian sebelum potongan dan potongannya (kolomnya hanya menyimpan yang dibayar). */
        rincian: { komisiKotor: number; potongan: number; potonganSisa: number };
        sebelum: (IsiResmi & { id: string }) | null;
      }[];
      hapus: { id: string; userId: string; sebelum: IsiResmi }[];
    };

const isiDari = (b: BarisResmiAda): IsiResmi => ({
  unitsSold: b.unitsSold,
  commission: b.commission,
  basis: b.basis === "PER_SPG" ? "PER_SPG" : "BAGI_RATA",
});

/**
 * Apa yang ditulis saat satu toko × satu bulan ditetapkan (ulang).
 *
 * DITOLAK seluruhnya kalau satu baris saja sudah dibayar: dengan BAGI_RATA
 * menetapkan ulang menggeser bagian semua SPG, dan bagian yang sudah masuk
 * kantong orang tidak bisa ikut digeser — jumlahnya tidak akan sama lagi
 * dengan komisi toko. Baris orang yang tidak lagi menerima (dilepas dari toko
 * sebelum ditetapkan ulang) dihapus, jejaknya tetap.
 */
export function rencanaTetapkan(hasil: HasilKomisiToko, ada: BarisResmiAda[]): RencanaTetapkan {
  if (ada.some((b) => b.paidAt !== null)) return { ok: false, code: "SUDAH_DIBAYAR" };
  const penerima = hasil.perSpg.filter((p) => p.penerima);
  if (penerima.length === 0) return { ok: false, code: "TANPA_SPG" };
  const lama = new Map(ada.map((b) => [b.userId, b]));
  const id = new Set(penerima.map((p) => p.userId));
  return {
    ok: true,
    tulis: penerima.map((p) => {
      const b = lama.get(p.userId);
      return {
        userId: p.userId,
        isi: { unitsSold: p.potong, commission: p.komisi, basis: hasil.dasar },
        rincian: { komisiKotor: p.komisiKotor, potongan: p.potongan, potonganSisa: p.potonganSisa },
        sebelum: b ? { id: b.id, ...isiDari(b) } : null,
      };
    }),
    hapus: ada.filter((b) => !id.has(b.userId)).map((b) => ({ id: b.id, userId: b.userId, sebelum: isiDari(b) })),
  };
}

const samaSen = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Apakah hitungan sekarang masih sama dengan yang sudah ditetapkan. Berbeda
 * kalau ada nota yang masuk dari antrean HP atau pengembalian sesudah
 * ditetapkan, SPG toko berganti, atau dasar diubah — kantor menetapkan ulang
 * selama belum ada yang dibayar.
 */
export function sudahBerbeda(hasil: HasilKomisiToko, ada: BarisResmiAda[]): boolean {
  if (ada.length === 0) return false;
  const lama = new Map(ada.map((b) => [b.userId, b]));
  const penerima = hasil.perSpg.filter((p) => p.penerima);
  if (penerima.length !== ada.length) return true;
  return penerima.some((p) => {
    const b = lama.get(p.userId);
    return !b || !samaSen(b.commission, p.komisi) || b.unitsSold !== p.potong || b.basis !== hasil.dasar;
  });
}

export type StatusKomisi = "BELUM" | "DITETAPKAN" | "DIBAYAR";

export function statusResmi(b: { paidAt: Date | string | null } | null | undefined): StatusKomisi {
  if (!b) return "BELUM";
  return b.paidAt ? "DIBAYAR" : "DITETAPKAN";
}

// ---------------------------------------------------------------------------
// Isian pengaturan
// ---------------------------------------------------------------------------

/** Isian kartu Pengaturan → SPG → Komisi toko putus; null kalau bentuknya salah. */
export function validasiAturanKomisiPutus(isi: unknown): { aktif: boolean; dasar: DasarKomisi } | null {
  if (!isi || typeof isi !== "object") return null;
  const o = isi as Record<string, unknown>;
  if (typeof o.aktif !== "boolean") return null;
  if (o.dasar !== "BAGI_RATA" && o.dasar !== "PER_SPG") return null;
  return { aktif: o.aktif, dasar: o.dasar };
}
