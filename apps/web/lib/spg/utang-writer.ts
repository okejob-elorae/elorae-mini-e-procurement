import type { AdminNotification, Prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { capNotificationText } from "@/lib/notifications/text";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { formatIDR } from "@/lib/sales-orders/format";
import { catatBebanDipotong, loncengBebanLunasLewatUtangTx, utangBebanSudahDiputuskan } from "./beban-spg-writer";
import { dariSen, keSen } from "./hilang";
import { bagianHilangTerbukaSpg } from "./hilang-db";
import { potongBebanHilangPenuh } from "./hilang-potong";
import { teksKoreksi, type KeUtang } from "./koreksi";
import { unitKomisiSpg } from "./koreksi-queries";
import { catatKoreksiDiterapkan, KomisiBerubahError } from "./koreksi-writer";
import {
  alokasiUtang,
  bacaCaraBayarUtang,
  ENTITAS_BAYAR_TAMBAHAN_SPG,
  ENTITAS_BAYAR_UTANG_SPG,
  ENTITAS_UTANG_SPG,
  JEJAK_UTANG_SPG,
  KATEGORI_NOTIF_UTANG_SPG,
  MAKS_CATATAN_UTANG,
  MAKS_KUNCI_UTANG,
  REF_BAYAR_TAMBAHAN_SPG,
  REF_BAYAR_UTANG_SPG,
  REF_CATAT_SISA_SPG,
  REF_UTANG_SPG,
  tanggalBayarSah,
  type CaraBayarUtangSpg,
} from "./utang";
import { bebanReturTerbukaSpg, keadaanSesudahAkhir, selisihSesudahAkhir, utangTerbukaSpg } from "./utang-queries";

/**
 * Penulis utang SPG yang sudah berhenti (P6, P6a, P67, P68, keputusan 11). Setiap langkah satu
 * `runSerializable` dengan jejaknya di transaksi yang sama; setiap pelunasan per utang
 * tukar-bandingkan pada `settledAmount` (penjaga hanya sah di dalam transaksi serializable).
 * Membuat utang tidak memposting jurnal; jurnal penerimaan dan bayar tambahan diposting pemanggil
 * SESUDAH komit (`kaitPenerimaanUtangSpg`, `kaitBayarTambahanSpg`).
 */

type Tx = Prisma.TransactionClient;

const angka = (v: unknown) => Number(v ?? 0);
/** Membangun ulang unit komisi di dalam transaksi membaca penjualan dan baris resmi — beri waktu lebih. */
const BANGUN_ULANG = { timeout: 30_000 };
const desimal = (sen: number) => (sen / 100).toFixed(2);

async function jejak(tx: Tx, isi: { userId: string; action: string; entityType: string; entityId: string; before: unknown; after: unknown; metadata: Record<string, unknown>; reason?: string | null }) {
  await tx.auditLog.create({
    data: {
      userId: isi.userId,
      action: isi.action,
      entityType: isi.entityType,
      entityId: isi.entityId,
      changes: { before: isi.before, after: isi.after } as Prisma.InputJsonValue,
      metadata: isi.metadata as Prisma.InputJsonValue,
      reason: isi.reason ?? null,
    },
  });
}

/**
 * Pembayaran terakhir SPG yang berhenti (B28): semua yang tidak tertutup menjadi SATU utang per
 * sumber, dan sumbernya ditutup di transaksi yang sama — koreksi minus dengan `SpgCommissionCorrection`
 * ber-`paidRefType` `SpgDebt`, bagian beban barang hilang dengan `StockLossDeduction` ber-`refType`
 * `SpgDebt`, beban retur pembeli dengan potongan beban ber-`paidRefType` `SpgDebt`. Tidak ada jurnal.
 */
export async function tutupKeUtangSpg(
  tx: Tx,
  input: { spgUserId: string; createdRefType: string; createdRefId: string; keUtang: KeUtang; bulanBayar: string; olehUserId: string; waktu: Date },
): Promise<{ id: string; jumlah: number }[]> {
  const dibuat: { id: string; jumlah: number }[] = [];
  const buat = async (d: { kind: string; sourceKey: string; storeId: string | null; bulan: string | null; jumlahSen: number; note: string }) => {
    const r = await tx.spgDebt.create({
      data: {
        spgUserId: input.spgUserId,
        kind: d.kind,
        sourceKey: d.sourceKey,
        sourceStoreId: d.storeId,
        sourceSalesMonth: d.bulan,
        amount: desimal(d.jumlahSen),
        createdRefType: input.createdRefType,
        createdRefId: input.createdRefId,
        note: d.note,
        createdById: input.olehUserId,
        createdAt: input.waktu,
      },
      select: { id: true },
    });
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_UTANG_SPG.DIBUAT,
      entityType: ENTITAS_UTANG_SPG,
      entityId: r.id,
      before: null,
      after: { kind: d.kind, sourceKey: d.sourceKey, amount: dariSen(d.jumlahSen) },
      metadata: { spgUserId: input.spgUserId, createdRefType: input.createdRefType, createdRefId: input.createdRefId, storeId: d.storeId },
    });
    dibuat.push({ id: r.id, jumlah: dariSen(d.jumlahSen) });
    return r.id;
  };

  for (const k of input.keUtang.koreksi) {
    const id = await buat({ kind: "KOREKSI", sourceKey: k.sumber, storeId: k.storeId, bulan: k.bulanJual, jumlahSen: keSen(k.jumlah), note: `Sisa koreksi penjualan ${k.bulanJual}` });
    await catatKoreksiDiterapkan(tx, {
      userId: input.spgUserId,
      rencana: {
        refType: "SpgCommission",
        refId: id,
        koreksi: [
          {
            sumber: k.sumber,
            jenis: k.jenis,
            storeId: k.storeId,
            namaToko: "",
            bulanJual: k.bulanJual,
            selisih: -k.jumlah,
            selisihGaji: -k.gaji,
            diterapkan: -k.jumlah,
            gajiDiterapkan: -k.gaji,
            dibawa: 0,
            angka: 0,
            dibayarSebelum: 0,
            terapanSebelum: 0,
          },
        ],
      },
      bulanBayar: input.bulanBayar,
      olehUserId: input.olehUserId,
      waktu: input.waktu,
      paidRefType: REF_UTANG_SPG,
      paidRefId: id,
    });
  }
  for (const h of input.keUtang.hilang) {
    const jumlahSen = keSen(h.jumlah);
    const id = await buat({ kind: "BARANG_HILANG", sourceKey: h.shareId, storeId: h.storeId, bulan: null, jumlahSen, note: "Sisa beban barang hilang" });
    await potongBebanHilangPenuh(tx, {
      userId: input.spgUserId,
      potong: [{ shareId: h.shareId, sen: jumlahSen }],
      refType: REF_UTANG_SPG,
      refId: id,
      createdById: input.olehUserId,
      note: "Dialihkan ke utang SPG",
    });
  }
  const retur: { chargeId: string; jumlah: number; dariKomisi: number; dariGaji: number; paidRefType: string; paidRefId: string }[] = [];
  for (const r of input.keUtang.retur) {
    const id = await buat({ kind: "RETUR_PEMBELI", sourceKey: r.chargeId, storeId: r.storeId, bulan: null, jumlahSen: keSen(r.jumlah), note: "Sisa beban retur pembeli" });
    retur.push({ chargeId: r.chargeId, jumlah: r.jumlah, dariKomisi: 0, dariGaji: 0, paidRefType: REF_UTANG_SPG, paidRefId: id });
  }
  if (retur.length > 0) await catatBebanDipotong(tx, { olehUserId: input.olehUserId, waktu: input.waktu, bulanBayar: input.bulanBayar, potong: retur });
  return dibuat;
}

