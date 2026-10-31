import { prisma } from "@elorae/db";
import type { AccountType } from "@/lib/constants/enums";
import { KANAL_JURNAL, kanalMarketplace } from "@/lib/finance/journals/kanal";
import { saringJurnalLaporan } from "./balances";
import { susunLabaKanal, type BarisKanalMentah, type BarisTurunan, type HasilLabaKanal } from "./laba-kanal";

const JENIS_LABA_RUGI: AccountType[] = ["PENDAPATAN", "HPP", "BEBAN"];

/** Sumber jurnal lama yang kanalnya bisa diturunkan dari dokumennya. */
const SUMBER_PESANAN = ["SALESORDER_REVENUE", "SALESORDER_COGS"];
const SUMBER_RETUR = ["SALESRETURN_REVENUE", "SALESRETURN_COGS"];
const SUMBER_KANVAS = ["VAN_SALE", "VAN_RECONCILE"];
const SUMBER_KOL = ["KOL_FEE", "KOL_PAYMENT", "KOL_PAYMENT_REVERSAL", "KOL_SAMPLE"];
const SUMBER_SETTLEMENT = ["SETTLEMENT"];
const SUMBER_TURUNAN = [...SUMBER_PESANAN, ...SUMBER_RETUR, ...SUMBER_KANVAS, ...SUMBER_KOL, ...SUMBER_SETTLEMENT];

const POTONG = 1000;
function potong<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += POTONG) out.push(xs.slice(i, i + POTONG));
  return out;
}

async function petaKanal<T extends { id: string }>(
  ids: string[],
  cari: (ids: string[]) => Promise<T[]>,
  kanal: (row: T) => string | null,
): Promise<Map<string, string | null>> {
  const peta = new Map<string, string | null>();
  for (const bagian of potong([...new Set(ids)])) {
    for (const row of await cari(bagian)) peta.set(row.id, kanal(row));
  }
  return peta;
}

/**
 * Baris jurnal laba rugi TANPA kanal dari sumber yang kanalnya bisa
 * diturunkan (jurnal sebelum dimensi kanal ada). Dibaca terpisah dari
 * agregat supaya total tetap sama dengan buku besar — barisnya hanya
 * dipindah antarkelompok (`susunLabaKanal`).
 */
async function bacaTurunan(range: { from?: Date; to: Date }): Promise<BarisTurunan[]> {
  const lines = await prisma.journalLine.findMany({
    where: {
      channel: null,
      account: { type: { in: JENIS_LABA_RUGI } },
      journal: { ...saringJurnalLaporan(range), sourceType: { in: SUMBER_TURUNAN } },
    },
    select: {
      debit: true,
      credit: true,
      storeId: true,
      chartAccountId: true,
      account: { select: { type: true } },
      journal: { select: { sourceType: true, sourceId: true } },
    },
  });
  if (lines.length === 0) return [];

  const idDari = (jenis: string[]) =>
    lines.filter((l) => jenis.includes(l.journal.sourceType ?? "") && l.journal.sourceId).map((l) => l.journal.sourceId!);

  const [pesanan, retur, kanvas, settlement] = await Promise.all([
    petaKanal(idDari(SUMBER_PESANAN), (ids) => prisma.salesOrder.findMany({ where: { id: { in: ids } }, select: { id: true, channel: true } }), (r) =>
      kanalMarketplace(r.channel),
    ),
    petaKanal(idDari(SUMBER_RETUR), (ids) => prisma.salesReturn.findMany({ where: { id: { in: ids } }, select: { id: true, channel: true } }), (r) =>
      kanalMarketplace(r.channel),
    ),
    petaKanal(idDari(["VAN_SALE"]), (ids) => prisma.vanSale.findMany({ where: { id: { in: ids } }, select: { id: true, storeId: true } }), (r) => r.storeId),
    petaKanal(idDari(SUMBER_SETTLEMENT), (ids) => prisma.settlement.findMany({ where: { id: { in: ids } }, select: { id: true, marketplace: true } }), (r) =>
      kanalMarketplace(r.marketplace),
    ),
  ]);

  const out: BarisTurunan[] = [];
  for (const l of lines) {
    const jenis = l.journal.sourceType ?? "";
    const id = l.journal.sourceId ?? "";
    let kanal: string | null = null;
    let storeIdTurunan: string | null = null;
    if (SUMBER_PESANAN.includes(jenis)) kanal = pesanan.get(id) ?? null;
    else if (SUMBER_RETUR.includes(jenis)) kanal = retur.get(id) ?? null;
    else if (SUMBER_KANVAS.includes(jenis)) {
      kanal = KANAL_JURNAL.KANVAS;
      storeIdTurunan = jenis === "VAN_SALE" ? (kanvas.get(id) ?? null) : null;
    } else if (SUMBER_KOL.includes(jenis)) kanal = KANAL_JURNAL.KOL;
    else if (SUMBER_SETTLEMENT.includes(jenis)) kanal = settlement.get(id) ?? null;
    if (!kanal) continue;
    out.push({
      accountId: l.chartAccountId,
      type: l.account.type as AccountType,
      debit: Number(l.debit),
      credit: Number(l.credit),
      storeId: l.storeId,
      kanal,
      storeIdTurunan,
    });
  }
  return out;
}

