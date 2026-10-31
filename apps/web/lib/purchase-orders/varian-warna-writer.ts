import { prisma, type Prisma } from "@elorae/db";
import { normalizeTcxCode } from "@elorae/db/pantone/book-index";
import { runSerializable } from "@/lib/db/tx-retry";
import { parseItemVariants, type ItemVariantRow } from "@/lib/items/variants";
import { labelPantone, rencanaVarianWarna, type TolakVarianWarna } from "./varian-warna";

/*
 * "+ Warna baru" dari formulir PO: menambah satu varian warna ke bahan
 * (`Item.variants`). Bahan barang jadi DITOLAK — variannya datang dari Jubelio.
 * Satu transaksi serializable: baca varian, periksa kembar, tulis, dan jejak
 * sebelum/sesudah di `AuditLog`, jadi dua orang yang menambah warna yang sama
 * bersamaan tidak menghasilkan dua varian.
 */

export const JEJAK_VARIAN_WARNA = "ITEM_COLOR_VARIANT_ADDED";

export type HasilTambahVarianWarna =
  | {
      ok: true;
      varian: { sku: string; warna: string; pantone: string | null; hex: string | null };
      variants: ItemVariantRow[];
    }
  | {
      ok: false;
      kode: TolakVarianWarna | "BARANG_TIDAK_ADA" | "BARANG_JADI" | "PANTONE_TIDAK_SAH" | "PANTONE_TIDAK_ADA";
      /** VARIAN_SUDAH_ADA: SKU varian yang sudah ada dan daftar varian terkini, supaya layar bisa memilihnya. */
      sku?: string;
      variants?: ItemVariantRow[];
    };

export async function tambahVarianWarna(masukan: {
  itemId: string;
  warna: string;
  pantone?: string | null;
  userId: string;
}): Promise<HasilTambahVarianWarna> {
  const { itemId, userId } = masukan;
  const pantoneMentah = (masukan.pantone ?? "").trim();

  let pantone: { label: string; hex: string } | null = null;
  if (pantoneMentah) {
    const tcx = normalizeTcxCode(pantoneMentah);
    if (!tcx) return { ok: false, kode: "PANTONE_TIDAK_SAH" };
    const warnaPantone = await prisma.pantoneColor.findUnique({ where: { tcx }, select: { tcx: true, hex: true } });
    if (!warnaPantone) return { ok: false, kode: "PANTONE_TIDAK_ADA" };
    pantone = { label: labelPantone(warnaPantone.tcx), hex: hexRapi(warnaPantone.hex) };
  }

  return runSerializable(async (tx) => {
    const barang = await tx.item.findUnique({ where: { id: itemId }, select: { id: true, sku: true, type: true, variants: true } });
    if (!barang) return { ok: false, kode: "BARANG_TIDAK_ADA" } as const;
    if (barang.type === "FINISHED_GOOD") return { ok: false, kode: "BARANG_JADI" } as const;

    const sebelum = parseItemVariants(barang.variants);
    const rencana = rencanaVarianWarna(sebelum, barang.sku, masukan.warna, pantone?.label ?? null);
    if (!rencana.ok) return rencana.kode === "VARIAN_SUDAH_ADA" ? { ...rencana, variants: sebelum } : rencana;

    await tx.item.update({ where: { id: itemId }, data: { variants: rencana.semua as Prisma.InputJsonValue } });
    const sku = rencana.baris.sku;
    const warna = Object.entries(rencana.baris).find(([k]) => k !== "sku" && k !== "pantone")?.[1] ?? "";
    await tx.auditLog.create({
      data: {
        userId,
        action: JEJAK_VARIAN_WARNA,
        entityType: "Item",
        entityId: itemId,
        changes: { before: sebelum, after: rencana.semua } as Prisma.InputJsonValue,
        metadata: { sku, warna, pantone: pantone?.label ?? null, sumber: "PO" } as Prisma.InputJsonValue,
      },
    });
    return {
      ok: true,
      varian: { sku, warna, pantone: pantone?.label ?? null, hex: pantone?.hex ?? null },
      variants: rencana.semua,
    } as const;
  });
}

function hexRapi(hex: string): string {
  const h = hex.trim().toLowerCase();
  return h.startsWith("#") ? h : `#${h}`;
}

/** Hex warna Pantone TCX untuk kode yang tersimpan di varian ("19-4005 TCX" atau "19-4005"). */
export async function hexPantone(kode: readonly string[]): Promise<Record<string, string>> {
  const tcx = [...new Set(kode.map((k) => normalizeTcxCode(k)).filter((k): k is string => !!k))].slice(0, 500);
  if (tcx.length === 0) return {};
  const baris = await prisma.pantoneColor.findMany({ where: { tcx: { in: tcx } }, select: { tcx: true, hex: true } });
  return Object.fromEntries(baris.map((b) => [b.tcx, hexRapi(b.hex)]));
}
