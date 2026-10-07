import { prisma, Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { runSerializable } from "@/lib/db/tx-retry";
import { KODE_FOTO_SUDAH_DIPAKAI, periksaFotoKembar } from "@/lib/foto/kembar";
import { PERMISSIONS } from "@/lib/rbac";
import { fotoBolehDipakai, KODE_FOTO_BUKAN_MILIK } from "@/lib/receivables/foto-pencatat";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { bacaTanggal, hariIniWib } from "@/lib/tanggal-isian";
import { bacaAmbangKreatif } from "./pengaturan";
import { bacaTarifPajakKreatif } from "./pajak-pengaturan";
import {
  bagiJumlah,
  hitungTermin,
  tarifInfoTermin,
  type JenisPajak,
  type ModePajak,
  type RincianPph,
  type SubjekPajak,
  type TarifPajakKreatif,
} from "./pph";
import {
  bobotUlang,
  jatuhTempoTermin,
  LABEL_PELUNASAN,
  nilaiBasis,
  rencanaBawaan,
  rencanakanTermin,
  turunkanBayar,
  type DasarRencana,
  type KodeTolakTermin,
  type PemicuTermin,
  type RencanaTermin,
  type StatusTermin,
  type TerminTerhitung,
  type TurunanBayar,
} from "./termin-aturan";
import { sinkronJurnalKolAman } from "./jurnal-kol";
import { terapkanMajuOtomatis } from "./maju-otomatis";
import type { StatusBayar, Tahap } from "./tahap";

/**
 * Penulis termin pembayaran fee KOL (`KolPaymentTerm`) — KHUSUS SERVER.
 *
 * SATU PENULIS untuk keadaan bayar kolaborasi: `KolBrief.payStatus/
 * paidAmount/paidAt` hanya ditulis `turunkanDanTulis` di sini, dari terminnya.
 * Setiap penjaga keadaan (bayar, batalkan bayar) berjalan di `runSerializable`
 * — `updateMany where status` saja bukan compare-and-swap di Prisma 7.
 *
 * Jejak ditulis di transaksi yang sama, pada kolaborasinya (entityType
 * `KolBrief`), supaya tampil di riwayat kolaborasi. Jurnal buku besar
 * diposting SESUDAH commit oleh `jurnal-kol.ts` (best-effort).
 *
 * Termin yang dibayar terkunci. Termin dengan `bayarKe > 0` tidak pernah
 * dihapus (jurnal pembayaran & pembaliknya dicari lewat id-nya); termin
 * belum pernah dibayar boleh dihapus saat rencana diganti.
 */

type Klien = Prisma.TransactionClient;
const D = (n: number) => new Prisma.Decimal(n);
const angka = (v: unknown): number => Number(v ?? 0);
const keSen = (n: number): number => Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));
const hariDari = (d: Date | null | undefined): string | null => (d ? formatDateOnlyJakarta(d) : null);

export const BATAS_CATATAN_TERMIN = 1000;
export const BATAS_NOMOR_BUKTI = 60;
const CATATAN_WARISAN = "Dibayar sebelum modul pajak — PPh tidak dihitung.";

const PILIH_TERMIN = {
  id: true,
  urutan: true,
  label: true,
  persen: true,
  neto: true,
  bruto: true,
  pph: true,
  dpp: true,
  jenisPajak: true,
  grossUp: true,
  tarifInfo: true,
  pemicu: true,
  hariSesudah: true,
  jatuhTempo: true,
  status: true,
  bayarKe: true,
  dibayarAt: true,
  buktiTransferUrl: true,
  nomorBuktiPotong: true,
  setorAt: true,
  catatan: true,
  createdAt: true,
} satisfies Prisma.KolPaymentTermSelect;

type BarisTermin = Prisma.KolPaymentTermGetPayload<{ select: typeof PILIH_TERMIN }>;

async function muat(tx: Klien, kolaborasiId: string) {
  return tx.kolBrief.findUnique({
    where: { id: kolaborasiId },
    select: {
      id: true,
      docNo: true,
      fee: true,
      modePajak: true,
      tahap: true,
      dealAt: true,
      liveAt: true,
      payStatus: true,
      paidAmount: true,
      paidAt: true,
      payNote: true,
      kol: { select: { id: true, name: true, jenisPajak: true, adaNpwp: true, grossUpBawaan: true } },
      terms: { select: PILIH_TERMIN, orderBy: [{ urutan: "asc" }, { createdAt: "asc" }] },
    },
  });
}

type Kolaborasi = NonNullable<Awaited<ReturnType<typeof muat>>>;

export function subjekDari(kol: { jenisPajak: string; adaNpwp: boolean }): SubjekPajak {
  return { jenis: kol.jenisPajak as JenisPajak, adaNpwp: kol.adaNpwp };
}

const basis = (t: BarisTermin) => nilaiBasis({ bruto: angka(t.bruto), neto: angka(t.neto), grossUp: t.grossUp });

export type RingkasTermin = { label: string; status: StatusTermin; jumlah: number; bruto: number; pph: number; neto: number };

function ringkas(terms: readonly BarisTermin[]): RingkasTermin[] {
  return terms
    .filter((t) => t.status !== "BATAL")
    .map((t) => ({ label: t.label, status: t.status as StatusTermin, jumlah: basis(t), bruto: angka(t.bruto), pph: angka(t.pph), neto: angka(t.neto) }));
}

const samaRingkas = (a: RingkasTermin[], b: RingkasTermin[]) => JSON.stringify(a) === JSON.stringify(b);

function dasarJatuhTempo(c: Pick<Kolaborasi, "dealAt" | "liveAt">) {
  return { dealHari: hariDari(c.dealAt), tayangHari: hariDari(c.liveAt) };
}

function tanggalAtauNull(hari: string | null): Date | null {
  return hari ? (parseDateOnly(hari) ?? null) : null;
}

