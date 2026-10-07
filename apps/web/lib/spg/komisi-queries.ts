import { prisma, type Prisma } from "@elorae/db";
import { bulanWib } from "@/lib/salesman/pengaturan";
import { bacaKomisiPutus, KUNCI_KOMISI_PUTUS, type AturanKomisiPutus, type DasarKomisi } from "./pengaturan";
import { sisaBebanHilangPerOrang } from "./hilang-db";
import {
  bulanSebelum,
  bulanSudahSelesai,
  hitungKomisiToko,
  rentangBulanWib,
  statusResmi,
  sudahBerbeda,
  type BarisJualKomisi,
  type BarisKembaliKomisi,
  type BarisResmiAda,
  type KomisiPerSpg,
  type OrangKomisi,
  type PotonganKomisi,
  type StatusKomisi,
} from "./komisi";

/**
 * Pemuat komisi SPG. Satu pemuat (`bahanKomisiToko`) untuk HP, kantor, dan
 * penulis — tiga angka yang harus selalu sama.
 *
 * Klien Prisma boleh transaksi: penulis memanggilnya di dalam `runSerializable`
 * sehingga hitungan dan penulisannya melihat keadaan yang sama.
 */

type Klien = Prisma.TransactionClient | typeof prisma;

const angka = (v: unknown) => Number(v ?? 0);
const namaOrang = (u: { name: string | null; email: string }) => u.name?.trim() || u.email;

export type BahanKomisiToko = { orang: OrangKomisi[]; jual: BarisJualKomisi[]; kembali: BarisKembaliKomisi[] };

/**
 * Nota dan pengembalian satu bulan WIB untuk beberapa toko, plus orangnya: SPG
 * yang bertugas di toko itu, penjual bulan itu, dan `tambahanOrang` (pemegang
 * baris resmi, supaya kantor tetap melihat namanya).
 */
export async function bahanKomisiToko(
  db: Klien,
  storeIds: string[],
  periode: string,
  tambahanOrang: Map<string, string[]> = new Map(),
): Promise<Map<string, BahanKomisiToko>> {
  const hasil = new Map<string, BahanKomisiToko>(storeIds.map((id) => [id, { orang: [], jual: [], kembali: [] }]));
  if (storeIds.length === 0) return hasil;
  const { awal, akhir } = rentangBulanWib(periode);

  const [jual, kembali, bertugas] = await Promise.all([
    db.spgSaleLine.findMany({
      where: { spgSale: { storeId: { in: storeIds }, createdAt: { gte: awal, lt: akhir } } },
      select: { itemId: true, qty: true, item: { select: { commissionPerPcs: true } }, spgSale: { select: { storeId: true, salesmanId: true } } },
    }),
    db.spgSaleReturnLine.findMany({
      where: { saleReturn: { storeId: { in: storeIds }, createdAt: { gte: awal, lt: akhir } } },
      select: { itemId: true, qty: true, saleReturn: { select: { storeId: true } }, saleLine: { select: { spgSale: { select: { salesmanId: true } } } } },
    }),
    db.user.findMany({
      where: { assignedStoreId: { in: storeIds } },
      select: { id: true, name: true, email: true, assignedStoreId: true },
    }),
  ]);

  const perlu = new Map<string, Set<string>>(storeIds.map((id) => [id, new Set<string>()]));
  for (const j of jual) {
    hasil.get(j.spgSale.storeId)?.jual.push({
      salesmanId: j.spgSale.salesmanId,
      itemId: j.itemId,
      qty: j.qty,
      commissionPerPcs: angka(j.item.commissionPerPcs),
    });
    perlu.get(j.spgSale.storeId)?.add(j.spgSale.salesmanId);
  }
  for (const k of kembali) {
    hasil.get(k.saleReturn.storeId)?.kembali.push({ salesmanId: k.saleLine.spgSale.salesmanId, itemId: k.itemId, qty: k.qty });
  }
  for (const [storeId, ids] of tambahanOrang) for (const id of ids) perlu.get(storeId)?.add(id);

  const dikenal = new Map(bertugas.map((u) => [u.id, namaOrang(u)]));
  const belum = [...new Set([...perlu.values()].flatMap((s) => [...s]))].filter((id) => !dikenal.has(id));
  if (belum.length > 0) {
    const lain = await db.user.findMany({ where: { id: { in: belum } }, select: { id: true, name: true, email: true } });
    for (const u of lain) dikenal.set(u.id, namaOrang(u));
  }

  for (const storeId of storeIds) {
    const b = hasil.get(storeId)!;
    const tugas = bertugas.filter((u) => u.assignedStoreId === storeId);
    const ids = new Set(tugas.map((u) => u.id));
    b.orang = [
      ...tugas.map((u) => ({ userId: u.id, nama: namaOrang(u), ditugaskan: true })),
      ...[...(perlu.get(storeId) ?? [])].filter((id) => !ids.has(id)).map((id) => ({ userId: id, nama: dikenal.get(id) ?? id, ditugaskan: false })),
    ];
  }
  return hasil;
}

