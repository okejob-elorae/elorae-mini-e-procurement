import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { idBebanDariCatatan } from "@/lib/receivables/penanda-beban";
import { daftarPiutang } from "@/lib/receivables/queries";
import { keSen, SUMBER_LAPANGAN } from "./aturan";
import { bacaNilaiReturBanyak } from "./jurnal";
import { ringkasRekonsiliasi, type BarisRekonsiliasiToko, type RekonsiliasiPiutang } from "./rekonsiliasi";

/*
 * Rekonsiliasi piutang toko — KHUSUS SERVER. Membandingkan saldo akun
 * `AR_STORE` di buku besar (per toko, dari `JournalLine.storeId`) dengan Σ sisa
 * piutang modul piutang (`daftarPiutang`: dihitung ulang dari nol, tanpa toko
 * konsinyasi).
 *
 * Keduanya sengaja tidak sama persis: jurnal retur mengkredit piutang sebesar
 * barang yang SAMPAI begitu gudang menghitungnya, sedangkan modul baru
 * mengurangi piutang saat toko memotong nota retur itu di BKM yang
 * terverifikasi. Selisih itu dihitung per nota (`kreditBelumDipakai`), jadi
 * yang tersisa — `selisih` — seharusnya nol (dalam batas pembulatan rupiah per
 * faktur di modul).
 */

/** Hitungan gudang yang ikut buku besar: sudah berjurnal, atau berhak dijurnal (FINAL, sejak tanggal mulai). */
async function nriBukuBesar(storeIds: string[] | null, mulai: Date | null): Promise<string[]> {
  const berjurnal = await prisma.journal.findMany({
    where: { sourceType: SUMBER_LAPANGAN.RETUR },
    select: { sourceId: true },
  });
  const ids = new Set(berjurnal.map((j) => (j.sourceId ?? "").split("#")[0]).filter(Boolean));
  if (mulai) {
    const layak = await prisma.warehouseReturn.findMany({
      where: { status: "FINAL", finalisedAt: { gte: mulai } },
      select: { id: true },
    });
    for (const n of layak) ids.add(n.id);
  }
  if (!storeIds) return [...ids];
  const toko = await prisma.warehouseReturn.findMany({
    where: { id: { in: [...ids] }, OR: [{ storeId: { in: storeIds } }, { storeReturn: { storeId: { in: storeIds } } }] },
    select: { id: true },
  });
  return toko.map((t) => t.id);
}

/**
 * `storeIds` membatasi ke toko tertentu (tes di basis data bersama, atau
 * rincian satu toko); tanpa itu seluruh toko non-konsinyasi.
 */