/** Data kolom satu termin dari hasil hitungan. */
function dataDariHitungan(b: TerminTerhitung, c: Kolaborasi, urutan: number) {
  const r = b.rincian;
  return {
    urutan,
    label: b.label,
    persen: D(b.persenFee),
    neto: D(r.neto),
    bruto: D(r.bruto),
    pph: D(r.pph),
    dpp: D(r.dpp),
    jenisPajak: r.jenis,
    grossUp: r.grossUp,
    tarifInfo: tarifInfoTermin(r),
    pemicu: b.pemicu,
    hariSesudah: b.hariSesudah,
    jatuhTempo: tanggalAtauNull(jatuhTempoTermin({ pemicu: b.pemicu, hariSesudah: b.hariSesudah, tanggal: b.tanggal }, dasarJatuhTempo(c))),
    catatan: b.catatan,
  };
}

/**
 * Ganti termin BELUM dibayar dengan hasil hitungan. Baris lama dipakai ulang
 * sesuai urutan; sisanya dihapus (belum pernah dibayar) atau dibatalkan
 * (pernah dibayar lalu dibatalkan — jurnalnya dicari lewat id ini).
 */
async function tulisTerminBelum(tx: Klien, c: Kolaborasi, baris: TerminTerhitung[]): Promise<void> {
  const dibayar = c.terms.filter((t) => t.status === "DIBAYAR");
  const belum = c.terms.filter((t) => t.status === "BELUM");
  let urutan = 0;
  for (const t of dibayar) {
    urutan++;
    if (t.urutan !== urutan) await tx.kolPaymentTerm.update({ where: { id: t.id }, data: { urutan } });
  }
  for (const [i, b] of baris.entries()) {
    urutan++;
    const data = dataDariHitungan(b, c, urutan);
    const lama = belum[i];
    if (lama) await tx.kolPaymentTerm.update({ where: { id: lama.id }, data });
    else await tx.kolPaymentTerm.create({ data: { ...data, collabId: c.id } });
  }
  for (const lama of belum.slice(baris.length)) {
    if (lama.bayarKe > 0) await tx.kolPaymentTerm.update({ where: { id: lama.id }, data: { status: "BATAL" } });
    else await tx.kolPaymentTerm.delete({ where: { id: lama.id } });
  }
}

/** Turunkan payStatus/paidAmount/paidAt dari termin dan tulis bila berbeda. */
export async function turunkanDanTulis(tx: Klien, kolaborasiId: string): Promise<TurunanBayar> {
  const c = await tx.kolBrief.findUniqueOrThrow({
    where: { id: kolaborasiId },
    select: {
      fee: true,
      payStatus: true,
      paidAmount: true,
      paidAt: true,
      terms: { select: { status: true, bruto: true, neto: true, grossUp: true, dibayarAt: true } },
    },
  });
  const d = turunkanBayar(
    angka(c.fee),
    c.terms.map((t) => ({
      status: t.status as StatusTermin,
      bruto: angka(t.bruto),
      neto: angka(t.neto),
      grossUp: t.grossUp,
      dibayarHari: hariDari(t.dibayarAt),
    })),
  );
  const sama =
    c.payStatus === d.payStatus && keSen(angka(c.paidAmount)) === keSen(d.paidAmount) && hariDari(c.paidAt) === d.paidAtHari;
  if (!sama) {
    await tx.kolBrief.update({
      where: { id: kolaborasiId },
      data: { payStatus: d.payStatus, paidAmount: D(d.paidAmount), paidAt: tanggalAtauNull(d.paidAtHari) },
    });
  }
  return d;
}

export type KodeSelaras = "TIDAK_DITEMUKAN" | "SISA_NEGATIF" | KodeTolakTermin;
export type HasilSelaras = { ok: true; berubah: boolean; turunan: TurunanBayar } | { ok: false; kode: KodeSelaras };

/**
 * Selaraskan termin dengan fee, mode pajak, subjek pajak KOL, dan tarif
 * sekarang — DI DALAM transaksi pemanggil. Dipanggil sesudah kolaborasi
 * berbayar dibuat atau fee/jenis/mode/subjek/tarif berubah.
 *
 * - Fee nol: termin belum dibayar dibuang.
 * - Belum punya termin: termin bawaan "Pelunasan" 100% sesudah tayang +
 *   ambang jatuh tempo (bila KOL-nya gross-up bawaan, mode ikut GROSS_UP).
 *   Kolaborasi lama yang tercatat sudah dibayar mendapat termin "dibayar di
 *   luar buku" (bayarKe 0, tanpa PPh) sebesar yang tercatat.
 * - Selain itu: sisa (fee − dibayar) dibagi ulang ke termin belum dibayar
 *   mengikuti proporsi lamanya, PPh dihitung ulang per termin.
 *
 * Fee di bawah yang sudah dibayar → `SISA_NEGATIF` (pemanggil memeriksa
 * lebih dulu dengan `periksaFeeBaru` supaya tidak ada yang tertulis).
 */