/**
 * SAMBUNGAN potongan komisi per toko × bulan (mis. bagian barang hilang yang
 * ditanggung SPG). Satu-satunya tempat sumbernya dibaca — HP, kantor, dan
 * penulis semuanya lewat sini, jadi ketiganya tetap memberi angka yang sama.
 * Belum ada sumbernya: selalu kosong.
 */
export async function potonganKomisiToko(input: { db: Klien; storeIds: string[]; periode: string }): Promise<Map<string, PotonganKomisi[]>> {
  return new Map(input.storeIds.map((id) => [id, []]));
}

export async function aturanKomisiPutus(db: Klien = prisma): Promise<AturanKomisiPutus> {
  const s = await db.systemSetting.findUnique({ where: { key: KUNCI_KOMISI_PUTUS }, select: { value: true } });
  return bacaKomisiPutus(s?.value);
}

export const keBarisResmi = (r: { id: string; userId: string; unitsSold: number; commission: unknown; basis: string; paidAt: Date | null }): BarisResmiAda => ({
  id: r.id,
  userId: r.userId,
  unitsSold: r.unitsSold,
  commission: angka(r.commission),
  basis: r.basis,
  paidAt: r.paidAt,
});

// ---------------------------------------------------------------------------
// HP SPG
// ---------------------------------------------------------------------------

/**
 * Perkiraan komisi bulan berjalan untuk SPG yang melihat layar.
 *
 * Yang sampai ke HP hanya bagian SPG itu sendiri — rupiah rekan TIDAK PERNAH.
 * `totalToko` adalah komisi yang dibagi: seluruh toko pada BAGI_RATA (rekan
 * setoko mendapat bagian yang sama, jadi tidak ada yang terbuka), dan pada
 * PER_SPG sama dengan bagian SPG itu sendiri — total toko di sana ditambah
 * satu rekan sudah cukup untuk menebak komisi rekan itu.
 */
export type PerkiraanKomisiHp = {
  bulan: string;
  jenis: "KONSI" | "PUTUS";
  dasar: DasarKomisi;
  totalToko: number;
  bagianSaya: number;
  jumlahSpg: number;
  potongSaya: number;
  /** Hanya BAGI_RATA. */
  potongToko: number | null;
};

export async function perkiraanKomisiHp(
  userId: string,
  toko: { id: string; termsType: "PUTUS" | "KONSI" },
  hariIni: Date,
): Promise<PerkiraanKomisiHp | null> {
  let dasar: DasarKomisi = "BAGI_RATA";
  if (toko.termsType === "PUTUS") {
    const aturan = await aturanKomisiPutus();
    if (!aturan.aktif) return null;
    dasar = aturan.dasar;
  }
  const bulan = bulanWib(hariIni);
  const [bahan, potongan] = await Promise.all([bahanKomisiToko(prisma, [toko.id], bulan), potonganKomisiToko({ db: prisma, storeIds: [toko.id], periode: bulan })]);
  const hasil = hitungKomisiToko({ dasar, ...bahan.get(toko.id)!, potongan: potongan.get(toko.id) ?? [] });
  const saya = hasil.perSpg.find((p) => p.userId === userId && p.penerima);
  const bagianSaya = saya?.komisi ?? 0;
  return {
    bulan,
    jenis: toko.termsType,
    dasar,
    totalToko: dasar === "BAGI_RATA" ? hasil.totalToko : bagianSaya,
    bagianSaya,
    jumlahSpg: hasil.perSpg.filter((o) => o.ditugaskan).length,
    potongSaya: saya?.potong ?? 0,
    potongToko: dasar === "BAGI_RATA" ? hasil.potongToko : null,
  };
}

