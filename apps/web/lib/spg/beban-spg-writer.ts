import { Prisma, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatRupiah } from "@/lib/format/rupiah";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { capNotificationText, NOTIFICATION_TEXT_MAX } from "@/lib/notifications/text";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { rangkaiDalamBatas } from "./antaran";
import {
  ENTITAS_BEBAN_SPG,
  REF_BEBAN_KE_UTANG,
  teksBebanReturPembeli,
  type JenisTokoBeban,
  type KeputusanBarangBeban,
} from "./beban-spg";
import { KATEGORI_NOTIF_RETUR_PEMBELI } from "./retur-pembeli-status";
import { alokasiUtang } from "./utang";
import { keadaanSesudahAkhir, utangTerbukaSpg } from "./utang-queries";
import { potongUtangSpg } from "./utang-writer";

/**
 * Penulis beban SPG (`SpgCharge` + `SpgChargeDeduction`).
 *
 * Setiap penulis `...Tx` WAJIB dijalankan di dalam `runSerializable` milik
 * pemanggilnya: penjaganya `updateMany` bersyarat (Prisma `updateMany` bukan
 * compare-and-swap di luar transaksi serializable), dan jejaknya ditulis di
 * transaksi yang sama. Kalau penjaga meleset, penulis MELEMPAR P2034 —
 * transaksi diulang dengan bacaan baru, dan pemanggil (rencana bayar yang
 * disusun ulang di dalam transaksi) melihat keadaan barunya.
 *
 * Membuat, mengubah, atau membatalkan beban tidak memposting jurnal. Potongan
 * dan pengembalian dijurnal pembayaran gaji & komisi SPG (DR hutang komisi / CR
 * pemulihan kerugian, dan cerminnya) — milik modul pembayaran.
 */

type Tx = Prisma.TransactionClient;

const angka = (v: unknown) => Number(v ?? 0);
const keSen = (rupiah: number) => Math.round(rupiah * 100);
const desimal = (sen: number) => (sen / 100).toFixed(2);

/** Penjaga meleset: ulangi seluruh transaksi dengan bacaan baru. */
function ulangi(pesan: string): never {
  throw new Prisma.PrismaClientKnownRequestError(pesan, { code: "P2034", clientVersion: "beban-spg" });
}

/* ------------------------------------------------------------------ dibuat */

/**
 * Satu beban untuk laporan retur pembeli yang ditolak padahal uangnya sudah
 * dikembalikan (P13, P13a), ditulis di transaksi penolakan tepat sesudah
 * compare-and-swap statusnya. `besar` = angka sistem (`dihitung`) atau angka
 * struk yang ditetapkan kantor dengan `alasanBesar` (P81). Beban Rp 0 lahir
 * LUNAS (tidak ada yang dipotong), langsung menunggu keputusan barangnya.
 */
export async function buatBebanReturPembeliTx(
  tx: Tx,
  i: {
    returnId: string;
    spgUserId: string;
    storeId: string;
    jenisToko: JenisTokoBeban;
    docNo: string;
    spgSaleId: string;
    dilaporkanPada: Date;
    dihitung: number;
    besar: number;
    alasanBesar: string | null;
    olehUserId: string;
    waktu: Date;
  },
): Promise<{ chargeId: string; lunas: boolean }> {
  const besarSen = Math.max(0, keSen(i.besar));
  const lunas = besarSen === 0;
  const c = await tx.spgCharge.create({
    data: {
      spgUserId: i.spgUserId,
      storeId: i.storeId,
      sourceKind: i.jenisToko,
      source: "RETUR_PEMBELI",
      sourceId: i.returnId,
      sourceDocNo: i.docNo,
      spgSaleId: i.spgSaleId,
      reportedAt: i.dilaporkanPada,
      computedAmount: desimal(keSen(i.dihitung)),
      amount: desimal(besarSen),
      amountReason: i.alasanBesar,
      status: lunas ? "LUNAS" : "TERBUKA",
      settledAt: lunas ? i.waktu : null,
      note: teksBebanReturPembeli(i.docNo),
      createdById: i.olehUserId,
      createdAt: i.waktu,
    },
    select: { id: true },
  });
  await catatJejak(tx, {
    userId: i.olehUserId,
    action: JEJAK.BEBAN_SPG_DIBUAT,
    entityType: ENTITAS_BEBAN_SPG,
    entityId: c.id,
    changes: {
      after: { amount: besarSen / 100, computedAmount: keSen(i.dihitung) / 100, status: lunas ? "LUNAS" : "TERBUKA", spgUserId: i.spgUserId },
    },
    metadata: { source: "RETUR_PEMBELI", returnId: i.returnId, spgSaleId: i.spgSaleId, storeId: i.storeId, docNo: i.docNo },
    reason: i.alasanBesar,
  });
  return { chargeId: c.id, lunas };
}

