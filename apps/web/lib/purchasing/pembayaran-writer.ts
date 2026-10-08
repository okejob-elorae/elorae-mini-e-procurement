import { JournalError, postJournal, prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { generateDocNumber } from "@/lib/docNumber";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { bacaTarifPajakKreatif } from "@/lib/creative/pajak-pengaturan";
import { bacaJenisPotongPemasok, INFO_POTONG_PEMASOK, type JenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { lepasMutasiDariJurnal } from "@/lib/finance/kas/voucher-writer";
import { catatJejakKas, JEJAK_KAS } from "@/lib/finance/kas/jejak";
import {
  adalahCerminTandaiLunas,
  dasarPotongBawaanSen,
  hitungPembayaran,
  ID_SALDO_AWAL,
  memoAlokasi,
  periksaAlokasiTerhadapSisa,
  periksaPembayaran,
  STATUS_PEMBAYARAN,
  SUMBER_PEMBAYARAN_PEMASOK,
  SUMBER_PEMBAYARAN_PEMASOK_BALIK,
  uraianJurnalPembayaran,
  kunciDokumenHutang,
  type AlokasiSah,
  type IsianAlokasi,
  type IsianPembayaran,
  type KodeGalatPembayaran,
} from "./pembayaran-aturan";
import { bacaHutangPemasok, keadaanBayarPo, petaSisaDokumen } from "./pembayaran-hutang-queries";
import { adaJurnalTandaiLunasBerdiri } from "./supplier-payment-journal";

/**
 * Penulis pembayaran pemasok (dokumen) — KHUSUS SERVER. Pembayaran adalah
 * dokumen KEUANGAN: jurnalnya ditulis di transaksi yang sama.
 *
 *   DR Hutang usaha (bruto, satu baris per dokumen + uang muka)
 *   CR Kas/bank (neto)
 *   CR Hutang PPh 23/21/4(2) (potongan)
 *
 * Penjaga: alokasi tidak melebihi sisa dokumen (dibaca ulang DI DALAM
 * transaksi serializable), dokumen milik pemasok itu, PO yang ditandai lunas
 * dengan tombol lama tidak dibayar lagi lewat dokumen. Sesudah menulis, PO yang
 * hutangnya habis dan tidak menunggu barang lagi (CLOSED/OVER) ditandai lunas
 * otomatis (`paidAt` = tanggal bayar, riwayat PO "Lunas lewat pembayaran …");
 * pembatalan membukanya lagi — kecuali tanda lunasnya milik tombol lama.
 */

export type HasilPembayaranPemasok =
  | { ok: true; id: string; nomor: string; journalId: string | null; ulang: boolean }
  | { ok: false; kode: KodeGalatPembayaran; baris?: number; peran?: string };

class Tolak extends Error {
  constructor(
    public kode: KodeGalatPembayaran,
    public baris?: number,
    public peran?: string,
  ) {
    super(kode);
  }
}

const POLA_FOTO = /^\/api\/foto\/[A-Za-z0-9_-]{1,64}$/;
const sen = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);

async function denganKunci(client: Pick<Prisma.TransactionClient, "supplierPayment" | "journal">, kunci: string) {
  const ada = await client.supplierPayment.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, docNumber: true } });
  if (!ada) return null;
  const j = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: SUMBER_PEMBAYARAN_PEMASOK, sourceId: ada.id } },
    select: { id: true },
  });
  return { ok: true as const, id: ada.id, nomor: ada.docNumber, journalId: j?.id ?? null, ulang: true };
}

async function peranAkun(peran: Parameters<typeof resolveAccount>[0], tx: Prisma.TransactionClient): Promise<string> {
  try {
    return await resolveAccount(peran, tx);
  } catch (e) {
    if (e instanceof UnmappedRoleError) throw new Tolak("UNMAPPED_ROLE", undefined, e.role);
    throw e;
  }
}

type DataJurnalPembayaran = {
  id: string;
  nomor: string;
  namaPemasok: string;
  referensi: string | null;
  tanggal: Date;
  rekeningId: string;
  brutoSen: number;
  potongSen: number;
  jenisPotong: JenisPotongPemasok | null;
  alokasi: { sen: number; memo: string }[];
};

