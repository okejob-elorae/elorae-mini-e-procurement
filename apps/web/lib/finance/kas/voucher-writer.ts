import { JournalError, postJournal, prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { generateDocNumber } from "@/lib/docNumber";
import { parseDateOnly } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { bacaTarifPajakKreatif } from "@/lib/creative/pajak-pengaturan";
import { INFO_POTONG_PEMASOK, bacaJenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import {
  barisJurnalVoucher,
  DOC_TYPE_VOUCHER,
  hitungVoucher,
  periksaVoucher,
  STATUS_VOUCHER,
  SUMBER_VOUCHER_KAS,
  SUMBER_VOUCHER_KAS_BALIK,
  uraianJurnalVoucher,
  type BarisJurnalAkun,
  type IsianVoucher,
  type JenisVoucher,
  type KodeGalatVoucher,
  type VoucherSah,
} from "./aturan";
import { catatJejakKas, JEJAK_KAS } from "./jejak";

/**
 * Penulis voucher kas & bank — KHUSUS SERVER. Voucher adalah dokumen KEUANGAN:
 * jurnalnya ditulis di transaksi yang sama (voucher tanpa jurnal tidak pernah
 * ada); peran/akun yang tidak sah menolak vouchernya dengan kode.
 *
 * Idempoten: `idempotencyKey` (sekali per isian formulir) diperiksa PALING
 * DULU dan lagi di dalam transaksi; kiriman ulang mengembalikan voucher yang
 * sama (`ulang: true`) — termasuk bila isiannya sudah diubah (keputusan
 * pemilik untuk semua kunci kirim ulang: dokumen PERTAMA yang menang).
 *
 * Batal tidak menghapus: status CANCELLED + jurnal pembalik
 * (`CASH_VOUCHER_REVERSAL`, id sama, `reversalOfId`) bertanggal sama dengan
 * jurnal aslinya, alasan wajib, jejak di transaksi yang sama. Baris mutasi bank
 * yang dicocokkan ke jurnal aslinya dilepas (kembali "belum cocok").
 */

export type KodeTolakVoucher =
  | KodeGalatVoucher
  | "REKENING_TIDAK_SAH"
  | "AKUN_TIDAK_SAH"
  | "AKUN_KAS_DI_BARIS"
  | "AKUN_HUTANG_USAHA"
  | "AKUN_HUTANG_ALUR"
  | "AKUN_HUTANG_PAJAK"
  | "KATEGORI_TIDAK_SAH"
  | "PEMASOK_TIDAK_DITEMUKAN"
  | "FOTO_TIDAK_SAH"
  | "UNMAPPED_ROLE"
  | "NON_POSTABLE_ACCOUNT"
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIBATALKAN"
  | "ALASAN_WAJIB";

export type HasilVoucher =
  | { ok: true; id: string; nomor: string; journalId: string | null; ulang: boolean }
  | { ok: false; kode: KodeTolakVoucher; baris?: number; peran?: string };

class Tolak extends Error {
  constructor(
    public kode: KodeTolakVoucher,
    public baris?: number,
    public peran?: string,
  ) {
    super(kode);
  }
}

const POLA_FOTO = /^\/api\/foto\/[A-Za-z0-9_-]{1,64}$/;

async function denganKunci(client: Pick<Prisma.TransactionClient, "cashVoucher" | "journal">, kunci: string) {
  const ada = await client.cashVoucher.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, docNumber: true } });
  if (!ada) return null;
  const j = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: SUMBER_VOUCHER_KAS, sourceId: ada.id } },
    select: { id: true },
  });
  return { ok: true as const, id: ada.id, nomor: ada.docNumber, journalId: j?.id ?? null, ulang: true };
}

type AkunPostable = { id: string; type: string };

async function akunPostable(tx: Prisma.TransactionClient, ids: string[]): Promise<Map<string, AkunPostable>> {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return new Map();
  const akun = await tx.chartAccount.findMany({
    where: { id: { in: unik }, isActive: true, children: { none: {} } },
    select: { id: true, type: true },
  });
  return new Map(akun.map((a) => [a.id, a]));
}