/**
 * Potong utang SPG yang terbuka di sebuah pembayaran (B22d, B31): satu `SpgDebtSettlement` (POTONG)
 * per utang, `settledAmount` naik dengan tukar-bandingkan; utang yang tertutup menjadi LUNAS.
 * Mengembalikan Σ yang dipotong (rupiah).
 */
export async function potongUtangSpg(tx: Tx, input: { potong: readonly { debtId: string; sen: number }[]; refType: string; refId: string; olehUserId: string; jenis?: "POTONG" | "IMBANG" }): Promise<number> {
  let total = 0;
  for (const p of input.potong) {
    if (p.sen <= 0) continue;
    const d = await tx.spgDebt.findUnique({ where: { id: p.debtId }, select: { id: true, amount: true, settledAmount: true, status: true } });
    if (!d || d.status !== "TERBUKA") throw new KomisiBerubahError(0);
    const sisaSen = keSen(angka(d.amount)) - keSen(angka(d.settledAmount));
    if (p.sen > sisaSen) throw new KomisiBerubahError(0);
    const baru = keSen(angka(d.settledAmount)) + p.sen;
    const r = await tx.spgDebt.updateMany({
      where: { id: d.id, settledAmount: d.settledAmount, status: "TERBUKA" },
      data: { settledAmount: desimal(baru), ...(baru >= keSen(angka(d.amount)) ? { status: "LUNAS", settledAt: new Date() } : {}) },
    });
    if (r.count !== 1) throw new KomisiBerubahError(0);
    await tx.spgDebtSettlement.create({
      data: { debtId: d.id, amount: desimal(p.sen), kind: input.jenis ?? "POTONG", refType: input.refType, refId: input.refId, createdById: input.olehUserId },
    });
    total += p.sen;
  }
  return dariSen(total);
}

export type KodeSesudahAkhir = "BELUM_BERHENTI" | "BELUM_DIBAYAR_AKHIR" | "MASIH_ADA_BARIS_BELUM_DIBAYAR";

async function periksaSesudahAkhir(tx: Tx, spgUserId: string): Promise<KodeSesudahAkhir | null> {
  const k = await keadaanSesudahAkhir(tx, spgUserId);
  if (!k.berhenti) return "BELUM_BERHENTI";
  if (k.adaBarisBelumDibayar) return "MASIH_ADA_BARIS_BELUM_DIBAYAR";
  if (!k.akhirDibayar) return "BELUM_DIBAYAR_AKHIR";
  return null;
}

/**
 * Sesudah pembayaran terakhirnya (B29): pengurang baru — retur pembeli atas notanya yang disetujui
 * belakangan (koreksi minus), bagian beban barang hilang dan beban retur yang diputuskan sesudah ia
 * berhenti — dicatat sebagai utang. `jumlahDiharapkan` = yang dilihat kantor. `kunci` dibuat sekali
 * per tindakan: ia `createdRefId` utangnya (kunci unik utang) sekaligus penjaga kiriman ulang.
 */
