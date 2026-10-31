import { moveMainStock, Prisma } from "@elorae/db";
import type { StockAdjustmentSource, StockLedgerRefType } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { lengkapiNilaiMasukRusak, nilaiKeluarBerikutnya, nilaiMasukRusak } from "@/lib/finance/operasional/nilai-rusak-queries";
import { hppJualTerakhir } from "@/lib/receivables/hpp-retur";
import {
  ENTITAS_GERAK_RUSAK,
  JEJAK_GUDANG_RUSAK,
  REF_BARIS_NRI,
  REF_PENYESUAIAN,
  kondisiRusak,
  periksaKeputusanRusak,
  qtyBertanda,
  type AlasanTolakKeputusanRusak,
  type KeputusanGudangRusak,
} from "./gudang-rusak";

/**
 * Penulis gudang barang rusak (`DamagedStockMovement`). Aturannya di
 * `gudang-rusak.ts`; di sini hanya transaksinya.
 */

type Klien = Prisma.TransactionClient;

/**
 * Barang yang diperbaiki kembali ke stok jual dengan sumber penyesuaian retur
 * toko: barangnya memang barang retur toko yang penerimaannya ke stok jual
 * tertunda sampai diperbaiki. Mekanismenya sama dengan `masukkanKeStok` di
 * penulis retur — POSITIVE, harga rata-rata tidak digeser.
 */
const SUMBER_PERBAIKI: StockAdjustmentSource = "STORE_RETURN_RECEIVE";

/**
 * Hitungan gudang (NRI): setiap baris RUSAK/EXPIRED ber-barang katalog masuk
 * gudang barang rusak (`MASUK_RETUR`, +qty). Dipanggil DI DALAM transaksi
 * hitungan gudang, jadi barisnya ikut batal kalau hitungannya batal.
 *
 * Idempoten per baris NRI (`refType` + `refId`): baris yang sudah punya
 * gerakan masuk tidak ditulis lagi. Baris yang hanya diketik namanya (tanpa
 * `itemId`) tidak punya tempat di buku barang — dilewati, sama dengan stok jual.
 * Mengembalikan jumlah gerakan yang ditulis.
 */
export async function masukkanGudangRusakDariNri(
  tx: Klien,
  input: {
    noNri: string;
    olehUserId: string;
    baris: { id: string; itemId: string | null; variantSku: string | null; itemName: string; qty: number; condition: string }[];
    /** Toko asal barang — nilai masuknya HPP saat dijual ke toko ini (`hppJualTerakhir`). */
    storeId?: string | null;
    /** Saat hitungan gudang: hanya penjualan sebelum ini yang dihitung. */
    sebelum?: Date;
  },
): Promise<number> {
  const rusak = input.baris.filter(
    (b): b is typeof b & { itemId: string } => Boolean(b.itemId) && b.qty > 0 && kondisiRusak(b.condition),
  );
  if (rusak.length === 0) return 0;
  const sudah = await tx.damagedStockMovement.findMany({
    where: { refType: REF_BARIS_NRI, refId: { in: rusak.map((b) => b.id) } },
    select: { refId: true },
  });
  const ada = new Set(sudah.map((s) => s.refId));
  const baru = rusak.filter((b) => !ada.has(b.id));
  if (baru.length === 0) return 0;
  // Nilai masuk = qty × HPP saat barang itu dijual ke toko asalnya (uji akuntansi 2, bug 6),
  // atau × harga rata-rata sekarang bila belum pernah dijual ke sana. Jurnal returnya membaca
  // nilai ini untuk `INVENTORY_DAMAGED` DAN HPP yang dibalik, supaya buku besar = nilai gudang rusak.
  const sebelum = input.sebelum ?? new Date();
  const nilai = await Promise.all(
    baru.map(async (b) => {
      const hpp = await hppJualTerakhir(tx, { storeId: input.storeId, itemId: b.itemId, variantSku: b.variantSku, sebelum });
      return hpp === null ? nilaiMasukRusak(tx, b.itemId, b.variantSku, b.qty) : Math.round(Math.abs(b.qty) * hpp * 100) / 100;
    }),
  );
  await tx.damagedStockMovement.createMany({
    data: baru.map((b, i) => ({
      itemId: b.itemId,
      variantSku: b.variantSku?.trim() ?? "",
      productName: b.itemName.trim() || b.itemId,
      qty: qtyBertanda("MASUK_RETUR", b.qty),
      kind: "MASUK_RETUR",
      refType: REF_BARIS_NRI,
      refId: b.id,
      value: new Prisma.Decimal(nilai[i]),
      note: `${input.noNri} · ${b.condition}`,
      createdById: input.olehUserId,
    })),
  });
  return baru.length;
}

