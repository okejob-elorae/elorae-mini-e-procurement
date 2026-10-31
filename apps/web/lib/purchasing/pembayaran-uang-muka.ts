import { hitungPotongPemasok, type JenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { JEJAK_KAS } from "@/lib/finance/kas/jejak";
import type { TarifPajakKreatif } from "@/lib/creative/pph";
import { dasarPotongBawaanSen, kunciDokumenHutang, porsiPotongEfektif, type AlokasiSah, type SisaDokumen } from "./pembayaran-aturan";

/**
 * PPh atas UANG MUKA pemasok yang diterapkan ke dokumen hutang — MURNI.
 *
 * Masalah (uji akuntansi 2, Okt 2026): jasa jahit Rp 1.225.000, uang muka
 * Rp 500.000 diterapkan, pelunasan Rp 725.000 → PPh 23 hanya Rp 14.500
 * (atas pelunasan); uang muka tidak pernah dipotong. Aturannya sekarang
 * (keputusan sementara 2026-10-08): total PPh atas satu dokumen = tarif × dasar
 * dokumen itu, apa pun urutan uang muka dan pembayarannya.
 *
 * - Uang muka diterapkan ke dokumen yang BELUM lunas → ditunda: menjadi "uang
 *   muka belum dipotong" dokumen itu dan ikut dasar pembayaran berikutnya
 *   (`dasarPotongBawaanSen`), yang mencatat cakupannya (`uangMukaDipotong`).
 * - Uang muka yang MELUNASI dokumen → dipotong saat itu juga
 *   (`rencanaPotongPenerapan`): sebagian dokumen diselesaikan oleh PPh itu
 *   sendiri, dicatat sebagai pembayaran potongan tersendiri (BYR/…, neto 0,
 *   jurnal DR Utang usaha / CR Utang PPh) yang memakai rekening uang mukanya.
 *   Uang muka yang terpakai berkurang sebesar PPh-nya; sisanya tetap uang muka.
 * - Bagian uang muka yang sudah dipotong saat dibayar (PPh 4(2) bawaan, atau
 *   dasar yang diketik) tidak dipotong lagi (`terpotongSen`, dipakai urut).
 *
 * Tanpa kolom baru: penerapan, cakupan, dan bagian yang sudah dipotong dibaca
 * dari jejak pembayarannya (`SUPPLIER_PAYMENT_RECORDED` / `SUPPLIER_ADVANCE_APPLIED`).
 * Semua uang dalam SEN.
 */

/** Awalan `idempotencyKey` pembayaran potongan PPh atas uang muka (`potong-uang-muka:<id uang muka>:<nomor>`). */
export const AWALAN_KUNCI_POTONG_UANG_MUKA = "potong-uang-muka:";

export function kunciPotongUangMuka(pembayaranUangMukaId: string, nomor: string): string {
  return `${AWALAN_KUNCI_POTONG_UANG_MUKA}${pembayaranUangMukaId}:${nomor}`;
}

/** Pembayaran potongan PPh atas uang muka (milik uang muka `dariId` bila diberikan). */
export function adalahPotongUangMuka(idempotencyKey: string | null | undefined, dariId?: string): boolean {
  if (typeof idempotencyKey !== "string" || !idempotencyKey.startsWith(AWALAN_KUNCI_POTONG_UANG_MUKA)) return false;
  return dariId == null || idempotencyKey.startsWith(`${AWALAN_KUNCI_POTONG_UANG_MUKA}${dariId}:`);
}

export type BarisRencanaPotong = {
  jenis: AlokasiSah["jenis"];
  id: string;
  /** Alokasi yang benar-benar diambil dari uang muka (diminta − bagian PPh). */
  dariUangMukaSen: number;
  /** Bagian dokumen yang diselesaikan oleh PPh yang dipotong (alokasi pembayaran potongan). */
  alokasiPotongSen: number;
  dasarSen: number;
  potongSen: number;
  /** Uang muka tertunda dokumen ini yang ditutup pembayaran potongan. */
  cakupanSen: number;
};

export type RencanaPotongPenerapan = {
  baris: BarisRencanaPotong[];
  potongSen: number;
  alokasiPotongSen: number;
  dasarSen: number;
  /** Bagian uang muka yang sudah dipotong saat dibayar, sesudah penerapan ini. */
  sisaPoolSen: number;
};

/**
 * Rencana penerapan uang muka. Untuk setiap dokumen yang LUNAS oleh penerapan
 * ini (diminta = sisa) dan ikut dasar potongan: dasar = uang muka tertunda +
 * bagian yang diminta yang belum dipotong; PPh dihitung per dokumen
 * (dibulatkan ke bawah ke rupiah); bagian dokumen sebesar PPh itu diselesaikan
 * oleh potongannya, sisanya oleh uang muka. Dokumen yang belum lunas: tidak
 * dipotong sekarang.
 */
export function rencanaPotongPenerapan(p: {
  jenis: JenisPotongPemasok | null;
  adaNpwp: boolean;
  tarif?: TarifPajakKreatif;
  alokasi: readonly AlokasiSah[];
  sisa: ReadonlyMap<string, SisaDokumen>;
  poolSen: number;
}): RencanaPotongPenerapan {
  let pool = Math.max(0, p.poolSen);
  const baris: BarisRencanaPotong[] = [];
  for (const a of p.alokasi) {
    const d = p.sisa.get(kunciDokumenHutang(a.jenis, a.id));
    const belum = d?.uangMukaBelumDipotongSen ?? 0;
    const porsi = porsiPotongEfektif(p.jenis, d);
    const lunas = d != null && a.sen === d.sisaSen;
    let dasarSen = 0;
    let potongSen = 0;
    if (p.jenis && lunas && porsi > 0) {
      dasarSen = Math.round(Math.max(0, belum + a.sen - Math.min(pool, a.sen)) * porsi);
      potongSen = dasarSen > 0 ? Math.round(hitungPotongPemasok(dasarSen / 100, p.jenis, { adaNpwp: p.adaNpwp }, p.tarif).pph * 100) : 0;
    }
    const alokasiPotongSen = Math.min(potongSen, a.sen);
    const dariUangMukaSen = a.sen - alokasiPotongSen;
    const dariPool = Math.min(pool, dariUangMukaSen);
    pool -= dariPool;
    baris.push({
      jenis: a.jenis,
      id: a.id,
      dariUangMukaSen,
      alokasiPotongSen,
      dasarSen,
      potongSen,
      cakupanSen: potongSen > 0 ? belum + (dariUangMukaSen - dariPool) : 0,
    });
  }
  return {
    baris,
    potongSen: baris.reduce((s, b) => s + b.potongSen, 0),
    alokasiPotongSen: baris.reduce((s, b) => s + b.alokasiPotongSen, 0),
    dasarSen: baris.reduce((s, b) => s + b.dasarSen, 0),
    sisaPoolSen: pool,
  };
}

/** Data satu pembayaran BERLAKU untuk menghitung uang muka belum dipotong. */
export type DataUangMukaPembayaran = {
  id: string;
  /** Alokasi yang masih ada (kunci dokumen → bruto). */
  alokasi: ReadonlyArray<{ kunci: string; sen: number }>;
  /** Kunci dokumen yang dialokasikan lewat "terapkan uang muka", urut penerapan. */
  diterapkan: readonly string[];
  /** Bagian uang muka pembayaran ini yang sudah dipotong saat dibayar. */
  terpotongSen: number;
  /** Uang muka tertunda yang ditutup (dipotong) pembayaran ini, per dokumen. */
  menutup: ReadonlyArray<{ kunci: string; sen: number }>;
};

/**
 * Uang muka belum dipotong per dokumen = Σ alokasi uang muka (bagian yang tidak
 * tercakup pool "sudah dipotong" pembayaran uang mukanya) − Σ cakupan
 * pembayaran yang memotongnya. Negatif = kredit (sudah dipotong lebih dulu).
 * Juga sisa pool per pembayaran.
 */
export function hitungUangMukaBelumDipotong(daftar: readonly DataUangMukaPembayaran[]): {
  perDokumen: Map<string, number>;
  sisaTerpotong: Map<string, number>;
} {
  const per = new Map<string, number>();
  const tambah = (k: string, sen: number) => per.set(k, (per.get(k) ?? 0) + sen);
  const sisaTerpotong = new Map<string, number>();
  for (const p of daftar) {
    const alokasi = new Map(p.alokasi.map((a) => [a.kunci, a.sen]));
    let pool = Math.max(0, p.terpotongSen);
    const dilihat = new Set<string>();
    for (const k of p.diterapkan) {
      if (dilihat.has(k)) continue;
      dilihat.add(k);
      const sen = alokasi.get(k);
      if (sen == null || sen <= 0) continue;
      const tertutup = Math.min(pool, sen);
      pool -= tertutup;
      tambah(k, sen - tertutup);
    }
    sisaTerpotong.set(p.id, pool);
  }
  for (const p of daftar) for (const m of p.menutup) tambah(m.kunci, -m.sen);
  for (const [k, v] of [...per]) if (v === 0) per.delete(k);
  return { perDokumen: per, sisaTerpotong };
}

type JejakMentah = { action: string; changes: unknown; metadata: unknown };

const rupiahKeSen = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function daftarAlokasiJejak(v: unknown): Array<{ jenis: string; id: string; sen: number }> {
  if (!Array.isArray(v)) return [];
  const hasil: Array<{ jenis: string; id: string; sen: number }> = [];
  for (const x of v) {
    const o = obj(x);
    const sen = rupiahKeSen(o?.jumlah);
    if (!o || typeof o.jenis !== "string" || typeof o.id !== "string" || sen == null) continue;
    hasil.push({ jenis: o.jenis, id: o.id, sen });
  }
  return hasil;
}

/**
 * Jejak satu pembayaran (urut waktu) → penerapan uang muka, bagian uang muka
 * yang sudah dipotong, dan cakupan. Jejak sebelum perbaikan tidak membawa
 * `uangMukaTerpotong`: dihitung ulang dari dasar potongan yang tercatat
 * (PPh 4(2) bawaan → seluruh uang muka; PPh 23/21 bawaan → nol), dengan porsi
 * dokumen saat ini.
 */
export function susunJejakUangMuka(
  jejak: readonly JejakMentah[],
  porsiDokumen: (kunci: string) => number,
): Pick<DataUangMukaPembayaran, "terpotongSen" | "diterapkan" | "menutup"> {
  let terpotongSen = 0;
  let dicatat = false;
  const diterapkan: string[] = [];
  const menutup: Array<{ kunci: string; sen: number }> = [];
  for (const j of jejak) {
    const m = obj(j.metadata);
    if (j.action === JEJAK_KAS.UANG_MUKA_DITERAPKAN) {
      for (const a of daftarAlokasiJejak(m?.alokasi)) diterapkan.push(kunciDokumenHutang(a.jenis, a.id));
      continue;
    }
    if (j.action !== JEJAK_KAS.PEMBAYARAN_DICATAT || dicatat) continue;
    dicatat = true;
    for (const c of daftarAlokasiJejak(m?.uangMukaDipotong)) menutup.push({ kunci: kunciDokumenHutang(c.jenis, c.id), sen: c.sen });
    const baru = rupiahKeSen(m?.uangMukaTerpotong);
    if (baru != null) {
      terpotongSen = Math.max(0, baru);
      continue;
    }
    // Jejak lama.
    const sesudah = obj(obj(j.changes)?.after);
    const jenis = typeof m?.jenisPotong === "string" ? (m.jenisPotong as JenisPotongPemasok) : null;
    const uangMuka = rupiahKeSen(sesudah?.uangMuka) ?? 0;
    const dasar = rupiahKeSen(m?.dasarPotong) ?? 0;
    const potong = rupiahKeSen(sesudah?.potong) ?? 0;
    if (!jenis || uangMuka <= 0 || dasar <= 0 || potong <= 0) continue;
    const alokasi = daftarAlokasiJejak(sesudah?.alokasi).filter((a) => a.jenis === "GRN" || a.jenis === "WO_STEP" || a.jenis === "OTHER") as Array<{
      jenis: AlokasiSah["jenis"];
      id: string;
      sen: number;
    }>;
    const sisa = new Map<string, SisaDokumen>(alokasi.map((a) => [kunciDokumenHutang(a.jenis, a.id), { sisaSen: a.sen, porsiDasarPotong: porsiDokumen(kunciDokumenHutang(a.jenis, a.id)) }]));
    const tanpaUangMuka = dasarPotongBawaanSen(jenis, alokasi, sisa, alokasi.reduce((s, a) => s + a.sen, 0));
    terpotongSen = Math.min(uangMuka, Math.max(0, dasar - tanpaUangMuka));
  }
  return { terpotongSen, diterapkan, menutup };
}
