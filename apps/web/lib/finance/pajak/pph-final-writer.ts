import { JournalError, postJournal, prisma, type Prisma, type PrismaClient } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateAutoJournal } from "@/lib/finance/journal";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { bacaProfilPajak } from "./profil-pengaturan";
import { akunPeran } from "./akun-peran";
import { pakaiPphFinalUmkm, type BentukUsaha } from "./profil";
import { barisPphFinal, hitungPphFinal, type HasilPphFinal } from "./pph-final";
import {
  SUMBER_PPH_FINAL,
  SUMBER_PPH_FINAL_BALIK,
  bacaMasaPajak,
  idSumberMasa,
  masaDariTanggal,
  rentangMasa,
  tanggalJurnalMasa,
} from "./masa";
import { JENIS_REKAP_PPH_FINAL, keBarisRekap, type BarisRekapTersimpan } from "./masa-queries";
import { JEJAK_PAJAK, catatJejakPajak } from "./jejak-pajak";

/**
 * PPh final UMKM per masa — bacaan buku besar + penulis (KHUSUS SERVER).
 * Rumusnya di `./pph-final.ts`.
 *
 * Omzet = Σ (kredit − debit) akun peran pendapatan penjualan (`SALES_REVENUE`,
 * dan `SALES_RETURN`/`SALES_DISCOUNT` bila dipetakan) pada jurnal berlaku di
 * masa itu, tanpa jurnal tutup tahun (yang memindahkan saldo pendapatan ke laba
 * ditahan). Kredit PPh 22 = debit `PPH22_PREPAID` masa itu (dari settlement).
 *
 * Hasilnya disimpan di `TaxPeriodRecap` jenis `PPH_FINAL`: `outputDpp` = omzet,
 * `inputDpp` = dasar kena pajak, `outputTax` = PPh final, `inputTax` = kredit
 * PPh 22, `balance` = terutang (disetor lewat setoran pajak jenis PPH_FINAL).
 */

type Klien = PrismaClient | Prisma.TransactionClient;

const SUMBER_TUTUP_TAHUN = "YEAR_END_CLOSE";
const keSen = (n: number) => Math.round(Number((n * 100).toFixed(4)));

function saring(mulai: Date, sampai: Date, kecuali: string[]): Prisma.JournalWhereInput {
  return {
    ...SARING_JURNAL_BERLAKU,
    date: { gte: mulai, lt: sampai },
    OR: [{ sourceType: null }, { sourceType: { notIn: kecuali } }],
  };
}

/** Omzet bruto buku besar di [mulai, sampai). */
async function omzetAntara(client: Klien, mulai: Date, sampai: Date): Promise<number> {
  const peta = await akunPeran(client, ["SALES_REVENUE", "SALES_RETURN", "SALES_DISCOUNT"]);
  const ids = [...new Set(peta.values())];
  if (ids.length === 0) return 0;
  const a = await client.journalLine.aggregate({
    where: { chartAccountId: { in: ids }, journal: saring(mulai, sampai, [SUMBER_TUTUP_TAHUN]) },
    _sum: { debit: true, credit: true },
  });
  return (keSen(Number(a._sum.credit ?? 0)) - keSen(Number(a._sum.debit ?? 0))) / 100;
}

async function pph22Antara(client: Klien, mulai: Date, sampai: Date): Promise<number> {
  const peta = await akunPeran(client, ["PPH22_PREPAID"]);
  const id = peta.get("PPH22_PREPAID");
  if (!id) return 0;
  const a = await client.journalLine.aggregate({
    where: { chartAccountId: id, journal: saring(mulai, sampai, [SUMBER_PPH_FINAL, SUMBER_PPH_FINAL_BALIK]) },
    _sum: { debit: true, credit: true },
  });
  return Math.max(0, (keSen(Number(a._sum.debit ?? 0)) - keSen(Number(a._sum.credit ?? 0))) / 100);
}