/** Saldo satu barang × varian di gudang barang rusak (Σ qty bertanda). */
export async function saldoRusak(klien: Klien, itemId: string, variantSku: string): Promise<number> {
  const a = await klien.damagedStockMovement.aggregate({ where: { itemId, variantSku }, _sum: { qty: true } });
  return a._sum.qty ?? 0;
}

export type AlasanTolakGudangRusak = AlasanTolakKeputusanRusak | "BARANG_TIDAK_DITEMUKAN";

export type HasilPutuskanGudangRusak =
  | { ok: true; gerakId: string; saldoSesudah: number; penyesuaianId: string | null }
  | { ok: false; alasan: AlasanTolakGudangRusak };

/**
 * Kantor memutuskan sebagian (atau seluruh) saldo satu barang × varian.
 *
 * Penjaga saldo dibaca DI DALAM transaksi serializable: dua keputusan
 * bersamaan atas saldo yang sama tidak bisa sama-sama lolos — basis data
 * menolak salah satunya, percobaan ulangnya membaca saldo yang sudah berkurang.
 *
 * - `PERBAIKI`: stok jual gudang bertambah (`InventoryValue` varian persis,
 *   atau baris tanpa varian yang toleran `null`/`""`), dengan penyesuaian
 *   POSITIVE yang ditunjuk gerakannya (`refType = StockAdjustment`).
 * - `JUAL_OBRAL`: nilai jualnya (opsional) di `value`; stok jual tidak disentuh.
 * - `MUSNAHKAN`: keluar saja.
 *
 * Jejak `DAMAGED_STOCK_DECIDED` (saldo sebelum/sesudah, catatan) ditulis di
 * transaksi yang sama.
 */
export async function putuskanGudangRusak(input: {
  itemId: string;
  variantSku?: string | null;
  keputusan: unknown;
  qty: unknown;
  catatan: unknown;
  nilai?: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilPutuskanGudangRusak> {
  // Isian diperiksa sebelum transaksi (saldo tak terbatas) — penolakan yang
  // tidak bergantung saldo tidak perlu membuka transaksi.
  const awal = periksaKeputusanRusak(input, Number.POSITIVE_INFINITY);
  if (!awal.ok) return awal;
  const itemId = input.itemId?.trim();
  if (!itemId) return { ok: false, alasan: "BARANG_TIDAK_DITEMUKAN" };
  const varian = input.variantSku?.trim() ?? "";
  const sekarang = input.sekarang ?? new Date();

  const hasil = await runSerializable(async (tx): Promise<HasilPutuskanGudangRusak> => {
    const saldo = await saldoRusak(tx, itemId, varian);
    const p = periksaKeputusanRusak(input, saldo);
    if (!p.ok) return p;

    const [barang, terakhir] = await Promise.all([
      tx.item.findUnique({ where: { id: itemId }, select: { id: true, nameId: true } }),
      tx.damagedStockMovement.findFirst({
        where: { itemId, variantSku: varian },
        orderBy: { createdAt: "desc" },
        select: { productName: true },
      }),
    ]);
    if (!barang) return { ok: false, alasan: "BARANG_TIDAK_DITEMUKAN" };
    const productName = terakhir?.productName ?? barang.nameId;

    // Nilai yang keluar dari gudang rusak = bagian rata-rata saldo barang itu
    // (`lib/finance/operasional/nilai-rusak.ts`). Gerakan masuk lama yang belum
    // bernilai diisi dulu, supaya nilai ini dan nilai saldo sesudahnya memakai
    // harga yang sama. PERBAIKI/MUSNAHKAN menyimpannya di `value`; JUAL_OBRAL
    // memakai `value` untuk HASIL JUAL, jadi biayanya hanya di jejak (`biaya`).
    await lengkapiNilaiMasukRusak(tx, { barang: { itemId, variantSku: varian } });
    const biaya = await nilaiKeluarBerikutnya(tx, itemId, varian, p.qty);

    const penyesuaianId = p.keputusan === "PERBAIKI" ? await kembalikanKeStokJual(tx, { itemId, varian, qty: p.qty, productName, catatan: p.catatan, olehUserId: input.olehUserId }) : null;

    const gerak = await tx.damagedStockMovement.create({
      data: {
        itemId,
        variantSku: varian,
        productName,
        qty: qtyBertanda(p.keputusan, p.qty),
        kind: p.keputusan,
        refType: penyesuaianId ? REF_PENYESUAIAN : null,
        refId: penyesuaianId,
        value:
          p.keputusan === "JUAL_OBRAL"
            ? p.nilai !== null
              ? new Prisma.Decimal(p.nilai)
              : null
            : new Prisma.Decimal(biaya),
        note: p.catatan,
        createdById: input.olehUserId,
        createdAt: sekarang,
      },
      select: { id: true },
    });

    const saldoSesudah = saldo - p.qty;
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_GUDANG_RUSAK.DIPUTUSKAN,
        entityType: ENTITAS_GERAK_RUSAK,
        entityId: gerak.id,
        changes: { before: { saldo }, after: { saldo: saldoSesudah } },
        metadata: {
          itemId,
          variantSku: varian,
          productName,
          keputusan: p.keputusan satisfies KeputusanGudangRusak,
          qty: p.qty,
          ...(p.nilai !== null ? { nilai: p.nilai } : {}),
          // Nilai gudang rusak yang keluar (dibaca jurnal keputusan ini).
          biaya,
          ...(penyesuaianId ? { stockAdjustmentId: penyesuaianId } : {}),
        },
        reason: p.catatan,
      },
    });

    return { ok: true, gerakId: gerak.id, saldoSesudah, penyesuaianId };
  });

  // PERBAIKI menambah stok jual gudang (ada penyesuaian stok) — teruskan ke
  // Jubelio sesudah commit. JUAL_OBRAL/MUSNAHKAN tidak menyentuh stok jual.
  if (hasil.ok && hasil.penyesuaianId) {
    await antrekanPushStok([itemId], { sumber: "ADJUSTMENT", ref: `gudang rusak diperbaiki ${hasil.gerakId}`, userId: input.olehUserId });
  }
  return hasil;
}

