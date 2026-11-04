import { JournalError, postJournal, prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { parseDateOnly } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { INFO_SETORAN, periksaSetoran, type GalatSetoran, type IsianSetoran } from "./setoran";
import { SUMBER_SETORAN_PAJAK, SUMBER_SETORAN_PAJAK_BALIK } from "./masa";
import { JEJAK_PAJAK, catatJejakPajak } from "./jejak-pajak";

/**
 * Penulis setoran pajak — KHUSUS SERVER. Setoran adalah dokumen KEUANGAN:
 * jurnalnya (DR hutang pajak / CR bank) ditulis di transaksi yang sama, jadi
 * setoran tanpa jurnal tidak pernah ada; peran yang belum dipetakan menolak
 * setorannya dengan kode.
 *
 * Idempoten: `idempotencyKey` (sekali per isian formulir) diperiksa PALING
 * DULU dan lagi di dalam transaksi — kiriman ulang mengembalikan setoran yang
 * sama (`ulang: true`). NTPN yang sama tidak boleh dipakai dua setoran
 * berlaku (`NTPN_SUDAH_ADA`).
 *
 * Pembatalan tidak menghapus: status CANCELLED + jurnal pembalik
 * `TAX_PAYMENT_REVERSAL` (id sama), alasan wajib, jejak di transaksi yang sama.
 */

export type KodeTolakSetoran =
  | GalatSetoran
  | "REKENING_TIDAK_SAH"
  | "NTPN_SUDAH_ADA"
  | "UNMAPPED_ROLE"
  | "NON_POSTABLE_ACCOUNT"
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DIBATALKAN"
  | "ALASAN_WAJIB";

export type HasilSetoran =
  | { ok: true; id: string; journalId: string | null; ulang: boolean }
  | { ok: false; kode: KodeTolakSetoran; peran?: string };

class Tolak extends Error {
  constructor(
    public kode: KodeTolakSetoran,
    public peran?: string,
  ) {
    super(kode);
  }
}

async function denganKunci(client: Pick<Prisma.TransactionClient, "taxPayment" | "journal">, kunci: string) {
  const ada = await client.taxPayment.findUnique({ where: { idempotencyKey: kunci }, select: { id: true } });
  if (!ada) return null;
  const j = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: SUMBER_SETORAN_PAJAK, sourceId: ada.id } },
    select: { id: true },
  });
  return { ok: true as const, id: ada.id, journalId: j?.id ?? null, ulang: true };
}