/** Akun tiap baris (dari kategori atau pilihan langsung), diperiksa. */
async function siapkanBaris(
  tx: Prisma.TransactionClient,
  v: VoucherSah,
  rekeningKas: ReadonlySet<string>,
): Promise<{ akunBaris: string[]; baris: VoucherSah["baris"] }> {
  const kategoriIds = [...new Set(v.baris.map((b) => b.kategoriId).filter((x): x is string => Boolean(x)))];
  const kategori = kategoriIds.length
    ? await tx.cashCategory.findMany({ where: { id: { in: kategoriIds } }, select: { id: true, type: true, chartAccountId: true, withholdingType: true, isActive: true } })
    : [];
  const perKategori = new Map(kategori.map((k) => [k.id, k]));
  const akunBaris: string[] = [];
  const baris = v.baris.map((b, i) => {
    let akun = b.akunId;
    let kena = b.kenaPotong;
    if (b.kategoriId) {
      const k = perKategori.get(b.kategoriId);
      if (!k || !k.isActive || k.type !== v.jenis) throw new Tolak("KATEGORI_TIDAK_SAH", i + 1);
      akun = akun ?? k.chartAccountId;
      if (v.jenisPotong && bacaJenisPotongPemasok(k.withholdingType) === v.jenisPotong) kena = true;
    }
    akunBaris.push(akun as string);
    return { ...b, kenaPotong: kena };
  });
  const postable = await akunPostable(tx, akunBaris);
  const terlarang = await akunBerAlurSendiri(tx);
  akunBaris.forEach((id, i) => {
    if (!postable.has(id)) throw new Tolak("AKUN_TIDAK_SAH", i + 1);
    if (rekeningKas.has(id)) throw new Tolak("AKUN_KAS_DI_BARIS", i + 1);
    const alur = terlarang.get(id);
    if (alur) throw new Tolak(alur, i + 1);
  });
  return { akunBaris, baris };
}

/**
 * Akun hutang yang DILUNASI lewat alurnya sendiri — membayarnya lewat voucher
 * kas membuat buku pembantunya tidak ikut berkurang, dan membayar komisi/klaim
 * dengan kategori BEBAN membuat bebannya terjurnal dua kali (alurnya sendiri
 * sudah mendebit beban saat ditetapkan, lalu mendebit hutangnya saat dibayar):
 * - hutang usaha → Pembayaran pemasok;
 * - hutang komisi SPG/sales, penggantian biaya perjalanan, fee KOL → tombol
 *   "Tandai dibayar" di halaman komisi/klaim/KOL;
 * - hutang pajak → Pajak → Setoran.
 */
const PERAN_BERALUR: ReadonlyArray<readonly [Parameters<typeof resolveAccount>[0], KodeTolakVoucher]> = [
  ["AP", "AKUN_HUTANG_USAHA"],
  ["COMMISSION_PAYABLE", "AKUN_HUTANG_ALUR"],
  ["REIMBURSE_PAYABLE", "AKUN_HUTANG_ALUR"],
  ["KOL_PAYABLE", "AKUN_HUTANG_ALUR"],
  ["PPH21_PAYABLE", "AKUN_HUTANG_PAJAK"],
  ["PPH23_PAYABLE", "AKUN_HUTANG_PAJAK"],
  ["PPH4_2_PAYABLE", "AKUN_HUTANG_PAJAK"],
  ["PPH_FINAL_PAYABLE", "AKUN_HUTANG_PAJAK"],
  ["PPN_PAYABLE", "AKUN_HUTANG_PAJAK"],
  ["TAX", "AKUN_HUTANG_PAJAK"],
];

async function akunBerAlurSendiri(tx: Prisma.TransactionClient): Promise<Map<string, KodeTolakVoucher>> {
  const hasil = new Map<string, KodeTolakVoucher>();
  for (const [peran, kode] of PERAN_BERALUR) {
    try {
      const id = await resolveAccount(peran, tx);
      if (!hasil.has(id)) hasil.set(id, kode);
    } catch (e) {
      if (!(e instanceof UnmappedRoleError)) throw e;
    }
  }
  return hasil;
}

export type IsianCatatVoucher = IsianVoucher & {
  idempotencyKey?: string | null;
  olehUserId: string;
  hariIni?: string;
};

/**
 * Inti penulisan di dalam transaksi pemanggil (dipakai juga oleh "buat voucher
 * dari baris mutasi" dan isi ulang kas kecil). Melempar `Tolak`.
 */
