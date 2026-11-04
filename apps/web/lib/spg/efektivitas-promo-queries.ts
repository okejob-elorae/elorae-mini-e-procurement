import { prisma, type Prisma } from "@elorae/db";
import { nilaiBersihSpg } from "@/lib/dashboard/tren";
import { promoNota, ringkasPromoKonter, type JenisPromoKonter } from "./promo-konter";
import { ENTITAS_PROMO_KONTER, JEJAK_PROMO_KONTER, statusPromoKonter, type StatusPromoKonter } from "./promo-konter-kantor";
import { keBentukPromo } from "./promo-konter-queries";
import {
  deretHarian,
  hitungKeranjang,
  hitungPelanggan,
  HARI_KEMBALI,
  HARI_MS,
  jendelaPromo,
  perToko,
  ringkasEfektivitas,
  sasaranDariTarget,
  type BarisJualPromo,
  type BarisRincianPromo,
  type Jendela,
  type JendelaPromo,
  type Keranjang,
  type KembaliPelanggan,
  type PelangganPromo,
  type PemakaianPromo,
  type PenjualanSasaran,
  type RingkasanEfektivitas,
  type SasaranPromo,
  type TitikHarian,
} from "./efektivitas-promo";

/**
 * Kueri efektivitas promo konter (layar kantor). Semua angka dari baris basis
 * data; aturannya di `efektivitas-promo.ts` (murni, teruji). Tanggal dikirim
 * sebagai ISO dan diformat di layar dengan `formatDisplayDate` (WIB).
 */

const angka = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const angkaAtauNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Layar ini untuk mengawasi; promo yang dibaca sekaligus dibatasi. */
const BATAS_PROMO = 500;

export type RentangEfektivitas = { dari: Date | null; sampai: Date | null };

const pilihPromo = {
  id: true,
  name: true,
  type: true,
  value: true,
  buyQty: true,
  freeQty: true,
  minSubtotal: true,
  allItems: true,
  allStores: true,
  startsAt: true,
  endsAt: true,
  priority: true,
  isActive: true,
  memberOnly: true,
  storeSharePercent: true,
  createdAt: true,
  updatedAt: true,
  targets: { select: { kind: true, refId: true, qty: true } },
} satisfies Prisma.CounterPromoSelect;

type BarisPromo = Prisma.CounterPromoGetPayload<{ select: typeof pilihPromo }>;

function ringkas(r: BarisPromo): string {
  const bentuk = keBentukPromo(r);
  return ringkasPromoKonter({
    type: r.type as JenisPromoKonter,
    value: angkaAtauNull(r.value),
    buyQty: r.buyQty,
    freeQty: r.freeQty,
    minSubtotal: angkaAtauNull(r.minSubtotal),
    komponen: bentuk?.komponen,
  });
}

/** Promo belanja (minimal belanja): pemakaiannya dihitung per nota, bukan per potong. */
const belanjaPromo = (type: string) => promoNota(type as JenisPromoKonter);

/**
 * Kapan promo yang KINI nonaktif dimatikan: jejak `COUNTER_PROMO_DEACTIVATED`
 * terakhir. Tanpa jejak, perubahan terakhir promo (`updatedAt`) dipakai dan
 * ditandai `dariPerubahan` — layar menyebutnya.
 */
async function waktuDimatikan(promos: readonly BarisPromo[]): Promise<Map<string, { waktu: Date; dariPerubahan: boolean }>> {
  const mati = promos.filter((p) => !p.isActive);
  const hasil = new Map<string, { waktu: Date; dariPerubahan: boolean }>();
  if (mati.length === 0) return hasil;
  const jejak = await prisma.auditLog.groupBy({
    by: ["entityId"],
    where: { entityType: ENTITAS_PROMO_KONTER, action: JEJAK_PROMO_KONTER.DIMATIKAN, entityId: { in: mati.map((p) => p.id) } },
    _max: { createdAt: true },
  });
  const per = new Map(jejak.map((j) => [j.entityId, j._max.createdAt]));
  for (const p of mati) {
    const w = per.get(p.id);
    hasil.set(p.id, w ? { waktu: w, dariPerubahan: false } : { waktu: p.updatedAt, dariPerubahan: true });
  }
  return hasil;
}

const waktuSaring = (j: Jendela): Prisma.DateTimeFilter => ({ gte: j.mulai, lt: j.akhir });