export async function catatSisaSpgBerhenti(input: {
  spgUserId: string;
  olehUserId: string;
  jumlahDiharapkan: number;
  kunci: unknown;
  sekarang?: Date;
}): Promise<{ ok: true; utang: number; ulang?: true } | { ok: false; kode: KodeSesudahAkhir | "TIDAK_ADA_SISA" | "ANGKA_BERUBAH" | "KUNCI_WAJIB" }> {
  const kunci = typeof input.kunci === "string" ? input.kunci.trim() : "";
  if (!kunci || kunci.length > MAKS_KUNCI_UTANG) return { ok: false, kode: "KUNCI_WAJIB" };
  const sekarang = input.sekarang ?? new Date();
  try {
    return await runSerializable(async (tx) => {
      const ulang = await tx.spgDebt.findFirst({ where: { createdRefType: REF_CATAT_SISA_SPG, createdRefId: kunci }, select: { spgUserId: true } });
      if (ulang) return ulang.spgUserId === input.spgUserId ? { ok: true as const, utang: 0, ulang: true as const } : { ok: false as const, kode: "KUNCI_WAJIB" as const };
      const tolak = await periksaSesudahAkhir(tx, input.spgUserId);
      if (tolak) return { ok: false as const, kode: tolak };
      // Unit dibangun ulang DI DALAM transaksi (koreksi yang sudah diterapkan ikut terbaca): dua
      // tindakan bersamaan dengan kunci berbeda tidak pernah mencatat sisa yang sama dua kali.
      const units = (await unitKomisiSpg(tx, [input.spgUserId], sekarang)).get(input.spgUserId) ?? [];
      const { minus } = selisihSesudahAkhir(units);
      const hilang = await bagianHilangTerbukaSpg(tx, input.spgUserId);
      const retur = await bebanReturTerbukaSpg(tx, input.spgUserId);
      const keUtang: KeUtang = {
        koreksi: minus.map((m) => ({ sumber: m.sumber, jenis: m.jenis, storeId: m.storeId, bulanJual: m.bulanJual, jumlah: m.jumlah, gaji: m.gaji })),
        hilang: hilang.map((h) => ({ shareId: h.shareId, lossId: h.lossId, storeId: h.storeId, jumlah: dariSen(h.sisaSen) })),
        retur: retur.map((r) => ({ chargeId: r.chargeId, storeId: r.storeId, jumlah: dariSen(r.sisaSen) })),
      };
      const totalSen = keUtang.koreksi.reduce((n, k) => n + keSen(k.jumlah), 0) + keUtang.hilang.reduce((n, h) => n + keSen(h.jumlah), 0) + keUtang.retur.reduce((n, r) => n + keSen(r.jumlah), 0);
      if (totalSen <= 0) return { ok: false as const, kode: "TIDAK_ADA_SISA" as const };
      if (totalSen !== keSen(input.jumlahDiharapkan)) throw new KomisiBerubahError(dariSen(totalSen));
      const dibuat = await tutupKeUtangSpg(tx, {
        spgUserId: input.spgUserId,
        createdRefType: REF_CATAT_SISA_SPG,
        createdRefId: kunci,
        keUtang,
        bulanBayar: bulanWib(sekarang),
        olehUserId: input.olehUserId,
        waktu: sekarang,
      });
      return { ok: true as const, utang: dibuat.reduce((n, d) => n + d.jumlah, 0) };
    }, BANGUN_ULANG);
  } catch (e) {
    if (e instanceof KomisiBerubahError) return { ok: false, kode: "ANGKA_BERUBAH" };
    throw e;
  }
}

/**
 * Koreksi plus sesudah pembayaran terakhir (P67): ditulis dengan `paidRefType` `SpgExtraPayout`,
 * lalu mengurangi utangnya dulu (terlama dulu, `SpgDebtSettlement` IMBANG), dan sisanya dibayar
 * terpisah (`SpgExtraPayout`; cara dan tanggal wajib kalau sisanya > 0). Ditolak selama masih ada
 * pengurang yang belum dicatat sebagai utang (`SISA_MINUS_BELUM_DICATAT`).
 */
export async function terapkanKoreksiPlusSesudahAkhir(input: {
  spgUserId: string;
  cara?: unknown;
  dibayarPada?: unknown;
  fotoR2Key?: unknown;
  kunci: unknown;
  jumlahDiharapkan: number;
  olehUserId: string;
  sekarang?: Date;
}): Promise<
  | { ok: true; imbang: number; dibayar: number; payoutId: string; ulang?: true }
  | { ok: false; kode: KodeSesudahAkhir | "SISA_MINUS_BELUM_DICATAT" | "TIDAK_ADA_KOREKSI_PLUS" | "CARA_TIDAK_SAH" | "TANGGAL_TIDAK_SAH" | "ANGKA_BERUBAH" | "KUNCI_WAJIB" }