export type PphFinalMasa = {
  masa: string;
  aktif: boolean;
  bentukUsaha: BentukUsaha;
  hasil: HasilPphFinal;
  tersimpan: BarisRekapTersimpan | null;
};

export async function hitungPphFinalMasa(masa: string, client: Klien = prisma): Promise<PphFinalMasa> {
  const profil = await bacaProfilPajak(client);
  const { mulai, sampai } = rentangMasa(masa);
  const awalTahun = new Date(`${masa.slice(0, 4)}-01-01T00:00:00.000+07:00`);
  const [omzetMasa, omzetSebelum, pph22, row] = await Promise.all([
    omzetAntara(client, mulai, sampai),
    mulai > awalTahun ? omzetAntara(client, awalTahun, mulai) : Promise.resolve(0),
    pph22Antara(client, mulai, sampai),
    client.taxPeriodRecap.findUnique({ where: { type_period: { type: JENIS_REKAP_PPH_FINAL, period: masa } } }),
  ]);
  return {
    masa,
    aktif: pakaiPphFinalUmkm(profil),
    bentukUsaha: profil.bentukUsaha,
    hasil: hitungPphFinal({ omzetMasa, omzetSebelumnyaTahunIni: omzetSebelum, bentukUsaha: profil.bentukUsaha, pph22Masa: pph22 }),
    tersimpan: row ? keBarisRekap(row) : null,
  };
}

export type KodeTolakPphFinal =
  | "MASA_TIDAK_SAH"
  | "MASA_BELUM_SELESAI"
  | "REZIM_BUKAN_FINAL"
  | "SUDAH_FINAL"
  | "BELUM_FINAL"
  | "SUDAH_DISETOR"
  | "UNMAPPED_ROLE"
  | "UNBALANCED"
  | "NON_POSTABLE_ACCOUNT"
  | "ALASAN_WAJIB";

export type HasilPostingPphFinal = { ok: true; journalId: string | null; pajak: number } | { ok: false; kode: KodeTolakPphFinal; peran?: string };

class Tolak extends Error {
  constructor(
    public kode: KodeTolakPphFinal,
    public peran?: string,
  ) {
    super(kode);
  }
}

async function generasi(tx: Prisma.TransactionClient, masa: string): Promise<number> {
  return (await tx.journal.count({ where: { sourceType: SUMBER_PPH_FINAL_BALIK, sourceId: { startsWith: `${masa}#` } } })) + 1;
}