export async function selaraskanTermin(
  tx: Klien,
  input: { kolaborasiId: string; olehUserId: string; sebab: string; tarif?: TarifPajakKreatif },
): Promise<HasilSelaras> {
  let c = await muat(tx, input.kolaborasiId);
  if (!c) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  const fee = angka(c.fee);
  const tarif = input.tarif ?? (await bacaTarifPajakKreatif(tx));
  const subjek = subjekDari(c.kol);
  const sebelum = ringkas(c.terms);
  const pertama = c.terms.length === 0;

  if (pertama && keSen(fee) > 0 && c.kol.grossUpBawaan && c.modePajak === "DIPOTONG") {
    await tx.kolBrief.update({ where: { id: c.id }, data: { modePajak: "GROSS_UP" } });
    c = { ...c, modePajak: "GROSS_UP" };
  }
  const mode = c.modePajak as ModePajak;

  // Kolaborasi lama tanpa termin yang tercatat sudah dibayar: catat yang sudah
  // dibayar sebagai termin di luar buku besar.
  if (pertama && keSen(fee) > 0 && (c.payStatus === "LUNAS" || c.payStatus === "SEBAGIAN")) {
    const sudah = c.payStatus === "LUNAS" ? fee : Math.min(angka(c.paidAmount), fee);
    if (keSen(sudah) > 0) {
      await tx.kolPaymentTerm.create({
        data: {
          collabId: c.id,
          urutan: 1,
          label: c.payStatus === "LUNAS" ? LABEL_PELUNASAN : "Dibayar sebelumnya",
          persen: D(Math.round((sudah / fee) * 10_000) / 100),
          neto: D(sudah),
          bruto: D(sudah),
          jenisPajak: subjek.jenis,
          grossUp: mode === "GROSS_UP",
          pemicu: "DEAL",
          status: "DIBAYAR",
          bayarKe: 0,
          dibayarAt: c.paidAt ?? new Date(),
          catatan: CATATAN_WARISAN,
        },
      });
      // Uangnya bergerak di luar buku besar: jangan dijurnal otomatis (sama dengan isi awal migrasi).
      await tx.kolBrief.update({ where: { id: c.id }, data: { jurnalOtomatis: false } });
      c = (await muat(tx, c.id))!;
    }
  }

  const hidup = c.terms.filter((t) => t.status !== "BATAL");
  const dibayar = hidup.filter((t) => t.status === "DIBAYAR");
  const belum = hidup.filter((t) => t.status === "BELUM");
  const sisaSen = keSen(fee) - dibayar.reduce((s, t) => s + keSen(basis(t)), 0);
  if (sisaSen < 0) return { ok: false, kode: "SISA_NEGATIF" };

  let rencana: RencanaTermin[];
  if (sisaSen === 0) {
    rencana = [];
  } else if (belum.length === 0) {
    rencana = rencanaBawaan((await bacaAmbangKreatif()).jatuhTempoBayarHari);
  } else {
    const jumlah = bagiJumlah(sisaSen / 100, bobotUlang(belum.map(basis)));
    rencana = belum
      .map((t, i) => ({
        label: t.label,
        jumlah: jumlah[i],
        pemicu: t.pemicu as PemicuTermin,
        hariSesudah: t.hariSesudah,
        tanggal: t.pemicu === "TANGGAL" ? hariDari(t.jatuhTempo) : null,
        catatan: t.catatan,
      }))
      .filter((r) => keSen(r.jumlah) > 0);
  }

  const r = rencanakanTermin({
    fee,
    mode,
    subjek,
    tarif,
    dibayar: dibayar.map(basis),
    rencana,
    dasar: sisaSen > 0 && belum.length === 0 ? "PERSEN" : "JUMLAH",
  });
  if (!r.ok) return { ok: false, kode: r.kode };

  await tulisTerminBelum(tx, c, r.baris);
  // Jatuh tempo termin dibayar ikut dasar terbaru (tayang bisa baru terisi).
  for (const t of dibayar) {
    const jt = tanggalAtauNull(
      jatuhTempoTermin({ pemicu: t.pemicu as PemicuTermin, hariSesudah: t.hariSesudah, tanggal: t.pemicu === "TANGGAL" ? hariDari(t.jatuhTempo) : null }, dasarJatuhTempo(c)),
    );
    if ((jt?.getTime() ?? null) !== (t.jatuhTempo?.getTime() ?? null)) await tx.kolPaymentTerm.update({ where: { id: t.id }, data: { jatuhTempo: jt } });
  }
  const turunan = await turunkanDanTulis(tx, c.id);
  const sesudah = ringkas((await muat(tx, c.id))!.terms);
  const berubah = !samaRingkas(sebelum, sesudah);
  // Termin pertama kolaborasi baru sudah tercatat lewat jejak pembuatannya.
  if (berubah && !pertama) {
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.TERMIN_KOL_DIATUR,
      entityType: "KolBrief",
      entityId: c.id,
      changes: { before: sebelum, after: sesudah },
      metadata: { docNo: c.docNo, kol: c.kol.name, sebab: input.sebab, otomatis: true },
    });
  }
  return { ok: true, berubah, turunan };
}

/**
 * Pemeriksaan SEBELUM fee diubah: fee baru tidak boleh di bawah yang sudah
 * dibayar (dalam basis fee). Dipanggil penulis kolaborasi sebelum menulis apa
 * pun, supaya penolakan tidak meninggalkan perubahan setengah jadi.
 */
export async function periksaFeeBaru(tx: Klien, kolaborasiId: string, feeBaru: number): Promise<{ ok: true } | { ok: false; dibayar: number }> {
  const terms = await tx.kolPaymentTerm.findMany({
    where: { collabId: kolaborasiId, status: "DIBAYAR" },
    select: { bruto: true, neto: true, grossUp: true },
  });
  const dibayarSen = terms.reduce((s, t) => s + keSen(nilaiBasis({ bruto: angka(t.bruto), neto: angka(t.neto), grossUp: t.grossUp })), 0);
  return keSen(feeBaru) < dibayarSen ? { ok: false, dibayar: dibayarSen / 100 } : { ok: true };
}

// ───────────────────── Atur termin (pecah / ubah) ─────────────────────

export type KodeGagalTermin =
  | KodeTolakTermin
  | "TIDAK_DITEMUKAN"
  | "TANPA_FEE"
  | "MODE_TIDAK_VALID"
  | "SUDAH_DIBAYAR"
  | "TERMIN_BATAL"
  | "TANGGAL_DEPAN"
  | "ALASAN_WAJIB"
  | "TERLALU_PANJANG"
  | "SUDAH_DISETOR"
  | "BELUM_DIBAYAR"
  | "TANPA_PPH"
  | typeof KODE_FOTO_BUKAN_MILIK
  | typeof KODE_FOTO_SUDAH_DIPAKAI;

