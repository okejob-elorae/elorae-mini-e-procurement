import type { SpgReportCommission } from "@/lib/spg-commission/payout";

/**
 * Komisi SPG — murni, tanpa basis data.
 *
 * Angka komisi TIDAK dihitung di sini (keputusan pemilik 2026-11-01): satu hitungan untuk SEMUA SPG,
 * toko konsinyasi maupun toko putus — `lib/spg-commission/payout.ts`, tarif per KATEGORI barang
 * (Pengaturan → Komisi SPG) bulan penjualan × potong yang dijual SPG itu sendiri. "Ani Rp 40.000,
 * Sari Rp 20.000. ini yang benar" — bukan dibagi rata, dan bukan tarif komisi di master barang
 * (`Item.commissionPerPcs`, yang kini tidak dipakai untuk angka apa pun). Modul ini hanya menyusun
 * hasil hitungan itu untuk kantor dan HP (nama, siapa yang bertugas), memegang aturan penetapan
 * resmi toko putus (`SpgCommission`), dan aturan bulan.
 *
 * Komisi milik BULAN PENJUALAN tetapi dibayar di BULAN LAPORANNYA DICEK kantor, dengan catatan
 * bulan penjualannya: penjualan Oktober yang dicek 5 November dibayar November sebagai "Komisi
 * penjualan Oktober 2026". Toko putus dicek lewat "Tandai laporan dicek" (`SpgSalesCheck`), toko
 * konsinyasi saat angka resmi siklusnya dikunci.
 *
 * Tidak ada bagi rata di mana pun (keputusan pemilik 2026-11-02). Baris yang BELUM dibayar selalu
 * dibayar dengan komisi per SPG saat ditandai dibayar (`lib/spg/koreksi.ts`, dihitung ulang di
 * transaksi pembayarannya); baris yang SUDAH dibayar tidak diubah — selisihnya ikut SEKALI di
 * pembayaran SPG itu berikutnya sebagai koreksi (`SpgCommissionCorrection`).
 */

export const JEJAK_KOMISI_SPG = {
  DITETAPKAN: "SPG_COMMISSION_LOCKED",
  DITETAPKAN_ULANG: "SPG_COMMISSION_RELOCKED",
  DIBAYAR: "SPG_COMMISSION_PAID",
  LAPORAN_DICEK: "SPG_SALES_REPORT_CHECKED",
  LAPORAN_BATAL_DICEK: "SPG_SALES_REPORT_UNCHECKED",
  /** Baris yang belum dibayar diganti komisi per SPG sekarang di transaksi pembayarannya. */
  DIHITUNG_ULANG_SAAT_BAYAR: "SPG_COMMISSION_RECOMPUTED_AT_PAYMENT",
  /** Satu koreksi komisi diterapkan pada sebuah pembayaran (`SpgCommissionCorrection`). */
  KOREKSI_DITERAPKAN: "SPG_COMMISSION_CORRECTION_APPLIED",
} as const;

export type NamaJejakKomisiSpg = (typeof JEJAK_KOMISI_SPG)[keyof typeof JEJAK_KOMISI_SPG];

/**
 * `SpgCommission.basis` baris yang ditetapkan dengan hitungan tarif kategori. Baris yang
 * ditetapkan sebelum 2026-11-01 memakai `PER_SPG`/`BAGI_RATA` (tarif barang) dan tetap bisa
 * dibaca; menetapkan ulang menggantinya dengan hitungan baru.
 */
export const DASAR_TARIF_KATEGORI = "TARIF_KATEGORI";

/**
 * `SpgCommission.basis` baris toko putus yang ditetapkan SEBELUM 2026-11-01 (tarif barang:
 * `PER_SPG` per penjual, `BAGI_RATA` dibagi rata). Hanya dibaca untuk baris lama itu; pengaturan
 * `spg.komisiPutus` yang dulu memilihnya sudah tidak dibaca atau ditulis.
 */
export type DasarLama = "BAGI_RATA" | "PER_SPG";

export type DasarResmi = typeof DASAR_TARIF_KATEGORI | DasarLama;

export function bacaDasarResmi(basis: string): DasarResmi {
  if (basis === DASAR_TARIF_KATEGORI) return DASAR_TARIF_KATEGORI;
  return basis === "PER_SPG" ? "PER_SPG" : "BAGI_RATA";
}