/** Baris nota SPG barang sasaran di toko sasaran, dalam W dan B. */
async function muatBaris(sasaran: SasaranPromo, j: JendelaPromo): Promise<BarisJualPromo[]> {
  if (!sasaran.semuaToko && sasaran.tokoIds.length === 0) return [];
  if (!sasaran.semuaBarang && sasaran.barangIds.length === 0 && sasaran.kategoriIds.length === 0) return [];
  const barang: Prisma.SpgSaleLineWhereInput = sasaran.semuaBarang
    ? {}
    : {
        OR: [
          ...(sasaran.barangIds.length ? [{ itemId: { in: [...sasaran.barangIds] } }] : []),
          ...(sasaran.kategoriIds.length ? [{ item: { categoryId: { in: [...sasaran.kategoriIds] } } }] : []),
        ],
      };
  const rows = await prisma.spgSaleLine.findMany({
    where: {
      ...barang,
      spgSale: {
        ...(sasaran.semuaToko ? {} : { storeId: { in: [...sasaran.tokoIds] } }),
        OR: [{ createdAt: waktuSaring(j.pembanding) }, { createdAt: waktuSaring(j.promo) }],
      },
    },
    select: {
      spgSaleId: true,
      itemId: true,
      qty: true,
      returnedQty: true,
      lineTotal: true,
      item: { select: { categoryId: true } },
      spgSale: { select: { storeId: true, createdAt: true } },
    },
  });
  return rows.map((r) => ({
    spgSaleId: r.spgSaleId,
    storeId: r.spgSale.storeId,
    itemId: r.itemId,
    categoryId: r.item.categoryId,
    waktu: r.spgSale.createdAt,
    qty: r.qty,
    returnedQty: r.returnedQty,
    lineTotal: angka(r.lineTotal),
  }));
}

/** Rincian potongan promo ini di W, beserta toko dan syarat tokonya. */
async function muatRincian(promoId: string, j: Jendela): Promise<BarisRincianPromo[]> {
  const rows = await prisma.spgSalePromo.findMany({
    where: { promoId, createdAt: waktuSaring(j) },
    select: { spgSaleId: true, kind: true, qty: true, discount: true, storeDiscount: true, createdAt: true },
  });
  if (rows.length === 0) return [];
  const nota = await prisma.spgSale.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.spgSaleId))] } },
    select: { id: true, storeId: true, store: { select: { termsType: true } } },
  });
  const per = new Map(nota.map((n) => [n.id, n]));
  return rows.flatMap((r) => {
    const n = per.get(r.spgSaleId);
    if (!n) return [];
    return [
      {
        spgSaleId: r.spgSaleId,
        storeId: n.storeId,
        termsType: String(n.store.termsType),
        waktu: r.createdAt,
        kind: r.kind,
        qty: r.qty,
        discount: angka(r.discount),
        storeDiscount: angka(r.storeDiscount),
      },
    ];
  });
}

/**
 * Nota lama (sebelum rincian dicatat) di W yang tercatat memakai promo ini —
 * lewat `SpgSaleLine.counterPromoId` atau `SpgSale.orderPromoId` — tanpa satu
 * pun baris rincian untuk promo ini. Tidak dihitung; jumlahnya disebut.
 */
async function muatNotaLama(promoId: string, j: Jendela, dariRincian: ReadonlySet<string>): Promise<string[]> {
  const rows = await prisma.spgSale.findMany({
    where: { createdAt: waktuSaring(j), OR: [{ orderPromoId: promoId }, { lines: { some: { counterPromoId: promoId } } }] },
    select: { id: true },
  });
  return rows.map((r) => r.id).filter((id) => !dariRincian.has(id));
}

// ---------------------------------------------------------------------------
// Tab "Efektivitas"
// ---------------------------------------------------------------------------

export type BarisEfektivitas = {
  id: string;
  name: string;
  ringkasan: string;
  status: StatusPromoKonter;
  belanja: boolean;
  /** Periode promo yang dihitung (ISO). */
  mulai: string;
  akhir: string;
  hari: number;
  dipotongRentang: boolean;
  masihBerjalan: boolean;
  pemakaian: PemakaianPromo;
  penjualan: PenjualanSasaran;
  biaya: number | null;
  biayaAlasan: RingkasanEfektivitas["biayaAlasan"];
  notaLama: number;
};

