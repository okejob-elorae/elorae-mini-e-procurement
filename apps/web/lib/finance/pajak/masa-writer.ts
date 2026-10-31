import { JournalError, postJournal, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateAutoJournal } from "@/lib/finance/journal";
import {
  masaDariTanggal,
  SUMBER_PPN_MASA,
  SUMBER_PPN_MASA_BALIK,
  barisPenyelesaianPpn,
  bacaMasaPajak,
  geserMasaPajak,
  hitungRekapPpn,
  idSumberMasa,
  tanggalJurnalMasa,
} from "./masa";
import { JENIS_REKAP_PPN, adaPpnSebelum, akunPpn, kompensasiMasuk, rincianPpnMasa } from "./masa-queries";
import { JEJAK_PAJAK, catatJejakPajak } from "./jejak-pajak";

/**
 * Penulis rekap masa PPN — KHUSUS SERVER. Rekap adalah dokumen KEUANGAN, jadi
 * jurnal penyelesaiannya ditulis di transaksi yang sama (bukan best-effort):
 * bila jurnal gagal (peran belum dipetakan), finalisasi DITOLAK dengan kodenya
 * dan tidak ada yang berubah.
 *
 * Urutan: masa difinalkan berurutan — masa M ditolak selama ada PPN sebelum M
 * dan masa M−1 belum FINAL, karena kompensasi lebih bayar dibawa dari M−1.
 * Buka kembali hanya untuk masa FINAL TERAKHIR yang PPN-nya belum disetor;
 * jurnalnya dibalik (tidak pernah dihapus) dan finalisasi berikutnya memakai
 * generasi `sourceId` baru (`<masa>#<n>`).
 */

export type KodeTolakRekap =
  | "MASA_TIDAK_SAH"
  | "MASA_BELUM_SELESAI"
  | "SUDAH_FINAL"
  | "BELUM_FINAL"
  | "MASA_SEBELUM_BELUM_FINAL"
  | "MASA_SESUDAH_FINAL"
  | "SUDAH_DISETOR"
  | "AKUN_PPN_SAMA"
  | "UNMAPPED_ROLE"
  | "UNBALANCED"
  | "NON_POSTABLE_ACCOUNT"
  /** Jurnal pembalik jatuh di periode buku yang sudah ditutup — buka periodenya dulu. */
  | "PERIODE_TERTUTUP"
  | "ALASAN_WAJIB";

export type HasilRekap = { ok: true; journalId: string | null } | { ok: false; kode: KodeTolakRekap; peran?: string };

async function generasi(tx: Prisma.TransactionClient, masa: string): Promise<number> {
  const balik = await tx.journal.count({ where: { sourceType: SUMBER_PPN_MASA_BALIK, sourceId: { startsWith: `${masa}#` } } });
  return balik + 1;
}

function labelMasa(masa: string): string {
  const [t, b] = masa.split("-").map(Number);
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(t, b - 1, 1)));
}

export async function finalkanRekapPpn(input: { masa: string; olehUserId: string; sekarang?: Date; catatan?: string | null }): Promise<HasilRekap> {
  const masa = bacaMasaPajak(input.masa);
  if (!masa) return { ok: false, kode: "MASA_TIDAK_SAH" };
  if (masa >= masaDariTanggal(input.sekarang ?? new Date())) return { ok: false, kode: "MASA_BELUM_SELESAI" };

  try {
    return await runSerializable(async (tx): Promise<HasilRekap> => {
      const ada = await tx.taxPeriodRecap.findUnique({ where: { type_period: { type: JENIS_REKAP_PPN, period: masa } } });
      if (ada?.status === "FINAL") return { ok: false, kode: "SUDAH_FINAL" };
      const akun = await akunPpn(tx);
      if (akun.sama) return { ok: false, kode: "AKUN_PPN_SAMA" };
      const sebelum = await tx.taxPeriodRecap.findUnique({
        where: { type_period: { type: JENIS_REKAP_PPN, period: geserMasaPajak(masa, -1) } },
        select: { status: true },
      });
      if (sebelum?.status !== "FINAL" && (await adaPpnSebelum(masa, akun, tx))) return { ok: false, kode: "MASA_SEBELUM_BELUM_FINAL" };

      const rincian = await rincianPpnMasa(masa, akun, tx);
      const rekap = hitungRekapPpn({ ...rincian, kompensasi: await kompensasiMasuk(masa, tx) });
      const baris = barisPenyelesaianPpn(rekap);

      let journalId: string | null = null;
      if (baris.length > 0) {
        const r = await generateAutoJournal(tx, SUMBER_PPN_MASA, idSumberMasa(masa, await generasi(tx, masa)), baris, {
          date: tanggalJurnalMasa(masa),
          description: `Penyelesaian PPN masa ${labelMasa(masa)}`,
          postedById: input.olehUserId,
        });
        if (!r.ok) {
          // Batalkan transaksi: tidak ada yang boleh tertinggal setengah.
          throw new TolakRekap(r.code === "UNMAPPED_ROLE" ? "UNMAPPED_ROLE" : "UNBALANCED", r.role);
        }
        journalId = r.journalId;
      }

      const data = {
        outputDpp: rekap.keluaranDpp,
        outputTax: rekap.keluaran,
        inputDpp: rekap.masukanDpp,
        inputTax: rekap.masukan,
        compensation: rekap.kompensasi,
        balance: rekap.saldo,
        status: "FINAL",
        finalizedAt: new Date(),
        finalizedById: input.olehUserId,
        journalId,
        note: input.catatan?.trim() || ada?.note || null,
      };
      const row = ada
        ? await tx.taxPeriodRecap.update({ where: { id: ada.id }, data })
        : await tx.taxPeriodRecap.create({ data: { type: JENIS_REKAP_PPN, period: masa, ...data } });
      await catatJejakPajak(tx, {
        userId: input.olehUserId,
        action: JEJAK_PAJAK.PPN_MASA_FINAL,
        entityType: "TaxPeriodRecap",
        entityId: row.id,
        changes: { before: ada ? { status: ada.status } : null, after: { status: "FINAL", saldo: rekap.saldo } },
        metadata: { masa, keluaran: rekap.keluaran, masukan: rekap.masukan, kompensasi: rekap.kompensasi, barisTanpaDpp: rincian.barisTanpaDpp, journalId },
      });
      return { ok: true, journalId };
    });
  } catch (e) {
    if (e instanceof TolakRekap) return { ok: false, kode: e.kode, ...(e.peran ? { peran: e.peran } : {}) };
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, kode: "UNBALANCED" };
    if (e instanceof JournalError && (e.code as string) === "PERIOD_CLOSED") return { ok: false, kode: "PERIODE_TERTUTUP" };
    throw e;
  }
}

