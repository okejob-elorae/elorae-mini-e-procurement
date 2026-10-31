import { prisma } from "@elorae/db";
import { cocokCari, potongHalaman, type Halaman } from "@/app/backoffice/piutang/_daftar/halaman";
import { bacaAturanMemberDb, keadaanMemberPerNomor } from "./member-queries";
import { samarkanHp } from "./pelanggan";
import {
  gabungRingkas,
  hariSejak,
  hitungSaringPelanggan,
  jendelaPeriode,
  kategoriFavorit,
  ringkasLacak,
  saringPelanggan,
  statusPelanggan,
  urutkanMember,
  urutkanPelanggan,
  type BarisMemberKantor,
  type BarisPelangganLacak,
  type HitungSaringPelanggan,
  type MasukanPelangganRingkas,
  type RingkasLacak,
  type SaringMember,
  type SaringStatusMember,
  type StatusPelanggan,
} from "./pelanggan-lacak";
import { STATUS_TITIP_TERBUKA } from "./titip";

/**
 * Data pembeli untuk layar kantor (`/backoffice/spg-pelanggan`, `spg_sales:view`).
 *
 * Nomor HP pembeli TIDAK PERNAH keluar dari sini utuh — selalu disamarkan
 * (`0812****7890`), dan pencarian hanya mencocokkan nama dan bentuk samaran,
 * jadi kantor tidak bisa menebak nomor dengan mencari. Yang menghubungi
 * pembeli adalah SPG tokonya, dari HP-nya.
 *
 * Belanja = nilai nota sesudah potongan, dikurangi barang yang sudah
 * dikembalikan pembeli (harga bersih per potong, seperti dasbor). Aturan
 * status (baru/aktif/tidur), cakupan dan "kembali" ada di `pelanggan-lacak.ts`.
 */

const bulat = (n: number) => Math.round(n * 100) / 100;

/** Nilai potong yang dikembalikan, per nota: `returnedQty × lineTotal/qty` (baris lama: unitPrice). */
function nilaiKembali(l: { qty: number; returnedQty: number; unitPrice: unknown; lineTotal: unknown }): number {
  const harga = l.qty > 0 ? Number(l.lineTotal) / l.qty : Number(l.unitPrice);
  return l.returnedQty * (Number.isFinite(harga) ? harga : 0);
}

type SaringNota = { storeId?: string; createdAt?: { gte: Date; lt: Date } };

/** Nilai barang yang dikembalikan pembeli, per toko atau per pelanggan, dari nota yang mencatat pembeli. */
async function nilaiKembaliPer(kunci: "storeId" | "customerId", where: SaringNota): Promise<Map<string, number>> {
  const baris = await prisma.spgSaleLine.findMany({
    where: { returnedQty: { gt: 0 }, spgSale: { customerId: { not: null }, ...where } },
    select: { qty: true, returnedQty: true, unitPrice: true, lineTotal: true, spgSale: { select: { storeId: true, customerId: true } } },
  });
  const m = new Map<string, number>();
  for (const l of baris) {
    const k = kunci === "storeId" ? l.spgSale.storeId : (l.spgSale.customerId as string);
    m.set(k, (m.get(k) ?? 0) + nilaiKembali(l));
  }
  return m;
}

export type PeriodeTampil = { hari: number; hariAwal: string; hariAkhir: string };

// ─── Ringkasan per toko ──────────────────────────────────────────────────────

export type RingkasLacakToko = RingkasLacak & {
  storeId: string;
  toko: string;
  kode: string;
  /** Belanja bersih nota berpembeli di dalam periode. */
  belanjaPeriode: number;
  belanjaTerakhir: string | null;
};

export type DataRingkasPelanggan = {
  periode: PeriodeTampil;
  hariTidur: number;
  semua: RingkasLacak & { belanjaPeriode: number };
  toko: RingkasLacakToko[];
};

/**
 * Ringkasan pelacakan per toko dan semua toko. Toko masuk daftar kalau punya
 * pelanggan tercatat atau nota SPG di dalam periode — toko yang menjual tanpa
 * mencatat pembeli tampil dengan cakupan 0%, bukan hilang.
 */