export type HasilTermin<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; kode: KodeGagalTermin; indeks?: number };

/** Hasil yang membawa id kolaborasi, untuk sinkron jurnal sesudah commit. */
type DenganKolaborasi = { kolaborasiId: string; payStatus: StatusBayar; tahap: { dari: Tahap; ke: Tahap } | null };

/**
 * Ganti rencana termin yang BELUM dibayar (pecah, ubah, jadwal). Termin dibayar
 * tidak disentuh; rencana membagi sisanya.
 */
export async function aturTermin(input: {
  kolaborasiId: string;
  rencana: RencanaTermin[];
  dasar: DasarRencana;
  olehUserId: string;
}): Promise<HasilTermin<{ kolaborasiId: string; berubah: boolean }>> {
  const hasil = await runSerializable(async (tx): Promise<HasilTermin<{ kolaborasiId: string; berubah: boolean }>> => {
    const c = await muat(tx, input.kolaborasiId);
    if (!c) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    const fee = angka(c.fee);
    if (keSen(fee) <= 0) return { ok: false, kode: "TANPA_FEE" };
    const tarif = await bacaTarifPajakKreatif(tx);
    const dibayar = c.terms.filter((t) => t.status === "DIBAYAR");
    const r = rencanakanTermin({
      fee,
      mode: c.modePajak as ModePajak,
      subjek: subjekDari(c.kol),
      tarif,
      dibayar: dibayar.map(basis),
      rencana: input.rencana,
      dasar: input.dasar,
    });
    if (!r.ok) return r;
    const sebelum = ringkas(c.terms);
    await tulisTerminBelum(tx, c, r.baris);
    await turunkanDanTulis(tx, c.id);
    const sesudah = ringkas((await muat(tx, c.id))!.terms);
    const berubah = !samaRingkas(sebelum, sesudah);
    if (berubah) {
      await catatJejak(tx, {
        userId: input.olehUserId,
        action: JEJAK.TERMIN_KOL_DIATUR,
        entityType: "KolBrief",
        entityId: c.id,
        changes: { before: sebelum, after: sesudah },
        metadata: { docNo: c.docNo, kol: c.kol.name, sebab: "Termin diatur", otomatis: false },
      });
    }
    return { ok: true, kolaborasiId: c.id, berubah };
  });
  if (hasil.ok && hasil.berubah) await sinkronSesudah(hasil.kolaborasiId, input.olehUserId);
  return hasil;
}

/** Ubah mode pajak kolaborasi (DIPOTONG ↔ GROSS_UP); termin belum dibayar dihitung ulang. */
export async function ubahModePajak(input: {
  kolaborasiId: string;
  mode: string;
  olehUserId: string;
}): Promise<HasilTermin<{ kolaborasiId: string; berubah: boolean }>> {
  if (input.mode !== "DIPOTONG" && input.mode !== "GROSS_UP") return { ok: false, kode: "MODE_TIDAK_VALID" };
  const mode = input.mode as ModePajak;
  const hasil = await runSerializable(async (tx): Promise<HasilTermin<{ kolaborasiId: string; berubah: boolean }>> => {
    const c = await tx.kolBrief.findUnique({ where: { id: input.kolaborasiId }, select: { id: true, docNo: true, modePajak: true, kol: { select: { name: true } } } });
    if (!c) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (c.modePajak === mode) return { ok: true, kolaborasiId: c.id, berubah: false };
    await tx.kolBrief.update({ where: { id: c.id }, data: { modePajak: mode } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.MODE_PAJAK_KOL_DIUBAH,
      entityType: "KolBrief",
      entityId: c.id,
      changes: { before: { modePajak: c.modePajak }, after: { modePajak: mode } },
      metadata: { docNo: c.docNo, kol: c.kol.name },
    });
    const s = await selaraskanTermin(tx, { kolaborasiId: c.id, olehUserId: input.olehUserId, sebab: "Mode pajak diubah" });
    // Melempar membatalkan perubahan mode bila terminnya tidak bisa diselaraskan.
    if (!s.ok) throw new GagalTermin(s.kode === "SISA_NEGATIF" ? "TOTAL_JUMLAH" : (s.kode as KodeGagalTermin));
    return { ok: true, kolaborasiId: c.id, berubah: true };
  }).catch((e) => {
    if (e instanceof GagalTermin) return { ok: false as const, kode: e.kode };
    throw e;
  });
  if (hasil.ok && hasil.berubah) await sinkronSesudah(hasil.kolaborasiId, input.olehUserId);
  return hasil;
}

class GagalTermin extends Error {
  constructor(readonly kode: KodeGagalTermin) {
    super(kode);
  }
}

// ───────────────────── Bayar & batalkan bayar ─────────────────────

type IsianBayar = {
  /** Hari WIB "YYYY-MM-DD"; tidak boleh sesudah hari ini. */
  tanggal: string;
  buktiTransferUrl?: string | null;
  nomorBuktiPotong?: string | null;
  catatan?: string | null;
};

/**
 * Bayar satu termin — DI DALAM transaksi pemanggil, tanpa pemeriksaan foto
 * (pemanggil memeriksanya). Termin isi awal yang belum dihitung PPh-nya
 * (tarifInfo kosong) dihitung dulu dengan tarif sekarang.
 */
