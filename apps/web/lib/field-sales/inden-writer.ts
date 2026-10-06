import { reserveFieldSalesOrder, type OversellAlert, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import {
  BarangIndenBelumTercatatError,
  barisPerluDicadangkan,
  bolehDiubah,
  keadaanJendela,
  validasiJendela,
  type BarisBelumTercatat,
  type GalatJendela,
  type GalatSimpanJendela,
  type IsianJendela,
  type JendelaSah,
} from "./inden";

/**
 * Penulis pre-order (inden): simpan jendela dan rilis jendela. Aturan
 * murninya di `./inden`; pesanan pre-order sendiri dibuat lewat
 * `createFieldSalesOrder` seperti pesanan lain.
 */

type Tx = Prisma.TransactionClient;

// ── Pencadangan (dipakai rilis dan persetujuan sesudah rilis) ─────────────

type BarisPesanan = {
  id: string;
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
  deliveredQty: number;
  cancelledQty: number;
};

/**
 * Baris yang barangnya belum punya baris persediaan. Pencarian sama longgarnya
 * dengan `findFieldSalesInventory` di penulis reservasi: barang tanpa varian
 * boleh tersimpan dengan `variantSku` null atau "".
 */
async function barisTanpaPersediaan(tx: Tx, lines: ReadonlyArray<BarisPesanan>): Promise<BarisBelumTercatat[]> {
  if (lines.length === 0) return [];
  const itemIds = Array.from(new Set(lines.map((l) => l.itemId)));
  const rows = await tx.inventoryValue.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, variantSku: true } });
  const ada = new Set(rows.map((r) => `${r.itemId}::${r.variantSku ?? ""}`));
  const hasil: BarisBelumTercatat[] = [];
  const terlihat = new Set<string>();
  for (const l of lines) {
    const k = `${l.itemId}::${l.variantSku}`;
    if (ada.has(k) || terlihat.has(k)) continue;
    terlihat.add(k);
    hasil.push({ itemId: l.itemId, variantSku: l.variantSku, productName: l.productName });
  }
  return hasil;
}

/**
 * Cadangkan sisa terbuka satu pesanan pre-order. Peringatan, bukan penolakan,
 * untuk stok yang kurang — sama dengan pesanan PUTUS biasa: penulis reservasi
 * mencatat `STOCK_OVERSELL_RISK` untuk setiap baris yang membuat stok tersedia
 * minus. Yang DITOLAK hanya barang tanpa baris persediaan sama sekali, karena
 * di situ tidak ada yang bisa dicadangkan.
 *
 * Idempoten per baris: baris yang sudah punya reservasi dilewati penulis reservasi.
 */
export async function cadangkanPesananInden(
  tx: Tx,
  order: { orderNo: string; lines: ReadonlyArray<BarisPesanan> },
): Promise<{ baris: number; oversell: OversellAlert[] }> {
  const perlu = barisPerluDicadangkan(order.lines);
  if (perlu.length === 0) return { baris: 0, oversell: [] };
  const terbuka = order.lines.filter((l) => perlu.some((p) => p.fieldSalesLineId === l.id));
  const hilang = await barisTanpaPersediaan(tx, terbuka);
  if (hilang.length > 0) throw new BarangIndenBelumTercatatError(hilang);
  const r = await reserveFieldSalesOrder(tx, { orderNo: order.orderNo, lines: perlu });
  return { baris: r.reserved, oversell: r.oversell };
}

// ── Simpan jendela ────────────────────────────────────────────────────────

export type HasilSimpanJendela =
  | { ok: true; id: string }
  | { ok: false; kode: "TIDAK_SAH"; galat: GalatJendela[] }
  | { ok: false; kode: GalatSimpanJendela; itemIds?: string[] };

function potret(j: Omit<JendelaSah, "items">, items: ReadonlyArray<{ itemId: string; plannedQty: number | null }>) {
  return {
    name: j.name,
    note: j.note,
    opensAt: j.opensAt.toISOString(),
    closesAt: j.closesAt.toISOString(),
    shipFrom: j.shipFrom?.toISOString() ?? null,
    shipTo: j.shipTo?.toISOString() ?? null,
    isActive: j.isActive,
    items: [...items].map((i) => ({ itemId: i.itemId, plannedQty: i.plannedQty })).sort((a, b) => a.itemId.localeCompare(b.itemId)),
  };
}