/** Baris yang ditetapkan dengan aturan lama (tarif barang / dibagi rata). */
export const aturanLama = (basis: string) => bacaDasarResmi(basis) !== DASAR_TARIF_KATEGORI;

/** Orang yang mungkin menerima: SPG yang bertugas di toko itu, penjual bulan itu, atau pemegang baris resmi. */
export type OrangKomisi = { userId: string; nama: string; ditugaskan: boolean };

export type KomisiPerSpg = {
  userId: string;
  nama: string;
  ditugaskan: boolean;
  /** Potong terkonfirmasi yang dijual orang ini sendiri. */
  potong: number;
  /** Rupiah bulat: potong × tarif kategori bulan penjualan. */
  komisi: number;
  /** Potongnya yang tidak berkomisi karena barangnya tanpa kategori atau kategorinya belum bertarif. */
  potongTanpaTarif: number;
  /** Punya potong terkonfirmasi — mendapat baris resmi saat ditetapkan. */
  penerima: boolean;
};

export type HasilKomisiToko = {
  potongToko: number;
  totalToko: number;
  potongTanpaTarif: number;
  /** Urut: penerima menurut nama, lalu SPG bertugas yang tidak menjual. */
  perSpg: KomisiPerSpg[];
};

const urutNama = (a: { nama: string; userId: string }, b: { nama: string; userId: string }) =>
  a.nama.localeCompare(b.nama) || a.userId.localeCompare(b.userId);

/**
 * Hasil hitungan satu laporan (`commissionPerSpg`) disandingkan dengan orangnya. Penjual yang
 * tidak ada di daftar orang tetap dihitung (namanya id-nya) — potongnya tidak boleh hilang hanya
 * karena pemuatnya lupa menyertakannya. SPG bertugas yang tidak menjual ikut tampil dengan nol.
 */