async function bayarDalamTx(
  tx: Klien,
  t: BarisTermin,
  c: Kolaborasi,
  isi: IsianBayar,
  olehUserId: string,
  tarif: TarifPajakKreatif,
): Promise<{ ok: true } | { ok: false; kode: KodeGagalTermin }> {
  if (t.status === "DIBAYAR") return { ok: false, kode: "SUDAH_DIBAYAR" };
  if (t.status === "BATAL") return { ok: false, kode: "TERMIN_BATAL" };
  let nilai = { bruto: angka(t.bruto), pph: angka(t.pph), neto: angka(t.neto), dpp: angka(t.dpp) };
  if (!t.tarifInfo) {
    const r = hitungTermin(basis(t), t.grossUp ? "GROSS_UP" : "DIPOTONG", subjekDari(c.kol), tarif);
    nilai = { bruto: r.bruto, pph: r.pph, neto: r.neto, dpp: r.dpp };
    await tx.kolPaymentTerm.update({
      where: { id: t.id },
      data: { bruto: D(r.bruto), pph: D(r.pph), neto: D(r.neto), dpp: D(r.dpp), jenisPajak: r.jenis, tarifInfo: tarifInfoTermin(r) },
    });
  }
  const nomor = isi.nomorBuktiPotong?.trim() || null;
  const sekarang = new Date();
  const u = await tx.kolPaymentTerm.updateMany({
    where: { id: t.id, status: "BELUM" },
    data: {
      status: "DIBAYAR",
      bayarKe: { increment: 1 },
      dibayarAt: parseDateOnly(isi.tanggal) ?? sekarang,
      dibayarOlehId: olehUserId,
      buktiTransferUrl: isi.buktiTransferUrl?.trim() || null,
      nomorBuktiPotong: nomor,
      buktiPotongAt: nomor ? sekarang : null,
      ...(isi.catatan !== undefined ? { catatan: isi.catatan?.trim() || null } : {}),
    },
  });
  if (u.count !== 1) return { ok: false, kode: "SUDAH_DIBAYAR" };
  await catatJejak(tx, {
    userId: olehUserId,
    action: JEJAK.TERMIN_KOL_DIBAYAR,
    entityType: "KolBrief",
    entityId: c.id,
    changes: {
      before: { termin: t.label, status: "BELUM" },
      after: { termin: t.label, status: "DIBAYAR", tanggal: isi.tanggal, ...nilai, nomorBuktiPotong: nomor },
    },
    metadata: { docNo: c.docNo, kol: c.kol.name, terminId: t.id, bayarKe: t.bayarKe + 1, grossUp: t.grossUp },
  });
  return { ok: true };
}

/** Batalkan pembayaran satu termin — DI DALAM transaksi pemanggil. */
async function batalkanDalamTx(
  tx: Klien,
  t: BarisTermin,
  c: Kolaborasi,
  alasan: string,
  olehUserId: string,
): Promise<{ ok: true } | { ok: false; kode: KodeGagalTermin }> {
  if (t.status !== "DIBAYAR") return { ok: false, kode: "BELUM_DIBAYAR" };
  if (t.setorAt) return { ok: false, kode: "SUDAH_DISETOR" };
  const u = await tx.kolPaymentTerm.updateMany({
    where: { id: t.id, status: "DIBAYAR" },
    data: { status: "BELUM", dibayarAt: null, dibayarOlehId: null, buktiTransferUrl: null, nomorBuktiPotong: null, buktiPotongAt: null },
  });
  if (u.count !== 1) return { ok: false, kode: "BELUM_DIBAYAR" };
  await catatJejak(tx, {
    userId: olehUserId,
    action: JEJAK.TERMIN_KOL_BAYAR_DIBATALKAN,
    entityType: "KolBrief",
    entityId: c.id,
    changes: {
      before: { termin: t.label, status: "DIBAYAR", tanggal: hariDari(t.dibayarAt), bruto: angka(t.bruto), pph: angka(t.pph), neto: angka(t.neto) },
      after: { termin: t.label, status: "BELUM" },
    },
    metadata: { docNo: c.docNo, kol: c.kol.name, terminId: t.id, bayarKe: t.bayarKe, nomorBuktiPotong: t.nomorBuktiPotong },
    reason: alasan,
  });
  return { ok: true };
}

function periksaTanggalBayar(tanggal: string, hariIni: string): KodeGagalTermin | null {
  if (!bacaTanggal(tanggal)) return "TANGGAL_TIDAK_VALID";
  if (tanggal > hariIni) return "TANGGAL_DEPAN";
  return null;
}

/**
 * Bayar satu termin: tanggal (hari WIB, bukan masa depan), bukti transfer
 * (foto milik pembayar sendiri, kecuali keuangan), nomor bukti potong
 * opsional. Sesudahnya keadaan bayar kolaborasi diturunkan ulang dan tahap
 * dimajukan (LUNAS sesudah tayang → DIBAYAR). Jurnal sesudah commit.
 */
export async function bayarTermin(
  input: IsianBayar & { terminId: string; olehUserId: string },
): Promise<HasilTermin<DenganKolaborasi>> {
  const hariIni = hariIniWib();
  const tgl = (input.tanggal ?? "").trim();
  const salahTgl = periksaTanggalBayar(tgl, hariIni);
  if (salahTgl) return { ok: false, kode: salahTgl };
  if ((input.catatan ?? "").length > BATAS_CATATAN_TERMIN || (input.nomorBuktiPotong ?? "").trim().length > BATAS_NOMOR_BUKTI) {
    return { ok: false, kode: "TERLALU_PANJANG" };
  }

  const hasil = await runSerializable(async (tx): Promise<HasilTermin<DenganKolaborasi>> => {
    const t0 = await tx.kolPaymentTerm.findUnique({ where: { id: input.terminId }, select: { collabId: true } });
    if (!t0) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    const c = await muat(tx, t0.collabId);
    const t = c?.terms.find((x) => x.id === input.terminId);
    if (!c || !t) return { ok: false, kode: "TIDAK_DITEMUKAN" };

    const bukti = input.buktiTransferUrl?.trim() || null;
    if (bukti) {
      const milik = await fotoBolehDipakai(tx, { urls: [bukti], userId: input.olehUserId, izinKantor: [PERMISSIONS.JOURNALS_MANAGE] });
      if (!milik) return { ok: false, kode: KODE_FOTO_BUKAN_MILIK };
      const kembar = await periksaFotoKembar(tx, { urls: [bukti], userId: input.olehUserId });
      if (!kembar.boleh) return { ok: false, kode: KODE_FOTO_SUDAH_DIPAKAI };
    }

    const tarif = await bacaTarifPajakKreatif(tx);
    const r = await bayarDalamTx(tx, t, c, { ...input, tanggal: tgl, buktiTransferUrl: bukti }, input.olehUserId, tarif);
    if (!r.ok) return r;
    const turunan = await turunkanDanTulis(tx, c.id);
    const tahap = await terapkanMajuOtomatis(tx, { kolaborasiId: c.id, olehUserId: input.olehUserId, sebab: `Pembayaran termin ${t.label}` });
    return { ok: true, kolaborasiId: c.id, payStatus: turunan.payStatus, tahap };
  });
  if (hasil.ok) await sinkronSesudah(hasil.kolaborasiId, input.olehUserId);
  return hasil;
}