/**
 * Buat (tanpa `id`) atau ubah jendela pre-order beserta daftar barangnya.
 *
 * - Jendela yang sudah dirilis tidak bisa diubah: stoknya sudah dicadangkan
 *   atas dasar isinya.
 * - Barang baru harus barang jadi yang aktif. Barang yang SUDAH di jendela
 *   boleh tetap di sana walau kemudian dinonaktifkan — menyimpan ulang nama
 *   jendela tidak boleh gagal karena itu.
 * - Barang yang sudah dipesan toko (pesanan belum ditolak) tidak boleh dikeluarkan
 *   dari jendela: pesanannya akan menunjuk barang yang bukan lagi bagian pre-order.
 * - Jejak `AuditLog` ditulis di dalam transaksi yang sama, membawa potret
 *   sebelum/sesudah — barisnya sendiri hanya menyimpan keadaan terakhir.
 */
export async function simpanJendelaInden(input: { id?: string; isian: IsianJendela; userId: string }): Promise<HasilSimpanJendela> {
  const v = validasiJendela(input.isian);
  if (!v.ok) return { ok: false, kode: "TIDAK_SAH", galat: v.galat };
  const data = v.data;

  return runSerializable(async (tx): Promise<HasilSimpanJendela> => {
    const lama = input.id
      ? await tx.preorderWindow.findUnique({ where: { id: input.id } })
      : null;
    if (input.id && !lama) return { ok: false, kode: "TIDAK_ADA" };
    if (lama && !bolehDiubah(keadaanJendela(lama, new Date()))) return { ok: false, kode: "SUDAH_DIRILIS" };

    const barangLama = lama
      ? await tx.preorderWindowItem.findMany({ where: { windowId: lama.id }, select: { itemId: true, plannedQty: true } })
      : [];
    const idLama = new Set(barangLama.map((b) => b.itemId));
    const idBaru = data.items.map((i) => i.itemId).filter((id) => !idLama.has(id));
    if (idBaru.length > 0) {
      const sah = await tx.item.findMany({
        where: { id: { in: idBaru }, isActive: true, type: "FINISHED_GOOD" },
        select: { id: true },
      });
      const sahSet = new Set(sah.map((s) => s.id));
      const tidakSah = idBaru.filter((id) => !sahSet.has(id));
      if (tidakSah.length > 0) return { ok: false, kode: "BARANG_TIDAK_SAH", itemIds: tidakSah };
    }

    if (lama) {
      const tetap = new Set(data.items.map((i) => i.itemId));
      const dikeluarkan = barangLama.map((b) => b.itemId).filter((id) => !tetap.has(id));
      if (dikeluarkan.length > 0) {
        // Pcs yang sisanya sudah ditutup (dibatalkan) tidak lagi menunggu barang ini — sama
        // dengan hitungan "dipesan" di halaman rincian, supaya tombol hapus dan penolakan sepakat.
        const baris = await tx.fieldSalesOrderLine.findMany({
          where: { itemId: { in: dikeluarkan }, order: { preorderWindowId: lama.id, status: { not: "REJECTED" } } },
          select: { itemId: true, qty: true, cancelledQty: true },
        });
        const dipesan = Array.from(new Set(baris.filter((b) => b.qty > b.cancelledQty).map((b) => b.itemId)));
        if (dipesan.length > 0) return { ok: false, kode: "BARANG_SUDAH_DIPESAN", itemIds: dipesan };
        await tx.preorderWindowItem.deleteMany({ where: { windowId: lama.id, itemId: { in: dikeluarkan } } });
      }

      await tx.preorderWindow.update({
        where: { id: lama.id },
        data: {
          name: data.name,
          note: data.note,
          opensAt: data.opensAt,
          closesAt: data.closesAt,
          shipFrom: data.shipFrom,
          shipTo: data.shipTo,
          isActive: data.isActive,
        },
      });
      for (const it of data.items) {
        await tx.preorderWindowItem.upsert({
          where: { windowId_itemId: { windowId: lama.id, itemId: it.itemId } },
          create: { windowId: lama.id, itemId: it.itemId, plannedQty: it.plannedQty },
          update: { plannedQty: it.plannedQty },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "UPDATE",
          entityType: "PreorderWindow",
          entityId: lama.id,
          changes: { before: potret(lama, barangLama), after: potret(data, data.items) },
        },
      });
      return { ok: true, id: lama.id };
    }

    const baru = await tx.preorderWindow.create({
      data: {
        name: data.name,
        note: data.note,
        opensAt: data.opensAt,
        closesAt: data.closesAt,
        shipFrom: data.shipFrom,
        shipTo: data.shipTo,
        isActive: data.isActive,
        createdById: input.userId,
      },
      select: { id: true },
    });
    await tx.preorderWindowItem.createMany({
      data: data.items.map((i) => ({ windowId: baru.id, itemId: i.itemId, plannedQty: i.plannedQty })),
    });
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "CREATE",
        entityType: "PreorderWindow",
        entityId: baru.id,
        changes: { after: potret(data, data.items) },
      },
    });
    return { ok: true, id: baru.id };
  });
}