export type DaftarEfektivitas = { baris: BarisEfektivitas[]; terpotong: boolean };

/** Promo yang berjalan dalam rentang, dengan angka pokok efektivitasnya. Yang mulai paling akhir dulu. */
export async function daftarEfektivitasPromo(rentang: RentangEfektivitas, opsi: { sekarang?: Date; promoIds?: string[] } = {}): Promise<DaftarEfektivitas> {
  const sekarang = opsi.sekarang ?? new Date();
  if (opsi.promoIds && opsi.promoIds.length === 0) return { baris: [], terpotong: false };
  const promos = await prisma.counterPromo.findMany({
    where: {
      ...(opsi.promoIds ? { id: { in: opsi.promoIds } } : {}),
      // Kasar di basis data, tepat di `jendelaPromo`: yang berakhir sebelum rentang dibuang.
      ...(rentang.dari ? { OR: [{ endsAt: null }, { endsAt: { gte: rentang.dari } }] } : {}),
    },
    select: pilihPromo,
    orderBy: [{ createdAt: "desc" }],
    take: BATAS_PROMO + 1,
  });
  const terpotong = promos.length > BATAS_PROMO;
  const dibaca = promos.slice(0, BATAS_PROMO);
  const mati = await waktuDimatikan(dibaca);
  const berjalan = dibaca
    .map((p) => ({ p, j: jendelaPromo({ ...p, berhentiPada: mati.get(p.id)?.waktu ?? null }, sekarang, rentang) }))
    .filter((x): x is { p: BarisPromo; j: JendelaPromo } => x.j !== null);

  const baris = await Promise.all(
    berjalan.map(async ({ p, j }) => {
      const sasaran = sasaranDariTarget(p);
      const belanja = belanjaPromo(p.type);
      const [jual, rincian] = await Promise.all([muatBaris(sasaran, j), muatRincian(p.id, j.promo)]);
      const lama = await muatNotaLama(p.id, j.promo, new Set(rincian.map((r) => r.spgSaleId)));
      const r = ringkasEfektivitas({ sasaran, jendela: j, baris: jual, rincian, belanja });
      return {
        id: p.id,
        name: p.name,
        ringkasan: ringkas(p),
        status: statusPromoKonter(p, sekarang),
        belanja,
        mulai: j.promo.mulai.toISOString(),
        akhir: j.promo.akhir.toISOString(),
        hari: j.hari,
        dipotongRentang: j.dipotongRentang,
        masihBerjalan: j.masihBerjalan,
        pemakaian: r.pemakaian,
        penjualan: r.penjualan,
        biaya: r.biaya,
        biayaAlasan: r.biayaAlasan,
        notaLama: lama.length,
      } satisfies BarisEfektivitas;
    }),
  );
  baris.sort((a, b) => (a.mulai < b.mulai ? 1 : a.mulai > b.mulai ? -1 : a.name.localeCompare(b.name, "id")));
  return { baris, terpotong };
}

// ---------------------------------------------------------------------------
// Halaman hasil satu promo
// ---------------------------------------------------------------------------

export type JendelaTampil = { mulai: string; akhir: string };

export type TokoHasil = {
  storeId: string;
  nama: string;
  termsType: string;
  pemakaian: PemakaianPromo;
  penjualan: PenjualanSasaran;
};

export type KembaliTampil =
  | { dinilai: true; pembeli: number; persen: number | null; sampai: string }
  | { dinilai: false; sejak: string; masihBerjalan: boolean };

export type HasilEfektivitas = {
  promo: {
    id: string;
    name: string;
    ringkasan: string;
    status: StatusPromoKonter;
    belanja: boolean;
    memberOnly: boolean;
    semuaToko: boolean;
    jumlahToko: number;
    semuaBarang: boolean;
    jumlahBarang: number;
    jumlahKategori: number;
    adaKategori: boolean;
  };
  /** Null = promo tidak berjalan di rentang itu (atau belum mulai). */
  hasil: null | {
    promo: JendelaTampil;
    pembanding: JendelaTampil;
    mulaiPromo: string;
    hari: number;
    dipotongRentang: boolean;
    masihBerjalan: boolean;
    berhentiDimatikan: boolean;
    /** Waktu dimatikan tidak tercatat; periode berhenti di perubahan terakhir promo. */
    akhirDariPerubahan: boolean;
    pemakaian: PemakaianPromo;
    penjualan: PenjualanSasaran;
    biaya: number | null;
    biayaAlasan: RingkasanEfektivitas["biayaAlasan"];
    keranjang: Keranjang;
    pelanggan: Omit<PelangganPromo, "kembali"> & { kembali: KembaliTampil };
    harian: TitikHarian[];
    perToko: TokoHasil[];
    notaLama: number;
  };
};