/** Baris jurnal dari data pembayaran TERSIMPAN (dipakai penulis dan sapuan — satu bentuk). */
async function barisJurnalPembayaran(p: DataJurnalPembayaran, tx: Prisma.TransactionClient | typeof prisma) {
  const apId = await resolveAccount("AP", tx);
  const dialokasikan = p.alokasi.reduce((s, a) => s + a.sen, 0);
  const uangMuka = p.brutoSen - dialokasikan;
  const baris: { chartAccountId: string; debit: number; credit: number; memo?: string }[] = p.alokasi.map((a) => ({
    chartAccountId: apId,
    debit: a.sen / 100,
    credit: 0,
    memo: a.memo,
  }));
  if (uangMuka > 0) baris.push({ chartAccountId: apId, debit: uangMuka / 100, credit: 0, memo: "Uang muka pemasok" });
  const netoSen = p.brutoSen - p.potongSen;
  if (netoSen > 0) baris.push({ chartAccountId: p.rekeningId, debit: 0, credit: netoSen / 100 });
  if (p.potongSen > 0 && p.jenisPotong) {
    const peran = INFO_POTONG_PEMASOK[p.jenisPotong].peranHutang;
    baris.push({ chartAccountId: await resolveAccount(peran, tx), debit: 0, credit: p.potongSen / 100, memo: peran });
  }
  return baris;
}

/** Label dokumen untuk memo jurnal dan catatan alokasi. */
function labelDokumen(jenis: string, id: string, nomor: Map<string, string>): string {
  if (jenis === "OTHER" && id === ID_SALDO_AWAL) return "saldo awal";
  return nomor.get(kunciDokumenHutang(jenis, id)) ?? id;
}

/**
 * Tandai/buka lunas PO otomatis sesudah pembayaran dokumen berubah. Hanya PO
 * yang tidak menunggu barang lagi (CLOSED/OVER) yang ditandai lunas; tanda
 * lunas milik tombol lama tidak pernah dibuka di sini.
 */
async function selaraskanLunasPo(tx: Prisma.TransactionClient, poIds: string[], olehUserId: string, nomor: string, tanggalBayar: Date | null) {
  if (poIds.length === 0) return;
  const keadaan = await keadaanBayarPo(poIds, tx);
  const pos = await tx.purchaseOrder.findMany({ where: { id: { in: poIds } }, select: { id: true, status: true, paidAt: true, docNumber: true } });
  for (const po of pos) {
    const k = keadaan.get(po.id);
    if (!k || !k.adaGrnBerjurnal) continue;
    if (po.paidAt == null && k.sisaSen <= 0 && (po.status === "CLOSED" || po.status === "OVER") && tanggalBayar) {
      const r = await tx.purchaseOrder.updateMany({ where: { id: po.id, paidAt: null }, data: { paidAt: tanggalBayar } });
      if (r.count === 1) {
        await tx.pOStatusHistory.create({
          data: { poId: po.id, status: po.status, changedById: olehUserId, paymentEvent: "MARKED", notes: `Lunas lewat pembayaran ${nomor}` },
        });
        await catatJejakKas(tx, { userId: olehUserId, action: JEJAK_KAS.PO_LUNAS_DARI_PEMBAYARAN, entityType: "PurchaseOrder", entityId: po.id, metadata: { pembayaran: nomor } });
      }
    } else if (po.paidAt != null && k.sisaSen > 0 && !(await adaJurnalTandaiLunasBerdiri(po.id, tx))) {
      const r = await tx.purchaseOrder.updateMany({ where: { id: po.id, paidAt: { not: null } }, data: { paidAt: null } });
      if (r.count === 1) {
        await tx.pOStatusHistory.create({
          data: { poId: po.id, status: po.status, changedById: olehUserId, paymentEvent: "UNMARKED", notes: `Tanda lunas dibuka: pembayaran ${nomor} dibatalkan` },
        });
        await catatJejakKas(tx, { userId: olehUserId, action: JEJAK_KAS.PO_LUNAS_DIBUKA_PEMBATALAN, entityType: "PurchaseOrder", entityId: po.id, metadata: { pembayaran: nomor } });
      }
    }
  }
}

function petaGalat(e: unknown): HasilPembayaranPemasok | null {
  if (e instanceof Tolak) return { ok: false, kode: e.kode, ...(e.baris ? { baris: e.baris } : {}), ...(e.peran ? { peran: e.peran } : {}) };
  if (e instanceof UnmappedRoleError) return { ok: false, kode: "UNMAPPED_ROLE", peran: e.role };
  if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
  return null;
}