// ── Rilis ─────────────────────────────────────────────────────────────────

export type HasilRilisJendela =
  | { ok: true; sudahDirilis: boolean; pesanan: number; baris: number; oversell: OversellAlert[] }
  | { ok: false; kode: "TIDAK_ADA" }
  | { ok: false; kode: "BARANG_BELUM_TERCATAT"; baris: BarisBelumTercatat[] };

/**
 * "Rilis — barang sudah datang". Mencadangkan stok setiap pesanan pre-order
 * yang SUDAH disetujui dan masih punya sisa terbuka, lalu menandai jendelanya
 * dirilis. Pesanan yang masih menunggu persetujuan dicadangkan saat disetujui
 * (lihat `approveFieldSalesOrder`); pesanan yang sisanya sudah ditutup tidak
 * dicadangkan sama sekali.
 *
 * Idempoten: `releasedAt` dibalik dengan compare-and-swap PALING DULU, jadi
 * rilis kedua (klik ganda, dua admin) tidak mencadangkan apa pun dan hanya
 * melaporkan `sudahDirilis`. Rilis yang ditolak (barang belum tercatat di
 * gudang) membatalkan seluruh transaksi, termasuk tanda rilisnya.
 *
 * Serializable: persetujuan yang berjalan bersamaan membaca `releasedAt` di
 * transaksinya sendiri, jadi salah satunya diulang dan pesanan itu tidak bisa
 * lolos tanpa dicadangkan oleh keduanya.
 *
 * Sesudah commit: cadangan menurunkan `available`, jadi barang yang
 * dicadangkan didorong ke Jubelio (best-effort, tidak pernah melempar).
 */
export async function rilisJendelaInden(input: { id: string; userId: string }): Promise<HasilRilisJendela> {
  let barangDicadangkan: string[] = [];
  let hasil: HasilRilisJendela;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilRilisJendela> => {
      // Diisi ulang setiap percobaan: percobaan yang diulang tidak boleh mewariskan barangnya.
      barangDicadangkan = [];
      const now = new Date();
      const swap = await tx.preorderWindow.updateMany({ where: { id: input.id, releasedAt: null }, data: { releasedAt: now } });
      if (swap.count === 0) {
        const ada = await tx.preorderWindow.findUnique({ where: { id: input.id }, select: { id: true } });
        if (!ada) return { ok: false, kode: "TIDAK_ADA" };
        return { ok: true, sudahDirilis: true, pesanan: 0, baris: 0, oversell: [] };
      }

      const orders = await tx.fieldSalesOrder.findMany({
        where: { preorderWindowId: input.id, status: "APPROVED", deliveryStatus: { not: "CLOSED" } },
        orderBy: [{ approvedAt: "asc" }, { orderNo: "asc" }],
        select: {
          id: true,
          orderNo: true,
          lines: {
            select: { id: true, itemId: true, variantSku: true, productName: true, qty: true, deliveredQty: true, cancelledQty: true },
          },
        },
      });

      // Semua barang diperiksa DULU, sebelum satu reservasi pun ditulis: rilis
      // yang ditolak harus menyebut seluruh barang yang kurang sekaligus, bukan
      // satu per satu setiap kali tombol ditekan.
      const semua = orders.flatMap((o) => o.lines.filter((l) => barisPerluDicadangkan([l]).length > 0));
      const hilang = await barisTanpaPersediaan(tx, semua);
      if (hilang.length > 0) throw new BarangIndenBelumTercatatError(hilang);

      let pesanan = 0;
      let baris = 0;
      const oversell: OversellAlert[] = [];
      for (const o of orders) {
        const r = await cadangkanPesananInden(tx, { orderNo: o.orderNo, lines: o.lines });
        if (r.baris > 0) {
          pesanan += 1;
          barangDicadangkan.push(...barisPerluDicadangkan(o.lines).map((l) => l.itemId));
        }
        baris += r.baris;
        oversell.push(...r.oversell);
      }

      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: "PREORDER_WINDOW_RELEASED",
          entityType: "PreorderWindow",
          entityId: input.id,
          changes: { before: { releasedAt: null }, after: { releasedAt: now.toISOString() } },
          metadata: { pesanan, baris, oversell },
        },
      });

      return { ok: true, sudahDirilis: false, pesanan, baris, oversell };
    });
  } catch (e) {
    if (e instanceof BarangIndenBelumTercatatError) return { ok: false, kode: "BARANG_BELUM_TERCATAT", baris: e.baris };
    throw e;
  }
  if (hasil.ok && !hasil.sudahDirilis && barangDicadangkan.length > 0) {
    await antrekanPushStok([...new Set(barangDicadangkan)], { sumber: "INDEN", ref: `rilis inden ${input.id}`, userId: input.userId });
  }
  return hasil;
}