function keTampil(j: Jendela): JendelaTampil {
  return { mulai: j.mulai.toISOString(), akhir: j.akhir.toISOString() };
}

function kembaliTampil(k: KembaliPelanggan): KembaliTampil {
  return k.dinilai
    ? { dinilai: true, pembeli: k.pembeli, persen: k.persen, sampai: k.sampai.toISOString() }
    : { dinilai: false, sejak: k.sejak.toISOString(), masihBerjalan: k.masihBerjalan };
}

/** Nomor pembeli per nota: dari pelanggan toko, atau — kalau tidak ada — dari member. */
async function nomorPembeli(nota: readonly { id: string; customerId: string | null; memberId: string | null }[]): Promise<Map<string, string>> {
  const pelangganIds = [...new Set(nota.map((n) => n.customerId).filter((x): x is string => !!x))];
  const memberIds = [...new Set(nota.filter((n) => !n.customerId && n.memberId).map((n) => n.memberId as string))];
  const [pelanggan, member] = await Promise.all([
    pelangganIds.length ? prisma.storeCustomer.findMany({ where: { id: { in: pelangganIds } }, select: { id: true, phone: true } }) : [],
    memberIds.length ? prisma.member.findMany({ where: { id: { in: memberIds } }, select: { id: true, phone: true } }) : [],
  ]);
  const hpPelanggan = new Map(pelanggan.map((p) => [p.id, p.phone]));
  const hpMember = new Map(member.map((m) => [m.id, m.phone]));
  const hasil = new Map<string, string>();
  for (const n of nota) {
    const hp = (n.customerId && hpPelanggan.get(n.customerId)) || (n.memberId && hpMember.get(n.memberId)) || null;
    if (hp) hasil.set(n.id, hp);
  }
  return hasil;
}

/** Nomor (dari daftar) yang punya nota SPG di toko mana pun dalam rentang waktu. */
async function nomorBernota(phones: readonly string[], waktu: Prisma.DateTimeFilter): Promise<Set<string>> {
  const hasil = new Set<string>();
  if (phones.length === 0) return hasil;
  const pelanggan = await prisma.storeCustomer.findMany({ where: { phone: { in: [...phones] } }, select: { id: true, phone: true } });
  if (pelanggan.length === 0) return hasil;
  const hp = new Map(pelanggan.map((p) => [p.id, p.phone]));
  const ada = await prisma.spgSale.groupBy({ by: ["customerId"], where: { customerId: { in: pelanggan.map((p) => p.id) }, createdAt: waktu } });
  for (const a of ada) {
    const p = a.customerId ? hp.get(a.customerId) : undefined;
    if (p) hasil.add(p);
  }
  return hasil;
}

