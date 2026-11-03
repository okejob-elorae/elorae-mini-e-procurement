import { formatRupiah } from "@/lib/format/rupiah";
import { hargaBersihPotong } from "./tutup-hari";

/**
 * Beban SPG (`SpgCharge`) — bagian murni, aman di klien.
 *
 * Sumbernya satu: retur pembeli yang DITOLAK kantor padahal uang pembeli sudah
 * dikembalikan kasir (P13: "itu adalah salah SPG dan SPG yang harus ganti
 * rugi"; P13a). Besarnya harga bersih di nota SPG untuk potong itu, atau angka
 * struk yang ditetapkan kantor dengan alasan (P81). Tanpa kredit ke toko (P80).
 *
 * Dipotong di SETIAP pembayaran SPG itu (P11a "langsung potong"): dari bagian
 * komisi dulu, lalu gaji pokok (P5), tidak pernah di bawah Rp 0, sisanya
 * dibawa ke pembayaran berikutnya; tidak ada yang diikhlaskan (P6). SPG yang
 * berhenti: sisanya menjadi utang SPG di pembayaran terakhirnya (P6a) —
 * statusnya DIUTANGKAN, dan baru dianggap sudah diganti sesudah utang itu lunas.
 *
 * Sesudah diganti penuh, kantor memilih SEKALI (P79): uang SPG dikembalikan di
 * pembayaran berikutnya dan barangnya masuk stok (KEMBALI_STOK), atau barangnya
 * dibeli SPG (DIBELI_SPG).
 *
 * Penulisnya `./beban-spg-writer`, pembacanya `./beban-spg-queries`. Satu
 * langkah alokasi pemotongan ada di perencana bayar komisi SPG, yang memanggil
 * `terapkanBebanSpg` (atau `bagiBebanKeBaris` untuk beberapa baris belum
 * dibayar) sebagai golongan pengurang TERAKHIR.
 */

export const SUMBER_BEBAN_SPG = ["RETUR_PEMBELI"] as const;
export type SumberBebanSpg = (typeof SUMBER_BEBAN_SPG)[number];

/** `AuditLog.entityType` beban SPG. */
export const ENTITAS_BEBAN_SPG = "SpgCharge";

/**
 * TERBUKA: masih dipotong. LUNAS: habis dipotong dari bayaran. DIUTANGKAN:
 * sisanya dipindah ke utang SPG di pembayaran terakhirnya (diganti sesudah utang
 * itu lunas). BATAL: penolakannya dibatalkan kantor (P82).
 */
export const STATUS_BEBAN_SPG = ["TERBUKA", "LUNAS", "DIUTANGKAN", "BATAL"] as const;
export type StatusBebanSpg = (typeof STATUS_BEBAN_SPG)[number];

export const KEPUTUSAN_BARANG_BEBAN = ["KEMBALI_STOK", "DIBELI_SPG"] as const;
export type KeputusanBarangBeban = (typeof KEPUTUSAN_BARANG_BEBAN)[number];

/** `SpgChargeDeduction.paidRefType` sisa beban yang dipindah ke utang SPG (sama dengan `REF_UTANG_SPG`). */
export const REF_BEBAN_KE_UTANG = "SpgDebt";

/** Jenis toko beban (salinan `Store.termsType` saat beban dibuat) — kanal jurnalnya. */
export type JenisTokoBeban = "PUTUS" | "KONSI";

export function bacaStatusBebanSpg(v: unknown): StatusBebanSpg | null {
  return typeof v === "string" && (STATUS_BEBAN_SPG as readonly string[]).includes(v) ? (v as StatusBebanSpg) : null;
}

export function bacaKeputusanBarangBeban(v: unknown): KeputusanBarangBeban | null {
  return typeof v === "string" && (KEPUTUSAN_BARANG_BEBAN as readonly string[]).includes(v) ? (v as KeputusanBarangBeban) : null;
}

export const bacaJenisTokoBeban = (v: unknown): JenisTokoBeban => (v === "KONSI" ? "KONSI" : "PUTUS");

/** Beban yang masih terbuka, untuk perencana bayar (terlama dulu). */
export type BebanSpgTerbuka = {
  id: string;
  sumber: SumberBebanSpg;
  sumberId: string;
  docNo: string;
  storeId: string;
  jenisToko: JenisTokoBeban;
  /** ISO. */
  dibuatPada: string;
  sisa: number;
};

/** Uang beban yang dikembalikan ke SPG (KEMBALI_STOK) dan belum dibayarkan — dibayar PENUH di pembayaran berikutnya. */
export type KembaliBebanTerbuka = { id: string; docNo: string; storeId: string; jenisToko: JenisTokoBeban; jumlah: number };

export type BarisBebanDipotong = {
  chargeId: string;
  sumber: SumberBebanSpg;
  sumberId: string;
  docNo: string;
  storeId: string;
  jenisToko: JenisTokoBeban;
  sisaSebelum: number;
  diterapkan: number;
  dariKomisi: number;
  dariGaji: number;
  dibawa: number;
};

