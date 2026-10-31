import { bacaJenisPotongPemasok, hitungPotongPemasok, type JenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { bacaRupiahSen, tanggalKalenderSah } from "@/lib/finance/kas/aturan";
import type { TarifPajakKreatif } from "@/lib/creative/pph";

/**
 * Pembayaran pemasok (`SupplierPayment`, rancangan D2) — MURNI, aman untuk klien.
 *
 * Satu pembayaran = satu transfer/kas/giro ke SATU pemasok, bisa membayar
 * banyak dokumen hutang sekaligus (alokasi), sebagian atau penuh, dan bisa
 * menyisakan uang muka. Jumlah alokasi adalah bagian BRUTO hutang yang
 * diselesaikan (sebelum PPh dipotong), sama dengan cara `daftarHutangJasa`
 * membacanya.
 *
 * Dokumen hutang yang bisa dialokasikan:
 * - `GRN` — penerimaan barang (hutang dari baris AP jurnal GRN-nya);
 * - `WO_STEP` — jasa langkah WO (ongkos jahit/CMT, `daftarHutangJasa`);
 * - `OTHER` dengan id `SALDO_AWAL` — hutang saldo awal pemasok (jurnal OPENING).
 * `PO` hanya dipakai pembayaran cermin tombol lama "Tandai lunas".
 *
 * Jurnal (`SUMBER_PEMBAYARAN_PEMASOK`, sourceId = id pembayaran), di transaksi
 * yang sama: DR Hutang usaha (bruto, satu baris per dokumen + uang muka) /
 * CR kas/bank (neto) / CR hutang PPh (potongan). Uang muka juga mendebit hutang
 * usaha pemasok itu (saldo debit = uang muka) — keputusan sementara: tidak ada
 * akun uang muka pembelian terpisah.
 *
 * PPh atas dokumen yang sebagian dibayar dengan UANG MUKA (keputusan sementara
 * 2026-10-08, uji akuntansi 2): total PPh yang dipotong atas satu dokumen =
 * tarif × dasar dokumen itu, apa pun urutannya. Uang muka yang diterapkan ke
 * dokumen tanpa dipotong menjadi "uang muka belum dipotong" dokumen itu
 * (`SisaDokumen.uangMukaBelumDipotongSen`), dan ikut dasar pembayaran
 * berikutnya ke dokumen itu. Bila uang muka itu sendiri yang melunasi dokumen,
 * PPh-nya dipotong saat diterapkan (`rencanaPotongPenerapan`,
 * `pembayaran-uang-muka.ts`). Uang muka yang sudah dipotong saat dibayar
 * (PPh 4(2), atau dasar yang diketik) tidak dipotong lagi.
 *
 * Semua uang dalam SEN.
 */

export const SUMBER_PEMBAYARAN_PEMASOK = "SUPPLIER_PAYMENT_DOC";
export const SUMBER_PEMBAYARAN_PEMASOK_BALIK = "SUPPLIER_PAYMENT_DOC_REVERSAL";

export const TARGET_ALOKASI = { PO: "PO", GRN: "GRN", WO_STEP: "WO_STEP", LAIN: "OTHER" } as const;
export type TargetAlokasi = (typeof TARGET_ALOKASI)[keyof typeof TARGET_ALOKASI];
/** `targetId` alokasi `OTHER` untuk hutang saldo awal pemasok. */
export const ID_SALDO_AWAL = "SALDO_AWAL";

/** Awalan `idempotencyKey` pembayaran cermin tombol "Tandai lunas" (`tandai-lunas:<poId>#<generasi>`). */
export const AWALAN_KUNCI_TANDAI_LUNAS = "tandai-lunas:";
export function kunciTandaiLunas(poId: string, generasi: number): string {
  return `${AWALAN_KUNCI_TANDAI_LUNAS}${poId}#${generasi}`;
}
export function adalahCerminTandaiLunas(idempotencyKey: string | null | undefined): boolean {
  return typeof idempotencyKey === "string" && idempotencyKey.startsWith(AWALAN_KUNCI_TANDAI_LUNAS);
}

export const CARA_BAYAR = ["TRANSFER", "CASH", "GIRO"] as const;
export type CaraBayar = (typeof CARA_BAYAR)[number];
export function bacaCaraBayar(v: unknown): CaraBayar | null {
  return typeof v === "string" && (CARA_BAYAR as readonly string[]).includes(v) ? (v as CaraBayar) : null;
}

export const STATUS_PEMBAYARAN = { BERLAKU: "POSTED", BATAL: "CANCELLED" } as const;

export const MAKS_ALOKASI = 200;

export const KODE_GALAT_PEMBAYARAN = [
  "PEMASOK_WAJIB",
  "TANGGAL_TIDAK_SAH",
  "TANGGAL_MASA_DEPAN",
  "CARA_TIDAK_SAH",
  "REKENING_WAJIB",
  "REKENING_TIDAK_SAH",
  "ALOKASI_TIDAK_SAH",
  "ALOKASI_GANDA",
  "TERLALU_BANYAK_ALOKASI",
  "JUMLAH_TIDAK_SAH",
  "MELEBIHI_SISA",
  "DOKUMEN_TIDAK_DITEMUKAN",
  "BUKAN_PEMASOK_INI",
  "KOSONG",
  "POTONG_TIDAK_SAH",
  "DASAR_POTONG_TIDAK_SAH",
  "TEKS_TERLALU_PANJANG",
  "PEMASOK_TIDAK_DITEMUKAN",
  "PO_DITANDAI_LUNAS",
  "DIBAYAR_LEWAT_TAGIHAN_VENDOR",
  "UNMAPPED_ROLE",
  "NON_POSTABLE_ACCOUNT",
  "TIDAK_DITEMUKAN",
  "SUDAH_DIBATALKAN",
  "ALASAN_WAJIB",
  "PAKAI_BATAL_TANDAI_LUNAS",
  "BUKAN_UANG_MUKA",
  "MELEBIHI_UANG_MUKA",
  "FOTO_TIDAK_SAH",
] as const;
export type KodeGalatPembayaran = (typeof KODE_GALAT_PEMBAYARAN)[number];

export type IsianAlokasi = { jenis: unknown; id: unknown; jumlah: unknown };

export type IsianPembayaran = {
  pemasokId: unknown;
  tanggal: unknown;
  cara: unknown;
  rekeningId: unknown;
  referensi?: unknown;
  jatuhTempoGiro?: unknown;
  catatan?: unknown;
  fotoUrl?: unknown;
  alokasi?: unknown;
  uangMuka?: unknown;
  /** null/"" = tidak dipotong. undefined = pakai jenis potong pemasok (server). */
  jenisPotong?: unknown;
  /** Dasar potongan yang diketik; kosong = dihitung (`dasarPotongBawaan`). */
  dasarPotong?: unknown;
};

export type AlokasiSah = { jenis: Exclude<TargetAlokasi, "PO">; id: string; sen: number };

export type PembayaranSah = {
  pemasokId: string;
  tanggal: string;
  cara: CaraBayar;
  rekeningId: string;
  referensi: string | null;
  jatuhTempoGiro: string | null;
  catatan: string | null;
  fotoUrl: string | null;
  alokasi: AlokasiSah[];
  uangMukaSen: number;
  brutoSen: number;
  /** undefined = belum ditetapkan pemanggil (pakai pemasok). */
  jenisPotong: JenisPotongPemasok | null | undefined;
  dasarPotongSen: number | null;
};

function teks(v: unknown, maks: number): { ok: true; nilai: string | null } | { ok: false } {
  if (v == null) return { ok: true, nilai: null };
  if (typeof v !== "string") return { ok: false };
  const t = v.trim();
  if (!t) return { ok: true, nilai: null };
  return t.length > maks ? { ok: false } : { ok: true, nilai: t };
}

export function periksaPembayaran(
  input: IsianPembayaran,
  hariIni: string,
): { ok: true; pembayaran: PembayaranSah } | { ok: false; kode: KodeGalatPembayaran; baris?: number } {
  const pemasokId = typeof input.pemasokId === "string" && input.pemasokId.trim() ? input.pemasokId.trim() : null;
  if (!pemasokId) return { ok: false, kode: "PEMASOK_WAJIB" };
  const tanggal = typeof input.tanggal === "string" ? input.tanggal.trim() : "";
  if (!tanggalKalenderSah(tanggal)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  if (tanggal > hariIni) return { ok: false, kode: "TANGGAL_MASA_DEPAN" };
  const cara = bacaCaraBayar(input.cara);
  if (!cara) return { ok: false, kode: "CARA_TIDAK_SAH" };
  const rekeningId = typeof input.rekeningId === "string" && input.rekeningId.trim() ? input.rekeningId.trim() : null;
  if (!rekeningId) return { ok: false, kode: "REKENING_WAJIB" };
  const referensi = teks(input.referensi, 191);
  const catatan = teks(input.catatan, 1000);
  const foto = teks(input.fotoUrl, 500);
  if (!referensi.ok || !catatan.ok || !foto.ok) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  let jatuhTempoGiro: string | null = null;
  if (typeof input.jatuhTempoGiro === "string" && input.jatuhTempoGiro.trim()) {
    if (!tanggalKalenderSah(input.jatuhTempoGiro.trim())) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
    jatuhTempoGiro = cara === "GIRO" ? input.jatuhTempoGiro.trim() : null;
  }

  const daftar = input.alokasi == null ? [] : input.alokasi;
  if (!Array.isArray(daftar)) return { ok: false, kode: "ALOKASI_TIDAK_SAH" };
  if (daftar.length > MAKS_ALOKASI) return { ok: false, kode: "TERLALU_BANYAK_ALOKASI" };
  const alokasi: AlokasiSah[] = [];
  const dilihat = new Set<string>();
  for (let i = 0; i < daftar.length; i++) {
    const a = (daftar[i] ?? {}) as IsianAlokasi;
    const jenis = a.jenis;
    if (jenis !== "GRN" && jenis !== "WO_STEP" && jenis !== "OTHER") return { ok: false, kode: "ALOKASI_TIDAK_SAH", baris: i + 1 };
    const id = typeof a.id === "string" && a.id.trim() ? a.id.trim() : null;
    if (!id || (jenis === "OTHER" && id !== ID_SALDO_AWAL)) return { ok: false, kode: "ALOKASI_TIDAK_SAH", baris: i + 1 };
    const kunci = `${jenis}|${id}`;
    if (dilihat.has(kunci)) return { ok: false, kode: "ALOKASI_GANDA", baris: i + 1 };
    dilihat.add(kunci);
    const sen = bacaRupiahSen(a.jumlah);
    if (sen == null || sen < 0) return { ok: false, kode: "JUMLAH_TIDAK_SAH", baris: i + 1 };
    if (sen === 0) continue; // baris yang dikosongkan di formulir.
    alokasi.push({ jenis, id, sen });
  }
  let uangMukaSen = 0;
  if (input.uangMuka != null && input.uangMuka !== "") {
    const s = bacaRupiahSen(input.uangMuka);
    if (s == null) return { ok: false, kode: "JUMLAH_TIDAK_SAH" };
    uangMukaSen = s;
  }
  const brutoSen = alokasi.reduce((s, a) => s + a.sen, 0) + uangMukaSen;
  if (brutoSen <= 0) return { ok: false, kode: "KOSONG" };

  let jenisPotong: JenisPotongPemasok | null | undefined = undefined;
  if (input.jenisPotong === null || input.jenisPotong === "" || input.jenisPotong === "NONE") jenisPotong = null;
  else if (input.jenisPotong !== undefined) {
    const j = bacaJenisPotongPemasok(input.jenisPotong);
    if (!j) return { ok: false, kode: "POTONG_TIDAK_SAH" };
    jenisPotong = j;
  }
  // Batas atasnya (bruto + uang muka belum dipotong dokumen yang dibayar,
  // `batasDasarPotongSen`) diperiksa penulis sesudah membaca buku pembantu.
  let dasarPotongSen: number | null = null;
  if (input.dasarPotong != null && input.dasarPotong !== "") {
    const d = bacaRupiahSen(input.dasarPotong);
    if (d == null) return { ok: false, kode: "DASAR_POTONG_TIDAK_SAH" };
    dasarPotongSen = d;
  }

  return {
    ok: true,
    pembayaran: {
      pemasokId,
      tanggal,
      cara,
      rekeningId,
      referensi: referensi.nilai,
      jatuhTempoGiro,
      catatan: catatan.nilai,
      fotoUrl: foto.nilai,
      alokasi,
      uangMukaSen,
      brutoSen,
      jenisPotong,
      dasarPotongSen,
    },
  };
}

/** Sisa satu dokumen hutang, dengan dasar potongan per rupiah (jasa: DPP tanpa PPN ÷ tagihan). */
export type SisaDokumen = {
  sisaSen: number;
  /** 0..1 — bagian alokasi yang menjadi dasar PPh 23/21. */
  porsiDasarPotong: number;
  /**
   * Bruto uang muka yang sudah diterapkan ke dokumen ini tetapi PPh-nya belum
   * dipotong. Negatif = kredit: sudah dipotong lebih dulu (pembayaran uang
   * mukanya kemudian dibatalkan) — mengurangi dasar pembayaran berikutnya.
   */
  uangMukaBelumDipotongSen?: number;
};

/** Kunci peta sisa: `GRN|<id>`, `WO_STEP|<id>`, `OTHER|SALDO_AWAL`. */
export const kunciDokumenHutang = (jenis: string, id: string) => `${jenis}|${id}`;

/** Setiap alokasi tidak melebihi sisa dokumennya (sisa sebelum pembayaran ini). */
export function periksaAlokasiTerhadapSisa(
  alokasi: readonly AlokasiSah[],
  sisa: ReadonlyMap<string, SisaDokumen>,
): { ok: true } | { ok: false; kode: "DOKUMEN_TIDAK_DITEMUKAN" | "MELEBIHI_SISA"; baris: number } {
  for (let i = 0; i < alokasi.length; i++) {
    const a = alokasi[i];
    const s = sisa.get(kunciDokumenHutang(a.jenis, a.id));
    if (!s) return { ok: false, kode: "DOKUMEN_TIDAK_DITEMUKAN", baris: i + 1 };
    if (a.sen > s.sisaSen) return { ok: false, kode: "MELEBIHI_SISA", baris: i + 1 };
  }
  return { ok: true };
}

/** Porsi dasar potongan sebuah dokumen untuk jenis potong ini: PPh 4(2) memotong seluruh bruto. */
export function porsiPotongEfektif(jenis: JenisPotongPemasok | null, s: SisaDokumen | undefined): number {
  if (!jenis) return 0;
  if (jenis === "PPH4_2") return 1;
  return s?.porsiDasarPotong ?? 0;
}

const belumDipotong = (s: SisaDokumen | undefined) => s?.uangMukaBelumDipotongSen ?? 0;

/**
 * Dasar potongan bawaan:
 * - PPh 4(2) (sewa): seluruh bruto (termasuk uang muka pembayaran ini);
 * - PPh 23/21 (jasa): Σ alokasi × porsi dasar potongan dokumennya — jasa
 *   langkah WO memakai nilai jasa tanpa PPN; barang (GRN) dan saldo awal tidak
 *   menjadi dasar. Uang muka pembayaran INI tidak menjadi dasar (dokumennya
 *   belum diketahui).
 * Keduanya ditambah uang muka yang sudah diterapkan ke dokumen yang dibayar
 * tetapi belum dipotong (kredit mengurangi, tidak pernah di bawah nol per dokumen).
 */
export function dasarPotongBawaanSen(
  jenis: JenisPotongPemasok | null,
  alokasi: readonly AlokasiSah[],
  sisa: ReadonlyMap<string, SisaDokumen>,
  brutoSen: number,
): number {
  if (!jenis) return 0;
  if (jenis === "PPH4_2") {
    return alokasi.reduce((s, a) => s + Math.max(0, a.sen + belumDipotong(sisa.get(kunciDokumenHutang(a.jenis, a.id)))) - a.sen, brutoSen);
  }
  return alokasi.reduce((s, a) => {
    const d = sisa.get(kunciDokumenHutang(a.jenis, a.id));
    return s + Math.round(Math.max(0, a.sen + belumDipotong(d)) * porsiPotongEfektif(jenis, d));
  }, 0);
}

/** Dasar potongan terbesar yang boleh diketik: bruto + uang muka belum dipotong dokumen yang dibayar. */
export function batasDasarPotongSen(alokasi: readonly AlokasiSah[], sisa: ReadonlyMap<string, SisaDokumen>, brutoSen: number): number {
  return alokasi.reduce((s, a) => s + Math.max(0, belumDipotong(sisa.get(kunciDokumenHutang(a.jenis, a.id)))), brutoSen);
}

/**
 * Uang muka tertunda yang DITUTUP pembayaran ini (dicatat di jejaknya,
 * `uangMukaDipotong`): untuk setiap dokumen yang dibayar dan ikut dasar
 * potongan, seluruh uang muka belum dipotongnya — atau, bila PPh terpotong
 * bruto pembayaran (`faktor` < 1), sebagian sebanding. Kredit (negatif) dipakai
 * sebesar yang mengurangi dasar alokasi itu.
 */
export function cakupanUangMukaDipotong(
  jenis: JenisPotongPemasok | null,
  alokasi: readonly AlokasiSah[],
  sisa: ReadonlyMap<string, SisaDokumen>,
  faktor = 1,
): Array<{ jenis: AlokasiSah["jenis"]; id: string; sen: number }> {
  if (!jenis) return [];
  const hasil: Array<{ jenis: AlokasiSah["jenis"]; id: string; sen: number }> = [];
  for (const a of alokasi) {
    const d = sisa.get(kunciDokumenHutang(a.jenis, a.id));
    const belum = belumDipotong(d);
    if (belum === 0 || porsiPotongEfektif(jenis, d) <= 0) continue;
    const sen = belum > 0 ? (faktor >= 1 ? belum : Math.floor(belum * Math.max(0, faktor))) : Math.max(belum, -a.sen);
    if (sen !== 0) hasil.push({ jenis: a.jenis, id: a.id, sen });
  }
  return hasil;
}

/**
 * Bagian UANG MUKA pembayaran ini yang sudah dipotong saat dibayar (dicatat di
 * jejaknya, `uangMukaTerpotong`): dasar potongan dikurangi dasar alokasinya,
 * paling banyak sebesar uang mukanya. PPh 4(2) bawaan → seluruh uang muka;
 * PPh 23/21 bawaan → nol (dipotong kemudian); dasar yang diketik lebih besar →
 * kelebihannya. Saat uang muka ini diterapkan, bagian ini tidak dipotong lagi.
 */
export function uangMukaTerpotongSen(
  jenis: JenisPotongPemasok | null,
  alokasi: readonly AlokasiSah[],
  sisa: ReadonlyMap<string, SisaDokumen>,
  uangMukaSen: number,
  dasarPotongSen: number,
  faktor = 1,
): number {
  if (!jenis || uangMukaSen <= 0 || dasarPotongSen <= 0) return 0;
  const tanpaUangMuka = dasarPotongBawaanSen(jenis, alokasi, sisa, alokasi.reduce((s, a) => s + a.sen, 0));
  const v = Math.min(uangMukaSen, Math.max(0, dasarPotongSen - tanpaUangMuka));
  return faktor >= 1 ? v : Math.floor(v * Math.max(0, faktor));
}

export type HitunganPembayaran = { brutoSen: number; dasarPotongSen: number; potongSen: number; netoSen: number };

export function hitungPembayaran(
  brutoSen: number,
  jenis: JenisPotongPemasok | null,
  dasarPotongSen: number,
  adaNpwp: boolean,
  tarif?: TarifPajakKreatif,
): HitunganPembayaran {
  if (!jenis || dasarPotongSen <= 0) return { brutoSen, dasarPotongSen: 0, potongSen: 0, netoSen: brutoSen };
  const r = hitungPotongPemasok(dasarPotongSen / 100, jenis, { adaNpwp }, tarif);
  const potongSen = Math.min(Math.round(r.pph * 100), brutoSen);
  return { brutoSen, dasarPotongSen, potongSen, netoSen: brutoSen - potongSen };
}

/**
 * Bagian PPh yang benar-benar terpotong: 1, kecuali PPh dibatasi bruto
 * pembayaran (bayar kecil atas dokumen yang uang muka belum dipotongnya besar)
 * — maka potongan ÷ PPh penuh. Dipakai untuk mencatat cakupan sebanding.
 */
export function faktorPotongPenuh(
  h: HitunganPembayaran,
  jenis: JenisPotongPemasok | null,
  adaNpwp: boolean,
  tarif?: TarifPajakKreatif,
): number {
  if (!jenis || h.potongSen <= 0) return 0;
  const penuhSen = Math.round(hitungPotongPemasok(h.dasarPotongSen / 100, jenis, { adaNpwp }, tarif).pph * 100);
  return penuhSen > h.potongSen ? h.potongSen / penuhSen : 1;
}

/** Uraian jurnal pembayaran pemasok (data, selalu Bahasa Indonesia). */
export function uraianJurnalPembayaran(nomor: string, namaPemasok: string, referensi: string | null): string {
  return `Pembayaran pemasok ${nomor} · ${namaPemasok}${referensi ? ` · ${referensi}` : ""}`.slice(0, 500);
}

/** Memo baris hutang per alokasi (tampil di buku besar). */
export function memoAlokasi(jenis: string, label: string): string {
  const awal = jenis === "GRN" ? "Bayar penerimaan" : jenis === "WO_STEP" ? "Bayar jasa" : jenis === "OTHER" ? "Bayar utang saldo awal" : "Bayar";
  return `${awal} ${label}`.trim().slice(0, 191);
}