/* ---------------------------------------------------------------- dipotong */

function loncengLunas(c: { id: string; sourceId: string; sourceDocNo: string; spgSaleId: string; storeId: string }) {
  return {
    category: KATEGORI_NOTIF_RETUR_PEMBELI,
    severity: "INFO" as const,
    title: capNotificationText("Beban SPG lunas — putuskan barangnya"),
    message: capNotificationText(
      `Beban retur pembeli nota ${c.sourceDocNo} sudah diganti SPG. Pilih: kembalikan uang SPG (barang masuk stok) atau barang dibeli SPG.`,
    ),
    metadata: { returnId: c.sourceId, spgSaleId: c.spgSaleId, storeId: c.storeId, chargeId: c.id },
  };
}

/**
 * Potongan beban di SATU pembayaran (`paidRefType`/`paidRefId` = baris yang
 * dibayar: `ConsignmentCommission`, `SpgCommission`) — atau pemindahan sisanya
 * ke utang SPG di pembayaran terakhir (`paidRefType` `SpgDebt`, `dariKomisi`
 * dan `dariGaji` 0). Satu `SpgChargeDeduction` per beban, `settledAmount` naik
 * dengan compare-and-swap. Habis dari bayaran → LUNAS + lonceng "putuskan
 * barangnya" (ditulis di transaksi ini, dikembalikan untuk disebar pemanggil
 * SESUDAH komit). Habis lewat utang → DIUTANGKAN, tanpa lonceng: baru diganti
 * sesudah utangnya lunas (`loncengBebanLunasLewatUtangTx`).
 */
