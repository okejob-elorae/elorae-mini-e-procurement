import { prisma } from "@elorae/db";
import { formatDisplayDate } from "@/lib/date-only";
import { bacaTabelUkuran, pilihTabelUkuran, SATUAN_UKURAN, type SatuanUkuran } from "@/lib/items/size-chart";
import { variantDetailForSku } from "@/lib/items/variants";
import { bacaVarian } from "@/lib/salesman/analisa-toko";
import { hargaKasirSpg, syaratHargaToko, type SyaratHargaToko } from "./harga-kasir";
import { SPG_STORE_PRICING_SELECT } from "./pricing";
import { promoBerlaku, ringkasPromoKonter } from "./promo-konter";
import { promoKonterUntukToko } from "./promo-konter-queries";
import {
  barisVarianProduk,
  labelGudang,
  promoMenyasarBarang,
  tersediaGudang,
  tokoLainTeratas,
  type InfoProduk,
  type ProdukDaftar,
  type TokoLain,
  type VarianProduk,
} from "./produk";

/**
 * Kueri Info produk di HP SPG. Hanya untuk server: halaman memanggilnya dengan
 * toko tetap SPG dari sesi (tidak pernah dari alamat) dan meneruskan hasilnya
 * ke komponen klien apa adanya — jadi bentuk hasil inilah yang sampai ke HP.
 * Angka gudang hanya dibaca untuk menentukan keterangan, tidak ikut dikirim.
 */

/**
 * Harga yang disebut ke pembeli = harga kasir toko SPG ini (`hargaKasirSpg`,
 * sama dengan layar jual dan penulis nota, atas kolom toko yang sama
 * `SPG_STORE_PRICING_SELECT`): toko konsinyasi = harga di toko, dan tanpa
 * harga (null) selama markup tokonya belum sah.
 */
const hargaToko = (sellingPrice: unknown, syarat: SyaratHargaToko) =>
  hargaKasirSpg(sellingPrice === null || sellingPrice === undefined ? null : Number(sellingPrice), syarat);

async function syaratToko(storeId: string): Promise<SyaratHargaToko> {
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: SPG_STORE_PRICING_SELECT });
  return toko ? syaratHargaToko(toko) : { termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null };
}

/** Urutan foto: foto barang (tanpa varian) dulu, lalu per varian; urutan simpan di dalamnya. */
function urutkanFoto<T extends { variantSku: string | null; sortOrder: number; url: string }>(foto: T[]): T[] {
  return [...foto].sort(
    (a, b) =>
      Number(!!a.variantSku) - Number(!!b.variantSku) ||
      (a.variantSku ?? "").localeCompare(b.variantSku ?? "") ||
      a.sortOrder - b.sortOrder,
  );
}

/**
 * Daftar barang untuk layar Info produk: barang jadi yang aktif, ditambah
 * barang jadi yang pernah bergerak di buku stok toko ini (barang yang sudah
 * dinonaktifkan di master bisa masih di rak dan masih ditanyakan pembeli).
 */
export async function daftarProdukSpg(storeId: string): Promise<ProdukDaftar[]> {
  const [diBuku, syarat] = await Promise.all([
    prisma.storeStockMovement.findMany({ where: { storeId }, distinct: ["itemId"], select: { itemId: true } }),
    syaratToko(storeId),
  ]);
  const items = await prisma.item.findMany({
    where: {
      type: "FINISHED_GOOD",
      OR: [{ isActive: true }, ...(diBuku.length ? [{ id: { in: diBuku.map((d) => d.itemId) } }] : [])],
    },
    orderBy: { nameId: "asc" },
    select: { id: true, sku: true, nameId: true, sellingPrice: true, variants: true },
  });
  if (items.length === 0) return [];
  const foto = await prisma.itemImage.findMany({
    where: { itemId: { in: items.map((i) => i.id) } },
    select: { itemId: true, variantSku: true, url: true, sortOrder: true },
  });
  const fotoUtama = new Map<string, string>();
  for (const f of urutkanFoto(foto)) if (!fotoUtama.has(f.itemId)) fotoUtama.set(f.itemId, f.url);

  return items.map((i) => ({
    itemId: i.id,
    nama: i.nameId,
    sku: i.sku,
    harga: hargaToko(i.sellingPrice, syarat),
    foto: fotoUtama.get(i.id) ?? null,
    varian: barisVarianProduk(i.variants).map((v) => ({ variantSku: v.sku, barcode: v.barcode })),
  }));
}

/**
 * Info satu barang untuk pembeli, dilihat dari toko SPG `storeId`. null kalau
 * barangnya tidak ada atau bukan barang jadi.
 */
