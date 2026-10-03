"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { searchPlacesViaSerpApi } from "@/lib/geo/search-places";
import type { SerpPlaceResult } from "@/lib/geo/serpapi-maps";
import {
  createStore,
  updateStore,
  deactivateStore,
  type StoreFields,
} from "@/lib/stores/queries";
import { lingkupPindah, type LingkupPindah } from "@/lib/stores/penanggung-jawab";
import { bacaAturanKelasToko, bacaKelas, KUNCI_KELAS_TOKO, type KelasToko } from "@/lib/stores/kelas-toko";
import { bacaBatasHari, KUNCI_BATAS_HARI } from "@/lib/salesman/pengaturan";
import { pindahkanToko } from "@/lib/stores/penanggung-jawab-writer";

type ActionResult<T = never> = { ok: true; data?: T } | { ok: false; code: string; message: string };

const storeInputSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(191),
  address: z.string().min(1),
  phone: z.string().max(64).nullable(),
  contactName: z.string().max(191).nullable(),
  termsType: z.enum(["PUTUS", "KONSI"]),
  paymentTempo: z.number().int().min(0).max(365),
  marginPercent: z.number().min(0).max(999.99).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  checkinRadiusMeters: z.number().int().min(0).max(100000).nullable(),
  isPkp: z.boolean(),
  groupId: z.string().min(1).nullable(),
  salesmanId: z.string().min(1).nullable(),
  // Batas kredit (Rp) muat di Decimal(15,2); tidak dikirim = tidak diubah, null = ikut bawaan.
  creditLimit: z.number().min(0).max(9_999_999_999_999).nullable().optional(),
  maxOpenInvoices: z.number().int().min(0).max(100_000).nullable().optional(),
  // Kelas toko; tidak dikirim = tidak diubah, null = tanpa kelas (ikut batas hari umum).
  storeClass: z.enum(["A", "B", "C"]).nullable().optional(),
});

/**
 * Area dan sales yang dipilih harus ada. Tanpa foreign key
 * (`relationMode = "prisma"`), id yang salah akan tersimpan diam-diam dan
 * tokonya lenyap dari layar semua orang.
 */
async function rujukanAda(groupId: string | null, salesmanId: string | null): Promise<boolean> {
  const [area, sales] = await Promise.all([
    groupId ? prisma.storeGroup.count({ where: { id: groupId } }) : Promise.resolve(1),
    salesmanId ? prisma.user.count({ where: { id: salesmanId } }) : Promise.resolve(1),
  ]);
  return area === 1 && sales === 1;
}

async function requireManage(): Promise<
  { ok: true; userId: string } | { ok: false; code: string; message: string }
> {
  const session = await auth();
  if (!session) return { ok: false, code: "forbidden", message: "Permission denied." };
  const perms = session.user.permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, code: "forbidden", message: "Permission denied." };
  }
  return { ok: true, userId: session.user.id };
}

/** In-process cooldown for SerpAPI place search (paid quota). */
const PLACE_SEARCH_COOLDOWN_MS = 2_000;
const lastPlaceSearchAtByUser = new Map<string, number>();

function takePlaceSearchSlot(userId: string): boolean {
  const now = Date.now();
  const last = lastPlaceSearchAtByUser.get(userId) ?? 0;
  if (now - last < PLACE_SEARCH_COOLDOWN_MS) return false;
  lastPlaceSearchAtByUser.set(userId, now);
  if (lastPlaceSearchAtByUser.size > 500) {
    for (const [id, at] of lastPlaceSearchAtByUser) {
      if (now - at > PLACE_SEARCH_COOLDOWN_MS * 10) lastPlaceSearchAtByUser.delete(id);
    }
  }
  return true;
}

export async function createStoreAction(input: StoreFields): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const parsed = storeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: parsed.error.message };
  }
  if (!(await rujukanAda(parsed.data.groupId, parsed.data.salesmanId))) {
    return { ok: false, code: "invalid_ref", message: "Area or salesperson not found." };
  }
  try {
    const created = await createStore(parsed.data);
    revalidatePath("/backoffice/stores");
    return { ok: true, data: { id: created.id } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, code: "code_unique", message: "Store code already exists." };
    }
    throw e;
  }
}

export async function updateStoreAction(id: string, input: StoreFields): Promise<ActionResult> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const parsed = storeInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: parsed.error.message };
  }
  if (!(await rujukanAda(parsed.data.groupId, parsed.data.salesmanId))) {
    return { ok: false, code: "invalid_ref", message: "Area or salesperson not found." };
  }
  try {
    await updateStore(id, parsed.data, gate.userId);
    revalidatePath("/backoffice/stores");
    revalidatePath(`/backoffice/stores/${id}`);
    // Kelas mengubah jarak kunjungan di rencana beranda sales.
    if (parsed.data.storeClass !== undefined) revalidatePath("/pwa");
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, code: "code_unique", message: "Store code already exists." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return { ok: false, code: "not_found", message: "Store not found." };
    }
    throw e;
  }
}

/**
 * Batas kredit satu toko untuk formulir ubah toko, bila halaman pemanggilnya
 * belum menyertakannya di `initial`. Formulir tidak menampilkan kolom kosong
 * seolah-olah "tanpa batas" selagi nilainya belum terbaca.
 */
export async function bacaBatasKreditTokoAction(
  id: string,
): Promise<ActionResult<{ creditLimit: number | null; maxOpenInvoices: number | null }>> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const toko = await prisma.store.findUnique({ where: { id }, select: { creditLimit: true, maxOpenInvoices: true } });
  if (!toko) return { ok: false, code: "not_found", message: "Store not found." };
  return {
    ok: true,
    data: { creditLimit: toko.creditLimit === null ? null : Number(toko.creditLimit), maxOpenInvoices: toko.maxOpenInvoices },
  };
}