> {
  const kunci = typeof input.kunci === "string" ? input.kunci.trim() : "";
  if (!kunci || kunci.length > MAKS_KUNCI_UTANG) return { ok: false, kode: "KUNCI_WAJIB" };
  const sekarang = input.sekarang ?? new Date();
  const hariIni = kunciHariWib(sekarang);
  try {
    return await runSerializable(async (tx) => {
      const ada = await tx.spgExtraPayout.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, spgUserId: true, amount: true, offsetAmount: true } });
      if (ada) {
        return ada.spgUserId === input.spgUserId
          ? { ok: true as const, imbang: angka(ada.offsetAmount), dibayar: angka(ada.amount), payoutId: ada.id, ulang: true as const }
          : { ok: false as const, kode: "KUNCI_WAJIB" as const };
      }
      const tolak = await periksaSesudahAkhir(tx, input.spgUserId);
      if (tolak) return { ok: false as const, kode: tolak };
      // Dibangun ulang di transaksi ini, seperti `catatSisaSpgBerhenti`: plus yang sama tidak
      // pernah dibayarkan dua kali oleh dua dialog bersamaan.
      const units = (await unitKomisiSpg(tx, [input.spgUserId], sekarang)).get(input.spgUserId) ?? [];
      const { minus, plus } = selisihSesudahAkhir(units);
      const [hilang, retur] = await Promise.all([bagianHilangTerbukaSpg(tx, input.spgUserId), bebanReturTerbukaSpg(tx, input.spgUserId)]);
      if (minus.length > 0 || hilang.length > 0 || retur.length > 0) return { ok: false as const, kode: "SISA_MINUS_BELUM_DICATAT" as const };
      const plusSen = plus.reduce((n, p) => n + keSen(p.jumlah), 0);
      if (plusSen <= 0) return { ok: false as const, kode: "TIDAK_ADA_KOREKSI_PLUS" as const };
      if (plusSen !== keSen(input.jumlahDiharapkan)) throw new KomisiBerubahError(dariSen(plusSen));

      const utang = await utangTerbukaSpg(tx, input.spgUserId);
      const imbang = alokasiUtang(
        utang.map((u) => ({ id: u.debtId, sisaSen: u.sisaSen })),
        plusSen,
      );
      const imbangSen = imbang.reduce((n, i) => n + i.sen, 0);
      const tunaiSen = plusSen - imbangSen;
      let cara: CaraBayarUtangSpg | null = null;
      let paidOn = hariIni;
      if (tunaiSen > 0) {
        cara = bacaCaraBayarUtang(input.cara);
        if (!cara) return { ok: false as const, kode: "CARA_TIDAK_SAH" as const };
        if (!tanggalBayarSah(input.dibayarPada, hariIni)) return { ok: false as const, kode: "TANGGAL_TIDAK_SAH" as const };
        paidOn = input.dibayarPada;
      }
      const payout = await tx.spgExtraPayout.create({
        data: {
          spgUserId: input.spgUserId,
          amount: desimal(tunaiSen),
          offsetAmount: desimal(imbangSen),
          method: cara,
          paidOn,
          photoR2Key: typeof input.fotoR2Key === "string" && input.fotoR2Key ? input.fotoR2Key : null,
          idempotencyKey: kunci,
          createdById: input.olehUserId,
        },
        select: { id: true },
      });
      await catatKoreksiDiterapkan(tx, {
        userId: input.spgUserId,
        rencana: {
          refType: "SpgCommission",
          refId: payout.id,
          koreksi: plus.map((p) => ({
            sumber: p.sumber,
            jenis: p.jenis,
            storeId: p.storeId,
            namaToko: p.namaToko,
            bulanJual: p.bulanJual,
            selisih: p.jumlah,
            selisihGaji: p.gaji,
            diterapkan: p.jumlah,
            gajiDiterapkan: p.gaji,
            dibawa: 0,
            angka: 0,
            dibayarSebelum: 0,
            terapanSebelum: 0,
          })),
        },
        bulanBayar: bulanWib(sekarang),
        olehUserId: input.olehUserId,
        waktu: sekarang,
        paidRefType: REF_BAYAR_TAMBAHAN_SPG,
        paidRefId: payout.id,
      });
      if (imbang.length > 0) {
        await potongUtangSpg(tx, { potong: imbang.map((i) => ({ debtId: i.id, sen: i.sen })), refType: REF_BAYAR_TAMBAHAN_SPG, refId: payout.id, olehUserId: input.olehUserId, jenis: "IMBANG" });
        await jejak(tx, {
          userId: input.olehUserId,
          action: JEJAK_UTANG_SPG.IMBANG,
          entityType: ENTITAS_BAYAR_TAMBAHAN_SPG,
          entityId: payout.id,
          before: null,
          after: { imbang: imbang.map((i) => ({ debtId: i.id, jumlah: dariSen(i.sen) })) },
          metadata: { spgUserId: input.spgUserId },
        });
      }
      await jejak(tx, {
        userId: input.olehUserId,
        action: JEJAK_UTANG_SPG.TAMBAHAN_DIBAYAR,
        entityType: ENTITAS_BAYAR_TAMBAHAN_SPG,
        entityId: payout.id,
        before: null,
        after: { koreksiPlus: dariSen(plusSen), imbang: dariSen(imbangSen), dibayar: dariSen(tunaiSen), cara, paidOn },
        metadata: { spgUserId: input.spgUserId, sumber: plus.map((p) => ({ sumber: p.sumber, jumlah: p.jumlah, catatan: teksKoreksi({ ...p, gajiDiterapkan: p.gaji }) })) },
      });
      return { ok: true as const, imbang: dariSen(imbangSen), dibayar: dariSen(tunaiSen), payoutId: payout.id };
    }, BANGUN_ULANG);
  } catch (e) {
    if (e instanceof KomisiBerubahError) return { ok: false, kode: "ANGKA_BERUBAH" };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Pembayaran utang (dicatat kantor, menunggu cek mutasi bank)
// ---------------------------------------------------------------------------

export type KodeBayarUtang =
  | "JUMLAH_TIDAK_SAH"
  | "MELEBIHI_SISA"
  | "CARA_TIDAK_SAH"
  | "TANGGAL_TIDAK_SAH"
  | "KUNCI_WAJIB"
  | "FOTO_TIDAK_SAH"
  | "TIDAK_ADA_UTANG"
  | "CATATAN_TERLALU_PANJANG"
  | "TIDAK_DITEMUKAN"
  | "STATUS_BERUBAH"
  | "PEMERIKSA_SAMA"
  | "ALASAN_WAJIB"
  | "SUDAH_DIBATALKAN"
  | "BUKAN_PENCATAT"
  | "BEBAN_SUDAH_DIPUTUSKAN";

function bacaJumlahSen(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = Math.round(n * 100);
  if (Math.abs(s - n * 100) > 1e-6) return null;
  return s;
}

async function sisaBolehDicatat(tx: Tx, spgUserId: string, kecualiId?: string): Promise<number> {
  const [utang, menunggu] = await Promise.all([
    utangTerbukaSpg(tx, spgUserId),
    tx.spgDebtPayment.findMany({ where: { spgUserId, status: "MENUNGGU_CEK", ...(kecualiId ? { id: { not: kecualiId } } : {}) }, select: { amount: true } }),
  ]);
  return utang.reduce((n, u) => n + u.sisaSen, 0) - menunggu.reduce((n, m) => n + keSen(angka(m.amount)), 0);
}

async function namaSpg(tx: Tx, userId: string): Promise<string> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return u?.name?.trim() || u?.email || "SPG";
}