export const BATAS_BAYAR_TERMIN_MASSAL = 200;

class GagalTerminBaris extends Error {
  constructor(
    readonly kode: KodeGagalTermin,
    readonly terminId: string,
  ) {
    super(kode);
  }
}

/**
 * Bayar banyak termin sekaligus (satu transfer, satu tanggal, satu bukti
 * opsional) — SATU transaksi serializable, utuh atau tidak sama sekali.
 */
export async function bayarTerminBanyak(input: {
  terminIds: readonly string[];
  tanggal: string;
  buktiTransferUrl?: string | null;
  olehUserId: string;
}): Promise<
  | { ok: true; jumlah: number; kolaborasiIds: string[]; perpindahan: ({ kolaborasiId: string } & { dari: Tahap; ke: Tahap })[] }
  | { ok: false; kode: KodeGagalTermin | "KOSONG" | "TERLALU_BANYAK"; terminId?: string }
> {
  const ids = [...new Set(input.terminIds.map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, kode: "KOSONG" };
  if (ids.length > BATAS_BAYAR_TERMIN_MASSAL) return { ok: false, kode: "TERLALU_BANYAK" };
  const tgl = (input.tanggal ?? "").trim();
  const salahTgl = periksaTanggalBayar(tgl, hariIniWib());
  if (salahTgl) return { ok: false, kode: salahTgl };
  const bukti = input.buktiTransferUrl?.trim() || null;

  try {
    const hasil = await runSerializable(async (tx) => {
      if (bukti) {
        const milik = await fotoBolehDipakai(tx, { urls: [bukti], userId: input.olehUserId, izinKantor: [PERMISSIONS.JOURNALS_MANAGE] });
        if (!milik) throw new GagalTerminBaris(KODE_FOTO_BUKAN_MILIK, ids[0]);
        const kembar = await periksaFotoKembar(tx, { urls: [bukti], userId: input.olehUserId });
        if (!kembar.boleh) throw new GagalTerminBaris(KODE_FOTO_SUDAH_DIPAKAI, ids[0]);
      }
      const tarif = await bacaTarifPajakKreatif(tx);
      const kolabIds: string[] = [];
      for (const id of ids) {
        const t0 = await tx.kolPaymentTerm.findUnique({ where: { id }, select: { collabId: true } });
        if (!t0) throw new GagalTerminBaris("TIDAK_DITEMUKAN", id);
        const c = await muat(tx, t0.collabId);
        const t = c?.terms.find((x) => x.id === id);
        if (!c || !t) throw new GagalTerminBaris("TIDAK_DITEMUKAN", id);
        const r = await bayarDalamTx(tx, t, c, { tanggal: tgl, buktiTransferUrl: bukti }, input.olehUserId, tarif);
        if (!r.ok) throw new GagalTerminBaris(r.kode, id);
        if (!kolabIds.includes(c.id)) kolabIds.push(c.id);
      }
      const perpindahan: ({ kolaborasiId: string } & { dari: Tahap; ke: Tahap })[] = [];
      for (const kolaborasiId of kolabIds) {
        await turunkanDanTulis(tx, kolaborasiId);
        const p = await terapkanMajuOtomatis(tx, { kolaborasiId, olehUserId: input.olehUserId, sebab: "Pembayaran termin" });
        if (p) perpindahan.push({ kolaborasiId, ...p });
      }
      return { ok: true as const, jumlah: ids.length, kolaborasiIds: kolabIds, perpindahan };
    });
    await sinkronJurnalKolAman(hasil.kolaborasiIds, input.olehUserId);
    return hasil;
  } catch (e) {
    if (e instanceof GagalTerminBaris) return { ok: false, kode: e.kode, terminId: e.terminId };
    throw e;
  }
}

/**
 * Batalkan pembayaran satu termin (salah catat): alasan wajib, jejak membawa
 * nilai yang dibatalkan. Ditolak bila PPh-nya sudah disetor. Termin kembali
 * BELUM dan dihitung ulang dengan tarif sekarang; jurnal pembaliknya
 * diposting sesudah commit.
 */
export async function batalkanBayarTermin(input: {
  terminId: string;
  alasan: string;
  olehUserId: string;
}): Promise<HasilTermin<DenganKolaborasi>> {
  const alasan = (input.alasan ?? "").trim();
  if (!alasan) return { ok: false, kode: "ALASAN_WAJIB" };
  if (alasan.length > BATAS_CATATAN_TERMIN) return { ok: false, kode: "TERLALU_PANJANG" };

  const hasil = await runSerializable(async (tx): Promise<HasilTermin<DenganKolaborasi>> => {
    const t0 = await tx.kolPaymentTerm.findUnique({ where: { id: input.terminId }, select: { collabId: true } });
    if (!t0) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    const c = await muat(tx, t0.collabId);
    const t = c?.terms.find((x) => x.id === input.terminId);
    if (!c || !t) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    const r = await batalkanDalamTx(tx, t, c, alasan, input.olehUserId);
    if (!r.ok) return r;
    const s = await selaraskanTermin(tx, { kolaborasiId: c.id, olehUserId: input.olehUserId, sebab: "Pembayaran termin dibatalkan" });
    if (!s.ok) throw new GagalTermin(s.kode as KodeGagalTermin);
    return { ok: true, kolaborasiId: c.id, payStatus: s.turunan.payStatus, tahap: null };
  }).catch((e) => {
    if (e instanceof GagalTermin) return { ok: false as const, kode: e.kode };
    throw e;
  });
  if (hasil.ok) await sinkronSesudah(hasil.kolaborasiId, input.olehUserId);
  return hasil;
}

/**
 * Setel TOTAL yang sudah dibayar (basis fee) sebuah kolaborasi ke `targetSen`
 * pada hari `hari` — dipakai "Tandai dibayar" (Lunas/Sebagian/Belum) yang
 * bekerja per kolaborasi, bukan per termin. DI DALAM transaksi pemanggil.
 *
 * - Turun (atau tanggal berbeda): pembayaran dibatalkan dari yang terakhir.
 * - Naik: termin belum dibayar dibayar berurutan; termin yang lebih besar
 *   dari kekurangannya DIPECAH (bagian dibayar + sisa) — PPh tiap bagian
 *   dihitung sendiri.
 * Semua pemeriksaan (PPh sudah disetor) dijalankan SEBELUM menulis.
 */
export async function setelTotalDibayar(
  tx: Klien,
  input: { kolaborasiId: string; targetSen: number; hari: string | null; olehUserId: string; alasan: string; tarif?: TarifPajakKreatif },
): Promise<{ ok: true } | { ok: false; kode: KodeGagalTermin }> {
  let c = await muat(tx, input.kolaborasiId);
  if (!c) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  const tarif = input.tarif ?? (await bacaTarifPajakKreatif(tx));
  const hidup = c.terms.filter((t) => t.status !== "BATAL");
  const dibayar = hidup
    .filter((t) => t.status === "DIBAYAR")
    .sort((a, b) => (b.dibayarAt?.getTime() ?? 0) - (a.dibayarAt?.getTime() ?? 0) || b.urutan - a.urutan);
  const paidSen = dibayar.reduce((s, t) => s + keSen(basis(t)), 0);
  const gantiTanggal = input.hari !== null && dibayar.some((t) => hariDari(t.dibayarAt) !== input.hari) && input.targetSen === paidSen;

  // Rencana pembatalan dulu (tanpa menulis), supaya PPh yang sudah disetor menolak sebelum apa pun berubah.
  const dibatalkan: BarisTermin[] = [];
  let sisaPaid = paidSen;
  for (const t of dibayar) {
    if (!gantiTanggal && sisaPaid <= input.targetSen) break;
    dibatalkan.push(t);
    sisaPaid -= keSen(basis(t));
  }
  if (dibatalkan.some((t) => t.setorAt)) return { ok: false, kode: "SUDAH_DISETOR" };

  for (const t of dibatalkan) {
    const r = await batalkanDalamTx(tx, t, c, input.alasan, input.olehUserId);
    if (!r.ok) throw new GagalTermin(r.kode);
  }

  let kurang = input.targetSen - sisaPaid;
  if (kurang > 0) {
    c = (await muat(tx, c.id))!;
    const belum = c.terms.filter((t) => t.status === "BELUM");
    const subjek = subjekDari(c.kol);
    for (const t of belum) {
      if (kurang <= 0) break;
      const b = keSen(basis(t));
      if (b <= kurang) {
        const r = await bayarDalamTx(tx, t, c, { tanggal: input.hari ?? hariIniWib() }, input.olehUserId, tarif);
        if (!r.ok) throw new GagalTermin(r.kode);
        kurang -= b;
        continue;
      }
      // Pecah: bagian sebesar kekurangannya dibayar, sisanya jadi termin baru.
      const modeT: ModePajak = t.grossUp ? "GROSS_UP" : "DIPOTONG";
      const bagian = hitungTermin(kurang / 100, modeT, subjek, tarif);
      const sisa = hitungTermin((b - kurang) / 100, modeT, subjek, tarif);
      const feeSen = keSen(angka(c.fee));
      const persen = (sen: number) => D(feeSen > 0 ? Math.round((sen / feeSen) * 10_000) / 100 : 0);
      await tx.kolPaymentTerm.updateMany({ where: { collabId: c.id, urutan: { gt: t.urutan } }, data: { urutan: { increment: 1 } } });
      await tx.kolPaymentTerm.create({
        data: {
          collabId: c.id,
          urutan: t.urutan + 1,
          label: t.label,
          persen: persen(b - kurang),
          ...nilaiKolom(sisa),
          pemicu: t.pemicu,
          hariSesudah: t.hariSesudah,
          jatuhTempo: t.jatuhTempo,
          catatan: t.catatan,
        },
      });
      await tx.kolPaymentTerm.update({ where: { id: t.id }, data: { persen: persen(kurang), ...nilaiKolom(bagian) } });
      const segar = (await tx.kolPaymentTerm.findUniqueOrThrow({ where: { id: t.id }, select: PILIH_TERMIN })) as BarisTermin;
      const r = await bayarDalamTx(tx, segar, c, { tanggal: input.hari ?? hariIniWib() }, input.olehUserId, tarif);
      if (!r.ok) throw new GagalTermin(r.kode);
      kurang = 0;
    }
    if (kurang > 0) throw new GagalTermin("TOTAL_JUMLAH");
  }
  return { ok: true };
}

function nilaiKolom(r: RincianPph) {
  return {
    neto: D(r.neto),
    bruto: D(r.bruto),
    pph: D(r.pph),
    dpp: D(r.dpp),
    jenisPajak: r.jenis,
    grossUp: r.grossUp,
    tarifInfo: tarifInfoTermin(r),
  };
}

export { GagalTermin };

// ───────────────────── Bukti potong & setor (keuangan) ─────────────────────

/** Catat (atau hapus, `nomor` kosong) nomor bukti potong termin yang sudah dibayar dan ber-PPh. */
export async function catatBuktiPotong(input: {
  terminId: string;
  nomor: string | null;
  tanggal?: string | null;
  olehUserId: string;
}): Promise<HasilTermin<{ kolaborasiId: string }>> {
  const nomor = input.nomor?.trim() || null;
  if (nomor && nomor.length > BATAS_NOMOR_BUKTI) return { ok: false, kode: "TERLALU_PANJANG" };
  const tgl = input.tanggal?.trim() || null;
  if (tgl && !bacaTanggal(tgl)) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };
  if (tgl && tgl > hariIniWib()) return { ok: false, kode: "TANGGAL_DEPAN" };
  return runSerializable(async (tx): Promise<HasilTermin<{ kolaborasiId: string }>> => {
    const t = await tx.kolPaymentTerm.findUnique({
      where: { id: input.terminId },
      select: { id: true, collabId: true, label: true, status: true, pph: true, nomorBuktiPotong: true, buktiPotongAt: true, collab: { select: { docNo: true } } },
    });
    if (!t) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (t.status !== "DIBAYAR") return { ok: false, kode: "BELUM_DIBAYAR" };
    if (keSen(angka(t.pph)) <= 0) return { ok: false, kode: "TANPA_PPH" };
    const buktiPotongAt = nomor ? (tgl ? (parseDateOnly(tgl) ?? new Date()) : (t.buktiPotongAt ?? new Date())) : null;
    await tx.kolPaymentTerm.update({ where: { id: t.id }, data: { nomorBuktiPotong: nomor, buktiPotongAt } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.BUKTI_POTONG_KOL_DICATAT,
      entityType: "KolBrief",
      entityId: t.collabId,
      changes: {
        before: { nomorBuktiPotong: t.nomorBuktiPotong, tanggal: hariDari(t.buktiPotongAt) },
        after: { nomorBuktiPotong: nomor, tanggal: hariDari(buktiPotongAt) },
      },
      metadata: { docNo: t.collab.docNo, terminId: t.id, termin: t.label },
    });
    return { ok: true, kolaborasiId: t.collabId };
  });
}