export async function rekonsiliasiPiutangToko(opsi: { storeIds?: string[] } = {}): Promise<RekonsiliasiPiutang> {
  const lingkup = opsi.storeIds && opsi.storeIds.length > 0 ? opsi.storeIds : null;
  const [akunId, mulai] = await Promise.all([
    resolveAccount("AR_STORE").catch((e) => {
      if (e instanceof UnmappedRoleError) return null;
      throw e;
    }),
    readGlCutover(),
  ]);
  const akun = akunId ? await prisma.chartAccount.findUnique({ where: { id: akunId }, select: { id: true, code: true, name: true } }) : null;

  // Buku besar: saldo akun AR_STORE per toko.
  const perTokoBuku = new Map<string | null, number>();
  if (akun) {
    const g = await prisma.journalLine.groupBy({
      by: ["storeId"],
      where: {
        chartAccountId: akun.id,
        journal: SARING_JURNAL_BERLAKU,
        ...(lingkup ? { storeId: { in: lingkup } } : {}),
      },
      _sum: { debit: true, credit: true },
    });
    for (const r of g) perTokoBuku.set(r.storeId ?? null, keSen(Number(r._sum.debit ?? 0)) - keSen(Number(r._sum.credit ?? 0)));
  }

  // Modul: sisa setiap piutang, dihitung ulang.
  const piutang = lingkup ? (await Promise.all(lingkup.map((storeId) => daftarPiutang({ storeId })))).flat() : await daftarPiutang();
  const detail = piutang.length
    ? await prisma.receivable.findMany({
        where: { id: { in: piutang.map((p) => p.id) } },
        select: { id: true, deliveryId: true, note: true, source: true },
      })
    : [];
  const detailPer = new Map(detail.map((d) => [d.id, d]));
  const notaBerjurnal = new Set(
    (
      await prisma.journal.findMany({
        where: { sourceType: SUMBER_LAPANGAN.NOTA, sourceId: { in: detail.map((d) => d.deliveryId).filter((x): x is string => Boolean(x)) } },
        select: { sourceId: true },
      })
    ).map((j) => j.sourceId),
  );
  // Faktur manual/impor yang sudah punya jurnal `STORE_INVOICE` sendiri (generasi pertama = id faktur).
  const fakturBerjurnal = new Set(
    (
      await prisma.journal.findMany({
        where: { sourceType: SUMBER_LAPANGAN.FAKTUR, sourceId: { in: detail.filter((d) => !d.deliveryId).map((d) => d.id) } },
        select: { sourceId: true },
      })
    ).map((j) => j.sourceId),
  );

  type Akumulasi = { nama: string; modul: number; diLuar: number; jumlah: number; kredit: number };
  const per = new Map<string, Akumulasi>();
  const ambil = (storeId: string, nama: string) => {
    let a = per.get(storeId);
    if (!a) {
      a = { nama, modul: 0, diLuar: 0, jumlah: 0, kredit: 0 };
      per.set(storeId, a);
    }
    return a;
  };
  for (const p of piutang) {
    const a = ambil(p.storeId, p.storeName);
    const sisa = keSen(p.outstanding);
    a.modul += sisa;
    a.jumlah += 1;
    const d = detailPer.get(p.id);
    const lewatJurnalNota = d?.deliveryId ? notaBerjurnal.has(d.deliveryId) : false;
    const fakturBeban = d?.source === "MANUAL" && idBebanDariCatatan(d.note) !== null;
    const lewatJurnalFaktur = d ? fakturBerjurnal.has(d.id) : false;
    if (!lewatJurnalNota && !fakturBeban && !lewatJurnalFaktur) a.diLuar += sisa;
  }

  // Kredit retur yang belum dipotong toko, per toko.
  const nilaiRetur = await bacaNilaiReturBanyak(prisma, await nriBukuBesar(lingkup, mulai));
  for (const n of nilaiRetur.values()) {
    if (n.konsinyasi || !n.storeId || !n.final) continue;
    const kredit = keSen(n.nilai.kreditBelumDipakai);
    if (kredit === 0) continue;
    ambil(n.storeId, n.storeName ?? n.storeId).kredit += kredit;
  }

  // Toko yang hanya muncul di buku besar (mis. piutangnya sudah dihapus).
  const tokoBukuSaja = [...perTokoBuku.keys()].filter((id): id is string => id !== null && !per.has(id));
  if (tokoBukuSaja.length) {
    const toko = await prisma.store.findMany({ where: { id: { in: tokoBukuSaja } }, select: { id: true, name: true } });
    const nama = new Map(toko.map((t) => [t.id, t.name]));
    for (const id of tokoBukuSaja) ambil(id, nama.get(id) ?? id);
  }

  const baris: BarisRekonsiliasiToko[] = [...per.entries()].map(([storeId, a]) => ({
    storeId,
    storeName: a.nama,
    bukuBesar: (perTokoBuku.get(storeId) ?? 0) / 100,
    modul: a.modul / 100,
    kreditRetur: a.kredit / 100,
    diLuarJurnal: a.diLuar / 100,
    jumlahPiutang: a.jumlah,
  }));
  const tanpaToko = (perTokoBuku.get(null) ?? 0) / 100;

  return ringkasRekonsiliasi({
    akun: akun ? { id: akun.id, kode: akun.code, nama: akun.name } : null,
    tanggalMulai: mulai ? formatDateOnlyJakarta(mulai) : null,
    baris,
    tanpaToko: lingkup ? 0 : tanpaToko,
  });
}