/** PO dari alokasi GRN (untuk menolak PO bertanda lunas tombol lama dan menyelaraskan tanda lunas). */
async function poDariAlokasi(tx: Prisma.TransactionClient, alokasi: readonly Pick<AlokasiSah, "jenis" | "id">[]): Promise<Map<string, string>> {
  const grnIds = alokasi.filter((a) => a.jenis === "GRN").map((a) => a.id);
  if (grnIds.length === 0) return new Map();
  const g = await tx.gRN.findMany({ where: { id: { in: grnIds } }, select: { id: true, poId: true } });
  return new Map(g.filter((x) => x.poId).map((x) => [x.id, x.poId as string]));
}

/** PO bertanda lunas tombol lama (paidAt terisi tanpa alokasi dokumen) — jangan dibayar dua kali. */
async function tolakPoDitandaiLunas(tx: Prisma.TransactionClient, alokasi: readonly AlokasiSah[], poPerGrn: Map<string, string>) {
  const poIds = [...new Set(poPerGrn.values())];
  if (poIds.length === 0) return;
  const lunas = await tx.purchaseOrder.findMany({ where: { id: { in: poIds }, paidAt: { not: null } }, select: { id: true } });
  if (lunas.length === 0) return;
  const keadaan = await keadaanBayarPo(lunas.map((p) => p.id), tx);
  const terlarang = new Set(lunas.filter((p) => !keadaan.get(p.id)?.adaAlokasiDokumen).map((p) => p.id));
  alokasi.forEach((a, i) => {
    if (a.jenis === "GRN" && terlarang.has(poPerGrn.get(a.id) ?? "")) throw new Tolak("PO_DITANDAI_LUNAS", i + 1);
  });
}

export type IsianCatatPembayaran = IsianPembayaran & { idempotencyKey?: string | null; olehUserId: string; hariIni?: string };

