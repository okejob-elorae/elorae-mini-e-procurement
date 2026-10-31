import { prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import { nilaiBarisHilang } from "@/lib/spg/hilang-db";
import { gerakLakuBersih } from "@/lib/spg/laku-bersih";
import { AKSI_PINDAH_TOKO } from "@/lib/stores/penanggung-jawab-writer";
import {
  kunciBulanSiklus,
  laporanSiklusDipakai,
  nilaiLaku,
  pemegangPada,
  pemilikOmzetKonsi,
  pengirimPada,
  tanggalLaporanSiklus,
  type BarisLakuKonsi,
  type GantiPemegang,
  type KirimanKonsi,
} from "./penjualan-konsi";

/**
 * Kueri omzet konsinyasi salesman — barang LAKU di toko konsinyasi yang ia
 * pegang saat barang itu laku. Aturannya (sumber, tanggal, harga, pemilik) di `penjualan-konsi.ts`;
 * di sini hanya mengambil bahannya. Satu-satunya sumber baris konsi untuk
 * `penjualanSalesman` (komisi, target, peringkat, rincian sales) dan untuk pcs
 * konsi di HP.
 *
 * Client screens hanya boleh `import type` dari berkas ini (memuat Prisma).
 */

type TokoKonsi = {
  id: string;
  markupPercent: unknown;
  /** Pemilik omzet laku toko ini pada saat `t` (bisa salesman di luar yang diminta). */
  pemilikPada: (t: Date) => string | null;
};

/** Nama tindakan jejak pindah pemegang toko — diambil dari penulisnya, bukan disalin. */
const JEJAK_PINDAH_PEMEGANG = AKSI_PINDAH_TOKO;

/** `changes` jejak sebagai objek — kolom JSON bisa saja terbaca sebagai teks. */
function objekJejak(changes: unknown): { before?: { salesmanId?: unknown }; after?: { salesmanId?: unknown } } | null {
  let x = changes;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return x && typeof x === "object" ? (x as { before?: { salesmanId?: unknown }; after?: { salesmanId?: unknown } }) : null;
}

function sebelumDariJejak(changes: unknown): string | null {
  const before = objekJejak(changes)?.before;
  return typeof before?.salesmanId === "string" && before.salesmanId ? before.salesmanId : null;
}

function sesudahDariJejak(changes: unknown): string | null {
  const after = objekJejak(changes)?.after;
  return typeof after?.salesmanId === "string" && after.salesmanId ? after.salesmanId : null;
}

/**
 * Toko KONSI yang omzet lakunya BISA milik salah satu `salesmanIds`: pernah
 * atau sedang ia pegang (jejak pindah pemegang), atau pernah tanpa pemegang
 * dan ia pernah mengirim konsi ke sana. Pemilik per saat laku dihitung
 * `pemilikPada` — aturannya di `penjualan-konsi.ts`.
 */
async function tokoKonsiMilik(salesmanIds: readonly string[]): Promise<TokoKonsi[]> {
  const ids = new Set(salesmanIds);
  const toko = await prisma.store.findMany({
    where: { termsType: "KONSI" },
    select: { id: true, salesmanId: true, markupPercent: true },
  });
  if (toko.length === 0) return [];
  const storeIds = toko.map((t) => t.id);
  const [jejak, kiriman] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: JEJAK_PINDAH_PEMEGANG, entityType: "Store", entityId: { in: storeIds } },
      select: { entityId: true, createdAt: true, changes: true },
    }),
    prisma.fieldSalesOrder.findMany({
      where: { storeId: { in: storeIds }, orderType: "KONSI", status: "APPROVED", approvedAt: { not: null } },
      select: { storeId: true, salesmanId: true, approvedAt: true },
    }),
  ]);
  const riwayat = new Map<string, GantiPemegang[]>();
  const pernahPegang = new Map<string, Set<string>>();
  const catat = <T,>(peta: Map<string, T[]>, k: string, v: T) => {
    const d = peta.get(k);
    if (d) d.push(v);
    else peta.set(k, [v]);
  };
  for (const j of jejak) {
    catat(riwayat, j.entityId, { pada: j.createdAt, sebelum: sebelumDariJejak(j.changes) });
    const orang = pernahPegang.get(j.entityId) ?? new Set<string>();
    for (const x of [sebelumDariJejak(j.changes), sesudahDariJejak(j.changes)]) if (x) orang.add(x);
    pernahPegang.set(j.entityId, orang);
  }
  const kirimPerToko = new Map<string, KirimanKonsi[]>();
  for (const k of kiriman) catat(kirimPerToko, k.storeId, { pada: k.approvedAt as Date, salesmanId: k.salesmanId });

  return toko.flatMap((t) => {
    const r = riwayat.get(t.id) ?? [];
    const kirim = kirimPerToko.get(t.id) ?? [];
    // Pernah tanpa pemegang = sekarang kosong, atau ada jejak dengan "sebelum" kosong.
    const pernahKosong = !t.salesmanId || r.some((g) => !g.sebelum);
    const mungkin = new Set<string>([...(pernahPegang.get(t.id) ?? []), ...(t.salesmanId ? [t.salesmanId] : [])]);
    if (pernahKosong) for (const k of kirim) mungkin.add(k.salesmanId);
    if (![...mungkin].some((x) => ids.has(x))) return [];
    return [
      {
        id: t.id,
        markupPercent: t.markupPercent,
        pemilikPada: (pada: Date) =>
          pemilikOmzetKonsi({ pemegangId: pemegangPada(r, t.salesmanId, pada), pengirimTerakhirId: pengirimPada(kirim, pada) }),
      },
    ];
  });
}