export async function postingPphFinal(input: { masa: string; olehUserId: string; sekarang?: Date }): Promise<HasilPostingPphFinal> {
  const masa = bacaMasaPajak(input.masa);
  if (!masa) return { ok: false, kode: "MASA_TIDAK_SAH" };
  if (masa >= masaDariTanggal(input.sekarang ?? new Date())) return { ok: false, kode: "MASA_BELUM_SELESAI" };
  try {
    return await runSerializable(async (tx): Promise<HasilPostingPphFinal> => {
      const h = await hitungPphFinalMasa(masa, tx);
      if (!h.aktif) return { ok: false, kode: "REZIM_BUKAN_FINAL" };
      if (h.tersimpan?.status === "FINAL") return { ok: false, kode: "SUDAH_FINAL" };
      const baris = barisPphFinal(h.hasil);
      let journalId: string | null = null;
      if (baris.length > 0) {
        const r = await generateAutoJournal(tx, SUMBER_PPH_FINAL, idSumberMasa(masa, await generasi(tx, masa)), baris, {
          date: tanggalJurnalMasa(masa),
          description: `PPh final UMKM masa ${masa}`,
          postedById: input.olehUserId,
        });
        if (!r.ok) throw new Tolak(r.code === "UNMAPPED_ROLE" ? "UNMAPPED_ROLE" : "UNBALANCED", r.role);
        journalId = r.journalId;
      }
      const data = {
        outputDpp: h.hasil.omzet,
        inputDpp: h.hasil.dasar,
        outputTax: h.hasil.pajak,
        inputTax: h.hasil.kreditPph22,
        compensation: 0,
        balance: h.hasil.terutang,
        status: "FINAL",
        finalizedAt: new Date(),
        finalizedById: input.olehUserId,
        journalId,
      };
      const row = h.tersimpan
        ? await tx.taxPeriodRecap.update({ where: { id: h.tersimpan.id }, data })
        : await tx.taxPeriodRecap.create({ data: { type: JENIS_REKAP_PPH_FINAL, period: masa, ...data } });
      await catatJejakPajak(tx, {
        userId: input.olehUserId,
        action: JEJAK_PAJAK.PPH_FINAL_DIPOSTING,
        entityType: "TaxPeriodRecap",
        entityId: row.id,
        changes: { after: { status: "FINAL", pajak: h.hasil.pajak, terutang: h.hasil.terutang } },
        metadata: { masa, omzet: h.hasil.omzet, dasar: h.hasil.dasar, kreditPph22: h.hasil.kreditPph22, journalId },
      });
      return { ok: true, journalId, pajak: h.hasil.pajak };
    });
  } catch (e) {
    if (e instanceof Tolak) return { ok: false, kode: e.kode, ...(e.peran ? { peran: e.peran } : {}) };
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, kode: "UNBALANCED" };
    throw e;
  }
}

export async function bukaPphFinal(input: { masa: string; olehUserId: string; alasan: string }): Promise<HasilPostingPphFinal> {
  const masa = bacaMasaPajak(input.masa);
  if (!masa) return { ok: false, kode: "MASA_TIDAK_SAH" };
  const alasan = input.alasan?.trim() ?? "";
  if (alasan.length < 5) return { ok: false, kode: "ALASAN_WAJIB" };
  try {
    return await runSerializable(async (tx): Promise<HasilPostingPphFinal> => {
      const ada = await tx.taxPeriodRecap.findUnique({ where: { type_period: { type: JENIS_REKAP_PPH_FINAL, period: masa } } });
      if (ada?.status !== "FINAL") return { ok: false, kode: "BELUM_FINAL" };
      if (await tx.taxPayment.findFirst({ where: { type: "PPH_FINAL", period: masa, status: "POSTED" }, select: { id: true } })) {
        return { ok: false, kode: "SUDAH_DISETOR" };
      }
      let balikId: string | null = null;
      if (ada.journalId) {
        const asli = await tx.journal.findUnique({
          where: { id: ada.journalId },
          select: { id: true, date: true, sourceId: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
        });
        if (asli?.sourceId) {
          balikId = (
            await postJournal(tx, {
              source: { type: SUMBER_PPH_FINAL_BALIK, id: asli.sourceId },
              date: asli.date,
              description: `Pembukaan kembali PPh final masa ${masa}`,
              postedById: input.olehUserId,
              reversalOfId: asli.id,
              lines: asli.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: Number(l.credit), credit: Number(l.debit), ...(l.memo ? { memo: l.memo } : {}) })),
            })
          ).journalId;
        }
      }
      await tx.taxPeriodRecap.update({ where: { id: ada.id }, data: { status: "DRAFT", finalizedAt: null, finalizedById: null, journalId: null } });
      await catatJejakPajak(tx, {
        userId: input.olehUserId,
        action: JEJAK_PAJAK.PPH_FINAL_DIBUKA,
        entityType: "TaxPeriodRecap",
        entityId: ada.id,
        changes: { before: { status: "FINAL", journalId: ada.journalId }, after: { status: "DRAFT" } },
        metadata: { masa, jurnalPembalik: balikId },
        reason: alasan,
      });
      return { ok: true, journalId: balikId, pajak: 0 };
    });
  } catch (e) {
    if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
    throw e;
  }
}