export type BarisKembaliBeban = { chargeId: string; docNo: string; storeId: string; jenisToko: JenisTokoBeban; jumlah: number };

const keSen = (rupiah: number): number => Math.round(rupiah * 100);
const dariSen = (sen: number): number => sen / 100;
const bulat2 = (n: number): number => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ besarnya */

type BarisNilai = { qty: number; saleLine: { qty: number; lineTotal: number | null; unitPrice: number } };

/**
 * Nilai bersih potong di satu baris laporan: qty × harga bersih per potong baris
 * nota (total baris ÷ qty, sesudah promo dan diskon; harga satuan bila total
 * baris kosong). Angka yang SAMA dengan "Nilai" di rincian kantor.
 */
export function nilaiBersihBarisRetur(l: BarisNilai): number {
  return bulat2(l.qty * hargaBersihPotong({ qty: l.saleLine.qty, lineTotal: l.saleLine.lineTotal, unitPrice: l.saleLine.unitPrice }));
}

/** Besar beban yang dihitung sistem (P81): Σ nilai bersih setiap baris laporan, dibulatkan per baris. */
export function nilaiBebanReturPembeli(lines: readonly BarisNilai[]): number {
  return dariSen(lines.reduce((n, l) => n + keSen(nilaiBersihBarisRetur(l)), 0));
}

/** Batas `Decimal(15, 2)`. */
const MAKS_SEN = 999_999_999_999_999;

/**
 * Besar beban yang ditetapkan kantor saat menolak (P81). Kosong → angka
 * sistem. Angka lain: > 0, paling banyak dua desimal, muat di Decimal(15, 2),
 * dan wajib beralasan bila berbeda dari angka sistem.
 */