/** Komisi resmi toko putus milik SPG ini saja. */
export async function komisiPutusResmiSaya(userId: string, batas = 6) {
  const rows = await prisma.spgCommission.findMany({
    where: { userId },
    orderBy: [{ period: "desc" }, { lockedAt: "desc" }],
    take: batas,
    select: { id: true, storeId: true, period: true, unitsSold: true, commission: true, deduction: true, basis: true, lockedAt: true, paidAt: true },
  });
  const toko = await prisma.store.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.storeId))] } }, select: { id: true, name: true } });
  const nama = new Map(toko.map((t) => [t.id, t.name]));
  return rows.map((r) => ({
    id: r.id,
    periode: r.period,
    toko: nama.get(r.storeId) ?? "—",
    potong: r.unitsSold,
    komisi: angka(r.commission),
    /** Beban barang hilang yang dipotong saat komisi ini ditetapkan. */
    potonganHilang: angka(r.deduction),
    dasar: (r.basis === "PER_SPG" ? "PER_SPG" : "BAGI_RATA") as DasarKomisi,
    ditetapkan: r.lockedAt.toISOString(),
    dibayar: r.paidAt ? r.paidAt.toISOString() : null,
  }));
}

// ---------------------------------------------------------------------------
// Kantor
// ---------------------------------------------------------------------------

export type BarisKomisiKantor = KomisiPerSpg & {
  status: StatusKomisi;
  resmi: {
    id: string;
    unitsSold: number;
    commission: number;
    /** Beban barang hilang yang dipotong saat ditetapkan; dibayar = commission − deduction. */
    deduction: number;
    basis: DasarKomisi;
    lockedAt: string;
    paidAt: string | null;
    note: string | null;
  } | null;
  /** Sisa beban barang hilang SPG ini yang belum terpotong (rupiah) — 0 kalau tidak ada. */
  bebanHilangSisa: number;
};

export type TokoKomisiKantor = {
  storeId: string;
  nama: string;
  kode: string;
  aktif: boolean;
  potongToko: number;
  totalToko: number;
  baris: BarisKomisiKantor[];
  adaResmi: boolean;
  adaDibayar: boolean;
  semuaDibayar: boolean;
  /** Hitungan sekarang tidak sama dengan yang sudah ditetapkan. */
  berbeda: boolean;
};

export type TokoKonsiKomisi = { storeId: string; nama: string; kode: string; jumlahSpg: number; siklusId: string | null };

export type DaftarKomisiKantor = {
  periode: string;
  bulanSelesai: boolean;
  aturan: AturanKomisiPutus;
  toko: TokoKomisiKantor[];
  tokoKonsi: TokoKonsiKomisi[];
  ringkas: { totalHitung: number; totalResmi: number; totalDibayar: number; tokoBelum: number };
};

/**
 * Komisi SPG toko putus satu bulan WIB untuk kantor: setiap toko PUTUS yang
 * punya SPG bertugas, nota SPG bulan itu, atau baris resmi bulan itu. Toko
 * konsinyasi hanya didaftar dengan tautan ke siklusnya — komisinya dihitung
 * dan dibayar di sana.
 */
