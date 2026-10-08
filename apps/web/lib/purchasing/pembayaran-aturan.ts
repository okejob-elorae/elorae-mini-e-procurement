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
  let dasarPotongSen: number | null = null;
  if (input.dasarPotong != null && input.dasarPotong !== "") {
    const d = bacaRupiahSen(input.dasarPotong);
    if (d == null || d > brutoSen) return { ok: false, kode: "DASAR_POTONG_TIDAK_SAH" };
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
export type SisaDokumen = { sisaSen: number; /** 0..1 — bagian alokasi yang menjadi dasar PPh 23/21. */ porsiDasarPotong: number };

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

/**
 * Dasar potongan bawaan:
 * - PPh 4(2) (sewa): seluruh bruto;
 * - PPh 23/21 (jasa): Σ alokasi × porsi dasar potongan dokumennya — jasa
 *   langkah WO memakai nilai jasa tanpa PPN; barang (GRN) dan saldo awal tidak
 *   menjadi dasar. Uang muka tidak menjadi dasar (dipotong saat pelunasannya).
 */
export function dasarPotongBawaanSen(
  jenis: JenisPotongPemasok | null,
  alokasi: readonly AlokasiSah[],
  sisa: ReadonlyMap<string, SisaDokumen>,
  brutoSen: number,
): number {
  if (!jenis) return 0;
  if (jenis === "PPH4_2") return brutoSen;
  return alokasi.reduce((s, a) => s + Math.round(a.sen * (sisa.get(kunciDokumenHutang(a.jenis, a.id))?.porsiDasarPotong ?? 0)), 0);
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

/** Uraian jurnal pembayaran pemasok (data, selalu Bahasa Indonesia). */
export function uraianJurnalPembayaran(nomor: string, namaPemasok: string, referensi: string | null): string {
  return `Pembayaran pemasok ${nomor} · ${namaPemasok}${referensi ? ` · ${referensi}` : ""}`.slice(0, 500);
}

/** Memo baris hutang per alokasi (tampil di buku besar). */
export function memoAlokasi(jenis: string, label: string): string {
  const awal = jenis === "GRN" ? "Bayar penerimaan" : jenis === "WO_STEP" ? "Bayar jasa" : jenis === "OTHER" ? "Bayar utang saldo awal" : "Bayar";
  return `${awal} ${label}`.trim().slice(0, 191);
}