/** Catat pembayaran utang SPG (P68): MENUNGGU_CEK, tidak mengurangi apa pun sampai diperiksa. */
export async function catatPenerimaanUtangSpg(input: {
  spgUserId: string;
  jumlah: unknown;
  cara: unknown;
  diterimaPada: unknown;
  fotoR2Key?: unknown;
  catatan?: unknown;
  kunci: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true; ulang: boolean; id: string } | { ok: false; kode: KodeBayarUtang }> {
  const kunci = typeof input.kunci === "string" ? input.kunci.trim() : "";
  if (!kunci || kunci.length > MAKS_KUNCI_UTANG) return { ok: false, kode: "KUNCI_WAJIB" };
  const jumlahSen = bacaJumlahSen(input.jumlah);
  if (jumlahSen === null) return { ok: false, kode: "JUMLAH_TIDAK_SAH" };
  const cara = bacaCaraBayarUtang(input.cara);
  if (!cara) return { ok: false, kode: "CARA_TIDAK_SAH" };
  const sekarang = input.sekarang ?? new Date();
  if (!tanggalBayarSah(input.diterimaPada, kunciHariWib(sekarang))) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  const diterimaPada = input.diterimaPada;
  if (input.fotoR2Key !== undefined && input.fotoR2Key !== null && (typeof input.fotoR2Key !== "string" || input.fotoR2Key.length > 191)) return { ok: false, kode: "FOTO_TIDAK_SAH" };
  const catatan = typeof input.catatan === "string" ? input.catatan.trim() : "";
  if (catatan.length > MAKS_CATATAN_UTANG) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };

  const sesudah: { notif: AdminNotification | null } = { notif: null };
  const hasil = await runSerializable(async (tx): Promise<{ ok: true; ulang: boolean; id: string } | { ok: false; kode: KodeBayarUtang }> => {
    sesudah.notif = null;
    const ada = await tx.spgDebtPayment.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, spgUserId: true } });
    if (ada) return ada.spgUserId === input.spgUserId ? { ok: true, ulang: true, id: ada.id } : { ok: false, kode: "KUNCI_WAJIB" };
    const sisa = await sisaBolehDicatat(tx, input.spgUserId);
    if (sisa <= 0) return { ok: false, kode: "TIDAK_ADA_UTANG" };
    if (jumlahSen > sisa) return { ok: false, kode: "MELEBIHI_SISA" };
    const p = await tx.spgDebtPayment.create({
      data: {
        spgUserId: input.spgUserId,
        amount: desimal(jumlahSen),
        method: cara,
        receivedOn: diterimaPada,
        photoR2Key: typeof input.fotoR2Key === "string" && input.fotoR2Key ? input.fotoR2Key : null,
        note: catatan || null,
        idempotencyKey: kunci,
        createdById: input.olehUserId,
      },
      select: { id: true },
    });
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_UTANG_SPG.BAYAR_DICATAT,
      entityType: ENTITAS_BAYAR_UTANG_SPG,
      entityId: p.id,
      before: null,
      after: { status: "MENUNGGU_CEK", jumlah: dariSen(jumlahSen), cara, diterimaPada },
      metadata: { spgUserId: input.spgUserId },
    });
    const nama = await namaSpg(tx, input.spgUserId);
    sesudah.notif = await tx.adminNotification.create({
      data: {
        category: KATEGORI_NOTIF_UTANG_SPG.BAYAR_DIAJUKAN,
        title: capNotificationText(`Pembayaran utang ${nama} ${formatIDR(dariSen(jumlahSen))} menunggu cek`),
        message: capNotificationText("Cocokkan dengan mutasi rekening sebelum utang SPG berkurang."),
        metadata: { paymentId: p.id, spgUserId: input.spgUserId },
      },
    });
    return { ok: true, ulang: false, id: p.id };
  });
  if (hasil.ok && sesudah.notif) {
    const n = sesudah.notif;
    await fanOutAdminNotification({ id: n.id, category: n.category, title: n.title, message: n.message, metadata: n.metadata });
  }
  return hasil;
}

