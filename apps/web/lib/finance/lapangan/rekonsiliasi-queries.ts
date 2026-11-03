import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { readReceivableJournalStates } from "@/lib/finance/ar/store-receivable-role";
import { daftarPiutang } from "@/lib/receivables/queries";
import { keSen, SUMBER_LAPANGAN } from "./aturan";
import { bacaNilaiReturBanyak } from "./jurnal";
import { ringkasRekonsiliasi, type BarisRekonsiliasiToko, type RekonsiliasiPiutang } from "./rekonsiliasi";

/*
 * Rekonsiliasi piutang toko — KHUSUS SERVER. Membandingkan saldo akun
 * `AR_STORE` di buku besar (per toko, dari `JournalLine.storeId`) dengan Σ sisa
 * piutang modul piutang (`daftarPiutang`: dihitung ulang dari nol, dan sudah
 * dikurangi uang yang masuk lewat pembayaran kantor —
 * `Receivable.paidAmount`, yang dikredit jurnal penerimaannya ke akun yang
 * sama) — dalam batas pembulatan rupiah per faktur, angka yang sama dengan
 * `outstandingAmount` yang ditulis `kolomPembayaranKantor`.
 *
 * Faktur yang jurnal fakturnya mendebit akun LAIN (bentuk lama di AR, laporan
 * laku konsinyasi di AR_CONSIGNMENT — `readReceivableJournalStates`) tidak ikut:
 * setiap pelunasannya dikredit ke akun itu juga, jadi saldonya memang tidak
 * pernah ada di AR_STORE. Tagihan KONSINYASI (`BarisPiutang.konsi` —
 * `Receivable.isConsignment`) juga tidak pernah ikut, berjurnal atau belum: ia
 * berdiri di AR_CONSIGNMENT (jurnal siklusnya, atau saldo awal akun itu), dan
 * BKM yang melunasinya mengkredit akun itu. Tanpa ini tagihan siklus yang
 * jurnalnya belum berdiri terhitung modul AR_STORE dan tokonya tampil tidak cocok.
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
 * rincian satu toko); tanpa itu seluruh toko — tagihan konsinyasi di dalamnya
 * dilewati per tagihan.
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
  // Akun yang didebit jurnal faktur setiap piutang: jurnal nota, jurnal `STORE_INVOICE` faktur
  // manual/impor (generasi pertama = id faktur), atau separuh pendapatan bentuk lama.
  const jurnalFaktur = await readReceivableJournalStates(prisma, piutang.filter((p) => !p.konsi).map((p) => p.id));

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
    if (p.konsi) continue;
    const peran = jurnalFaktur.get(p.id)?.role ?? null;
    if (peran !== null && peran !== "AR_STORE") continue;
    const a = ambil(p.storeId, p.storeName);
    const sisa = keSen(p.outstanding);
    a.modul += sisa;
    a.jumlah += 1;
    if (peran === null) a.diLuar += sisa;
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
