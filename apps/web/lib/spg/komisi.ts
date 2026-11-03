import { confirmsAnyPiece, type SalesReport, type SpgReportCommission } from "@/lib/spg-commission/payout";
import { detailGajiUntukDisimpan, type DetailGajiTersimpan, type HasilGaji } from "./gaji-pokok";

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

/** `SpgCommission.basis` setiap baris: hitungan tarif kategori (satu-satunya aturan; tidak ada data aturan lama). */
export const DASAR_TARIF_KATEGORI = "TARIF_KATEGORI";

/**
 * Laporan toko putus × bulan yang perlu dicek kantor (B20): ia mengonfirmasi potong untuk seorang SPG,
 * ATAU punya peserta gaji (SPG terjadwal yang bulan itu tidak menjual tetap digaji, P63). Satu
 * definisi untuk "Tandai laporan dicek", antrean "menunggu dicek", dan Beranda.
 */
export function laporanPerluDicek(laporan: SalesReport, peserta: readonly string[]): boolean {
  return peserta.length > 0 || confirmsAnyPiece(laporan);
}

/** Potong yang terjual tanpa kategori barang: komisinya menyusul begitu kategorinya diisi (P69). */
export type TanpaKategori = { itemId: string; potong: number };

/**
 * Potong tanpa kategori per barang dalam satu laporan (dari gerakannya, kategori BARIS nota — P8).
 * Ditampilkan di "Tandai laporan dicek" dan saat mengunci siklus konsinyasi; tidak pernah menolak.
 */
