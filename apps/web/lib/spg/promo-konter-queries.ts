import { prisma, type Prisma } from "@elorae/db";
import { JENIS_PROMO_KONTER, type JenisPromoKonter, type PromoKonter } from "./promo-konter";

type Klien = Prisma.TransactionClient | typeof prisma;

const angkaAtauNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Baris `CounterPromo` + sasarannya → bentuk yang dipakai mesin promo (aman ke HP). */
export function keBentukPromo(r: {
  id: string;
  name: string;
  type: string;
  value: unknown;
  buyQty: number | null;
  freeQty: number | null;
  minSubtotal: unknown;
  allItems: boolean;
  allStores: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  priority: number;
  isActive: boolean;
  storeSharePercent?: unknown;
  memberOnly?: boolean;
  targets: { kind: string; refId: string; qty?: number | null }[];
}): PromoKonter | null {
  if (!(JENIS_PROMO_KONTER as readonly string[]).includes(r.type)) return null;
  const ref = (kind: string) => r.targets.filter((t) => t.kind === kind).map((t) => t.refId);
  return {
    id: r.id,
    name: r.name,
    type: r.type as JenisPromoKonter,
    value: angkaAtauNull(r.value),
    buyQty: r.buyQty,
    freeQty: r.freeQty,
    minSubtotal: angkaAtauNull(r.minSubtotal),
    allItems: r.allItems,
    itemIds: ref("ITEM"),
    categoryIds: ref("CATEGORY"),
    allStores: r.allStores,
    storeIds: ref("STORE"),
    startsAt: r.startsAt ? r.startsAt.toISOString() : null,
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
    priority: r.priority,
    isActive: r.isActive,
    storeSharePercent: Number(r.storeSharePercent ?? 0) || 0,
    memberOnly: r.memberOnly === true,
    ...(r.type === "PAKET"
      ? {
          komponen: r.targets
            .filter((t) => t.kind === "ITEM" || t.kind === "CATEGORY")
            .map((t) => ({ jenis: t.kind as "ITEM" | "CATEGORY", refId: t.refId, qty: t.qty ?? 1 }))
            .sort((a, b) => (a.jenis + a.refId < b.jenis + b.refId ? -1 : 1)),
        }
      : {}),
  };
}

/**
 * Promo konter yang bisa berlaku di toko ini mulai `sejak` — termasuk yang
 * baru mulai beberapa hari lagi. Layar jual menyimpannya bersama halaman, dan
 * HP yang menjual tanpa sinyal memakai daftar ini; mesin promo sendiri yang
 * memilih mana yang berlaku pada waktu jualnya.
 *
 * Sasaran kategori/barang ikut terkirim (id saja); sasaran TOKO tidak — HP
 * hanya menerima promo yang memang untuk tokonya.
 */
export async function promoKonterUntukToko(storeId: string, sejak: Date, klien: Klien = prisma): Promise<PromoKonter[]> {
  const rows = await klien.counterPromo.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ endsAt: null }, { endsAt: { gte: sejak } }] },
        { OR: [{ allStores: true }, { targets: { some: { kind: "STORE", refId: storeId } } }] },
      ],
    },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
    include: { targets: { select: { kind: true, refId: true, qty: true } } },
  });
  return rows
    .map((r) => keBentukPromo(r))
    .filter((p): p is PromoKonter => p !== null)
    .map((p) => ({ ...p, storeIds: p.allStores ? [] : [storeId] }));
}
