import { POSTING_ROLES, type PostingRole } from "@/lib/constants/journal-roles";
import type { AutoJournalLine } from "@/lib/finance/journal";
import { KANAL_JURNAL, type KanalJurnal } from "@/lib/finance/journals/kanal";
import { nilaiPerPeranPersediaan } from "@/lib/finance/journals/peran-persediaan";
import { memoPeranDpp } from "@/lib/finance/pajak/jurnal-ppn";
import { pisahPpn, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import { bahanPotonganRetur, returTertahan, type PotonganPadaKlaim } from "@/lib/receivables/rules";

/*
 * Aturan jurnal penjualan lapangan & piutang toko — MURNI (tanpa Prisma), aman
 * untuk komponen klien dan dites tanpa basis data. Pembaca data dan penulisnya
 * di `jurnal.ts`, penyelarasnya di `selaras.ts`, kait pasca-commit di `kait.ts`.
 *
 * EMPAT SUMBER (sourceType jurnal):
 * - `FIELD_DELIVERY` — nota tagihan pengiriman putus. Sekali posting, tidak
 *   pernah diselaraskan: piutang toko + pendapatan (DPP) + PPN keluaran, dan
 *   HPP dari biaya yang benar-benar keluar dari kartu stok.
 * - `FIELD_COLLECTION` — pelunasan BKM (dan giro yang cair). DISELARASKAN:
 *   keadaan sekarang (terverifikasi atau tidak, tautan potongan) dibandingkan
 *   dengan jurnal yang sudah ada, selisihnya diposting sebagai generasi baru
 *   (`<id>#2`, `<id>#3` …). Pembatalan sesudah terverifikasi = generasi yang
 *   membalik — jurnal tidak pernah dihapus.
 * - `STORE_RETURN` — hitungan gudang retur toko (NRI), juga DISELARASKAN:
 *   barang kembali ke persediaan dan pendapatan dibalik sebesar FISIK yang
 *   diakui (Aturan uang 2), lalu menyesuaikan diri saat potongan toko diakui,
 *   beban selisih diputuskan, atau hitungannya dipindah toko.
 * - `STORE_EXCHANGE` — tukar barang selesai. Sekali posting.
 *
 * MENGAPA BKM TIDAK MENJURNAL POTONGAN RETUR. Piutang modul (`hitungSisaPiutang`)
 * hanya berkurang lewat BKM terverifikasi; potongan retur di dalamnya diakui
 * bertahap (ditahan sampai gudang menghitung dan beban selisih diputuskan).
 * Buku besar mengkredit piutang toko untuk retur SEKALI, di jurnal returnya,
 * sebesar maks(fisik yang diakui, yang sudah dipakai toko). Dengan begitu
 * saldo `AR_STORE` per toko = Σ sisa piutang modul − "kredit retur yang belum
 * dipotong toko" (`nilaiReturBukuBesar().kreditBelumDipakai`) — selisih yang
 * dihitung, bukan ditebak, di laporan rekonsiliasi piutang.
 */

export const SUMBER_LAPANGAN = {
  NOTA: "FIELD_DELIVERY",
  BKM: "FIELD_COLLECTION",
  RETUR: "STORE_RETURN",
  TUKAR: "STORE_EXCHANGE",
} as const;

export type SumberLapangan = (typeof SUMBER_LAPANGAN)[keyof typeof SUMBER_LAPANGAN];

export const SEMUA_SUMBER_LAPANGAN: readonly SumberLapangan[] = [
  SUMBER_LAPANGAN.NOTA,
  SUMBER_LAPANGAN.BKM,
  SUMBER_LAPANGAN.RETUR,
  SUMBER_LAPANGAN.TUKAR,
];

/** Sumber yang jurnalnya diselaraskan bergenerasi (`<id>`, `<id>#2`, …). */
export const SUMBER_BERGENERASI: readonly SumberLapangan[] = [SUMBER_LAPANGAN.BKM, SUMBER_LAPANGAN.RETUR];

/**
 * `kind` di metadata `JOURNAL_PENDING` (`{ docId, kind, reason, role }`).
 * KONTRAK dengan `lib/finance/jurnal-tertunda.ts` dan
 * `lib/notifications/navigation.ts` — keduanya memetakan kind yang sama.
 */
export const JENIS_TERTUNDA_LAPANGAN: Readonly<Record<SumberLapangan, string>> = {
  FIELD_DELIVERY: "nota_putus",
  FIELD_COLLECTION: "bkm_lapangan",
  STORE_RETURN: "retur_toko",
  STORE_EXCHANGE: "tukar_barang",
};

export function sumberDariJenisTertunda(kind: string): SumberLapangan | null {
  for (const s of SEMUA_SUMBER_LAPANGAN) if (JENIS_TERTUNDA_LAPANGAN[s] === kind) return s;
  return null;
}

export function bacaSumberLapangan(v: unknown): SumberLapangan | null {
  return typeof v === "string" && (SEMUA_SUMBER_LAPANGAN as readonly string[]).includes(v) ? (v as SumberLapangan) : null;
}

// ── Generasi jurnal yang diselaraskan ───────────────────────────────────────

/** Generasi pertama memakai id dokumen apa adanya — sama dengan sumber jurnal lain. */
export function idGenerasi(entityId: string, ke: number): string {
  return ke <= 1 ? entityId : `${entityId}#${ke}`;
}

/** Nomor generasi sebuah sourceId milik dokumen ini, atau null bila bukan miliknya. */
export function generasiSourceId(entityId: string, sourceId: string): number | null {
  if (sourceId === entityId) return 1;
  const awalan = `${entityId}#`;
  if (!sourceId.startsWith(awalan)) return null;
  const sisa = sourceId.slice(awalan.length);
  return /^\d+$/.test(sisa) ? Number(sisa) : null;
}

export function generasiBerikutnya(entityId: string, sourceIds: readonly string[]): number {
  let maks = 0;
  for (const s of sourceIds) maks = Math.max(maks, generasiSourceId(entityId, s) ?? 0);
  return maks + 1;
}

// ── Baris bertanda (sen; + debit, − kredit) ─────────────────────────────────

export type BarisBertanda = {
  role: PostingRole;
  /** Sen bulat, bertanda: positif = debit, negatif = kredit. */
  sen: number;
  channel?: KanalJurnal | null;
  storeId?: string | null;
};

/** Rupiah → sen bulat (toFixed menahan galat biner 0,1 + 0,2). */
export function keSen(n: number): number {
  return Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));
}