export async function catatPembayaranPemasok(input: IsianCatatPembayaran): Promise<HasilPembayaranPemasok> {
  const periksa = periksaPembayaran(input, input.hariIni ?? hariIniWib());
  if (!periksa.ok) return { ok: false, kode: periksa.kode, ...(periksa.baris ? { baris: periksa.baris } : {}) };
  const p = periksa.pembayaran;
  if (p.fotoUrl && !POLA_FOTO.test(p.fotoUrl)) return { ok: false, kode: "FOTO_TIDAK_SAH" };
  const kunci = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim().slice(0, 100) : null;
  if (kunci) {
    const lama = await denganKunci(prisma, kunci);
    if (lama) return lama;
  }
  try {
    return await runSerializable(async (tx): Promise<HasilPembayaranPemasok> => {
      if (kunci) {
        const lama = await denganKunci(tx, kunci);
        if (lama) return lama;
      }
      const pemasok = await tx.supplier.findUnique({ where: { id: p.pemasokId }, select: { id: true, name: true, taxWithholding: true, hasNpwp: true } });
      if (!pemasok) throw new Tolak("PEMASOK_TIDAK_DITEMUKAN");
      const rekening = await rekeningKasBank(tx);
      if (!rekening.some((r) => r.id === p.rekeningId)) throw new Tolak("REKENING_TIDAK_SAH");

      const hutang = await bacaHutangPemasok({ supplierIds: [p.pemasokId] }, tx);
      if (hutang.apBelumDipetakan) throw new Tolak("UNMAPPED_ROLE", undefined, "AP");
      const milik = hutang.pemasok[0];
      const sisa = petaSisaDokumen(milik);
      const cek = periksaAlokasiTerhadapSisa(p.alokasi, sisa);
      if (!cek.ok) throw new Tolak(cek.kode, cek.baris);
      const poPerGrn = await poDariAlokasi(tx, p.alokasi);
      await tolakPoDitandaiLunas(tx, p.alokasi, poPerGrn);

      const jenisPotong = p.jenisPotong === undefined ? bacaJenisPotongPemasok(pemasok.taxWithholding) : p.jenisPotong;
      const dasar = p.dasarPotongSen ?? dasarPotongBawaanSen(jenisPotong, p.alokasi, sisa, p.brutoSen);
      const tarif = jenisPotong === "PPH21" || jenisPotong === "PPH23" ? await bacaTarifPajakKreatif(tx) : undefined;
      const hitung = hitungPembayaran(p.brutoSen, jenisPotong, dasar, pemasok.hasNpwp, tarif);
      // Peran wajib dipetakan SEBELUM menulis apa pun.
      await peranAkun("AP", tx);
      if (hitung.potongSen > 0 && jenisPotong) await peranAkun(INFO_POTONG_PEMASOK[jenisPotong].peranHutang, tx);

      const nomorDok = new Map((milik?.dokumen ?? []).map((d) => [kunciDokumenHutang(d.jenis, d.id), d.nomor]));
      const nomor = await generateDocNumber("SUPPAY", tx);
      const tanggal = parseDateOnly(p.tanggal) as Date;
      const bayar = await tx.supplierPayment.create({
        data: {
          docNumber: nomor,
          supplierId: p.pemasokId,
          date: tanggal,
          method: p.cara,
          cashAccountId: p.rekeningId,
          reference: p.referensi,
          giroDueDate: p.jatuhTempoGiro ? parseDateOnly(p.jatuhTempoGiro) : null,
          grossAmount: hitung.brutoSen / 100,
          withholdingType: hitung.potongSen > 0 ? jenisPotong : null,
          withholdingAmount: hitung.potongSen / 100,
          netAmount: hitung.netoSen / 100,
          isAdvance: p.uangMukaSen > 0,
          status: STATUS_PEMBAYARAN.BERLAKU,
          note: p.catatan,
          proofPhotoUrl: p.fotoUrl,
          idempotencyKey: kunci,
          createdById: input.olehUserId,
          allocations: {
            create: p.alokasi.map((a) => ({ targetType: a.jenis, targetId: a.id, amount: a.sen / 100, note: labelDokumen(a.jenis, a.id, nomorDok) })),
          },
        },
        select: { id: true },
      });
      const baris = await barisJurnalPembayaran(
        {
          id: bayar.id,
          nomor,
          namaPemasok: pemasok.name,
          referensi: p.referensi,
          tanggal,
          rekeningId: p.rekeningId,
          brutoSen: hitung.brutoSen,
          potongSen: hitung.potongSen,
          jenisPotong: hitung.potongSen > 0 ? jenisPotong : null,
          alokasi: p.alokasi.map((a) => ({ sen: a.sen, memo: memoAlokasi(a.jenis, labelDokumen(a.jenis, a.id, nomorDok)) })),
        },
        tx,
      );
      const j = await postJournal(tx, {
        source: { type: SUMBER_PEMBAYARAN_PEMASOK, id: bayar.id },
        date: tanggal,
        description: uraianJurnalPembayaran(nomor, pemasok.name, p.referensi),
        postedById: input.olehUserId,
        lines: baris,
      });
      await catatJejakKas(tx, {
        userId: input.olehUserId,
        action: JEJAK_KAS.PEMBAYARAN_DICATAT,
        entityType: "SupplierPayment",
        entityId: bayar.id,
        changes: {
          after: {
            nomor,
            pemasokId: p.pemasokId,
            tanggal: p.tanggal,
            cara: p.cara,
            bruto: hitung.brutoSen / 100,
            potong: hitung.potongSen / 100,
            neto: hitung.netoSen / 100,
            uangMuka: p.uangMukaSen / 100,
            alokasi: p.alokasi.map((a) => ({ jenis: a.jenis, id: a.id, jumlah: a.sen / 100 })),
          },
        },
        metadata: { journalId: j.journalId, dasarPotong: hitung.dasarPotongSen / 100, jenisPotong },
      });
      await selaraskanLunasPo(tx, [...new Set(poPerGrn.values())], input.olehUserId, nomor, tanggal);
      return { ok: true, id: bayar.id, nomor, journalId: j.journalId, ulang: false };
    });
  } catch (e) {
    const g = petaGalat(e);
    if (g) return g;
    if (kunci && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const lama = await denganKunci(prisma, kunci);
      if (lama) return lama;
    }
    throw e;
  }
}