export async function ringkasPelangganKantor(m: { sekarang?: Date; periodeHari: number }): Promise<DataRingkasPelanggan> {
  const sekarang = m.sekarang ?? new Date();
  const jendela = jendelaPeriode(sekarang, m.periodeHari);
  const dalam = { gte: jendela.awal, lt: jendela.akhir };
  const [aturan, pelanggan, notaSemua, notaPeriode, notaToko, notaTokoPembeli, memberAktif, kembali] = await Promise.all([
    bacaAturanMemberDb(),
    prisma.storeCustomer.findMany({ select: { id: true, storeId: true, phone: true } }),
    prisma.spgSale.groupBy({ by: ["customerId"], where: { customerId: { not: null } }, _count: { _all: true }, _min: { createdAt: true }, _max: { createdAt: true } }),
    prisma.spgSale.groupBy({ by: ["customerId"], where: { customerId: { not: null }, createdAt: dalam }, _count: { _all: true } }),
    prisma.spgSale.groupBy({ by: ["storeId"], where: { createdAt: dalam }, _count: { _all: true } }),
    prisma.spgSale.groupBy({ by: ["storeId"], where: { createdAt: dalam, customerId: { not: null } }, _count: { _all: true }, _sum: { total: true } }),
    prisma.member.findMany({ where: { isActive: true }, select: { phone: true } }),
    nilaiKembaliPer("storeId", { createdAt: dalam }),
  ]);
  const semuaPer = new Map(notaSemua.map((n) => [n.customerId as string, n]));
  const periodePer = new Map(notaPeriode.map((n) => [n.customerId as string, n._count._all]));
  const notaTokoPer = new Map(notaToko.map((n) => [n.storeId, n._count._all]));
  const pembeliTokoPer = new Map(notaTokoPembeli.map((n) => [n.storeId, n]));
  const nomorMember = new Set(memberAktif.map((x) => x.phone));

  const perToko = new Map<string, MasukanPelangganRingkas[]>();
  const terakhirToko = new Map<string, Date>();
  for (const p of pelanggan) {
    const n = semuaPer.get(p.id);
    const isi: MasukanPelangganRingkas = {
      phone: p.phone,
      nota: n?._count._all ?? 0,
      pertama: n?._min.createdAt ?? null,
      terakhir: n?._max.createdAt ?? null,
      notaPeriode: periodePer.get(p.id) ?? 0,
    };
    const daftar = perToko.get(p.storeId) ?? [];
    daftar.push(isi);
    perToko.set(p.storeId, daftar);
    const t = terakhirToko.get(p.storeId);
    if (isi.terakhir && (!t || isi.terakhir > t)) terakhirToko.set(p.storeId, isi.terakhir);
  }

  const storeIds = [...new Set([...perToko.keys(), ...notaTokoPer.keys()])];
  const toko = storeIds.length ? await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true, code: true } }) : [];
  const tokoPer = new Map(toko.map((t) => [t.id, t]));

  const baris: RingkasLacakToko[] = storeIds
    .map((storeId) => {
      const pb = pembeliTokoPer.get(storeId);
      const r = ringkasLacak({
        pelanggan: perToko.get(storeId) ?? [],
        notaPeriode: notaTokoPer.get(storeId) ?? 0,
        notaBerpembeli: pb?._count._all ?? 0,
        memberAktif: nomorMember,
        sekarang,
        awalPeriode: jendela.awal,
        hariTidur: aturan.hariTidur,
      });
      const t = tokoPer.get(storeId);
      return {
        ...r,
        storeId,
        toko: t?.name ?? "—",
        kode: t?.code ?? "",
        belanjaPeriode: Math.max(0, bulat(Number(pb?._sum.total ?? 0) - (kembali.get(storeId) ?? 0))),
        belanjaTerakhir: terakhirToko.get(storeId)?.toISOString() ?? null,
      };
    })
    .sort((a, b) => b.pelanggan - a.pelanggan || b.notaPeriode - a.notaPeriode || a.toko.localeCompare(b.toko, "id"));

  return {
    periode: { hari: jendela.hari, hariAwal: jendela.hariAwal, hariAkhir: jendela.hariAkhir },
    hariTidur: aturan.hariTidur,
    semua: { ...gabungRingkas(baris, nomorMember.size), belanjaPeriode: bulat(baris.reduce((s, b) => s + b.belanjaPeriode, 0)) },
    toko: baris,
  };
}

// ─── Pelanggan satu toko ─────────────────────────────────────────────────────

export type DataPelangganToko = {
  toko: { id: string; name: string; code: string };
  periode: PeriodeTampil;
  hariTidur: number;
  ringkas: RingkasLacak;
  /** Angka tombol saring — mengikuti kotak cari. */
  hitung: HitungSaringPelanggan;
  halaman: Halaman<BarisPelangganLacak>;
};

/**
 * Pelanggan satu toko untuk kantor: dihitung untuk SEMUA pelanggan toko itu
 * (status dan saringan butuh semuanya), lalu disaring dan dipotong per halaman
 * di server — peramban hanya menerima satu halaman. null = tokonya tidak ada.
 */