/**
 * Barang yang diperbaiki kembali ke stok jual gudang. Varian yang disebut
 * dicari PERSIS; barang tanpa varian memakai pencarian yang toleran (`null`
 * atau `""`, `findExistingInventoryValueRow`) supaya tidak lahir baris hantu
 * kedua. Stok bergerak lewat `moveMainStock`, jadi buku stok mendapat barisnya
 * yang menunjuk penyesuaian ini. Harga rata-rata tidak digeser — perbaikan
 * bukan pembelian. Mengembalikan id penyesuaiannya.
 */
async function kembalikanKeStokJual(
  tx: Klien,
  input: { itemId: string; varian: string; qty: number; productName: string; catatan: string; olehUserId: string },
): Promise<string> {
  const stok = await findExistingInventoryValueRow(tx, input.itemId, input.varian || null);
  const qtyLama = stok ? Number(stok.qtyOnHand) : 0;
  const hargaRata = stok ? Number(stok.avgCost) : 0;
  const qtyBaru = qtyLama + input.qty;
  const adj = await tx.stockAdjustment.create({
    data: {
      docNumber: await generateDocNumber("ADJ", tx),
      itemId: input.itemId,
      type: "POSITIVE",
      qtyChange: input.qty,
      reason: `Gudang barang rusak — diperbaiki — ${input.productName}${input.varian ? ` (${input.varian})` : ""}: ${input.catatan}`,
      prevQty: qtyLama,
      newQty: qtyBaru,
      prevAvgCost: hargaRata,
      newAvgCost: hargaRata,
      createdById: input.olehUserId,
      source: SUMBER_PERBAIKI,
    },
    select: { id: true, docNumber: true },
  });
  await moveMainStock(tx, {
    itemId: input.itemId,
    variantSku: input.varian || null,
    qtyDelta: input.qty,
    inventoryValueId: stok?.id,
    createIfMissing: !stok,
    unitCost: hargaRata,
    totalCost: input.qty * hargaRata,
    totalValue: qtyBaru * hargaRata,
    balanceValue: qtyBaru * hargaRata,
    refType: "StockAdjustment" satisfies StockLedgerRefType,
    refId: adj.id,
    refDocNumber: adj.docNumber,
    createdById: input.olehUserId,
  });
  return adj.id;
}