export async function batalkanPembayaranPemasok(input: { id: string; olehUserId: string; alasan: string }): Promise<HasilPembayaranPemasok> {
  const alasan = input.alasan?.trim() ?? "";
  if (alasan.length < 5) return { ok: false, kode: "ALASAN_WAJIB" };
  try {
    return await runSerializable(async (tx): Promise<HasilPembayaranPemasok> => {
      const b = await tx.supplierPayment.findUnique({
        where: { id: input.id },
        select: { id: true, docNumber: true, status: true, idempotencyKey: true, grossAmount: true, supplierId: true, allocations: { select: { targetType: true, targetId: true } } },
      });
      if (!b) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      if (b.status === STATUS_PEMBAYARAN.BATAL) return { ok: false, kode: "SUDAH_DIBATALKAN" };
      if (adalahCerminTandaiLunas(b.idempotencyKey)) return { ok: false, kode: "PAKAI_BATAL_TANDAI_LUNAS" };
      const asli = await tx.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: SUMBER_PEMBAYARAN_PEMASOK, sourceId: b.id } },
        select: { id: true, date: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
      });
      let balikId: string | null = null;
      let dilepas = 0;
      if (asli) {
        const r = await postJournal(tx, {
          source: { type: SUMBER_PEMBAYARAN_PEMASOK_BALIK, id: b.id },
          date: asli.date,
          description: `Pembatalan pembayaran pemasok ${b.docNumber}: ${alasan}`.slice(0, 500),
          postedById: input.olehUserId,
          reversalOfId: asli.id,
          lines: asli.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: Number(l.credit), credit: Number(l.debit), ...(l.memo ? { memo: l.memo } : {}) })),
        });
        balikId = r.journalId;
        dilepas = await lepasMutasiDariJurnal(tx, asli.id, `Dilepas: ${b.docNumber} dibatalkan`);
      }
      await tx.supplierPayment.update({
        where: { id: b.id },
        data: { status: STATUS_PEMBAYARAN.BATAL, cancelledAt: new Date(), cancelledById: input.olehUserId, cancelReason: alasan },
      });
      await catatJejakKas(tx, {
        userId: input.olehUserId,
        action: JEJAK_KAS.PEMBAYARAN_DIBATALKAN,
        entityType: "SupplierPayment",
        entityId: b.id,
        changes: { before: { status: STATUS_PEMBAYARAN.BERLAKU }, after: { status: STATUS_PEMBAYARAN.BATAL } },
        metadata: { nomor: b.docNumber, bruto: Number(b.grossAmount), jurnalPembalik: balikId, mutasiDilepas: dilepas },
        reason: alasan,
      });
      const poPerGrn = await poDariAlokasi(
        tx,
        b.allocations.filter((a) => a.targetId).map((a) => ({ jenis: a.targetType as AlokasiSah["jenis"], id: a.targetId as string })),
      );
      await selaraskanLunasPo(tx, [...new Set(poPerGrn.values())], input.olehUserId, b.docNumber, null);
      return { ok: true, id: b.id, nomor: b.docNumber, journalId: balikId, ulang: false };
    });
  } catch (e) {
    const g = petaGalat(e);
    if (g) return g;
    throw e;
  }
}

/**
 * Terapkan uang muka (bagian pembayaran yang belum dialokasikan) ke dokumen
 * hutang pemasok yang sama. Tanpa jurnal: hutang usaha sudah didebit saat uang
 * muka dibayar; yang berubah hanya buku pembantu per dokumen.
 */