export async function pelangganTokoKantor(
  storeId: string,
  m: { sekarang?: Date; periodeHari: number; cari?: string; status?: StatusPelanggan | null; member?: SaringMember | null; halaman?: number },
): Promise<DataPelangganToko | null> {
  const sekarang = m.sekarang ?? new Date();
  const jendela = jendelaPeriode(sekarang, m.periodeHari);
  const dalam = { gte: jendela.awal, lt: jendela.akhir };
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true, code: true } });
  if (!toko) return null;

  const berpembeli = { storeId, customerId: { not: null } };
  const [aturan, rows, nota, notaPeriode, notaToko, titip, kembali, lines] = await Promise.all([
    bacaAturanMemberDb(),
    prisma.storeCustomer.findMany({ where: { storeId }, select: { id: true, name: true, phone: true, createdAt: true } }),
    prisma.spgSale.groupBy({
      by: ["customerId"],
      where: berpembeli,
      _count: { _all: true },
      _sum: { total: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.spgSale.groupBy({ by: ["customerId"], where: { ...berpembeli, createdAt: dalam }, _count: { _all: true } }),
    prisma.spgSale.count({ where: { storeId, createdAt: dalam } }),
    prisma.customerRequest.groupBy({ by: ["customerId"], where: { storeId, status: { in: [...STATUS_TITIP_TERBUKA] } }, _count: { _all: true } }),
    nilaiKembaliPer("customerId", { storeId }),
    prisma.spgSaleLine.findMany({
      where: { spgSale: berpembeli },
      select: { qty: true, returnedQty: true, item: { select: { category: { select: { name: true } } } }, spgSale: { select: { customerId: true } } },
    }),
  ]);
  const keadaan = await keadaanMemberPerNomor(
    rows.map((r) => r.phone),
    { aturan, waktu: sekarang },
  );
  // Nota yang menunjuk pelanggan yang sudah tidak ada tetap nota berpembeli.
  const notaBerpembeli = notaPeriode.reduce((s, n) => s + n._count._all, 0);

  const notaPer = new Map(nota.map((n) => [n.customerId as string, n]));
  const periodePer = new Map(notaPeriode.map((n) => [n.customerId as string, n._count._all]));
  const titipPer = new Map(titip.map((t) => [t.customerId, t._count._all]));
  const barangPer = new Map<string, { kategori: string | null; qty: number; kembali: number }[]>();
  for (const l of lines) {
    const id = l.spgSale.customerId as string;
    const daftar = barangPer.get(id) ?? [];
    daftar.push({ kategori: l.item?.category?.name ?? null, qty: l.qty, kembali: l.returnedQty });
    barangPer.set(id, daftar);
  }
  const memberAktif = new Set([...keadaan].filter(([, k]) => k.aktif).map(([phone]) => phone));

  const masukan: MasukanPelangganRingkas[] = [];
  const semua: BarisPelangganLacak[] = rows.map((r) => {
    const n = notaPer.get(r.id);
    const isi: MasukanPelangganRingkas = {
      phone: r.phone,
      nota: n?._count._all ?? 0,
      pertama: n?._min.createdAt ?? null,
      terakhir: n?._max.createdAt ?? null,
      notaPeriode: periodePer.get(r.id) ?? 0,
    };
    masukan.push(isi);
    const belanja = Math.max(0, bulat(Number(n?._sum.total ?? 0) - (kembali.get(r.id) ?? 0)));
    const k = keadaan.get(r.phone);
    return {
      id: r.id,
      nama: r.name,
      hpSamar: samarkanHp(r.phone),
      dicatat: r.createdAt.toISOString(),
      member: k ? { tingkat: k.tingkat, aktif: k.aktif } : null,
      nota: isi.nota,
      belanja,
      rataNota: isi.nota > 0 ? bulat(belanja / isi.nota) : null,
      pertama: isi.pertama?.toISOString() ?? null,
      terakhir: isi.terakhir?.toISOString() ?? null,
      hariSejak: isi.terakhir ? hariSejak(isi.terakhir, sekarang) : null,
      status: statusPelanggan(isi, { sekarang, awalPeriode: jendela.awal, hariTidur: aturan.hariTidur }),
      favorit: kategoriFavorit(barangPer.get(r.id) ?? []),
      titipTerbuka: titipPer.get(r.id) ?? 0,
    };
  });

  const ringkas = ringkasLacak({
    pelanggan: masukan,
    notaPeriode: notaToko,
    notaBerpembeli,
    memberAktif,
    sekarang,
    awalPeriode: jendela.awal,
    hariTidur: aturan.hariTidur,
  });
  const dicari = urutkanPelanggan(semua.filter((b) => cocokCari(m.cari ?? "", b.nama, b.hpSamar)));
  return {
    toko,
    periode: { hari: jendela.hari, hariAwal: jendela.hariAwal, hariAkhir: jendela.hariAkhir },
    hariTidur: aturan.hariTidur,
    ringkas,
    hitung: hitungSaringPelanggan(dicari),
    halaman: potongHalaman(saringPelanggan(dicari, { status: m.status ?? null, member: m.member ?? null }), m.halaman ?? 1),
  };
}

// ─── Member seluruh Elorae ───────────────────────────────────────────────────

export type DataMemberKantor = {
  periodeBulan: number;
  hitung: { semua: number; aktif: number; nonaktif: number };
  halaman: Halaman<BarisMemberKantor>;
};

/**
 * Daftar member Elorae (semua toko). Tingkat dan belanja periode dari
 * `keadaanMemberPerNomor` — angka yang sama dengan yang dipakai nota. "Belanja
 * di" = toko tempat nomor ini punya nota, dari pelanggan toko bernomor sama.
 */
export async function memberKantor(m: { sekarang?: Date; cari?: string; status?: SaringStatusMember | null; halaman?: number }): Promise<DataMemberKantor> {
  const sekarang = m.sekarang ?? new Date();
  const [aturan, member] = await Promise.all([
    bacaAturanMemberDb(),
    prisma.member.findMany({
      select: { id: true, phone: true, name: true, joinedAt: true, joinedStoreId: true, isActive: true, deactivatedAt: true },
    }),
  ]);
  const phones = member.map((x) => x.phone);
  const [keadaan, pelanggan] = phones.length
    ? await Promise.all([
        keadaanMemberPerNomor(phones, { aturan, waktu: sekarang }),
        prisma.storeCustomer.findMany({ where: { phone: { in: phones } }, select: { id: true, storeId: true, phone: true } }),
      ])
    : [new Map(), []];
  const beli = pelanggan.length
    ? await prisma.spgSale.groupBy({ by: ["customerId"], where: { customerId: { in: pelanggan.map((p) => p.id) } }, _count: { _all: true } })
    : [];
  const adaNota = new Set(beli.map((b) => b.customerId as string));
  const tokoBelanja = new Map<string, Set<string>>();
  for (const p of pelanggan) {
    if (!adaNota.has(p.id)) continue;
    const s = tokoBelanja.get(p.phone) ?? new Set<string>();
    s.add(p.storeId);
    tokoBelanja.set(p.phone, s);
  }
  const storeIds = [...new Set([...member.map((x) => x.joinedStoreId), ...[...tokoBelanja.values()].flatMap((s) => [...s])])];
  const toko = storeIds.length ? await prisma.store.findMany({ where: { id: { in: storeIds } }, select: { id: true, name: true } }) : [];
  const namaToko = new Map(toko.map((t) => [t.id, t.name]));

  const semua: BarisMemberKantor[] = member.map((x) => {
    const k = keadaan.get(x.phone);
    return {
      id: x.id,
      nama: x.name,
      hpSamar: samarkanHp(x.phone),
      tingkat: k?.tingkat ?? aturan.tingkat[0].nama,
      kodeTingkat: k?.kodeTingkat ?? aturan.tingkat[0].kode,
      belanjaPeriode: k?.belanjaPeriode ?? 0,
      toko: [...(tokoBelanja.get(x.phone) ?? [])]
        .map((id) => ({ id, nama: namaToko.get(id) ?? "—" }))
        .sort((a, b) => a.nama.localeCompare(b.nama, "id")),
      bergabung: x.joinedAt.toISOString(),
      tokoBergabung: namaToko.get(x.joinedStoreId) ?? "—",
      aktif: x.isActive,
      nonaktifSejak: x.deactivatedAt?.toISOString() ?? null,
    };
  });
  const dicari = urutkanMember(semua.filter((b) => cocokCari(m.cari ?? "", b.nama, b.hpSamar)));
  const aktif = dicari.filter((b) => b.aktif).length;
  const tersaring = m.status ? dicari.filter((b) => b.aktif === (m.status === "aktif")) : dicari;
  return {
    periodeBulan: aturan.periodeBulan,
    hitung: { semua: dicari.length, aktif, nonaktif: dicari.length - aktif },
    halaman: potongHalaman(tersaring, m.halaman ?? 1),
  };
}
