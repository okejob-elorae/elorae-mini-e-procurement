import { prisma } from "@elorae/db";
import { kunciHariWib } from "@/lib/dashboard/tren";
import type { BarangLambat, InfoBarangAnalisa, StokSekarang } from "@/lib/salesman/analisa-toko";
import {
  barangLambatSpg,
  HARI_LAJU,
  HARI_LAMBAT,
  rentangSpg,
  susunAnalisaSpg,
  susunCukupHari,
  susunDicari,
  type AnalisaSpg,
  type BarisMinta,
  type CukupHari,
  type DicariSpg,
  type JualSpg,
  type PeriodeSpg,
  type RentangSpg,
} from "./analisa";

/**
 * Kueri analisa penjualan SPG. Aturannya murni di `analisa.ts`; di sini hanya
 * bahannya dibaca. SELALU satu toko — toko tetap SPG yang diturunkan halaman
 * dari sesi, tidak pernah dari alamat.
 *
 * Bahan:
 *   - nota SPG toko ini (`SpgSaleLine`, semua SPG-nya), bersih dari barang
 *     yang dikembalikan pembeli (`qty − returnedQty`);
 *   - buku stok toko (`StoreStockMovement`): sisa per barang × varian = Σ qty,
 *     dan tanggal barang pertama kali masuk (gerakan positif pertama);
 *   - barang dicari pembeli (`LostSale`) toko ini.
 * Tidak ada rupiah di hasilnya.
 */

const HARI_MS = 86_400_000;

export type HasilAnalisaSpg = {
  toko: { id: string; nama: string };
  periode: PeriodeSpg;
  rentang: Pick<RentangSpg, "dari" | "sampai" | "dariLalu" | "sampaiLalu" | "hari" | "hariLalu">;
  /** Toko punya buku stok (pernah ada gerakan) — tanpa itu "sisa di rak" tidak diketahui. */
  bukuAda: boolean;
  /** Tidak ada penjualan sama sekali di periode ini maupun pembandingnya. */
  kosong: boolean;
  analisa: AnalisaSpg;
  cukup: { baris: CukupHari[]; jumlahHampirHabis: number; mintaHampirHabis: BarisMinta[] };
  lambat: { baris: BarangLambat[]; jumlah: number };
  dicari: DicariSpg[];
  hariLaju: number;
  hariLambat: number;
};

export async function analisaSpg(
  toko: { id: string; name: string },
  periode: PeriodeSpg,
  hariIni: Date,
): Promise<HasilAnalisaSpg> {
  const rentang = rentangSpg(hariIni, periode);
  // Jendela nota: periode pembanding, atau jendela laju/lambat bila lebih panjang.
  const awalJendela = Math.min(
    rentang.awalLalu.getTime(),
    new Date(`${kunciHariWib(hariIni)}T00:00:00+07:00`).getTime() - Math.max(HARI_LAJU, HARI_LAMBAT) * HARI_MS,
  );

  const [nota, saldo, masukPertama, dicariMentah] = await Promise.all([
    prisma.spgSaleLine.findMany({
      where: { spgSale: { storeId: toko.id, createdAt: { gte: new Date(awalJendela) } } },
      select: { itemId: true, variantSku: true, qty: true, returnedQty: true, spgSale: { select: { createdAt: true } } },
    }),
    prisma.storeStockMovement.groupBy({
      by: ["itemId", "variantSku"],
      where: { storeId: toko.id },
      _sum: { qty: true },
    }),
    prisma.storeStockMovement.groupBy({
      by: ["itemId", "variantSku"],
      where: { storeId: toko.id, qty: { gt: 0 } },
      _min: { createdAt: true },
    }),
    prisma.lostSale.findMany({
      where: { storeId: toko.id, createdAt: { gte: rentang.awal, lt: rentang.akhir } },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { itemId: true, variantSku: true, description: true, qty: true, createdAt: true },
    }),
  ]);

  const jual: JualSpg[] = nota.map((l) => ({
    tanggal: l.spgSale.createdAt,
    itemId: l.itemId,
    variantSku: l.variantSku ?? "",
    pcs: l.qty - l.returnedQty,
  }));
  const pertama = new Map(masukPertama.map((m) => [`${m.itemId}::${m.variantSku}`, m._min.createdAt ?? null]));
  const stok: StokSekarang[] = saldo.map((s) => ({
    itemId: s.itemId,
    variantSku: s.variantSku ?? "",
    qty: s._sum.qty ?? 0,
    firstInAt: pertama.get(`${s.itemId}::${s.variantSku}`) ?? null,
  }));

  const itemIds = [
    ...new Set([...jual.map((j) => j.itemId), ...stok.map((s) => s.itemId), ...dicariMentah.flatMap((d) => (d.itemId ? [d.itemId] : []))]),
  ];
  const barangRows = itemIds.length
    ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sku: true, nameId: true, categoryId: true, variants: true } })
    : [];
  const barang = new Map<string, InfoBarangAnalisa>(
    barangRows.map((b) => [b.id, { nama: b.nameId, sku: b.sku, kategoriId: b.categoryId, variants: b.variants }]),
  );
  const kategoriIds = [...new Set(barangRows.map((b) => b.categoryId).filter((x): x is string => !!x))];
  const kategoriRows = kategoriIds.length
    ? await prisma.itemCategory.findMany({ where: { id: { in: kategoriIds } }, select: { id: true, name: true } })
    : [];
  const kategori = new Map(kategoriRows.map((k) => [k.id, k.name]));

  const analisa = susunAnalisaSpg({ rentang, jual, barang, kategori });
  return {
    toko: { id: toko.id, nama: toko.name },
    periode,
    rentang: {
      dari: rentang.dari,
      sampai: rentang.sampai,
      dariLalu: rentang.dariLalu,
      sampaiLalu: rentang.sampaiLalu,
      hari: rentang.hari,
      hariLalu: rentang.hariLalu,
    },
    bukuAda: stok.length > 0,
    kosong: analisa.totalPcs === 0 && analisa.totalPcsLalu === 0,
    analisa,
    cukup: susunCukupHari({ stok, jual, barang, hariIni }),
    lambat: barangLambatSpg({ stok, jual, barang, hariIni }),
    dicari: susunDicari({
      baris: dicariMentah.map((d) => ({
        itemId: d.itemId,
        variantSku: d.variantSku ?? "",
        description: d.description,
        qty: d.qty,
        tanggal: d.createdAt,
      })),
      rentang,
      barang,
    }),
    hariLaju: HARI_LAJU,
    hariLambat: HARI_LAMBAT,
  };
}