class TolakRekap extends Error {
  constructor(
    public kode: KodeTolakRekap,
    public peran?: string,
  ) {
    super(kode);
    this.name = "TolakRekap";
  }
}

export async function bukaRekapPpn(input: { masa: string; olehUserId: string; alasan: string }): Promise<HasilRekap> {
  const masa = bacaMasaPajak(input.masa);
  if (!masa) return { ok: false, kode: "MASA_TIDAK_SAH" };
  const alasan = input.alasan?.trim() ?? "";
  if (alasan.length < 5) return { ok: false, kode: "ALASAN_WAJIB" };

  try {
    return await runSerializable(async (tx): Promise<HasilRekap> => {
      const ada = await tx.taxPeriodRecap.findUnique({ where: { type_period: { type: JENIS_REKAP_PPN, period: masa } } });
      if (ada?.status !== "FINAL") return { ok: false, kode: "BELUM_FINAL" };
      const sesudah = await tx.taxPeriodRecap.findFirst({ where: { type: JENIS_REKAP_PPN, period: { gt: masa }, status: "FINAL" }, select: { id: true } });
      if (sesudah) return { ok: false, kode: "MASA_SESUDAH_FINAL" };
      const setor = await tx.taxPayment.findFirst({ where: { type: "PPN", period: masa, status: "POSTED" }, select: { id: true } });
      if (setor) return { ok: false, kode: "SUDAH_DISETOR" };

      let balikId: string | null = null;
      if (ada.journalId) {
        const asli = await tx.journal.findUnique({
          where: { id: ada.journalId },
          select: { id: true, date: true, sourceId: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
        });
        if (asli?.sourceId) {
          const r = await postJournal(tx, {
            source: { type: SUMBER_PPN_MASA_BALIK, id: asli.sourceId },
            date: asli.date,
            description: `Pembukaan kembali PPN masa ${labelMasa(masa)}`,
            postedById: input.olehUserId,
            reversalOfId: asli.id,
            lines: asli.lines.map((l) => ({
              chartAccountId: l.chartAccountId,
              debit: Number(l.credit),
              credit: Number(l.debit),
              ...(l.memo ? { memo: l.memo } : {}),
            })),
          });
          balikId = r.journalId;
        }
      }
      await tx.taxPeriodRecap.update({ where: { id: ada.id }, data: { status: "DRAFT", finalizedAt: null, finalizedById: null, journalId: null } });
      await catatJejakPajak(tx, {
        userId: input.olehUserId,
        action: JEJAK_PAJAK.PPN_MASA_DIBUKA,
        entityType: "TaxPeriodRecap",
        entityId: ada.id,
        changes: { before: { status: "FINAL", journalId: ada.journalId }, after: { status: "DRAFT" } },
        metadata: { masa, jurnalPembalik: balikId },
        reason: alasan,
      });
      return { ok: true, journalId: balikId };
    });
  } catch (e) {
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
    if (e instanceof JournalError && (e.code as string) === "PERIOD_CLOSED") return { ok: false, kode: "PERIODE_TERTUTUP" };
    throw e;
  }
}