/** Revisi pembayaran yang dikembalikan pemeriksa → MENUNGGU_CEK lagi (pencatat atau pemegang `spg_commission:pay`). */
export async function revisiPenerimaanUtangSpg(input: {
  id: string;
  versi: number;
  jumlah: unknown;
  cara: unknown;
  diterimaPada: unknown;
  fotoR2Key?: unknown;
  catatan?: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true } | { ok: false; kode: KodeBayarUtang }> {
  const jumlahSen = bacaJumlahSen(input.jumlah);
  if (jumlahSen === null) return { ok: false, kode: "JUMLAH_TIDAK_SAH" };
  const cara = bacaCaraBayarUtang(input.cara);
  if (!cara) return { ok: false, kode: "CARA_TIDAK_SAH" };
  const sekarang = input.sekarang ?? new Date();
  if (!tanggalBayarSah(input.diterimaPada, kunciHariWib(sekarang))) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  const diterimaPada = input.diterimaPada;
  const catatan = typeof input.catatan === "string" ? input.catatan.trim() : "";
  if (catatan.length > MAKS_CATATAN_UTANG) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  const sesudah: { notif: AdminNotification | null } = { notif: null };
  const hasil = await runSerializable(async (tx): Promise<{ ok: true } | { ok: false; kode: KodeBayarUtang }> => {
    sesudah.notif = null;
    const p = await tx.spgDebtPayment.findUnique({ where: { id: input.id }, select: { id: true, spgUserId: true, status: true, version: true, amount: true, method: true, receivedOn: true } });
    if (!p) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (p.status !== "DIKEMBALIKAN" || p.version !== input.versi) return { ok: false, kode: "STATUS_BERUBAH" };
    const sisa = await sisaBolehDicatat(tx, p.spgUserId, p.id);
    if (jumlahSen > sisa) return { ok: false, kode: "MELEBIHI_SISA" };
    const r = await tx.spgDebtPayment.updateMany({
      where: { id: p.id, status: "DIKEMBALIKAN", version: input.versi },
      data: {
        status: "MENUNGGU_CEK",
        version: { increment: 1 },
        amount: desimal(jumlahSen),
        method: cara,
        receivedOn: diterimaPada,
        ...(typeof input.fotoR2Key === "string" ? { photoR2Key: input.fotoR2Key || null } : {}),
        note: catatan || null,
        returnNote: null,
        checkedById: null,
        checkedAt: null,
      },
    });
    if (r.count !== 1) return { ok: false, kode: "STATUS_BERUBAH" };
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_UTANG_SPG.BAYAR_DIREVISI,
      entityType: ENTITAS_BAYAR_UTANG_SPG,
      entityId: p.id,
      before: { status: p.status, jumlah: angka(p.amount), cara: p.method, diterimaPada: p.receivedOn },
      after: { status: "MENUNGGU_CEK", jumlah: dariSen(jumlahSen), cara, diterimaPada },
      metadata: { spgUserId: p.spgUserId },
    });
    const nama = await namaSpg(tx, p.spgUserId);
    sesudah.notif = await tx.adminNotification.create({
      data: {
        category: KATEGORI_NOTIF_UTANG_SPG.BAYAR_DIAJUKAN,
        title: capNotificationText(`Pembayaran utang ${nama} direvisi, menunggu cek`),
        message: capNotificationText("Cocokkan dengan mutasi rekening sebelum utang SPG berkurang."),
        metadata: { paymentId: p.id, spgUserId: p.spgUserId },
      },
    });
    return { ok: true };
  });
  if (hasil.ok && sesudah.notif) {
    const n = sesudah.notif;
    await fanOutAdminNotification({ id: n.id, category: n.category, title: n.title, message: n.message, metadata: n.metadata });
  }
  return hasil;
}

/** Pencatat dan setiap perevisi pembayaran (dari jejaknya) — tidak ada yang memeriksa yang ikut ia catat. */
async function pencatatPembayaran(tx: Tx, id: string, createdById: string): Promise<Set<string>> {
  const jejakRows = await tx.auditLog.findMany({
    where: { entityType: ENTITAS_BAYAR_UTANG_SPG, entityId: id, action: { in: [JEJAK_UTANG_SPG.BAYAR_DICATAT, JEJAK_UTANG_SPG.BAYAR_DIREVISI] } },
    select: { userId: true },
  });
  return new Set([createdById, ...jejakRows.map((j) => j.userId).filter((x): x is string => Boolean(x))]);
}