export function kunciBaris(b: Pick<BarisBertanda, "role" | "storeId" | "channel">): string {
  return `${b.role}|${b.storeId ?? ""}|${b.channel ?? ""}`;
}

/** Gabung per peran + toko + kanal, buang yang nol; urutan = kemunculan pertama. */
export function gabungBaris(baris: readonly BarisBertanda[]): BarisBertanda[] {
  const peta = new Map<string, BarisBertanda>();
  for (const b of baris) {
    const k = kunciBaris(b);
    const ada = peta.get(k);
    if (ada) ada.sen += b.sen;
    else peta.set(k, { role: b.role, sen: b.sen, channel: b.channel ?? null, storeId: b.storeId ?? null });
  }
  return [...peta.values()].filter((b) => b.sen !== 0);
}

export function jumlahSen(baris: readonly BarisBertanda[]): number {
  return baris.reduce((s, b) => s + b.sen, 0);
}

/** Yang perlu diposting supaya jurnal dokumen sama dengan sasarannya. */
export function selisihBaris(sasaran: readonly BarisBertanda[], terposting: readonly BarisBertanda[]): BarisBertanda[] {
  return gabungBaris([...sasaran, ...terposting.map((b) => ({ ...b, sen: -b.sen }))]);
}

/**
 * Baris untuk `generateAutoJournal`. `memo` = nama peran: saldo per dokumen
 * dibaca kembali dari jurnalnya sendiri per PERAN (bukan per akun), jadi
 * pemetaan akun yang berubah kemudian tidak memicu penyesuaian palsu.
 */
export function keBarisJurnal(baris: readonly BarisBertanda[]): AutoJournalLine[] {
  const gabung = gabungBaris(baris);
  // DPP baris PPN = pendapatan (nota) atau retur penjualan (NRI) di set yang sama, bersih dari
  // potongan penjualan (siklus konsinyasi: PPN dihitung atas tagihan sesudah promo), supaya
  // rekap masa PPN membaca DPP persis; peran tetap di depan memo untuk penyelaras.
  const dppSen = Math.abs(
    gabung.filter((b) => b.role === "SALES_REVENUE" || b.role === "SALES_RETURN" || b.role === "SALES_DISCOUNT").reduce((s, b) => s + b.sen, 0),
  );
  return gabung.map((b) => ({
    role: b.role,
    debit: b.sen > 0 ? b.sen / 100 : 0,
    credit: b.sen < 0 ? -b.sen / 100 : 0,
    memo: (b.role === "PPN_KELUARAN" || b.role === "PPN_MASUKAN") && dppSen > 0 ? memoPeranDpp(b.role, dppSen / 100) : b.role,
    channel: b.channel ?? null,
    storeId: b.storeId ?? null,
  }));
}