export async function hasilEfektivitasPromo(
  id: string,
  opsi: { rentang?: RentangEfektivitas | null; sekarang?: Date } = {},
): Promise<HasilEfektivitas | null> {
  if (!id) return null;
  const sekarang = opsi.sekarang ?? new Date();
  const p = await prisma.counterPromo.findUnique({ where: { id }, select: pilihPromo });
  if (!p) return null;
  const sasaran = sasaranDariTarget(p);
  const belanja = belanjaPromo(p.type);
  const mati = (await waktuDimatikan([p])).get(p.id) ?? null;
  const j = jendelaPromo({ ...p, berhentiPada: mati?.waktu ?? null }, sekarang, opsi.rentang ?? null);
  const kepala: HasilEfektivitas["promo"] = {
    id: p.id,
    name: p.name,
    ringkasan: ringkas(p),
    status: statusPromoKonter(p, sekarang),
    belanja,
    memberOnly: p.memberOnly,
    semuaToko: sasaran.semuaToko,
    jumlahToko: sasaran.tokoIds.length,
    semuaBarang: sasaran.semuaBarang,
    jumlahBarang: sasaran.barangIds.length,
    jumlahKategori: sasaran.kategoriIds.length,
    adaKategori: sasaran.kategoriIds.length > 0,
  };
  if (!j) return { promo: kepala, hasil: null };

  const [jual, rincian, tokoBernota] = await Promise.all([
    muatBaris(sasaran, j),
    muatRincian(p.id, j.promo),
    sasaran.semuaToko
      ? prisma.spgSale
          .groupBy({ by: ["storeId"], where: { OR: [{ createdAt: waktuSaring(j.pembanding) }, { createdAt: waktuSaring(j.promo) }] } })
          .then((g) => g.map((x) => x.storeId))
      : Promise.resolve([...sasaran.tokoIds]),
  ]);
  const notaPakai = new Set(rincian.map((r) => r.spgSaleId));
  const lama = await muatNotaLama(p.id, j.promo, notaPakai);

  // Keranjang: semua nota di toko sasaran selama promo.
  const notaToko = await prisma.spgSale.findMany({
    where: { createdAt: waktuSaring(j.promo), ...(sasaran.semuaToko ? {} : { storeId: { in: [...sasaran.tokoIds] } }) },
    select: {
      id: true,
      storeId: true,
      createdAt: true,
      total: true,
      lines: { where: { returnedQty: { gt: 0 } }, select: { qty: true, returnedQty: true, unitPrice: true, lineTotal: true } },
    },
  });
  const keranjang = hitungKeranjang(
    notaToko.map((n) => ({ id: n.id, storeId: n.storeId, waktu: n.createdAt, nilaiBersih: nilaiBersihSpg(n.total, n.lines) })),
    { sasaran, jendela: j.promo, pakai: notaPakai, lama: new Set(lama) },
  );

  // Pelanggan: pembeli nota promo, dikenali dari nomornya.
  const notaPromo = notaPakai.size
    ? await prisma.spgSale.findMany({ where: { id: { in: [...notaPakai] } }, select: { id: true, customerId: true, memberId: true } })
    : [];
  const hp = await nomorPembeli(notaPromo);
  const nomor = [...new Set(hp.values())];
  const batasKembali = new Date(j.promo.akhir.getTime() + HARI_KEMBALI * HARI_MS);
  const bisaKembali = !j.masihBerjalan && batasKembali.getTime() <= sekarang.getTime();
  const [adaSebelum, adaSesudah] = await Promise.all([
    nomorBernota(nomor, { lt: j.promo.mulai }),
    bisaKembali ? nomorBernota(nomor, { gte: j.promo.akhir, lt: batasKembali }) : Promise.resolve(new Set<string>()),
  ]);
  const pelanggan = hitungPelanggan({
    notaPromo: notaPromo.map((n) => ({ id: n.id, phone: hp.get(n.id) ?? null, member: n.memberId !== null })),
    adaSebelum,
    adaSesudah,
    jendela: j,
    sekarang,
  });

  const toko = await prisma.store.findMany({
    where: { id: { in: [...new Set([...tokoBernota, ...rincian.map((r) => r.storeId)])] } },
    select: { id: true, name: true, termsType: true },
  });
  const namaToko = new Map(toko.map((t) => [t.id, t]));
  const ring = ringkasEfektivitas({ sasaran, jendela: j, baris: jual, rincian, belanja });

  return {
    promo: kepala,
    hasil: {
      promo: keTampil(j.promo),
      pembanding: keTampil(j.pembanding),
      mulaiPromo: j.mulaiPromo.toISOString(),
      hari: j.hari,
      dipotongRentang: j.dipotongRentang,
      masihBerjalan: j.masihBerjalan,
      berhentiDimatikan: j.berhentiDimatikan,
      akhirDariPerubahan: j.berhentiDimatikan && mati?.dariPerubahan === true,
      pemakaian: ring.pemakaian,
      penjualan: ring.penjualan,
      biaya: ring.biaya,
      biayaAlasan: ring.biayaAlasan,
      keranjang,
      pelanggan: { ...pelanggan, kembali: kembaliTampil(pelanggan.kembali) },
      harian: deretHarian(jual, sasaran, j),
      perToko: perToko({ sasaran, jendela: j, baris: jual, rincian, belanja, tokoBernota: [...tokoBernota, ...rincian.map((r) => r.storeId)] }).map((t) => ({
        ...t,
        nama: namaToko.get(t.storeId)?.name ?? "—",
        termsType: String(namaToko.get(t.storeId)?.termsType ?? ""),
      })),
      notaLama: lama.length,
    },
  };
}