/** Catat setoran PPh (tanggal + NTPN) termin; `setor` null menghapusnya. */
export async function catatSetorPph(input: {
  terminId: string;
  setor: { tanggal: string; ntpn: string } | null;
  olehUserId: string;
}): Promise<HasilTermin<{ kolaborasiId: string }>> {
  let tanggal: Date | null = null;
  let ntpn: string | null = null;
  if (input.setor) {
    const tgl = input.setor.tanggal?.trim() ?? "";
    if (!bacaTanggal(tgl)) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };
    if (tgl > hariIniWib()) return { ok: false, kode: "TANGGAL_DEPAN" };
    ntpn = input.setor.ntpn?.trim() || null;
    if (ntpn && ntpn.length > BATAS_NOMOR_BUKTI) return { ok: false, kode: "TERLALU_PANJANG" };
    tanggal = parseDateOnly(tgl) ?? null;
  }
  return runSerializable(async (tx): Promise<HasilTermin<{ kolaborasiId: string }>> => {
    const t = await tx.kolPaymentTerm.findUnique({
      where: { id: input.terminId },
      select: { id: true, collabId: true, label: true, status: true, pph: true, setorAt: true, ntpn: true, collab: { select: { docNo: true } } },
    });
    if (!t) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (t.status !== "DIBAYAR") return { ok: false, kode: "BELUM_DIBAYAR" };
    if (keSen(angka(t.pph)) <= 0) return { ok: false, kode: "TANPA_PPH" };
    await tx.kolPaymentTerm.update({ where: { id: t.id }, data: { setorAt: tanggal, ntpn } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.SETOR_PPH_KOL_DICATAT,
      entityType: "KolBrief",
      entityId: t.collabId,
      changes: { before: { setorAt: hariDari(t.setorAt), ntpn: t.ntpn }, after: { setorAt: hariDari(tanggal), ntpn } },
      metadata: { docNo: t.collab.docNo, terminId: t.id, termin: t.label },
    });
    return { ok: true, kolaborasiId: t.collabId };
  });
}

