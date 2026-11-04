"use server";
import { revalidatePath } from "next/cache";
import { prisma, Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

export type PromoActionResult = { ok: true; id?: string } | { ok: false; reason: "FORBIDDEN" | "INVALID" };

export type PromoFormInput = {
  id?: string; name: string; type: "PERCENT" | "FIXED" | "TIERED" | "BONUS"; level: "LINE" | "ORDER";
  value: number | null; minQty: number | null; minOrderSubtotal: number | null; minOrderQty: number | null;
  allStores: boolean; startsAt: string | null; endsAt: string | null; priority: number; isActive: boolean;
  itemIds: string[]; storeIds: string[]; tiers: Array<{ minQty: number; unitPrice: number }>;
  /** BONUS ("beli X gratis Y"): setiap `bonusBuyQty` pcs dibeli → `bonusFreeQty` pcs gratis. */
  bonusBuyQty?: number | null; bonusFreeQty?: number | null;
  /** BONUS: barang hadiah; null = barang yang sama dengan yang dibeli. */
  bonusItemId?: string | null;
};

const bulatPositif = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 100_000;

/** Kolom bonus yang disimpan — kosong untuk promo selain BONUS, supaya sisa isian lama tidak ikut terbaca. */
function kolomBonus(i: PromoFormInput) {
  return i.type === "BONUS"
    ? { bonusBuyQty: i.bonusBuyQty ?? null, bonusFreeQty: i.bonusFreeQty ?? null, bonusItemId: i.bonusItemId ?? null }
    : { bonusBuyQty: null, bonusFreeQty: null, bonusItemId: null };
}

/** Barang hadiah harus barang yang ada — kalau tidak, promo tidak pernah bisa memberi apa pun. */
async function hadiahAda(i: PromoFormInput): Promise<boolean> {
  if (i.type !== "BONUS" || !i.bonusItemId) return true;
  return (await prisma.item.count({ where: { id: i.bonusItemId } })) === 1;
}

async function guard() {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.PROMOS_MANAGE)) return null;
  return session.user.id;
}

function validate(i: PromoFormInput): boolean {
  if (!i.name.trim()) return false;
  if (i.type === "BONUS") {
    // Bonus selalu per produk: yang dihitung adalah pcs barang promo di pesanan.
    if (i.level !== "LINE") return false;
    if (!bulatPositif(i.bonusBuyQty) || !bulatPositif(i.bonusFreeQty)) return false;
    if (i.bonusItemId != null && (typeof i.bonusItemId !== "string" || i.bonusItemId.trim() === "")) return false;
  } else if (i.type === "TIERED") { if (i.level !== "LINE" || i.tiers.length === 0) return false; }
  else if (i.value === null || i.value < 0) return false;
  if (i.type === "PERCENT" && i.value !== null && i.value > 100) return false;
  if (i.level === "LINE" && i.itemIds.length === 0) return false;
  if (!i.allStores && i.storeIds.length === 0) return false;
  return true;
}

export async function createPromoAction(input: PromoFormInput): Promise<PromoActionResult> {
  const uid = await guard(); if (!uid) return { ok: false, reason: "FORBIDDEN" };
  if (!validate(input)) return { ok: false, reason: "INVALID" };
  if (!(await hadiahAda(input))) return { ok: false, reason: "INVALID" };
  const itemIds = Array.from(new Set(input.itemIds));
  const storeIds = Array.from(new Set(input.storeIds));
  const tiers = Array.from(new Map(input.tiers.map((t) => [t.minQty, t])).values());
  try {
    const p = await prisma.promo.create({
      data: {
        name: input.name.trim(), type: input.type, level: input.level, termsType: "PUTUS",
        value: input.type === "TIERED" || input.type === "BONUS" ? null : input.value,
        minQty: input.type === "BONUS" ? null : input.minQty,
        ...kolomBonus(input),
        minOrderSubtotal: input.minOrderSubtotal, minOrderQty: input.minOrderQty,
        allStores: input.allStores, startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null, priority: input.priority, isActive: input.isActive,
        items: { create: itemIds.map((itemId) => ({ itemId })) },
        stores: input.allStores ? undefined : { create: storeIds.map((storeId) => ({ storeId })) },
        tiers: { create: (input.type === "TIERED" ? tiers : []).map((t) => ({ minQty: t.minQty, unitPrice: t.unitPrice })) },
      },
    });
    revalidatePath("/backoffice/promos");
    return { ok: true, id: p.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) return { ok: false, reason: "INVALID" };
    throw e;
  }
}

export async function updatePromoAction(input: PromoFormInput): Promise<PromoActionResult> {
  const uid = await guard(); if (!uid) return { ok: false, reason: "FORBIDDEN" };
  if (!input.id || !validate(input)) return { ok: false, reason: "INVALID" };
  if (!(await hadiahAda(input))) return { ok: false, reason: "INVALID" };
  const itemIds = Array.from(new Set(input.itemIds));
  const storeIds = Array.from(new Set(input.storeIds));
  const tiers = Array.from(new Map(input.tiers.map((t) => [t.minQty, t])).values());
  try {
    await prisma.$transaction([
      prisma.promoItem.deleteMany({ where: { promoId: input.id } }),
      prisma.promoStore.deleteMany({ where: { promoId: input.id } }),
      prisma.promoTier.deleteMany({ where: { promoId: input.id } }),
      prisma.promo.update({
        where: { id: input.id },
        data: {
          name: input.name.trim(), type: input.type, level: input.level,
          value: input.type === "TIERED" || input.type === "BONUS" ? null : input.value,
        minQty: input.type === "BONUS" ? null : input.minQty,
        ...kolomBonus(input),
          minOrderSubtotal: input.minOrderSubtotal, minOrderQty: input.minOrderQty,
          allStores: input.allStores, startsAt: input.startsAt ? new Date(input.startsAt) : null,
          endsAt: input.endsAt ? new Date(input.endsAt) : null, priority: input.priority, isActive: input.isActive,
          items: { create: itemIds.map((itemId) => ({ itemId })) },
          stores: input.allStores ? undefined : { create: storeIds.map((storeId) => ({ storeId })) },
          tiers: { create: (input.type === "TIERED" ? tiers : []).map((t) => ({ minQty: t.minQty, unitPrice: t.unitPrice })) },
        },
      }),
    ]);
    revalidatePath("/backoffice/promos");
    revalidatePath(`/backoffice/promos/${input.id}`);
    return { ok: true, id: input.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) return { ok: false, reason: "INVALID" };
    throw e;
  }
}

export async function togglePromoAction(id: string, isActive: boolean): Promise<PromoActionResult> {
  const uid = await guard(); if (!uid) return { ok: false, reason: "FORBIDDEN" };
  try {
    await prisma.promo.update({ where: { id }, data: { isActive } });
    revalidatePath("/backoffice/promos");
    return { ok: true, id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) return { ok: false, reason: "INVALID" };
    throw e;
  }
}