async function tulisVoucher(
  tx: Prisma.TransactionClient,
  v: VoucherSah,
  kunci: string | null,
  olehUserId: string,
): Promise<{ id: string; nomor: string; journalId: string; barisRekeningIds: string[] }> {
  const rekening = await rekeningKasBank(tx);
  const rekeningKas = new Set(rekening.map((r) => r.id));
  if (!rekeningKas.has(v.rekeningId)) throw new Tolak("REKENING_TIDAK_SAH");
  if (v.jenis === "TRANSFER" && (!v.rekeningTujuanId || !rekeningKas.has(v.rekeningTujuanId))) throw new Tolak("REKENING_TIDAK_SAH");
  if (v.fotoUrl && !POLA_FOTO.test(v.fotoUrl)) throw new Tolak("FOTO_TIDAK_SAH");
  if (v.pemasokId) {
    const p = await tx.supplier.findUnique({ where: { id: v.pemasokId }, select: { id: true } });
    if (!p) throw new Tolak("PEMASOK_TIDAK_DITEMUKAN");
  }

  const { akunBaris, baris } = v.jenis === "TRANSFER" ? { akunBaris: [], baris: [] } : await siapkanBaris(tx, v, rekeningKas);
  const siap: VoucherSah = { ...v, baris };
  const tarif = siap.jenisPotong === "PPH21" || siap.jenisPotong === "PPH23" ? await bacaTarifPajakKreatif(tx) : undefined;
  const hitung = hitungVoucher(siap, tarif);
  let akunHutangPph: string | null = null;
  if (hitung.potongSen > 0 && siap.jenisPotong) {
    const peran = INFO_POTONG_PEMASOK[siap.jenisPotong].peranHutang;
    try {
      akunHutangPph = await resolveAccount(peran, tx);
    } catch (e) {
      if (e instanceof UnmappedRoleError) throw new Tolak("UNMAPPED_ROLE", undefined, e.role);
      throw e;
    }
  }

  const nomor = await generateDocNumber(DOC_TYPE_VOUCHER[siap.jenis], tx);
  const voucher = await tx.cashVoucher.create({
    data: {
      docNumber: nomor,
      type: siap.jenis,
      date: parseDateOnly(siap.tanggal) as Date,
      cashAccountId: siap.rekeningId,
      transferAccountId: siap.rekeningTujuanId,
      counterpart: siap.pihak,
      supplierId: siap.pemasokId,
      description: siap.keterangan,
      totalAmount: hitung.totalSen / 100,
      withholdingType: hitung.potongSen > 0 ? siap.jenisPotong : null,
      withholdingAmount: hitung.potongSen / 100,
      netAmount: hitung.netoSen / 100,
      status: STATUS_VOUCHER.BERLAKU,
      photoUrl: siap.fotoUrl,
      idempotencyKey: kunci,
      createdById: olehUserId,
      lines: {
        create: baris.map((b, i) => ({
          categoryId: b.kategoriId,
          chartAccountId: akunBaris[i],
          amount: b.sen / 100,
          memo: b.memo,
          channel: b.kanal,
          storeId: b.tokoId,
          sortOrder: i,
        })),
      },
    },
    select: { id: true },
  });

  const baris_ = barisJurnalVoucher(siap, hitung, akunBaris, akunHutangPph);
  const j = await postJournal(tx, {
    source: { type: SUMBER_VOUCHER_KAS, id: voucher.id },
    date: parseDateOnly(siap.tanggal) as Date,
    description: uraianJurnalVoucher(siap.jenis, nomor, siap.pihak, siap.keterangan),
    postedById: olehUserId,
    lines: baris_,
  });
  const barisRekening = await tx.journalLine.findMany({
    where: { journalId: j.journalId, chartAccountId: siap.jenis === "TRANSFER" ? { in: [siap.rekeningId, siap.rekeningTujuanId as string] } : siap.rekeningId },
    select: { id: true },
  });
  await catatJejakKas(tx, {
    userId: olehUserId,
    action: JEJAK_KAS.VOUCHER_DICATAT,
    entityType: "CashVoucher",
    entityId: voucher.id,
    changes: {
      after: {
        nomor,
        jenis: siap.jenis,
        tanggal: siap.tanggal,
        total: hitung.totalSen / 100,
        potong: hitung.potongSen / 100,
        neto: hitung.netoSen / 100,
        rekeningId: siap.rekeningId,
        rekeningTujuanId: siap.rekeningTujuanId,
      },
    },
    // `dasarPotong` di metadata: tabel voucher tidak punya kolom dasar potongan; PPh dipotong membacanya dari sini.
    metadata: { journalId: j.journalId, ...(hitung.potongSen > 0 ? { dasarPotong: hitung.dasarPotongSen / 100, jenisPotong: siap.jenisPotong } : {}) },
  });
  return { id: voucher.id, nomor, journalId: j.journalId, barisRekeningIds: barisRekening.map((b) => b.id) };
}