export async function catatSetoran(input: IsianSetoran & { idempotencyKey?: string | null; olehUserId: string; hariIni?: string }): Promise<HasilSetoran> {
  const periksa = periksaSetoran(input, input.hariIni ?? hariIniWib());
  if (!periksa.ok) return { ok: false, kode: periksa.galat };
  const s = periksa.setoran;
  const kunci = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim().slice(0, 100) : null;
  if (kunci) {
    const lama = await denganKunci(prisma, kunci);
    if (lama) return lama;
  }
  const info = INFO_SETORAN[s.jenis];

  try {
    return await runSerializable(async (tx): Promise<HasilSetoran> => {
      if (kunci) {
        const lama = await denganKunci(tx, kunci);
        if (lama) return lama;
      }
      const kembar = await tx.taxPayment.findFirst({ where: { ntpn: s.ntpn, status: "POSTED" }, select: { id: true } });
      if (kembar) throw new Tolak("NTPN_SUDAH_ADA");

      let rekeningId: string;
      if (s.rekeningId) {
        const a = await tx.chartAccount.findUnique({ where: { id: s.rekeningId }, select: { type: true, isActive: true, _count: { select: { children: true } } } });
        if (!a || a.type !== "ASET" || !a.isActive || a._count.children > 0) throw new Tolak("REKENING_TIDAK_SAH");
        rekeningId = s.rekeningId;
      } else {
        rekeningId = await resolveAccount("BANK", tx);
      }
      const hutangId = await resolveAccount(info.peranDebit, tx);

      const bayar = await tx.taxPayment.create({
        data: {
          type: s.jenis,
          period: s.masa,
          amount: s.jumlah,
          paidAt: parseDateOnly(s.tanggalBayar) as Date,
          ntpn: s.ntpn,
          billingCode: s.kodeBilling,
          cashAccountId: s.rekeningId,
          status: "POSTED",
          note: s.catatan,
          idempotencyKey: kunci,
          createdById: input.olehUserId,
        },
        select: { id: true },
      });
      const j = await postJournal(tx, {
        source: { type: SUMBER_SETORAN_PAJAK, id: bayar.id },
        date: parseDateOnly(s.tanggalBayar) as Date,
        description: `Setoran ${info.label} masa ${s.masa} (NTPN ${s.ntpn})`,
        postedById: input.olehUserId,
        lines: [
          { chartAccountId: hutangId, debit: s.jumlah, credit: 0, memo: info.peranDebit },
          { chartAccountId: rekeningId, debit: 0, credit: s.jumlah },
        ],
      });
      await catatJejakPajak(tx, {
        userId: input.olehUserId,
        action: JEJAK_PAJAK.SETORAN_DICATAT,
        entityType: "TaxPayment",
        entityId: bayar.id,
        changes: { after: { jenis: s.jenis, masa: s.masa, jumlah: s.jumlah, ntpn: s.ntpn, tanggalBayar: s.tanggalBayar } },
        metadata: { journalId: j.journalId },
      });
      return { ok: true, id: bayar.id, journalId: j.journalId, ulang: false };
    });
  } catch (e) {
    if (e instanceof Tolak) return { ok: false, kode: e.kode, ...(e.peran ? { peran: e.peran } : {}) };
    if (e instanceof UnmappedRoleError) return { ok: false, kode: "UNMAPPED_ROLE", peran: e.role };
    // Balapan kiriman ganda yang lolos sebagai pelanggaran kunci unik: kembalikan pemenangnya.
    if (kunci && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const lama = await denganKunci(prisma, kunci);
      if (lama) return lama;
    }
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
    throw e;
  }
}

export async function batalkanSetoran(input: { id: string; olehUserId: string; alasan: string }): Promise<HasilSetoran> {
  const alasan = input.alasan?.trim() ?? "";
  if (alasan.length < 5) return { ok: false, kode: "ALASAN_WAJIB" };
  try {
    return await runSerializable(async (tx): Promise<HasilSetoran> => {
      const b = await tx.taxPayment.findUnique({ where: { id: input.id }, select: { id: true, status: true, type: true, period: true, amount: true, ntpn: true } });
      if (!b) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      if (b.status === "CANCELLED") return { ok: false, kode: "SUDAH_DIBATALKAN" };
      const asli = await tx.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: SUMBER_SETORAN_PAJAK, sourceId: b.id } },
        select: { id: true, date: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
      });
      let balikId: string | null = null;
      if (asli) {
        const r = await postJournal(tx, {
          source: { type: SUMBER_SETORAN_PAJAK_BALIK, id: b.id },
          date: new Date(),
          description: `Pembatalan setoran ${b.type} masa ${b.period}${b.ntpn ? ` (NTPN ${b.ntpn})` : ""}`,
          postedById: input.olehUserId,
          reversalOfId: asli.id,
          lines: asli.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: Number(l.credit), credit: Number(l.debit), ...(l.memo ? { memo: l.memo } : {}) })),
        });
        balikId = r.journalId;
      }
      await tx.taxPayment.update({
        where: { id: b.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: input.olehUserId, cancelReason: alasan },
      });
      await catatJejakPajak(tx, {
        userId: input.olehUserId,
        action: JEJAK_PAJAK.SETORAN_DIBATALKAN,
        entityType: "TaxPayment",
        entityId: b.id,
        changes: { before: { status: "POSTED" }, after: { status: "CANCELLED" } },
        metadata: { jenis: b.type, masa: b.period, jumlah: Number(b.amount), jurnalPembalik: balikId },
        reason: alasan,
      });
      return { ok: true, id: b.id, journalId: balikId, ulang: false };
    });
  } catch (e) {
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
    throw e;
  }
}