export type LaporanLabaKanal = HasilLabaKanal & {
  /** Nama toko per id, untuk kelompok "toko". */
  namaToko: Record<string, string>;
};

/**
 * Laba per kanal / per toko untuk satu periode. `kanal` menyaring baris yang
 * dihitung (mis. hanya PUTUS saat melihat per toko) — penyaring ini memakai
 * kanal tersimpan maupun kanal turunan.
 */
export async function muatLabaKanal(input: {
  from?: Date;
  to: Date;
  kelompok: "kanal" | "toko";
  kanal?: string | null;
}): Promise<LaporanLabaKanal> {
  const range = { from: input.from, to: input.to };
  const [akun, pemetaan, agregat, turunanSemua] = await Promise.all([
    prisma.chartAccount.findMany({ where: { type: { in: JENIS_LABA_RUGI } }, select: { id: true, type: true } }),
    prisma.journalAccountMapping.findMany({
      where: { role: { in: ["SALES_RETURN", "SALES_DISCOUNT"] } },
      select: { role: true, chartAccountId: true },
    }),
    prisma.journalLine.groupBy({
      by: ["channel", "storeId", "chartAccountId"],
      _sum: { debit: true, credit: true },
      where: { account: { type: { in: JENIS_LABA_RUGI } }, journal: saringJurnalLaporan(range) },
    }),
    bacaTurunan(range),
  ]);

  const jenisAkun = new Map(akun.map((a) => [a.id, a.type as AccountType]));
  const peran = {
    retur: new Set(pemetaan.filter((m) => m.role === "SALES_RETURN").map((m) => m.chartAccountId)),
    potongan: new Set(pemetaan.filter((m) => m.role === "SALES_DISCOUNT").map((m) => m.chartAccountId)),
  };

  const filterKanal = input.kanal ?? null;
  const baris: BarisKanalMentah[] = [];
  for (const g of agregat) {
    const type = jenisAkun.get(g.chartAccountId);
    if (!type) continue;
    baris.push({
      kanal: g.channel,
      storeId: g.storeId,
      accountId: g.chartAccountId,
      type,
      debit: Number(g._sum.debit ?? 0),
      credit: Number(g._sum.credit ?? 0),
    });
  }

  const barisTersaring = filterKanal ? baris.filter((b) => b.kanal === filterKanal) : baris;
  /* Saat menyaring satu kanal, baris tanpa kanal yang kanal turunannya cocok ikut — sebagai baris biasa. */
  const turunan = filterKanal ? [] : turunanSemua;
  const tambahanSaring: BarisKanalMentah[] = filterKanal
    ? turunanSemua
        .filter((t) => t.kanal === filterKanal)
        .map((t) => ({ kanal: t.kanal, storeId: t.storeId ?? t.storeIdTurunan, accountId: t.accountId, type: t.type, debit: t.debit, credit: t.credit }))
    : [];

  const hasil = susunLabaKanal([...barisTersaring, ...tambahanSaring], peran, input.kelompok, turunan);
  if (filterKanal) hasil.barisTurunan = tambahanSaring.length;

  const idToko = hasil.baris.map((b) => b.kunci).filter((k): k is string => input.kelompok === "toko" && k !== null);
  const toko = idToko.length
    ? await prisma.store.findMany({ where: { id: { in: idToko } }, select: { id: true, name: true, code: true } })
    : [];
  const namaToko = Object.fromEntries(toko.map((t) => [t.id, t.code ? `${t.name} (${t.code})` : t.name]));

  return { ...hasil, namaToko };
}