function petaGalat(e: unknown): HasilVoucher | null {
  if (e instanceof Tolak) return { ok: false, kode: e.kode, ...(e.baris ? { baris: e.baris } : {}), ...(e.peran ? { peran: e.peran } : {}) };
  if (e instanceof UnmappedRoleError) return { ok: false, kode: "UNMAPPED_ROLE", peran: e.role };
  if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
  return null;
}

export async function catatVoucher(input: IsianCatatVoucher): Promise<HasilVoucher> {
  const periksa = periksaVoucher(input, input.hariIni ?? hariIniWib());
  if (!periksa.ok) return { ok: false, kode: periksa.kode, ...(periksa.baris ? { baris: periksa.baris } : {}) };
  const kunci = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim().slice(0, 100) : null;
  if (kunci) {
    const lama = await denganKunci(prisma, kunci);
    if (lama) return lama;
  }
  try {
    return await runSerializable(async (tx): Promise<HasilVoucher> => {
      if (kunci) {
        const lama = await denganKunci(tx, kunci);
        if (lama) return lama;
      }
      const hasil = await tulisVoucher(tx, periksa.voucher, kunci, input.olehUserId);
      return { ok: true, id: hasil.id, nomor: hasil.nomor, journalId: hasil.journalId, ulang: false };
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

/**
 * Voucher di dalam transaksi pemanggil — untuk "buat voucher dari baris mutasi
 * bank" (rekonsiliasi) yang harus mencocokkan barisnya di transaksi yang sama.
 * Mengembalikan id baris jurnal rekeningnya.
 */
export async function catatVoucherDalamTransaksi(
  tx: Prisma.TransactionClient,
  input: IsianVoucher & { olehUserId: string; hariIni?: string; idempotencyKey?: string | null },
): Promise<{ ok: true; id: string; nomor: string; journalId: string; barisRekeningIds: string[] } | { ok: false; kode: KodeTolakVoucher; baris?: number; peran?: string }> {
  const periksa = periksaVoucher(input, input.hariIni ?? hariIniWib());
  if (!periksa.ok) return { ok: false, kode: periksa.kode, ...(periksa.baris ? { baris: periksa.baris } : {}) };
  const kunci = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim().slice(0, 100) : null;
  try {
    const r = await tulisVoucher(tx, periksa.voucher, kunci, input.olehUserId);
    return { ok: true, ...r };
  } catch (e) {
    const g = petaGalat(e);
    if (g && !g.ok) return g;
    throw e;
  }
}

/** Lepas baris mutasi bank yang dicocokkan ke baris jurnal `journalId` (dokumennya dibatalkan). */
export async function lepasMutasiDariJurnal(tx: Prisma.TransactionClient, journalId: string, alasan: string): Promise<number> {
  const barisJurnal = await tx.journalLine.findMany({ where: { journalId }, select: { id: true } });
  if (barisJurnal.length === 0) return 0;
  const r = await tx.bankStatementLine.updateMany({
    where: { matchedJournalLineId: { in: barisJurnal.map((b) => b.id) } },
    data: { status: "UNMATCHED", matchedJournalLineId: null, matchedAt: null, matchedById: null, createdJournalId: null, note: alasan.slice(0, 1000) },
  });
  return r.count;
}

export async function batalkanVoucher(input: { id: string; olehUserId: string; alasan: string }): Promise<HasilVoucher> {
  const alasan = input.alasan?.trim() ?? "";
  if (alasan.length < 5) return { ok: false, kode: "ALASAN_WAJIB" };
  try {
    return await runSerializable(async (tx): Promise<HasilVoucher> => {
      const v = await tx.cashVoucher.findUnique({
        where: { id: input.id },
        select: { id: true, docNumber: true, status: true, type: true, totalAmount: true },
      });
      if (!v) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      if (v.status === STATUS_VOUCHER.BATAL) return { ok: false, kode: "SUDAH_DIBATALKAN" };
      const asli = await tx.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: SUMBER_VOUCHER_KAS, sourceId: v.id } },
        select: { id: true, date: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true, channel: true, storeId: true } } },
      });
      let balikId: string | null = null;
      let dilepas = 0;
      if (asli) {
        const r = await postJournal(tx, {
          source: { type: SUMBER_VOUCHER_KAS_BALIK, id: v.id },
          date: asli.date,
          description: `Pembatalan ${v.docNumber}: ${alasan}`.slice(0, 500),
          postedById: input.olehUserId,
          reversalOfId: asli.id,
          lines: asli.lines.map(
            (l): BarisJurnalAkun => ({
              chartAccountId: l.chartAccountId,
              debit: Number(l.credit),
              credit: Number(l.debit),
              ...(l.memo ? { memo: l.memo } : {}),
              ...(l.channel ? { channel: l.channel as BarisJurnalAkun["channel"] } : {}),
              ...(l.storeId ? { storeId: l.storeId } : {}),
            }),
          ),
        });
        balikId = r.journalId;
        dilepas = await lepasMutasiDariJurnal(tx, asli.id, `Dilepas: ${v.docNumber} dibatalkan`);
      }
      await tx.cashVoucher.update({
        where: { id: v.id },
        data: { status: STATUS_VOUCHER.BATAL, cancelledAt: new Date(), cancelledById: input.olehUserId, cancelReason: alasan },
      });
      await catatJejakKas(tx, {
        userId: input.olehUserId,
        action: JEJAK_KAS.VOUCHER_DIBATALKAN,
        entityType: "CashVoucher",
        entityId: v.id,
        changes: { before: { status: STATUS_VOUCHER.BERLAKU }, after: { status: STATUS_VOUCHER.BATAL } },
        metadata: { nomor: v.docNumber, jenis: v.type, total: Number(v.totalAmount), jurnalPembalik: balikId, mutasiDilepas: dilepas },
        reason: alasan,
      });
      return { ok: true, id: v.id, nomor: v.docNumber, journalId: balikId, ulang: false };
    });
  } catch (e) {
    const g = petaGalat(e);
    if (g) return g;
    throw e;
  }
}