// ───────────────────── Hitung ulang massal ─────────────────────

/**
 * Hitung ulang termin belum dibayar di semua kolaborasi (tarif berubah) atau
 * kolaborasi milik satu KOL (subjek pajak berubah). Satu transaksi per
 * kolaborasi; kegagalan satu kolaborasi tidak menghentikan yang lain.
 */
export async function hitungUlangTerminBelumDibayar(input: { olehUserId: string; sebab: string; kolId?: string }): Promise<number> {
  const daftar = await prisma.kolBrief.findMany({
    where: { fee: { gt: 0 }, terms: { some: { status: "BELUM" } }, ...(input.kolId ? { kolId: input.kolId } : {}) },
    select: { id: true },
  });
  const tarif = await bacaTarifPajakKreatif();
  let n = 0;
  for (const { id } of daftar) {
    try {
      const r = await runSerializable((tx) => selaraskanTermin(tx, { kolaborasiId: id, olehUserId: input.olehUserId, sebab: input.sebab, tarif }));
      if (r.ok && r.berubah) n++;
    } catch (e) {
      console.error("[hitungUlangTerminBelumDibayar] gagal untuk", id, e);
    }
  }
  return n;
}

// ───────────────────── Sinkron jurnal sesudah commit ─────────────────────

async function sinkronSesudah(kolaborasiId: string, olehUserId: string): Promise<void> {
  await sinkronJurnalKolAman([kolaborasiId], olehUserId);
}