const PUTUS: KanalJurnal = KANAL_JURNAL.PUTUS;

/** Barang keluar/masuk persediaan menurut tipenya (`peranPersediaan`), dalam sen. */
function barisPersediaan(
  nilai: ReadonlyArray<{ tipeBarang: string | null | undefined; nilai: number }>,
  arah: 1 | -1,
): BarisBertanda[] {
  return nilaiPerPeranPersediaan(nilai).map((p) => ({ role: p.role, sen: arah * keSen(p.nilai) }));
}

// ── Nota tagihan putus ──────────────────────────────────────────────────────

/**
 * Pengiriman putus = nota tagihan = piutang (keputusan pemilik 40):
 *   DR AR_STORE total / CR SALES_REVENUE DPP / CR PPN_KELUARAN PPN
 *   DR COGS / CR persediaan (biaya yang keluar dari kartu stok)
 * Pendapatan = total nota sesudah diskon (sudah dipro-rata per pengiriman).
 * Nota bernilai nol atau kurang tidak menjadi piutang (`buatPiutangNota`), jadi
 * juga tidak menyentuh `AR_STORE` di sini.
 */
export function barisNota(b: {
  total: number;
  storeId: string;
  tanggal: Date;
  pengaturanPpn: PengaturanPpn;
  hpp: ReadonlyArray<{ tipeBarang: string | null | undefined; nilai: number }>;
}): BarisBertanda[] {
  const baris: BarisBertanda[] = [];
  if (keSen(b.total) > 0) {
    const p = pisahPpn(b.total, { pengaturan: b.pengaturanPpn, tanggal: b.tanggal });
    baris.push({ role: "AR_STORE", sen: keSen(p.total), storeId: b.storeId });
    baris.push({ role: "SALES_REVENUE", sen: -keSen(p.dpp), channel: PUTUS, storeId: b.storeId });
    if (keSen(p.ppn) !== 0) baris.push({ role: "PPN_KELUARAN", sen: -keSen(p.ppn) });
  }
  const keluar = barisPersediaan(b.hpp, -1);
  const hpp = -jumlahSen(keluar);
  if (hpp !== 0) {
    baris.push({ role: "COGS", sen: hpp, channel: PUTUS, storeId: b.storeId });
    baris.push(...keluar);
  }
  return gabungBaris(baris);
}

// ── Pelunasan BKM ───────────────────────────────────────────────────────────

/**
 * Peran yang boleh dipilih untuk jenis potongan BKM (Pengaturan → Jenis
 * potongan). Potongan selalu DIDEBIT, jadi hanya peran bersaldo debit:
 * potongan penjualan, pajak yang dipotong toko (kredit pajak), biaya bank, dan
 * kerugian. Urutan = urutan pilihan di layar.
 */
export const PERAN_POTONGAN_BOLEH = ["SALES_DISCOUNT", "PPH23_PREPAID", "PPH22_PREPAID", "BANK_CHARGES", "LOSS_EXPENSE"] as const satisfies readonly PostingRole[];

const PERAN_SAH = new Set<string>(PERAN_POTONGAN_BOLEH.filter((p) => (POSTING_ROLES as readonly string[]).includes(p)));

export function peranPotonganSah(v: unknown): v is (typeof PERAN_POTONGAN_BOLEH)[number] {
  return typeof v === "string" && PERAN_SAH.has(v);
}

/**
 * Peran yang DIDEBIT sebuah potongan non-retur: `DeductionType.postingRole`
 * bila sah (`PERAN_POTONGAN_BOLEH`); jenis khusus toko PKP (`pkpOnly` —
 * potongan PPh 23 toko) → `PPH23_PREPAID`; selain itu potongan penjualan.
 */