/**
 * Periksa pembayaran utang terhadap mutasi rekening (`payments:verify`, bukan pencatat/perevisinya).
 * TERVERIFIKASI: dialokasikan ke utang terlama dulu (`SpgDebtSettlement` BAYAR, tukar-bandingkan per
 * utang); beban retur pembeli yang sisanya pindah ke utang yang kini lunas sudah diganti, jadi
 * kantor diberi lonceng "putuskan barangnya" (P79) — ditulis di transaksi ini, disebar sesudah komit.
 * DIKEMBALIKAN: catatan wajib; pencatat dikabari untuk merevisi.
 */
export async function periksaPenerimaanUtangSpg(input: {
  id: string;
  versi: number;
  keputusan: "TERVERIFIKASI" | "DIKEMBALIKAN";
  catatan?: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<{ ok: true } | { ok: false; kode: KodeBayarUtang }> {
  const catatan = typeof input.catatan === "string" ? input.catatan.trim() : "";
  if (input.keputusan === "DIKEMBALIKAN" && !catatan) return { ok: false, kode: "ALASAN_WAJIB" };
  if (catatan.length > MAKS_CATATAN_UTANG) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  const sekarang = input.sekarang ?? new Date();
  const sesudah: { notif: AdminNotification | null; lunas: AdminNotification[] } = { notif: null, lunas: [] };
  const hasil = await runSerializable(async (tx): Promise<{ ok: true } | { ok: false; kode: KodeBayarUtang }> => {
    // Callback ini bisa diulang: lonceng dari percobaan yang gagal tidak boleh ikut tersebar.
    sesudah.notif = null;
    sesudah.lunas = [];
    const p = await tx.spgDebtPayment.findUnique({ where: { id: input.id }, select: { id: true, spgUserId: true, status: true, version: true, amount: true, createdById: true } });
    if (!p) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (p.status !== "MENUNGGU_CEK" || p.version !== input.versi) return { ok: false, kode: "STATUS_BERUBAH" };
    if ((await pencatatPembayaran(tx, p.id, p.createdById)).has(input.olehUserId)) return { ok: false, kode: "PEMERIKSA_SAMA" };
    const r = await tx.spgDebtPayment.updateMany({
      where: { id: p.id, status: "MENUNGGU_CEK", version: input.versi },
      data:
        input.keputusan === "TERVERIFIKASI"
          ? { status: "TERVERIFIKASI", checkedById: input.olehUserId, checkedAt: sekarang, returnNote: null }
          : { status: "DIKEMBALIKAN", checkedById: input.olehUserId, checkedAt: sekarang, returnNote: catatan },
    });
    if (r.count !== 1) return { ok: false, kode: "STATUS_BERUBAH" };
    if (input.keputusan === "TERVERIFIKASI") {
      const utang = await utangTerbukaSpg(tx, p.spgUserId);
      const jumlahSen = keSen(angka(p.amount));
      if (jumlahSen > utang.reduce((n, u) => n + u.sisaSen, 0)) throw new LebihDariSisa();
      const alokasi = alokasiUtang(utang.map((u) => ({ id: u.debtId, sisaSen: u.sisaSen })), jumlahSen);
      const jadiLunas: string[] = [];
      for (const a of alokasi) {
        const d = await tx.spgDebt.findUnique({ where: { id: a.id }, select: { amount: true, settledAmount: true } });
        if (!d) throw new LebihDariSisa();
        const baru = keSen(angka(d.settledAmount)) + a.sen;
        const lunas = baru >= keSen(angka(d.amount));
        const u = await tx.spgDebt.updateMany({
          where: { id: a.id, settledAmount: d.settledAmount, status: "TERBUKA" },
          data: { settledAmount: desimal(baru), ...(lunas ? { status: "LUNAS", settledAt: sekarang } : {}) },
        });
        if (u.count !== 1) throw new LebihDariSisa();
        await tx.spgDebtSettlement.create({ data: { debtId: a.id, amount: desimal(a.sen), kind: "BAYAR", refType: REF_BAYAR_UTANG_SPG, refId: p.id, createdById: input.olehUserId } });
        if (lunas) jadiLunas.push(a.id);
      }
      // P79: keputusan barang menunggu pelunasan penuh — begitu utangnya lunas, kantor memutuskannya.
      sesudah.lunas.push(...(await loncengBebanLunasLewatUtangTx(tx, jadiLunas)));
    }
    await jejak(tx, {
      userId: input.olehUserId,
      action: input.keputusan === "TERVERIFIKASI" ? JEJAK_UTANG_SPG.BAYAR_DIVERIFIKASI : JEJAK_UTANG_SPG.BAYAR_DIKEMBALIKAN,
      entityType: ENTITAS_BAYAR_UTANG_SPG,
      entityId: p.id,
      before: { status: p.status, version: p.version },
      after: { status: input.keputusan, version: p.version },
      metadata: { spgUserId: p.spgUserId },
      reason: catatan || null,
    });
    if (input.keputusan === "DIKEMBALIKAN") {
      const nama = await namaSpg(tx, p.spgUserId);
      sesudah.notif = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_UTANG_SPG.BAYAR_DIKEMBALIKAN,
          title: capNotificationText(`Pembayaran utang ${nama} dikembalikan pemeriksa`),
          message: capNotificationText("Perbaiki sesuai catatan pemeriksa, lalu ajukan lagi."),
          metadata: { paymentId: p.id, spgUserId: p.spgUserId },
        },
      });
    }
    return { ok: true };
  }).catch((e: unknown) => {
    if (e instanceof LebihDariSisa) return { ok: false as const, kode: "MELEBIHI_SISA" as const };
    throw e;
  });
  if (hasil.ok) {
    for (const n of [...(sesudah.notif ? [sesudah.notif] : []), ...sesudah.lunas]) {
      await fanOutAdminNotification({ id: n.id, category: n.category, title: n.title, message: n.message, metadata: n.metadata });
    }
  }
  return hasil;
}