/**
 * Sapuan: posting ulang jurnal voucher BERLAKU yang tidak punya jurnal (mis.
 * data lama atau baris yang dipulihkan). Membangun ulang dari baris voucher
 * tersimpan, idempoten per (CASH_VOUCHER, id).
 */
export async function postingUlangJurnalVoucher(
  id: string,
  olehUserId: string,
): Promise<{ ok: true; journalId: string; created: boolean } | { ok: false; code: "UNMAPPED_ROLE" | "UNBALANCED" | "NOTHING_TO_POST"; role?: string }> {
  const v = await prisma.cashVoucher.findUnique({
    where: { id },
    select: {
      id: true,
      docNumber: true,
      type: true,
      date: true,
      status: true,
      cashAccountId: true,
      transferAccountId: true,
      counterpart: true,
      description: true,
      totalAmount: true,
      withholdingType: true,
      withholdingAmount: true,
      netAmount: true,
      lines: { orderBy: { sortOrder: "asc" }, select: { chartAccountId: true, amount: true, memo: true, channel: true, storeId: true } },
    },
  });
  if (!v || v.status !== STATUS_VOUCHER.BERLAKU) return { ok: false, code: "NOTHING_TO_POST" };
  const jenis = v.type as JenisVoucher;
  const totalSen = Math.round(Number(v.totalAmount) * 100);
  const potongSen = Math.round(Number(v.withholdingAmount) * 100);
  const jenisPotong = bacaJenisPotongPemasok(v.withholdingType);
  let akunHutangPph: string | null = null;
  if (potongSen > 0 && jenisPotong) {
    try {
      akunHutangPph = await resolveAccount(INFO_POTONG_PEMASOK[jenisPotong].peranHutang);
    } catch (e) {
      if (e instanceof UnmappedRoleError) return { ok: false, code: "UNMAPPED_ROLE", role: e.role };
      throw e;
    }
  }
  const vs: VoucherSah = {
    jenis,
    tanggal: "",
    rekeningId: v.cashAccountId,
    rekeningTujuanId: v.transferAccountId,
    pihak: v.counterpart,
    pemasokId: null,
    keterangan: v.description,
    fotoUrl: null,
    baris: v.lines.map((l) => ({
      kategoriId: null,
      akunId: l.chartAccountId,
      sen: Math.round(Number(l.amount) * 100),
      memo: l.memo,
      kanal: (l.channel as VoucherSah["baris"][number]["kanal"]) ?? null,
      tokoId: l.storeId,
      kenaPotong: false,
    })),
    totalSen,
    jenisPotong,
    adaNpwp: true,
  };
  const baris = barisJurnalVoucher(vs, { totalSen, dasarPotongSen: 0, potongSen, netoSen: totalSen - potongSen }, v.lines.map((l) => l.chartAccountId), akunHutangPph);
  try {
    const r = await postJournal(prisma, {
      source: { type: SUMBER_VOUCHER_KAS, id: v.id },
      date: v.date,
      description: uraianJurnalVoucher(jenis, v.docNumber, v.counterpart, v.description),
      postedById: olehUserId,
      lines: baris,
    });
    return { ok: true, journalId: r.journalId, created: r.created };
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}