export function peranPotongan(jenis: { postingRole: string | null; pkpOnly: boolean } | null | undefined): PostingRole {
  if (peranPotonganSah(jenis?.postingRole)) return jenis!.postingRole as PostingRole;
  if (jenis?.pkpOnly) return "PPH23_PREPAID";
  return "SALES_DISCOUNT";
}

/**
 * BKM TERVERIFIKASI (Aturan uang 1 — klaim bukan lunas):
 *   DR BANK (transfer/giro) atau CASH (tunai) = uang diterima
 *   DR peran potongan (potongan penjualan / PPh 23) = potongan non-retur
 *   CR AR_STORE = keduanya.
 * Potongan retur TIDAK dijurnal di sini — piutangnya diselesaikan jurnal retur
 * (sekali, tidak dua kali). Status lain = nol: generasi berikutnya membalik.
 */
export function barisKlaim(b: {
  terverifikasi: boolean;
  cara: string;
  diterima: number;
  storeId: string;
  potongan: ReadonlyArray<{ nilai: number; retur: boolean; peran: PostingRole }>;
}): BarisBertanda[] {
  if (!b.terverifikasi) return [];
  const baris: BarisBertanda[] = [];
  const kas = keSen(b.diterima);
  if (kas !== 0) baris.push({ role: b.cara === "tunai" ? "CASH" : "BANK", sen: kas });
  let kredit = kas;
  for (const p of b.potongan) {
    if (p.retur) continue;
    const s = keSen(p.nilai);
    if (s === 0) continue;
    const penjualan = p.peran === "SALES_DISCOUNT";
    baris.push({ role: p.peran, sen: s, ...(penjualan ? { channel: PUTUS, storeId: b.storeId } : {}) });
    kredit += s;
  }
  if (kredit !== 0) baris.push({ role: "AR_STORE", sen: -kredit, storeId: b.storeId });
  return gabungBaris(baris);
}

/**
 * Tanggal jurnal pelunasan: tanggal transfer menurut BKM (yang dicocokkan ke
 * mutasi bank), tetapi tidak sebelum tanggal mulai buku besar dan tidak sesudah
 * diverifikasi. Giro = saat cair (diverifikasi bersamaan).
 */
export function tanggalJurnalKlaim(b: { verifiedAt: Date; claimedTransferAt: Date; giro: boolean; mulai: Date | null }): Date {
  if (b.giro) return b.verifiedAt;
  let t = b.claimedTransferAt.getTime();
  if (b.mulai && t < b.mulai.getTime()) t = b.mulai.getTime();
  if (t > b.verifiedAt.getTime()) t = b.verifiedAt.getTime();
  return new Date(t);
}

// ── Retur toko ──────────────────────────────────────────────────────────────

/**
 * Bagian sebuah potongan retur (di BKM TERVERIFIKASI) yang diakui modul piutang
 * — memakai aturan modul itu sendiri (`bahanPotonganRetur` + `returTertahan`),
 * bukan salinannya.
 */
export function potonganReturDiakui(nilaiPotongan: number, retur: NonNullable<PotonganPadaKlaim["retur"]>): number {
  return nilaiPotongan - returTertahan(bahanPotonganRetur([{ nilaiPotongan, retur }]));
}

export type NilaiReturBukuBesar = {
  /** Fisik yang dihitung gudang, tidak melebihi klaim nota (kelebihan bukan kredit siapa pun). */
  fisikDiakui: number;
  /** Yang sudah dipakai toko: potongan diakui di BKM terverifikasi − faktur beban ke toko. */
  dipakai: number;
  /** Kredit piutang toko yang seharusnya berdiri di buku besar untuk retur ini. */
  sasaran: number;
  /** Bagian di atas fisik yang dilepas tanpa ditagih balik (beban ke sales/gudang/perusahaan). */
  rugi: number;
  /** Selisih buku besar − modul untuk retur ini (≥ 0): kredit retur yang belum dipotong toko. */
  kreditBelumDipakai: number;
};

/**
 * Nilai jurnal retur. `potonganDiakui` = Σ `potonganReturDiakui` atas nota ini
 * di BKM terverifikasi; `ditagihKeToko` = faktur beban selisih yang ditetapkan
 * ke toko. Contoh NRT 300 rb, fisik 100 rb:
 *  - belum dipotong → sasaran 100 rb (kredit belum dipakai 100 rb);
 *  - dipotong 300 rb, beban ke TOKO (faktur 200 rb) → sasaran 100 rb, tanpa rugi;
 *  - dipotong 300 rb, beban ke perusahaan → sasaran 300 rb, rugi 200 rb.
 */