export async function infoProdukSpg(itemId: string, storeId: string, sekarang: Date): Promise<InfoProduk | null> {
  const item = await prisma.item.findFirst({
    where: { id: itemId, type: "FINISHED_GOOD" },
    select: {
      id: true,
      sku: true,
      nameId: true,
      description: true,
      material: true,
      careInstructions: true,
      sizeChartId: true,
      categoryId: true,
      category: { select: { name: true } },
      isActive: true,
      sellingPrice: true,
      variants: true,
      images: { select: { url: true, variantSku: true, sortOrder: true } },
      inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true } },
    },
  });
  if (!item) return null;

  const tokoSpgLain = await prisma.user.findMany({
    where: { assignedStoreId: { not: null } },
    distinct: ["assignedStoreId"],
    select: { assignedStoreId: true },
  });
  const idTokoLain = tokoSpgLain.map((u) => u.assignedStoreId).filter((x): x is string => !!x && x !== storeId);

  const [bukuToko, saldoToko, saldoLain, tokoLain, promo, tabel, syarat] = await Promise.all([
    prisma.storeStockMovement.findFirst({ where: { storeId }, select: { id: true } }),
    prisma.storeStockMovement.groupBy({ by: ["variantSku"], where: { storeId, itemId }, _sum: { qty: true } }),
    idTokoLain.length
      ? prisma.storeStockMovement.groupBy({
          by: ["storeId", "variantSku"],
          where: { itemId, storeId: { in: idTokoLain } },
          _sum: { qty: true },
        })
      : Promise.resolve([]),
    idTokoLain.length
      ? prisma.store.findMany({ where: { id: { in: idTokoLain }, isActive: true }, select: { id: true, name: true } })
      : Promise.resolve([]),
    promoKonterUntukToko(storeId, sekarang),
    item.sizeChartId || item.categoryId
      ? prisma.sizeChart.findMany({
          where: {
            OR: [
              ...(item.sizeChartId ? [{ id: item.sizeChartId }] : []),
              ...(item.categoryId ? [{ categoryId: item.categoryId, isActive: true }] : []),
            ],
          },
        })
      : Promise.resolve([]),
    syaratToko(storeId),
  ]);
  const bukuDimulai = bukuToko !== null;

  // ── Varian: dari master, ditambah varian yang masih ada di buku toko ini.
  const master = barisVarianProduk(item.variants);
  const bervarian = master.length > 0;
  const saldoPerVarian = new Map(saldoToko.map((s) => [s.variantSku, s._sum.qty ?? 0]));
  const daftarSku: { sku: string; barcode: string | null }[] = bervarian ? [...master] : [{ sku: "", barcode: null }];
  for (const [sku, qty] of saldoPerVarian) {
    if (qty !== 0 && !daftarSku.some((v) => v.sku.toLowerCase() === sku.toLowerCase())) daftarSku.push({ sku, barcode: null });
  }

  const namaToko = new Map(tokoLain.map((s) => [s.id, s.name]));
  const lainPerVarian = new Map<string, TokoLain[]>();
  for (const g of saldoLain) {
    const nama = namaToko.get(g.storeId);
    if (!nama) continue;
    const daftar = lainPerVarian.get(g.variantSku) ?? [];
    daftar.push({ nama, qty: g._sum.qty ?? 0 });
    lainPerVarian.set(g.variantSku, daftar);
  }

  const labelVarian = (sku: string) => {
    if (!sku) return "";
    const { ukuran, warna } = bacaVarian(item.variants, sku, item.sku);
    const pendek = [ukuran, warna].filter(Boolean).join(" · ");
    return pendek || variantDetailForSku(item.variants, sku) || sku;
  };

  const varian: VarianProduk[] = daftarSku.map((v) => ({
    variantSku: v.sku,
    label: labelVarian(v.sku),
    barcode: v.barcode,
    stokToko: bukuDimulai ? (saldoPerVarian.get(v.sku) ?? 0) : null,
    gudang: labelGudang(tersediaGudang(item.inventoryValues, v.sku, bervarian && v.sku !== "")),
    tokoLain: tokoLainTeratas(lainPerVarian.get(v.sku) ?? []),
  }));

  // ── Promo konter untuk barang ini: yang berlaku sekarang dan yang segera mulai.
  const promoBarang = promo
    .filter((p) => promoMenyasarBarang(p, item.id, item.categoryId))
    .map((p) => ({
      id: p.id,
      nama: p.name,
      ringkas: ringkasPromoKonter(p),
      berlaku: promoBerlaku(p, storeId, sekarang),
      mulaiLabel: p.startsAt ? formatDisplayDate(p.startsAt) : null,
      sampaiLabel: p.endsAt ? formatDisplayDate(p.endsAt) : null,
    }))
    .sort((a, b) => Number(b.berlaku) - Number(a.berlaku));

  // ── Tabel ukuran: milik barang (aktif) atau bawaan kategorinya.
  const pilihan = pilihTabelUkuran({ sizeChartId: item.sizeChartId, categoryId: item.categoryId }, tabel);
  const tabelUkuran = pilihan
    ? (() => {
        const t = bacaTabelUkuran(pilihan.tabel.columns, pilihan.tabel.rows);
        return {
          nama: pilihan.tabel.name,
          satuan: ((SATUAN_UKURAN as readonly string[]).includes(pilihan.tabel.unit) ? pilihan.tabel.unit : "cm") as SatuanUkuran,
          kolom: t.columns,
          baris: t.rows,
          catatan: pilihan.tabel.note,
          sumber: pilihan.sumber,
        };
      })()
    : null;

  const fotoUrut = urutkanFoto(item.images);
  const dilihat = new Set<string>();
  const foto = fotoUrut
    .filter((f) => (dilihat.has(f.url) ? false : (dilihat.add(f.url), true)))
    .slice(0, 12)
    .map((f) => ({ url: f.url, variantSku: f.variantSku || null }));

  return {
    itemId: item.id,
    nama: item.nameId,
    sku: item.sku,
    aktif: item.isActive,
    kategori: item.category?.name ?? null,
    deskripsi: item.description?.trim() || null,
    bahan: item.material?.trim() || null,
    caraRawat: item.careInstructions?.trim() || null,
    harga: hargaToko(item.sellingPrice, syarat),
    foto,
    promo: promoBarang,
    tabelUkuran: tabelUkuran && tabelUkuran.kolom.length > 0 && tabelUkuran.baris.length > 0 ? tabelUkuran : null,
    bukuDimulai,
    bervarian,
    varian,
  };
}