export async function terapkanUangMuka(input: { pembayaranId: string; alokasi: unknown; olehUserId: string }): Promise<HasilPembayaranPemasok> {
  try {
    return await runSerializable(async (tx): Promise<HasilPembayaranPemasok> => {
      const b = await tx.supplierPayment.findUnique({
        where: { id: input.pembayaranId },
        select: { id: true, docNumber: true, status: true, idempotencyKey: true, supplierId: true, grossAmount: true, date: true, allocations: { select: { targetType: true, targetId: true, amount: true } } },
      });
      if (!b) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      if (b.status !== STATUS_PEMBAYARAN.BERLAKU) return { ok: false, kode: "SUDAH_DIBATALKAN" };
      if (adalahCerminTandaiLunas(b.idempotencyKey)) return { ok: false, kode: "BUKAN_UANG_MUKA" };
      const sisaUangMuka = sen(b.grossAmount) - b.allocations.reduce((s, a) => s + sen(a.amount), 0);
      if (sisaUangMuka <= 0) return { ok: false, kode: "BUKAN_UANG_MUKA" };
      // Pakai pemeriksa isian pembayaran untuk alokasinya saja.
      const periksa = periksaPembayaran(
        { pemasokId: b.supplierId, tanggal: formatDateOnlyJakarta(b.date), cara: "TRANSFER", rekeningId: "-", alokasi: input.alokasi as IsianAlokasi[] },
        "9999-12-31",
      );
      if (!periksa.ok) return { ok: false, kode: periksa.kode, ...(periksa.baris ? { baris: periksa.baris } : {}) };
      const alokasi = periksa.pembayaran.alokasi;
      const totalBaru = alokasi.reduce((s, a) => s + a.sen, 0);
      if (totalBaru > sisaUangMuka) return { ok: false, kode: "MELEBIHI_UANG_MUKA" };
      const sudah = new Set(b.allocations.map((a) => `${a.targetType}|${a.targetId}`));
      const ganda = alokasi.findIndex((a) => sudah.has(`${a.jenis}|${a.id}`));
      if (ganda >= 0) return { ok: false, kode: "ALOKASI_GANDA", baris: ganda + 1 };
      const hutang = await bacaHutangPemasok({ supplierIds: [b.supplierId] }, tx);
      const milik = hutang.pemasok[0];
      const cek = periksaAlokasiTerhadapSisa(alokasi, petaSisaDokumen(milik));
      if (!cek.ok) return { ok: false, kode: cek.kode, baris: cek.baris };
      const poPerGrn = await poDariAlokasi(tx, alokasi);
      await tolakPoDitandaiLunas(tx, alokasi, poPerGrn);
      const nomorDok = new Map((milik?.dokumen ?? []).map((d) => [kunciDokumenHutang(d.jenis, d.id), d.nomor]));
      await tx.supplierPaymentAllocation.createMany({
        data: alokasi.map((a) => ({ paymentId: b.id, targetType: a.jenis, targetId: a.id, amount: a.sen / 100, note: `${labelDokumen(a.jenis, a.id, nomorDok)} (dari uang muka)` })),
      });
      await tx.supplierPayment.update({ where: { id: b.id }, data: { isAdvance: totalBaru < sisaUangMuka } });
      await catatJejakKas(tx, {
        userId: input.olehUserId,
        action: JEJAK_KAS.UANG_MUKA_DITERAPKAN,
        entityType: "SupplierPayment",
        entityId: b.id,
        changes: { before: { sisaUangMuka: sisaUangMuka / 100 }, after: { sisaUangMuka: (sisaUangMuka - totalBaru) / 100 } },
        metadata: { alokasi: alokasi.map((a) => ({ jenis: a.jenis, id: a.id, jumlah: a.sen / 100 })) },
      });
      await selaraskanLunasPo(tx, [...new Set(poPerGrn.values())], input.olehUserId, b.docNumber, b.date);
      return { ok: true, id: b.id, nomor: b.docNumber, journalId: null, ulang: false };
    });
  } catch (e) {
    const g = petaGalat(e);
    if (g) return g;
    throw e;
  }
}

/**
 * Sapuan: posting ulang jurnal pembayaran BERLAKU (bukan cermin tombol lama)
 * yang tidak punya jurnal. Membangun dari baris tersimpan, idempoten.
 */
export async function postingUlangJurnalPembayaran(
  id: string,
  olehUserId: string,
): Promise<{ ok: true; journalId: string; created: boolean } | { ok: false; code: "UNMAPPED_ROLE" | "UNBALANCED" | "NOTHING_TO_POST"; role?: string }> {
  const b = await prisma.supplierPayment.findUnique({
    where: { id },
    select: {
      id: true,
      docNumber: true,
      status: true,
      idempotencyKey: true,
      date: true,
      cashAccountId: true,
      reference: true,
      grossAmount: true,
      withholdingType: true,
      withholdingAmount: true,
      supplierId: true,
      allocations: { select: { targetType: true, amount: true, note: true } },
    },
  });
  if (!b || b.status !== STATUS_PEMBAYARAN.BERLAKU || adalahCerminTandaiLunas(b.idempotencyKey) || !b.cashAccountId) return { ok: false, code: "NOTHING_TO_POST" };
  const pemasok = await prisma.supplier.findUnique({ where: { id: b.supplierId }, select: { name: true } });
  try {
    const baris = await barisJurnalPembayaran(
      {
        id: b.id,
        nomor: b.docNumber,
        namaPemasok: pemasok?.name ?? "",
        referensi: b.reference,
        tanggal: b.date,
        rekeningId: b.cashAccountId,
        brutoSen: sen(b.grossAmount),
        potongSen: sen(b.withholdingAmount),
        jenisPotong: bacaJenisPotongPemasok(b.withholdingType),
        alokasi: b.allocations.map((a) => ({ sen: sen(a.amount), memo: memoAlokasi(a.targetType, a.note ?? "") })),
      },
      prisma,
    );
    const r = await postJournal(prisma, {
      source: { type: SUMBER_PEMBAYARAN_PEMASOK, id: b.id },
      date: b.date,
      description: uraianJurnalPembayaran(b.docNumber, pemasok?.name ?? "", b.reference),
      postedById: olehUserId,
      lines: baris,
    });
    return { ok: true, journalId: r.journalId, created: r.created };
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}