export async function daftarKomisiKantor(periode: string, sekarang: Date): Promise<DaftarKomisiKantor> {
  const { awal, akhir } = rentangBulanWib(periode);
  const [aturan, bertugas, berjualan, resmi] = await Promise.all([
    aturanKomisiPutus(),
    prisma.user.findMany({ where: { assignedStoreId: { not: null } }, select: { assignedStoreId: true } }),
    prisma.spgSale.findMany({ where: { createdAt: { gte: awal, lt: akhir } }, select: { storeId: true }, distinct: ["storeId"] }),
    prisma.spgCommission.findMany({
      where: { period: periode },
      select: { id: true, userId: true, storeId: true, unitsSold: true, commission: true, deduction: true, basis: true, lockedAt: true, paidAt: true, note: true },
    }),
  ]);

  const jumlahSpg = new Map<string, number>();
  for (const u of bertugas) if (u.assignedStoreId) jumlahSpg.set(u.assignedStoreId, (jumlahSpg.get(u.assignedStoreId) ?? 0) + 1);
  const ids = [...new Set([...jumlahSpg.keys(), ...berjualan.map((s) => s.storeId), ...resmi.map((r) => r.storeId)])];
  const tokoSemua = ids.length
    ? await prisma.store.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true, termsType: true, isActive: true } })
    : [];
  const putus = tokoSemua.filter((t) => t.termsType === "PUTUS").sort((a, b) => a.name.localeCompare(b.name));
  const konsi = tokoSemua.filter((t) => t.termsType === "KONSI" && (jumlahSpg.get(t.id) ?? 0) > 0).sort((a, b) => a.name.localeCompare(b.name));

  const resmiPerToko = new Map<string, typeof resmi>();
  for (const r of resmi) resmiPerToko.set(r.storeId, [...(resmiPerToko.get(r.storeId) ?? []), r]);
  const tambahan = new Map([...resmiPerToko].map(([storeId, rows]) => [storeId, rows.map((r) => r.userId)]));
  const [bahan, potongan] = await Promise.all([
    bahanKomisiToko(prisma, putus.map((t) => t.id), periode, tambahan),
    potonganKomisiToko({ db: prisma, storeIds: putus.map((t) => t.id), periode }),
  ]);
  const bebanHilang = await sisaBebanHilangPerOrang(
    prisma,
    [...bahan.values()].flatMap((b) => b.orang.map((o) => o.userId)).concat(resmi.map((r) => r.userId)),
  );

  const [th, bl] = periode.split("-").map(Number);
  const siklus = konsi.length
    ? await prisma.consignmentCycle.findMany({
        where: { storeId: { in: konsi.map((t) => t.id) }, periodYear: th, periodMonth: bl },
        select: { id: true, storeId: true },
      })
    : [];

  const toko: TokoKomisiKantor[] = putus.map((t) => {
    const hasil = hitungKomisiToko({ dasar: aturan.dasar, ...bahan.get(t.id)!, potongan: potongan.get(t.id) ?? [] });
    const rows = resmiPerToko.get(t.id) ?? [];
    const ada = rows.map(keBarisResmi);
    const perUser = new Map(rows.map((r) => [r.userId, r]));
    const baris: BarisKomisiKantor[] = hasil.perSpg.map((p) => {
      const r = perUser.get(p.userId);
      return {
        ...p,
        status: statusResmi(r ?? null),
        resmi: r
          ? {
              id: r.id,
              unitsSold: r.unitsSold,
              commission: angka(r.commission),
              deduction: angka(r.deduction),
              basis: r.basis === "PER_SPG" ? "PER_SPG" : "BAGI_RATA",
              lockedAt: r.lockedAt.toISOString(),
              paidAt: r.paidAt ? r.paidAt.toISOString() : null,
              note: r.note,
            }
          : null,
        bebanHilangSisa: bebanHilang.get(p.userId) ?? 0,
      };
    });
    return {
      storeId: t.id,
      nama: t.name,
      kode: t.code,
      aktif: t.isActive,
      potongToko: hasil.potongToko,
      totalToko: hasil.totalToko,
      baris,
      adaResmi: rows.length > 0,
      adaDibayar: rows.some((r) => r.paidAt !== null),
      semuaDibayar: rows.length > 0 && rows.every((r) => r.paidAt !== null),
      berbeda: sudahBerbeda(hasil, ada),
    };
  });

  const sumResmi = (f: (r: (typeof resmi)[number]) => boolean) =>
    resmi.filter((r) => f(r) && putus.some((t) => t.id === r.storeId)).reduce((n, r) => n + angka(r.commission), 0);

  return {
    periode,
    bulanSelesai: bulanSudahSelesai(periode, bulanWib(sekarang)),
    aturan,
    toko,
    tokoKonsi: konsi.map((t) => ({
      storeId: t.id,
      nama: t.name,
      kode: t.code,
      jumlahSpg: jumlahSpg.get(t.id) ?? 0,
      siklusId: siklus.find((s) => s.storeId === t.id)?.id ?? null,
    })),
    ringkas: {
      // Yang akan dibayar kalau ditetapkan sekarang: bagian penerima sesudah potongan.
      totalHitung: toko.reduce((n, t) => n + t.baris.reduce((m, b) => m + (b.penerima ? b.komisi : 0), 0), 0),
      totalResmi: sumResmi(() => true),
      // Uang yang benar-benar keluar: komisi dikurangi potongan beban barang hilang.
      totalDibayar: resmi
        .filter((r) => r.paidAt !== null && putus.some((t) => t.id === r.storeId))
        .reduce((n, r) => n + Math.max(0, angka(r.commission) - angka(r.deduction)), 0),
      tokoBelum: toko.filter((t) => !t.adaResmi && t.baris.some((b) => b.penerima)).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Antrean Beranda
// ---------------------------------------------------------------------------

/**
 * Toko PUTUS yang komisi SPG bulan `periode`-nya BELUM ditetapkan — definisi
 * yang sama dengan `ringkas.tokoBelum` di halaman Komisi SPG: toko tanpa satu
 * pun baris resmi bulan itu yang punya penerima (`hitungKomisiToko`): SPG yang
 * ditugaskan di sana, ditambah pada dasar PER_SPG siapa pun yang berjualan di
 * sana bulan itu. Tanpa menghitung rupiahnya — cukup untuk Beranda.
 */
export async function tokoKomisiPutusBelumDitetapkan(periode: string, db: Klien = prisma): Promise<string[]> {
  const { awal, akhir } = rentangBulanWib(periode);
  const [aturan, bertugas, berjualan, resmi] = await Promise.all([
    aturanKomisiPutus(db),
    db.user.findMany({ where: { assignedStoreId: { not: null } }, select: { assignedStoreId: true }, distinct: ["assignedStoreId"] }),
    db.spgSale.findMany({ where: { createdAt: { gte: awal, lt: akhir }, lines: { some: {} } }, select: { storeId: true }, distinct: ["storeId"] }),
    db.spgCommission.findMany({ where: { period: periode }, select: { storeId: true }, distinct: ["storeId"] }),
  ]);
  const berpenerima = new Set(bertugas.map((u) => u.assignedStoreId).filter((x): x is string => Boolean(x)));
  if (aturan.dasar === "PER_SPG") for (const s of berjualan) berpenerima.add(s.storeId);
  for (const r of resmi) berpenerima.delete(r.storeId);
  if (berpenerima.size === 0) return [];
  const putus = await db.store.findMany({ where: { id: { in: [...berpenerima] }, termsType: "PUTUS" }, select: { id: true } });
  return putus.map((t) => t.id);
}

/**
 * Angka baris Beranda "komisi SPG bulan lalu belum ditetapkan": nol saat
 * komisi toko putus dimatikan (menetapkan ditolak `KOMISI_MATI`).
 */
export async function jumlahKomisiPutusBelumDitetapkan(sekarang = new Date()): Promise<number> {
  const aturan = await aturanKomisiPutus();
  if (!aturan.aktif) return 0;
  return (await tokoKomisiPutusBelumDitetapkan(bulanSebelum(bulanWib(sekarang)))).length;
}