/**
 * Bahan pemilih kelas di formulir toko: kelas toko ini (bila `id` diberikan)
 * dan jarak kunjungan tiap kelas, supaya pilihannya berbunyi "Kelas A — tiap
 * 7 hari" dan admin tahu akibat pilihannya.
 */
export async function bacaKelasTokoAction(id: string | null): Promise<
  ActionResult<{ storeClass: KelasToko | null; jarakHari: Record<KelasToko, number>; batasUmum: number }>
> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const [toko, setelan] = await Promise.all([
    id ? prisma.store.findUnique({ where: { id }, select: { storeClass: true } }) : Promise.resolve(null),
    prisma.systemSetting.findMany({
      where: { key: { in: [KUNCI_KELAS_TOKO, KUNCI_BATAS_HARI] } },
      select: { key: true, value: true },
    }),
  ]);
  if (id && !toko) return { ok: false, code: "not_found", message: "Store not found." };
  const nilai = (k: string) => setelan.find((s) => s.key === k)?.value ?? null;
  return {
    ok: true,
    data: {
      storeClass: bacaKelas(toko?.storeClass),
      jarakHari: bacaAturanKelasToko(nilai(KUNCI_KELAS_TOKO)).jarakHari,
      batasUmum: bacaBatasHari(nilai(KUNCI_BATAS_HARI)).hari,
    },
  };
}

export async function deactivateStoreAction(id: string): Promise<ActionResult> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  try {
    await deactivateStore(id);
    revalidatePath("/backoffice/stores");
    return { ok: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return { ok: false, code: "not_found", message: "Store not found." };
    }
    throw e;
  }
}

/**
 * Rotasi massal: pindahkan semua toko dalam satu lingkup (area, pemegang
 * sekarang, atau toko terpilih) ke satu sales, atau kosongkan pemegangnya.
 */
export async function pindahkanTokoAction(input: {
  lingkup: LingkupPindah;
  keSalesmanId: string | null;
}): Promise<ActionResult<{ jumlah: number }>> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const hasil = await pindahkanToko({ ...input, olehUserId: gate.userId });
  if (!hasil.ok) return { ok: false, code: hasil.alasan, message: hasil.alasan };
  revalidatePath("/backoffice/stores");
  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/pwa/stores");
  return { ok: true, data: { jumlah: hasil.jumlah } };
}

/**
 * Pratinjau rotasi: berapa toko dalam lingkup, dan berapa yang benar-benar
 * akan berpindah (yang sudah dipegang tujuan dilewati). Ditampilkan sebelum
 * admin menekan Pindahkan — rotasi massal tidak boleh jadi tebakan.
 */
export async function pratinjauPindahAction(input: {
  lingkup: LingkupPindah;
  keSalesmanId: string | null;
}): Promise<ActionResult<{ dalamLingkup: number; akanPindah: number }>> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const l = lingkupPindah(input.lingkup);
  if (!l.ok) return { ok: false, code: l.alasan, message: l.alasan };
  const toko = await prisma.store.findMany({ where: l.where, select: { salesmanId: true } });
  return {
    ok: true,
    data: {
      dalamLingkup: toko.length,
      akanPindah: toko.filter((t) => t.salesmanId !== input.keSalesmanId).length,
    },
  };
}

const areaSchema = z.object({
  id: z.string().min(1).nullable(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(191),
  isActive: z.boolean(),
});

/** Tambah atau ubah satu area. Kodenya unik dan disimpan huruf besar (JGU, JTT). */
export async function simpanAreaAction(input: {
  id: string | null;
  code: string;
  name: string;
  isActive: boolean;
}): Promise<ActionResult<{ id: string }>> {
  const gate = await requireManage();
  if (!gate.ok) return gate;
  const parsed = areaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "validation", message: parsed.error.message };
  const { id, ...data } = parsed.data;
  try {
    const area = id
      ? await prisma.storeGroup.update({ where: { id }, data, select: { id: true } })
      : await prisma.storeGroup.create({ data, select: { id: true } });
    revalidatePath("/backoffice/stores");
    return { ok: true, data: { id: area.id } };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, code: "code_unique", message: "Area code already exists." };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return { ok: false, code: "not_found", message: "Area not found." };
    }
    throw e;
  }
}

const placeSearchSchema = z.object({
  q: z.string().min(1).max(500),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

/** Whether SerpAPI place search is configured (no key leaked). */
export async function getPlaceSearchAvailabilityAction(): Promise<{ configured: boolean }> {
  const gate = await requireManage();
  if (!gate.ok) return { configured: false };
  return { configured: Boolean(process.env.SERPAPI_KEY?.trim()) };
}

export async function searchStorePlacesAction(input: {
  q: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<
  | { ok: true; results: SerpPlaceResult[] }
  | {
      ok: false;
      code: "FORBIDDEN" | "EMPTY_QUERY" | "NO_API_KEY" | "UPSTREAM" | "RATE_LIMITED" | "validation";
      message: string;
    }
> {
  const gate = await requireManage();
  if (!gate.ok) return { ok: false, code: "FORBIDDEN", message: "Permission denied." };

  const parsed = placeSearchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "validation", message: parsed.error.message };
  }

  if (!takePlaceSearchSlot(gate.userId)) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "Please wait a moment before searching again.",
    };
  }

  const result = await searchPlacesViaSerpApi({
    q: parsed.data.q,
    lat: parsed.data.lat ?? null,
    lng: parsed.data.lng ?? null,
  });
  if (!result.ok) {
    return { ok: false, code: result.code, message: result.message };
  }
  return { ok: true, results: result.results };
}