export async function catatBebanDipotong(
  tx: Tx,
  i: {
    olehUserId: string;
    waktu: Date;
    bulanBayar: string;
    potong: ReadonlyArray<{ chargeId: string; jumlah: number; dariKomisi: number; dariGaji: number; paidRefType: string; paidRefId: string }>;
  },
): Promise<{ lunas: AdminNotification[] }> {
  const lunas: AdminNotification[] = [];
  for (const p of i.potong) {
    const jumlahSen = keSen(p.jumlah);
    if (jumlahSen <= 0) continue;
    const keUtang = p.paidRefType === REF_BEBAN_KE_UTANG;
    const komisiSen = keUtang ? 0 : Math.max(0, keSen(p.dariKomisi));
    const gajiSen = keUtang ? 0 : Math.max(0, keSen(p.dariGaji));
    if (!keUtang && komisiSen + gajiSen !== jumlahSen) ulangi("potongan beban tidak seimbang");

    const c = await tx.spgCharge.findUnique({
      where: { id: p.chargeId },
      select: { id: true, status: true, amount: true, settledAmount: true, sourceId: true, sourceDocNo: true, spgSaleId: true, storeId: true },
    });
    if (!c || c.status !== "TERBUKA") ulangi("beban tidak lagi terbuka");
    const dibayarSen = keSen(angka(c.settledAmount));
    const jumlahBebanSen = keSen(angka(c.amount));
    if (dibayarSen + jumlahSen > jumlahBebanSen) ulangi("potongan melebihi sisa beban");

    await tx.spgChargeDeduction.create({
      data: {
        chargeId: c.id,
        amount: desimal(jumlahSen),
        fromCommission: desimal(komisiSen),
        fromSalary: desimal(gajiSen),
        paidRefType: p.paidRefType,
        paidRefId: p.paidRefId,
        payoutMonth: i.bulanBayar,
        createdById: i.olehUserId,
        createdAt: i.waktu,
      },
    });
    const baruSen = dibayarSen + jumlahSen;
    let statusBaru: "TERBUKA" | "LUNAS" | "DIUTANGKAN" = "TERBUKA";
    if (baruSen >= jumlahBebanSen) {
      const lewatUtang = keUtang || (await tx.spgChargeDeduction.count({ where: { chargeId: c.id, paidRefType: REF_BEBAN_KE_UTANG } })) > 0;
      statusBaru = lewatUtang ? "DIUTANGKAN" : "LUNAS";
    }
    const ubah = await tx.spgCharge.updateMany({
      where: { id: c.id, status: "TERBUKA", settledAmount: c.settledAmount },
      data: { settledAmount: desimal(baruSen), status: statusBaru, ...(statusBaru === "LUNAS" ? { settledAt: i.waktu } : {}) },
    });
    if (ubah.count !== 1) ulangi("beban berubah");
    await catatJejak(tx, {
      userId: i.olehUserId,
      action: JEJAK.BEBAN_SPG_DIPOTONG,
      entityType: ENTITAS_BEBAN_SPG,
      entityId: c.id,
      changes: {
        before: { settledAmount: dibayarSen / 100, status: c.status },
        after: { settledAmount: baruSen / 100, status: statusBaru },
      },
      metadata: {
        returnId: c.sourceId,
        docNo: c.sourceDocNo,
        paidRefType: p.paidRefType,
        paidRefId: p.paidRefId,
        payoutMonth: i.bulanBayar,
        jumlah: jumlahSen / 100,
        dariKomisi: komisiSen / 100,
        dariGaji: gajiSen / 100,
      },
    });
    if (statusBaru === "LUNAS") lunas.push(await tx.adminNotification.create({ data: loncengLunas(c) }));
  }
  return { lunas };
}

/**
 * Utang SPG yang baru LUNAS (pembayaran utang diperiksa terhadap mutasi bank):
 * beban yang sisanya dipindah ke utang-utang itu dan kini SEMUA utangnya lunas
 * sudah diganti — tulis lonceng "putuskan barangnya" untuk masing-masing, di
 * transaksi pemanggil, dan kembalikan untuk disebar SESUDAH komit. Beban yang
 * barangnya sudah diputuskan dilewati.
 */