type LakuMentah = Omit<BarisLakuKonsi, "nilai">;

/**
 * Harga Elorae per potong (sen) untuk setiap (barang, ukuran) laku di satu
 * toko — dasar "harga toko terima" yang sama dengan barang hilang.
 */
async function hargaPerKunci(toko: TokoKonsi, baris: readonly LakuMentah[]): Promise<Map<string, number>> {
  const kunci = new Map<string, { itemId: string; variantSku: string }>();
  for (const b of baris) kunci.set(`${b.itemId}::${b.variantSku}`, { itemId: b.itemId, variantSku: b.variantSku });
  const dinilai = await nilaiBarisHilang(
    prisma,
    [...kunci.values()].map((k) => ({ itemId: k.itemId, variantSku: k.variantSku, productName: "", qty: 1 })),
    { id: toko.id, termsType: "KONSI", markupPercent: toko.markupPercent, priceDiscountPercent: null },
    "HARGA_TERIMA",
  );
  return new Map(dinilai.map((d) => [`${d.itemId}::${d.variantSku}`, d.unitSen]));
}

/**
 * Laku konsinyasi per salesman dari `sejak` (dan sebelum `opsi.sebelum`, bila
 * ada). Salesman tanpa toko konsinyasi mendapat daftar kosong.
 */
export async function lakuKonsiSalesman(
  salesmanIds: readonly string[],
  sejak: Date,
  opsi: { sebelum?: Date; sekarang?: Date } = {},
): Promise<Map<string, BarisLakuKonsi[]>> {
  const ids = [...new Set(salesmanIds.filter(Boolean))];
  const hasil = new Map<string, BarisLakuKonsi[]>(ids.map((id) => [id, []]));
  if (ids.length === 0) return hasil;
  const sekarang = opsi.sekarang ?? new Date();
  const toko = await tokoKonsiMilik(ids);
  if (toko.length === 0) return hasil;
  const storeIds = toko.map((t) => t.id);
  const dalamRentang = (t: Date) => t >= sejak && (!opsi.sebelum || t < opsi.sebelum);

  const [awalBuku, gerak, laporan] = await Promise.all([
    prisma.storeStockMovement.groupBy({ by: ["storeId"], where: { storeId: { in: storeIds } }, _min: { createdAt: true } }),
    gerakLakuBersih(storeIds.map((storeId) => ({ storeId, dari: sejak, sebelum: opsi.sebelum }))),
    prisma.consignmentSold.findMany({
      where: {
        itemId: { not: null },
        qty: { not: 0 },
        cycle: {
          storeId: { in: storeIds },
          lockedAt: { not: null },
          periodYear: { gte: Number(kunciHariWib(sejak).slice(0, 4)) },
        },
      },
      select: { itemId: true, qty: true, cycle: { select: { storeId: true, periodYear: true, periodMonth: true } } },
    }),
  ]);
  const bukuPertama = new Map(awalBuku.map((g) => [g.storeId, g._min.createdAt]));

  const perToko = new Map<string, LakuMentah[]>();
  const tambah = (b: LakuMentah) => {
    const daftar = perToko.get(b.storeId);
    if (daftar) daftar.push(b);
    else perToko.set(b.storeId, [b]);
  };
  // JUAL ditulis negatif, retur pembeli (layak maupun rusak) positif: laku bersih = kebalikannya.
  for (const g of gerak) {
    tambah({ tanggal: g.createdAt, storeId: g.storeId, itemId: g.itemId, variantSku: g.variantSku, pcs: -g.qty });
  }
  for (const s of laporan) {
    const { storeId, periodYear, periodMonth } = s.cycle;
    if (!laporanSiklusDipakai(kunciBulanSiklus(periodYear, periodMonth), bukuPertama.get(storeId) ?? null)) continue;
    const tanggal = tanggalLaporanSiklus(periodYear, periodMonth, sekarang);
    if (!dalamRentang(tanggal)) continue;
    tambah({ tanggal, storeId, itemId: s.itemId as string, variantSku: "", pcs: s.qty });
  }

  await Promise.all(
    toko.map(async (t) => {
      const baris = perToko.get(t.id);
      if (!baris?.length) return;
      // Pemilik per baris pada saat laku; baris milik salesman lain dibuang sebelum dinilai.
      const milikDiminta = baris.flatMap((b) => {
        const pemilik = t.pemilikPada(b.tanggal);
        return pemilik && hasil.has(pemilik) ? [{ b, pemilik }] : [];
      });
      if (milikDiminta.length === 0) return;
      const harga = await hargaPerKunci(t, milikDiminta.map((x) => x.b));
      for (const { b, pemilik } of milikDiminta) {
        hasil.get(pemilik)!.push({ ...b, nilai: nilaiLaku(b.pcs, harga.get(`${b.itemId}::${b.variantSku}`) ?? 0) });
      }
    }),
  );
  for (const daftar of hasil.values()) daftar.sort((a, b) => a.tanggal.getTime() - b.tanggal.getTime());
  return hasil;
}

/** Satu salesman — bentuk yang dipakai `penjualanSalesman` dan pcs konsi di HP. */
export async function lakuKonsiSatuSalesman(
  salesmanId: string,
  sejak: Date,
  opsi: { sebelum?: Date; sekarang?: Date } = {},
): Promise<BarisLakuKonsi[]> {
  if (!salesmanId) return [];
  return (await lakuKonsiSalesman([salesmanId], sejak, opsi)).get(salesmanId) ?? [];
}