export function periksaBesarBeban(i: {
  besar: unknown;
  dihitung: number;
  alasan: unknown;
}): { ok: true; besar: number; alasan: string | null } | { ok: false; alasan: "BESAR_BEBAN_TIDAK_VALID" | "ALASAN_BESAR_BEBAN_WAJIB" | "ALASAN_TERLALU_PANJANG" } {
  if (i.besar === undefined || i.besar === null || i.besar === "") return { ok: true, besar: i.dihitung, alasan: null };
  const n = typeof i.besar === "number" ? i.besar : typeof i.besar === "string" ? Number(i.besar.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return { ok: false, alasan: "BESAR_BEBAN_TIDAK_VALID" };
  const sen = Math.round(n * 100);
  if (Math.abs(sen - n * 100) > 1e-6 || sen > MAKS_SEN) return { ok: false, alasan: "BESAR_BEBAN_TIDAK_VALID" };
  if (sen === keSen(i.dihitung)) return { ok: true, besar: dariSen(sen), alasan: null };
  const alasan = typeof i.alasan === "string" ? i.alasan.trim() : "";
  if (!alasan) return { ok: false, alasan: "ALASAN_BESAR_BEBAN_WAJIB" };
  if (Array.from(alasan).length > 500) return { ok: false, alasan: "ALASAN_TERLALU_PANJANG" };
  return { ok: true, besar: dariSen(sen), alasan };
}

/* ------------------------------------------------------------- pemotongan */

const urutTerlama = <T extends { dibuatPada: string; id: string }>(beban: readonly T[]): T[] =>
  [...beban].sort((a, b) => (a.dibuatPada < b.dibuatPada ? -1 : a.dibuatPada > b.dibuatPada ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Potong beban terbuka dari SATU pembayaran: terlama dulu, bagian komisi dulu
 * lalu gaji pokok, tidak pernah di bawah Rp 0, dalam sen bulat. Bagian komisi
 * dan gaji yang masuk = yang TERSISA sesudah pengurang sebelumnya (koreksi
 * minus, beban barang hilang). Setiap beban muncul di `baris` — yang tidak
 * kebagian apa pun dengan `diterapkan` 0 dan seluruhnya `dibawa`.
 */
export function terapkanBebanSpg(i: { sisaKomisiSen: number; sisaGajiSen: number; beban: readonly BebanSpgTerbuka[] }): {
  baris: BarisBebanDipotong[];
  jumlahSen: number;
  sisaKomisiSen: number;
  sisaGajiSen: number;
} {
  let komisi = Math.max(0, Math.floor(i.sisaKomisiSen));
  let gaji = Math.max(0, Math.floor(i.sisaGajiSen));
  let jumlahSen = 0;
  const baris: BarisBebanDipotong[] = [];
  for (const b of urutTerlama(i.beban)) {
    const sisaSen = Math.max(0, keSen(b.sisa));
    const dariKomisi = Math.min(komisi, sisaSen);
    komisi -= dariKomisi;
    const dariGaji = Math.min(gaji, sisaSen - dariKomisi);
    gaji -= dariGaji;
    const diterapkan = dariKomisi + dariGaji;
    jumlahSen += diterapkan;
    baris.push({
      chargeId: b.id,
      sumber: b.sumber,
      sumberId: b.sumberId,
      docNo: b.docNo,
      storeId: b.storeId,
      jenisToko: b.jenisToko,
      sisaSebelum: dariSen(sisaSen),
      diterapkan: dariSen(diterapkan),
      dariKomisi: dariSen(dariKomisi),
      dariGaji: dariSen(dariGaji),
      dibawa: dariSen(sisaSen - diterapkan),
    });
  }
  return { baris, jumlahSen, sisaKomisiSen: komisi, sisaGajiSen: gaji };
}

/**
 * Beberapa baris gaji & komisi SPG yang sama belum dibayar: beban dibagi
 * BERURUTAN menurut urutan bayar yang diberikan pemanggil — setiap baris hanya
 * menunjukkan yang benar-benar akan diambil pembayarannya, jadi beban yang sama
 * tidak tampak terpotong dua kali (tampilan = pembayaran).
 */
export function bagiBebanKeBaris<K extends string>(
  baris: ReadonlyArray<{ ref: K; sisaKomisiSen: number; sisaGajiSen: number }>,
  beban: readonly BebanSpgTerbuka[],
): Map<K, ReturnType<typeof terapkanBebanSpg>> {
  const hasil = new Map<K, ReturnType<typeof terapkanBebanSpg>>();
  let sisa = urutTerlama(beban).map((b) => ({ ...b }));
  for (const r of baris) {
    const t = terapkanBebanSpg({ sisaKomisiSen: r.sisaKomisiSen, sisaGajiSen: r.sisaGajiSen, beban: sisa });
    hasil.set(r.ref, { ...t, baris: t.baris.filter((x) => x.diterapkan > 0) });
    const dibawa = new Map(t.baris.map((x) => [x.chargeId, x.dibawa]));
    sisa = sisa.map((b) => ({ ...b, sisa: dibawa.get(b.id) ?? b.sisa })).filter((b) => keSen(b.sisa) > 0);
  }
  return hasil;
}

/* ------------------------------------------------------------------ keadaan */

/**
 * Sudah diganti penuh (syarat keputusan barang, P79): habis dipotong dari
 * bayaran (LUNAS), atau sisanya dipindah ke utang SPG dan SETIAP utang itu
 * sudah lunas (DIUTANGKAN). Selama ada utang terbuka, belum.
 */
export function bebanSudahDiganti(c: { status: string; utang: ReadonlyArray<{ lunas: boolean }> }): boolean {
  if (c.status === "LUNAS") return true;
  return c.status === "DIUTANGKAN" && c.utang.length > 0 && c.utang.every((u) => u.lunas);
}

export const KEADAAN_BEBAN_SPG = ["TERBUKA", "DIUTANGKAN", "MENUNGGU_KEPUTUSAN_BARANG", "DIBELI_SPG", "KEMBALI_STOK", "BATAL"] as const;
export type KeadaanBebanSpg = (typeof KEADAAN_BEBAN_SPG)[number];

/** Label keadaan beban untuk HP dan kantor. */
export function keadaanBebanSpg(c: { status: string; goodsDecision: string | null; diganti: boolean }): KeadaanBebanSpg {
  if (c.status === "BATAL") return "BATAL";
  if (c.goodsDecision === "KEMBALI_STOK") return "KEMBALI_STOK";
  if (c.goodsDecision === "DIBELI_SPG") return "DIBELI_SPG";
  if (c.diganti) return "MENUNGGU_KEPUTUSAN_BARANG";
  return c.status === "DIUTANGKAN" ? "DIUTANGKAN" : "TERBUKA";
}

/* -------------------------------------------------------------------- teks */

/** `SpgCharge.note`. */
export function teksBebanReturPembeli(docNo: string): string {
  return `Beban retur pembeli ditolak — nota ${docNo}`;
}

/**
 * Kalimat potongan dan pengembalian beban untuk kabar pembayaran SPG: "Dipotong
 * beban retur pembeli ditolak (nota X) Rp Y.", sisa yang dibawa, dan
 * "Pengembalian beban (nota X) Rp Z.". Kosong bila tidak ada keduanya.
 */
export function kalimatBebanKabar(beban: readonly BarisBebanDipotong[], kembali: readonly BarisKembaliBeban[]): string {
  const bagian: string[] = [];
  const dipotong = beban.filter((b) => b.diterapkan > 0);
  if (dipotong.length > 0) {
    const nota = dipotong.map((b) => b.docNo).join(", ");
    const jumlah = dariSen(dipotong.reduce((n, b) => n + keSen(b.diterapkan), 0));
    bagian.push(`Dipotong beban retur pembeli ditolak (nota ${nota}) ${formatRupiah(jumlah)}.`);
  }
  const dibawa = dariSen(beban.reduce((n, b) => n + keSen(b.dibawa), 0));
  if (dibawa > 0) bagian.push(`Sisa beban ${formatRupiah(dibawa)} dipotong di pembayaran berikutnya.`);
  if (kembali.length > 0) {
    const nota = kembali.map((k) => k.docNo).join(", ");
    const jumlah = dariSen(kembali.reduce((n, k) => n + keSen(k.jumlah), 0));
    bagian.push(`Pengembalian beban (nota ${nota}) ${formatRupiah(jumlah)}.`);
  }
  return bagian.join(" ");
}