export async function loncengBebanLunasLewatUtangTx(tx: Tx, debtIds: readonly string[]): Promise<AdminNotification[]> {
  const ids = [...new Set(debtIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const potong = await tx.spgChargeDeduction.findMany({
    where: { paidRefType: REF_BEBAN_KE_UTANG, paidRefId: { in: ids } },
    select: { chargeId: true },
  });
  const chargeIds = [...new Set(potong.map((p) => p.chargeId))];
  if (chargeIds.length === 0) return [];
  const beban = await tx.spgCharge.findMany({
    where: { id: { in: chargeIds }, status: "DIUTANGKAN", goodsDecision: null },
    select: { id: true, sourceId: true, sourceDocNo: true, spgSaleId: true, storeId: true, deductions: { where: { paidRefType: REF_BEBAN_KE_UTANG }, select: { paidRefId: true } } },
  });
  const semuaUtang = [...new Set(beban.flatMap((b) => b.deductions.map((d) => d.paidRefId)))];
  const utang = semuaUtang.length ? await tx.spgDebt.findMany({ where: { id: { in: semuaUtang } }, select: { id: true, status: true } }) : [];
  const lunasUtang = new Set(utang.filter((u) => u.status === "LUNAS").map((u) => u.id));
  const hasil: AdminNotification[] = [];
  for (const b of beban) {
    if (b.deductions.length === 0 || !b.deductions.every((d) => lunasUtang.has(d.paidRefId))) continue;
    hasil.push(await tx.adminNotification.create({ data: loncengLunas(b) }));
  }
  return hasil;
}

/**
 * Penjaga pembatalan pembayaran utang SPG: `true` bila salah satu utang ini
 * menanggung beban yang barangnya SUDAH diputuskan. Membatalkan pelunasannya
 * akan meninggalkan uang dikembalikan untuk uang yang tidak pernah diterima
 * (KEMBALI_STOK) atau barang yang dibawa SPG tanpa dibayar (DIBELI_SPG).
 */
export async function utangBebanSudahDiputuskan(tx: Tx, debtIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(debtIds.filter(Boolean))];
  if (ids.length === 0) return false;
  const n = await tx.spgChargeDeduction.count({
    where: { paidRefType: REF_BEBAN_KE_UTANG, paidRefId: { in: ids }, charge: { goodsDecision: { not: null } } },
  });
  return n > 0;
}

/* ---------------------------------------------------------- dikembalikan */

/**
 * Uang beban yang dikembalikan ke SPG (KEMBALI_STOK) dibayarkan PENUH di
 * pembayarannya (`paidRefType`/`paidRefId`), sebagai baris plus. Compare-and-
 * swap pada `paybackPaidAt` kosong dan jumlah yang direncanakan.
 */
export async function catatPengembalianBebanDibayar(
  tx: Tx,
  i: { olehUserId: string; waktu: Date; bulanBayar: string; paidRefType: string; paidRefId: string; kembali: ReadonlyArray<{ chargeId: string; jumlah: number }> },
): Promise<void> {
  for (const k of i.kembali) {
    const sen = keSen(k.jumlah);
    const ubah = await tx.spgCharge.updateMany({
      where: { id: k.chargeId, goodsDecision: "KEMBALI_STOK", paybackPaidAt: null, paybackAmount: desimal(sen) },
      data: { paybackPaidAt: i.waktu, paybackPaidRefType: i.paidRefType, paybackPaidRefId: i.paidRefId, paybackPayoutMonth: i.bulanBayar },
    });
    if (ubah.count !== 1) ulangi("pengembalian beban berubah");
    await catatJejak(tx, {
      userId: i.olehUserId,
      action: JEJAK.BEBAN_SPG_DIKEMBALIKAN,
      entityType: ENTITAS_BEBAN_SPG,
      entityId: k.chargeId,
      changes: { before: { paybackPaidAt: null }, after: { paybackPaidAt: i.waktu.toISOString(), jumlah: sen / 100 } },
      metadata: { paidRefType: i.paidRefType, paidRefId: i.paidRefId, payoutMonth: i.bulanBayar },
    });
  }
}

/* --------------------------------------------------------------- dibatalkan */

export type AlasanTidakBisaBatal = "TANPA_BEBAN" | "SUDAH_DIPOTONG" | "SUDAH_DIUTANGKAN" | "BARANG_SUDAH_DIPUTUSKAN";

/**
 * Bolehkah beban laporan ini dibatalkan (P82: penolakan keliru dibetulkan
 * selama beban SPG belum dipotong)? Hanya selama belum ada SATU pun potongan
 * atas beban itu: tidak dari bayaran (`SUDAH_DIPOTONG`) dan tidak dipindah ke
 * utang SPG di pembayaran terakhirnya (`SUDAH_DIUTANGKAN` — utang SPG belum
 * punya jalan pembatalan, jadi beban yang sudah menjadi utang tidak dibatalkan
 * dari sini). Beban Rp 0 (lahir LUNAS tanpa potongan) juga boleh.
 */
export async function bisaBatalkanBebanTx(
  tx: Tx,
  returnId: string,
): Promise<
  | { boleh: true; chargeId: string; status: string; settledAmount: Prisma.Decimal; amount: number }
  | { boleh: false; alasan: AlasanTidakBisaBatal }
> {
  const c = await tx.spgCharge.findUnique({
    where: { source_sourceId: { source: "RETUR_PEMBELI", sourceId: returnId } },
    select: { id: true, status: true, amount: true, settledAmount: true, goodsDecision: true, deductions: { select: { paidRefType: true } } },
  });
  if (!c || c.status === "BATAL") return { boleh: false, alasan: "TANPA_BEBAN" };
  if (c.goodsDecision !== null) return { boleh: false, alasan: "BARANG_SUDAH_DIPUTUSKAN" };
  if (c.deductions.some((d) => d.paidRefType !== REF_BEBAN_KE_UTANG)) return { boleh: false, alasan: "SUDAH_DIPOTONG" };
  if (c.deductions.length > 0 || c.status === "DIUTANGKAN") return { boleh: false, alasan: "SUDAH_DIUTANGKAN" };
  if (keSen(angka(c.settledAmount)) !== 0) return { boleh: false, alasan: "SUDAH_DIPOTONG" };
  return { boleh: true, chargeId: c.id, status: c.status, settledAmount: c.settledAmount, amount: angka(c.amount) };
}

/**
 * Batalkan beban (P82). Pemanggil sudah memeriksa `bisaBatalkanBebanTx` di
 * transaksi yang sama; di sini compare-and-swap beban → BATAL (status,
 * `settledAmount` yang dibaca, barang belum diputuskan), dengan jejaknya di
 * transaksi yang sama.
 */
export async function batalkanBebanTx(
  tx: Tx,
  i: { cek: Extract<Awaited<ReturnType<typeof bisaBatalkanBebanTx>>, { boleh: true }>; olehUserId: string; alasan: string; waktu: Date },
): Promise<void> {
  const ubah = await tx.spgCharge.updateMany({
    where: { id: i.cek.chargeId, status: i.cek.status, settledAmount: i.cek.settledAmount, goodsDecision: null },
    data: { status: "BATAL", cancelledAt: i.waktu, cancelledById: i.olehUserId, cancelReason: i.alasan },
  });
  // Potongan yang menyelip (pembayaran serentak) menaikkan `settledAmount` atau mengubah status → percobaan diulang.
  if (ubah.count !== 1) ulangi("beban berubah");
  await catatJejak(tx, {
    userId: i.olehUserId,
    action: JEJAK.BEBAN_SPG_DIBATALKAN,
    entityType: ENTITAS_BEBAN_SPG,
    entityId: i.cek.chargeId,
    changes: { before: { status: i.cek.status }, after: { status: "BATAL" } },
    metadata: { amount: i.cek.amount },
    reason: i.alasan,
  });
}

/* ---------------------------------------------------------- barangnya (P79) */

/**
 * Keputusan barang SEKALI (P79), compare-and-swap pada `goodsDecision` kosong.
 * KEMBALI_STOK: uang SPG dikembalikan sebesar yang sudah ia ganti
 * (`settledAmount`). Kalau pembayaran terakhirnya SUDAH terjadi (ia berhenti),
 * uang itu mengurangi utang SPG-nya yang masih terbuka dulu, terlama dulu (P67),
 * dan hanya sisanya yang menunggu dibayarkan; tanpa pembayaran berikutnya
 * sisanya tidak dibayar otomatis. DIBELI_SPG: tidak ada yang bergerak.
 */
export async function putuskanBarangBebanTx(
  tx: Tx,
  i: { chargeId: string; keputusan: KeputusanBarangBeban; olehUserId: string; catatan: string | null; waktu: Date; bulanBayar: string },
): Promise<{ ok: true; kembali: number; imbang: number } | { ok: false }> {
  const c = await tx.spgCharge.findUnique({
    where: { id: i.chargeId },
    select: { id: true, spgUserId: true, status: true, settledAmount: true, goodsDecision: true },
  });
  if (!c || c.goodsDecision !== null) return { ok: false };
  const kembaliSen = i.keputusan === "KEMBALI_STOK" ? keSen(angka(c.settledAmount)) : 0;

  // P67: SPG yang pembayaran terakhirnya sudah lewat — uangnya mengurangi utangnya dulu.
  let imbang: { id: string; sen: number }[] = [];
  if (kembaliSen > 0 && (await keadaanSesudahAkhir(tx, c.spgUserId)).akhirDibayar) {
    const utang = await utangTerbukaSpg(tx, c.spgUserId);
    imbang = alokasiUtang(
      utang.map((u) => ({ id: u.debtId, sisaSen: u.sisaSen })),
      kembaliSen,
    );
  }
  const imbangSen = imbang.reduce((n, x) => n + x.sen, 0);
  const sisaSen = kembaliSen - imbangSen;

  const ubah = await tx.spgCharge.updateMany({
    where: { id: c.id, goodsDecision: null, status: c.status, settledAmount: c.settledAmount },
    data: {
      goodsDecision: i.keputusan,
      goodsDecidedAt: i.waktu,
      goodsDecidedById: i.olehUserId,
      goodsDecisionNote: i.catatan,
      paybackAmount: desimal(sisaSen),
    },
  });
  if (ubah.count !== 1) return { ok: false };
  if (imbang.length > 0) {
    await potongUtangSpg(tx, {
      potong: imbang.map((x) => ({ debtId: x.id, sen: x.sen })),
      refType: ENTITAS_BEBAN_SPG,
      refId: c.id,
      olehUserId: i.olehUserId,
      jenis: "IMBANG",
    });
    // Seluruhnya habis untuk utang: pengembalian ini selesai sekarang, tidak menunggu pembayaran.
    if (sisaSen === 0) {
      await catatPengembalianBebanDibayar(tx, {
        olehUserId: i.olehUserId,
        waktu: i.waktu,
        bulanBayar: i.bulanBayar,
        paidRefType: REF_BEBAN_KE_UTANG,
        paidRefId: imbang[0].id,
        kembali: [{ chargeId: c.id, jumlah: 0 }],
      });
    }
  }
  await catatJejak(tx, {
    userId: i.olehUserId,
    action: JEJAK.BEBAN_SPG_BARANG_DIPUTUSKAN,
    entityType: ENTITAS_BEBAN_SPG,
    entityId: c.id,
    changes: {
      before: { goodsDecision: null },
      after: { goodsDecision: i.keputusan, paybackAmount: sisaSen / 100 },
    },
    metadata: {
      dikembalikan: kembaliSen / 100,
      ...(imbang.length ? { imbangUtang: imbang.map((x) => ({ debtId: x.id, jumlah: x.sen / 100 })) } : {}),
    },
    reason: i.catatan,
  });
  return { ok: true, kembali: kembaliSen / 100, imbang: imbangSen / 100 };
}

/* ------------------------------------------------------------ besar (P81) */

export type AlasanTolakUbahBeban =
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIPOTONG"
  | "BESAR_BEBAN_TIDAK_VALID"
  | "ALASAN_WAJIB"
  | "ALASAN_TERLALU_PANJANG"
  | "SAMA"
  | "PELAPOR_SAMA";

/**
 * Kantor mengubah besar beban menjadi angka struk, dengan alasan (P81), selama
 * belum ada yang dipotong (TERBUKA atau Rp 0, tanpa potongan, barang belum
 * diputuskan). Bebannya dicari dari laporannya (`source`+`sourceId` unik). SPG
 * yang dibebani tidak mengubah bebannya sendiri. Jejak di transaksi yang sama;
 * kabar ke SPG sesudah komit.
 */
export async function ubahBesarBebanSpg(i: {
  returnId: string;
  olehUserId: string;
  besar: unknown;
  alasan: unknown;
  sekarang?: Date;
}): Promise<{ ok: true; chargeId: string; returnId: string; spgUserId: string } | { ok: false; alasan: AlasanTolakUbahBeban }> {
  const alasan = typeof i.alasan === "string" ? i.alasan.trim() : "";
  if (!alasan) return { ok: false, alasan: "ALASAN_WAJIB" };
  if (Array.from(alasan).length > 500) return { ok: false, alasan: "ALASAN_TERLALU_PANJANG" };
  const n = typeof i.besar === "number" ? i.besar : typeof i.besar === "string" ? Number(i.besar.trim()) : NaN;
  const besarSen = Math.round(n * 100);
  if (!Number.isFinite(n) || n <= 0 || Math.abs(besarSen - n * 100) > 1e-6 || besarSen > 999_999_999_999_999) {
    return { ok: false, alasan: "BESAR_BEBAN_TIDAK_VALID" };
  }
  const sekarang = i.sekarang ?? new Date();

  type Hasil = { ok: true; chargeId: string; spgUserId: string; docNo: string } | { ok: false; alasan: AlasanTolakUbahBeban };
  const hasil = await runSerializable(async (tx): Promise<Hasil> => {
    const c = await tx.spgCharge.findUnique({
      where: { source_sourceId: { source: "RETUR_PEMBELI", sourceId: i.returnId } },
      select: { id: true, spgUserId: true, status: true, amount: true, settledAmount: true, goodsDecision: true, sourceDocNo: true, _count: { select: { deductions: true } } },
    });
    if (!c || c.status === "BATAL") return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (c.spgUserId === i.olehUserId) return { ok: false, alasan: "PELAPOR_SAMA" };
    const lamaSen = keSen(angka(c.amount));
    const belumDipotong =
      (c.status === "TERBUKA" || (c.status === "LUNAS" && lamaSen === 0)) && keSen(angka(c.settledAmount)) === 0 && c._count.deductions === 0 && c.goodsDecision === null;
    if (!belumDipotong) return { ok: false, alasan: "SUDAH_DIPOTONG" };
    if (lamaSen === besarSen) return { ok: false, alasan: "SAMA" };
    const ubah = await tx.spgCharge.updateMany({
      where: { id: c.id, status: c.status, settledAmount: c.settledAmount, amount: c.amount, goodsDecision: null },
      data: { amount: desimal(besarSen), amountReason: alasan, status: "TERBUKA", settledAt: null },
    });
    if (ubah.count !== 1) ulangi("beban berubah");
    await catatJejak(tx, {
      userId: i.olehUserId,
      action: JEJAK.BEBAN_SPG_DIUBAH,
      entityType: ENTITAS_BEBAN_SPG,
      entityId: c.id,
      changes: { before: { amount: lamaSen / 100, status: c.status }, after: { amount: besarSen / 100, status: "TERBUKA" } },
      metadata: { returnId: i.returnId, docNo: c.sourceDocNo },
      reason: alasan,
    });
    return { ok: true, chargeId: c.id, spgUserId: c.spgUserId, docNo: c.sourceDocNo };
  });
  if (!hasil.ok) return hasil;
  void kabariPengguna(hasil.spgUserId, {
    jenis: JENIS_KABAR.RETUR_PEMBELI_DITOLAK,
    judul: "Beban retur pembeli diubah",
    isi: rangkaiDalamBatas([`Beban nota ${hasil.docNo} diubah kantor menjadi ${formatRupiah(besarSen / 100)}.`, `Alasan: ${alasan}`], NOTIFICATION_TEXT_MAX),
    data: { returnId: i.returnId, chargeId: hasil.chargeId },
  });
  return { ok: true, chargeId: hasil.chargeId, returnId: i.returnId, spgUserId: hasil.spgUserId };
}