export function nilaiReturBukuBesar(b: {
  nilaiFisik: number;
  /** null = hitungan yatim (belum dijodohkan ke nota toko). */
  nilaiKlaimNota: number | null;
  potonganDiakui: number;
  ditagihKeToko: number;
}): NilaiReturBukuBesar {
  const fisik = b.nilaiKlaimNota === null ? 0 : Math.max(0, Math.min(keSen(b.nilaiFisik), keSen(b.nilaiKlaimNota)));
  const dipakai = keSen(b.potonganDiakui) - keSen(b.ditagihKeToko);
  const sasaran = Math.max(fisik, dipakai);
  return {
    fisikDiakui: fisik / 100,
    dipakai: dipakai / 100,
    sasaran: sasaran / 100,
    rugi: (sasaran - fisik) / 100,
    kreditBelumDipakai: (sasaran - dipakai) / 100,
  };
}

/**
 * Hitungan gudang retur toko PUTUS (retur toko konsinyasi = jurnal konsinyasi):
 *   DR persediaan (layak, biaya kartu stok) + DR INVENTORY_DAMAGED (rusak/kedaluwarsa)
 *   / CR COGS
 *   DR SALES_RETURN (DPP fisik diakui) + DR PPN_KELUARAN / CR AR_STORE
 *   DR LOSS_EXPENSE (rugi) / CR AR_STORE
 */
export function barisRetur(b: {
  konsinyasi: boolean;
  storeId: string | null;
  tanggal: Date;
  pengaturanPpn: PengaturanPpn;
  nilai: NilaiReturBukuBesar;
  stokLayak: ReadonlyArray<{ tipeBarang: string | null | undefined; nilai: number }>;
  nilaiRusak: number;
}): BarisBertanda[] {
  if (b.konsinyasi) return [];
  const baris: BarisBertanda[] = [];
  const masuk = barisPersediaan(b.stokLayak, 1);
  const rusak = keSen(b.nilaiRusak);
  if (rusak !== 0) masuk.push({ role: "INVENTORY_DAMAGED", sen: rusak });
  const kembali = jumlahSen(masuk);
  if (kembali !== 0) {
    baris.push(...masuk);
    baris.push({ role: "COGS", sen: -kembali, channel: PUTUS, storeId: b.storeId });
  }
  if (keSen(b.nilai.fisikDiakui) > 0) {
    const p = pisahPpn(b.nilai.fisikDiakui, { pengaturan: b.pengaturanPpn, tanggal: b.tanggal });
    baris.push({ role: "SALES_RETURN", sen: keSen(p.dpp), channel: PUTUS, storeId: b.storeId });
    if (keSen(p.ppn) !== 0) baris.push({ role: "PPN_KELUARAN", sen: keSen(p.ppn) });
    baris.push({ role: "AR_STORE", sen: -keSen(p.total), storeId: b.storeId });
  }
  if (keSen(b.nilai.rugi) > 0) {
    baris.push({ role: "LOSS_EXPENSE", sen: keSen(b.nilai.rugi), channel: PUTUS, storeId: b.storeId });
    baris.push({ role: "AR_STORE", sen: -keSen(b.nilai.rugi), storeId: b.storeId });
  }
  return gabungBaris(baris);
}

// ── Tukar barang ────────────────────────────────────────────────────────────

/**
 * Tukar barang dengan toko putus (nilai jual setara, piutang tidak disentuh):
 * barang masuk DR persediaan, barang keluar CR persediaan (biaya kartu stok),
 * dinetto per peran; selisih biayanya ke HPP.
 */
export function barisTukar(b: {
  storeId: string;
  masuk: ReadonlyArray<{ tipeBarang: string | null | undefined; nilai: number }>;
  keluar: ReadonlyArray<{ tipeBarang: string | null | undefined; nilai: number }>;
}): BarisBertanda[] {
  const persediaan = gabungBaris([...barisPersediaan(b.masuk, 1), ...barisPersediaan(b.keluar, -1)]);
  const netto = jumlahSen(persediaan);
  if (netto === 0 && persediaan.length === 0) return [];
  return gabungBaris([...persediaan, { role: "COGS", sen: -netto, channel: PUTUS, storeId: b.storeId }]);
}