class LebihDariSisa extends Error {
  constructor() {
    super("MELEBIHI_SISA");
    this.name = "LebihDariSisa";
  }
}

/**
 * Batalkan pembayaran utang. Yang belum diperiksa (MENUNGGU_CEK / DIKEMBALIKAN): pencatatnya atau
 * pemegang `spg_commission:pay` (`bolehBatalkanBelumDicek`). Yang sudah TERVERIFIKASI: hanya pemegang
 * `payments:verify` (`bolehBatalkanTerverifikasi`) — pelunasannya dikembalikan ke utang. Alasan wajib.
 * Ditolak `BEBAN_SUDAH_DIPUTUSKAN` bila utang yang dilunasinya menanggung beban retur pembeli yang
 * barangnya SUDAH diputuskan (P79): membatalkannya mengembalikan uang yang tidak pernah diterima,
 * atau meninggalkan barang yang dibawa SPG tanpa dibayar.
 */
export async function batalkanPenerimaanUtangSpg(input: {
  id: string;
  olehUserId: string;
  alasan: unknown;
  bolehBatalkanBelumDicek: boolean;
  bolehBatalkanTerverifikasi: boolean;
  sekarang?: Date;
}): Promise<{ ok: true; terverifikasi: boolean } | { ok: false; kode: KodeBayarUtang }> {
  const alasan = typeof input.alasan === "string" ? input.alasan.trim() : "";
  if (!alasan) return { ok: false, kode: "ALASAN_WAJIB" };
  if (alasan.length > MAKS_CATATAN_UTANG) return { ok: false, kode: "CATATAN_TERLALU_PANJANG" };
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<{ ok: true; terverifikasi: boolean } | { ok: false; kode: KodeBayarUtang }> => {
    const p = await tx.spgDebtPayment.findUnique({ where: { id: input.id }, select: { id: true, spgUserId: true, status: true, createdById: true } });
    if (!p) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (p.status === "DIBATALKAN") return { ok: false, kode: "SUDAH_DIBATALKAN" };
    const terverifikasi = p.status === "TERVERIFIKASI";
    if (terverifikasi ? !input.bolehBatalkanTerverifikasi : !(input.bolehBatalkanBelumDicek || p.createdById === input.olehUserId)) {
      return { ok: false, kode: "BUKAN_PENCATAT" };
    }
    // Pelunasan hanya ada pada penerimaan yang sudah TERVERIFIKASI; yang belum dicek tidak punya.
    const lunasan = await tx.spgDebtSettlement.findMany({ where: { refType: REF_BAYAR_UTANG_SPG, refId: p.id, voidedAt: null }, select: { id: true, debtId: true, amount: true } });
    // Diperiksa sebelum menulis apa pun (P79).
    if (terverifikasi && (await utangBebanSudahDiputuskan(tx, lunasan.map((l) => l.debtId)))) return { ok: false, kode: "BEBAN_SUDAH_DIPUTUSKAN" };
    const r = await tx.spgDebtPayment.updateMany({
      where: { id: p.id, status: p.status },
      data: { status: "DIBATALKAN", voidedAt: sekarang, voidedById: input.olehUserId, voidReason: alasan },
    });
    if (r.count !== 1) return { ok: false, kode: "STATUS_BERUBAH" };
    if (terverifikasi) {
      for (const l of lunasan) {
        const d = await tx.spgDebt.findUnique({ where: { id: l.debtId }, select: { settledAmount: true } });
        if (!d) continue;
        const baru = Math.max(0, keSen(angka(d.settledAmount)) - keSen(angka(l.amount)));
        await tx.spgDebt.update({ where: { id: l.debtId }, data: { settledAmount: desimal(baru), status: "TERBUKA", settledAt: null } });
        await tx.spgDebtSettlement.update({ where: { id: l.id }, data: { voidedAt: sekarang, voidedById: input.olehUserId } });
      }
    }
    await jejak(tx, {
      userId: input.olehUserId,
      action: JEJAK_UTANG_SPG.BAYAR_DIBATALKAN,
      entityType: ENTITAS_BAYAR_UTANG_SPG,
      entityId: p.id,
      before: { status: p.status },
      after: { status: "DIBATALKAN" },
      metadata: { spgUserId: p.spgUserId, terverifikasi },
      reason: alasan,
    });
    return { ok: true, terverifikasi };
  });
}