export function potongTanpaKategori(laporan: Pick<SalesReport, "movements">): TanpaKategori[] {
  const per = new Map<string, number>();
  for (const m of laporan.movements) if (m.categoryId === null) per.set(m.itemId, (per.get(m.itemId) ?? 0) + m.qty);
  return [...per]
    .filter(([, q]) => q > 0)
    .map(([itemId, potong]) => ({ itemId, potong }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

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
  baseSalary: number;
  salaryDetail: unknown;
  paidAt: Date | null;
};

export type IsiResmi = { unitsSold: number; commission: number; basis: string };

export type IsiResmiGaji = IsiResmi & { baseSalary: number; salaryDetail: DetailGajiTersimpan | null };

export type RencanaTetapkan =
  | { ok: false; code: "SUDAH_DIBAYAR" | "TANPA_PESERTA" }
  | {
      ok: true;
      tulis: { userId: string; isi: IsiResmiGaji; sebelum: (IsiResmi & { id: string; baseSalary: number }) | null }[];
      hapus: { id: string; userId: string; sebelum: IsiResmi & { baseSalary: number } }[];
    };

const isiDari = (b: BarisResmiAda): IsiResmi & { baseSalary: number } => ({ unitsSold: b.unitsSold, commission: b.commission, basis: b.basis, baseSalary: b.baseSalary });

/**
 * Apa yang ditulis saat satu toko putus × satu bulan penjualan ditetapkan (ulang): SATU baris untuk
 * setiap peserta gaji bulan itu (B19) dan setiap penjual yang mengonfirmasi potong — walau komisinya
 * nol — dengan potret gaji pokoknya (`gaji`, P63). Gaji yang sudah dihitung di baris lain untuk SPG ×
 * bulan yang sama (toko yang berganti syarat) ditulis Rp 0 dengan penunjuk ke baris itu
 * (`diBarisLain`), supaya gaji sebulan tidak pernah dibayar dua kali.
 *
 * DITOLAK seluruhnya kalau satu baris saja sudah dibayar (`SUDAH_DIBAYAR`), atau tanpa peserta dan
 * tanpa penjual (`TANPA_PESERTA`). Baris orang yang tidak lagi ikut dihapus; jejaknya tetap.
 */
export function rencanaTetapkan(
  hasil: HasilKomisiToko,
  ada: BarisResmiAda[],
  peserta: readonly string[],
  gaji: ReadonlyMap<string, HasilGaji | null>,
  diBarisLain: ReadonlyMap<string, { refType: string; refId: string }> = new Map(),
): RencanaTetapkan {
  if (ada.some((b) => b.paidAt !== null)) return { ok: false, code: "SUDAH_DIBAYAR" };
  const perSpg = new Map(hasil.perSpg.map((p) => [p.userId, p]));
  const ikut = [...new Set([...peserta, ...hasil.perSpg.filter((p) => p.penerima).map((p) => p.userId)])].sort();
  if (ikut.length === 0) return { ok: false, code: "TANPA_PESERTA" };
  const lama = new Map(ada.map((b) => [b.userId, b]));
  const id = new Set(ikut);
  return {
    ok: true,
    tulis: ikut.map((userId) => {
      const p = perSpg.get(userId);
      const b = lama.get(userId);
      const lain = diBarisLain.get(userId) ?? null;
      const g = lain ? null : (gaji.get(userId) ?? null);
      return {
        userId,
        isi: {
          unitsSold: p?.potong ?? 0,
          commission: p?.komisi ?? 0,
          basis: DASAR_TARIF_KATEGORI,
          baseSalary: !lain && g && g.ok ? g.rincian.gajiPokok : 0,
          salaryDetail: detailGajiUntukDisimpan(g, lain),
        },
        sebelum: b ? { id: b.id, ...isiDari(b) } : null,
      };
    }),
    hapus: ada.filter((b) => !id.has(b.userId)).map((b) => ({ id: b.id, userId: b.userId, sebelum: isiDari(b) })),
  };
}

const samaSen = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

/**
 * Apakah hitungan sekarang masih sama dengan yang sudah ditetapkan — komisi, potong, peserta, dan
 * potret gaji pokoknya. Berbeda kalau ada nota yang masuk dari antrean HP atau pengembalian sesudah
 * ditetapkan, peserta gajinya berubah, atau dasar gaji bulan itu berubah (catatan check-in yang
 * diperiksa, jadwal yang disetujui) — kantor menetapkan ulang selama belum ada yang dibayar.
 */
export function sudahBerbeda(hasil: HasilKomisiToko, ada: BarisResmiAda[], peserta: readonly string[] = [], gaji: ReadonlyMap<string, HasilGaji | null> = new Map()): boolean {
  if (ada.length === 0) return false;
  const lama = new Map(ada.map((b) => [b.userId, b]));
  const ikut = new Set([...peserta, ...hasil.perSpg.filter((p) => p.penerima).map((p) => p.userId)]);
  if (ikut.size !== ada.length) return true;
  const perSpg = new Map(hasil.perSpg.map((p) => [p.userId, p]));
  return [...ikut].some((userId) => {
    const b = lama.get(userId);
    const p = perSpg.get(userId);
    if (!b || !samaSen(b.commission, p?.komisi ?? 0) || b.unitsSold !== (p?.potong ?? 0)) return true;
    if (!gaji.has(userId)) return false;
    const g = gaji.get(userId) ?? null;
    return !samaSen(b.baseSalary, g && g.ok ? g.rincian.gajiPokok : 0);
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
 * Berapa bulan PENJUALAN ke belakang yang diperiksa untuk koreksi gaji & komisi — jawaban pemilik
 * 2026-11-02 (P10: "cukup"). Selisih yang lebih tua tidak dikoreksi lagi. Baris SASARAN koreksi dan
 * daftar tunggakan tidak dibatasi umur. Menggeser jendela tidak pernah menerapkan dua kali — jumlah
 * yang sudah diterapkan dibaca dari tabelnya.
 */
export const KOREKSI_JENDELA_BULAN = 12;

/** `AuditLog.entityType` satu koreksi yang diterapkan. */
export const ENTITAS_KOREKSI_KOMISI = "SpgCommissionCorrection";