export function susunKomisiToko(hitung: readonly SpgReportCommission[], orang: readonly OrangKomisi[]): HasilKomisiToko {
  const kenal = new Map(orang.map((o) => [o.userId, o]));
  const penerima: KomisiPerSpg[] = hitung
    .filter((h) => h.pieces > 0)
    .map((h) => {
      const o = kenal.get(h.salesmanId) ?? { userId: h.salesmanId, nama: h.salesmanId, ditugaskan: false };
      return { ...o, potong: h.pieces, komisi: h.amount, potongTanpaTarif: h.noRatePieces, penerima: true };
    })
    .sort(urutNama);
  const idPenerima = new Set(penerima.map((p) => p.userId));
  const lain: KomisiPerSpg[] = orang
    .filter((o) => !idPenerima.has(o.userId))
    .map((o) => ({ ...o, potong: 0, komisi: 0, potongTanpaTarif: 0, penerima: false }))
    .sort(urutNama);
  return {
    potongToko: penerima.reduce((n, p) => n + p.potong, 0),
    totalToko: penerima.reduce((n, p) => n + p.komisi, 0),
    potongTanpaTarif: penerima.reduce((n, p) => n + p.potongTanpaTarif, 0),
    perSpg: [...penerima, ...lain],
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

/** Bulan yang sudah selesai menurut kalender WIB — satu-satunya yang laporannya boleh dicek dan ditetapkan. */
export function bulanSudahSelesai(periode: string, bulanIni: string): boolean {
  return periode < bulanIni;
}

/**
 * `?bulan=lalu` (tautan Beranda "komisi SPG bulan lalu belum ditetapkan"). Penjualan bulan lalu
 * dicek dan dibayar BULAN INI, jadi tautan itu membuka bulan pembayaran berjalan.
 */
export const BULAN_LALU = "lalu";

/** Bulan sebelum `periode` ("2026-01" → "2025-12"). */
export function bulanSebelum(periode: string): string {
  const [th, bl] = periode.split("-").map(Number);
  return bl === 1 ? `${th - 1}-12` : `${th}-${String(bl - 1).padStart(2, "0")}`;
}

/**
 * Parameter `?bulan=` halaman Komisi SPG = BULAN PEMBAYARAN: salah satu pilihan; `lalu` atau
 * selain itu = bulan berjalan (`pilihan[0]`), tempat laporan bulan lalu dicek.
 */
export function bacaBulanBayar(nilai: string | string[] | undefined, pilihan: readonly string[]): string {
  const x = Array.isArray(nilai) ? nilai[0] : nilai;
  if (x && x !== BULAN_LALU && pilihan.includes(x)) return x;
  return pilihan[0];
}

// ---------------------------------------------------------------------------
// Penetapan resmi toko putus
// ---------------------------------------------------------------------------

export type BarisResmiAda = {
  id: string;
  userId: string;
  unitsSold: number;
  commission: number;
  basis: string;
  paidAt: Date | null;
};

export type IsiResmi = { unitsSold: number; commission: number; basis: string };

export type RencanaTetapkan =
  | { ok: false; code: "SUDAH_DIBAYAR" | "TANPA_SPG" }
  | {
      ok: true;
      tulis: { userId: string; isi: IsiResmi; sebelum: (IsiResmi & { id: string }) | null }[];
      hapus: { id: string; userId: string; sebelum: IsiResmi }[];
    };

const isiDari = (b: BarisResmiAda): IsiResmi => ({ unitsSold: b.unitsSold, commission: b.commission, basis: b.basis });

/**
 * Apa yang ditulis saat satu toko putus × satu bulan penjualan ditetapkan (ulang).
 *
 * DITOLAK seluruhnya kalau satu baris saja sudah dibayar: angka toko × bulan itu sudah keluar
 * sebagian, dan menetapkan ulang sebagian lainnya membuat jejaknya tidak lagi menjelaskan satu
 * hitungan. Baris orang yang tidak lagi menerima (potongnya hilang karena pengembalian yang
 * menyusul, atau baris aturan lama) dihapus; jejaknya tetap.
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
        isi: { unitsSold: p.potong, commission: p.komisi, basis: DASAR_TARIF_KATEGORI },
        sebelum: b ? { id: b.id, ...isiDari(b) } : null,
      };
    }),
    hapus: ada.filter((b) => !id.has(b.userId)).map((b) => ({ id: b.id, userId: b.userId, sebelum: isiDari(b) })),
  };
}

const samaSen = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Apakah hitungan sekarang masih sama dengan yang sudah ditetapkan. Berbeda kalau ada nota yang
 * masuk dari antrean HP atau pengembalian sesudah ditetapkan, tarifnya diubah sebelum bulan itu
 * selesai, atau barisnya ditetapkan dengan aturan lama — kantor menetapkan ulang selama belum
 * ada yang dibayar.
 */
export function sudahBerbeda(hasil: HasilKomisiToko, ada: BarisResmiAda[]): boolean {
  if (ada.length === 0) return false;
  const lama = new Map(ada.map((b) => [b.userId, b]));
  const penerima = hasil.perSpg.filter((p) => p.penerima);
  if (penerima.length !== ada.length) return true;
  return penerima.some((p) => {
    const b = lama.get(p.userId);
    return !b || !samaSen(b.commission, p.komisi) || b.unitsSold !== p.potong || aturanLama(b.basis);
  });
}

export type StatusKomisi = "BELUM" | "DITETAPKAN" | "DIBAYAR";

export function statusResmi(b: { paidAt: Date | string | null } | null | undefined): StatusKomisi {
  if (!b) return "BELUM";
  return b.paidAt ? "DIBAYAR" : "DITETAPKAN";
}

// ---------------------------------------------------------------------------
// Koreksi komisi
// ---------------------------------------------------------------------------

/**
 * Berapa bulan PENJUALAN ke belakang yang diperiksa untuk koreksi komisi (dan berapa bulan
 * PEMBAYARAN ke belakang sebuah baris yang belum dibayar masih menjadi tempat koreksi ikut dan
 * masuk daftar tunggakan). Keputusan sementara, ditanyakan ke pemilik: selisih yang lebih tua tidak
 * dikoreksi lagi. Menggeser jendela tidak pernah menerapkan dua kali — jumlah yang sudah diterapkan
 * dibaca dari tabelnya.
 */
export const KOREKSI_JENDELA_BULAN = 12;

/** `AuditLog.entityType` satu koreksi yang diterapkan. */
export const ENTITAS_KOREKSI_KOMISI = "SpgCommissionCorrection";
