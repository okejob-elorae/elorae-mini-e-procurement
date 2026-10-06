import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  createSupplier,
  supplierSchema,
  supplierUpdateSchema,
  updateSupplier,
} from "@/lib/suppliers/mutations";
import { prisma } from "@elorae/db";
import {
  createPurchaseOrder,
  type OfflinePOCreatePayload,
  type POFormData,
} from "@/lib/purchase-orders/mutations";
import { getActorName, notifyPOCreated, notifySupplierCreated } from "@/app/actions/notifications";

export const dynamic = "force-dynamic";

/*
 * Pemutar ulang antrean luring (`lib/offline/sync.ts`). Rute ini tidak ada di
 * `ROUTE_PERMISSIONS`, jadi proxy hanya menjamin ada sesi: setiap operasi
 * memeriksa izin yang SAMA dengan aksi biasanya, dan hanya menerima field yang
 * boleh diisi lewat formulir biasa. Field lain (status, approvedById, isActive,
 * approvedAt, bankAccountEnc, …) ditolak 400, tidak diam-diam dibuang, supaya
 * antrean yang mencoba menyelundupkannya terlihat gagal.
 */

/** Izin per jenis operasi — sama dengan `createSupplierAction`, `updateSupplierAction`, `createPO`. */
const IZIN_OPERASI = {
  SUPPLIER_CREATE: PERMISSIONS.SUPPLIERS_CREATE,
  SUPPLIER_UPDATE: PERMISSIONS.SUPPLIERS_EDIT,
  PO_CREATE: PERMISSIONS.PURCHASE_ORDERS_CREATE,
} as const;

type JenisOperasi = keyof typeof IZIN_OPERASI;

function jenisDikenal(type: unknown): type is JenisOperasi {
  return typeof type === "string" && Object.prototype.hasOwnProperty.call(IZIN_OPERASI, type);
}

/** Buat: persis isian formulir pemasok; status selalu PENDING_APPROVAL dari `createSupplier`. */
const skemaBuatPemasok = supplierSchema.strict();

/**
 * Ubah: field formulir edit, MINUS `isActive` (mengaktifkan/menonaktifkan bukan
 * pekerjaan antrean luring). Rekening bank diperlakukan sama dengan aksi edit
 * biasa — dienkripsi oleh `updateSupplier`.
 */
const skemaUbahPemasok = supplierUpdateSchema
  .omit({ isActive: true })
  .extend({ id: z.string().min(1) })
  .strict();

function tolak(status: number, error: string, details?: unknown) {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

function ringkasPemasok(s: { id: string; code: string; name: string; status: string }) {
  // Jangan kirim balik bankAccountEnc atau kolom persetujuan ke browser.
  return { id: s.id, code: s.code, name: s.name, status: s.status };
}

// POST /api/sync - Process offline operations
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return tolak(401, "Unauthorized");
  }

  let operation: unknown;
  try {
    operation = await req.json();
  } catch {
    return tolak(400, "Invalid JSON");
  }
  const { type, payload } = (operation ?? {}) as { type?: unknown; payload?: unknown };

  // GRN tidak diputar ulang dari antrean: tabel GRN tidak punya kunci
  // idempotensi, jadi kiriman ulang bisa menerima barang dua kali. Formulir GRN
  // butuh sinyal dan menyimpan isiannya sebagai draf (`lib/offline/grn-draf.ts`).
  if (type === "GRN_CREATE") {
    return NextResponse.json({ error: "GRN needs a connection", code: "GRN_BUTUH_SINYAL" }, { status: 400 });
  }

  if (!jenisDikenal(type)) {
    return tolak(400, "Unknown operation type");
  }
  if (!hasPermission(session.user.permissions ?? [], IZIN_OPERASI[type])) {
    return tolak(403, "Forbidden: Insufficient permissions");
  }

  try {
    switch (type) {
      case "SUPPLIER_CREATE":
        return await handleSupplierCreate(payload, session.user.id);
      case "SUPPLIER_UPDATE":
        return await handleSupplierUpdate(payload);
      case "PO_CREATE":
        return await handlePOCreate(payload, session.user.id);
    }
  } catch (error) {
    console.error("Sync operation failed:", error);
    return tolak(500, "Sync operation failed");
  }
}

async function handleSupplierCreate(payload: unknown, userId: string) {
  const parsed = skemaBuatPemasok.safeParse(payload);
  if (!parsed.success) {
    return tolak(400, "Invalid supplier payload", parsed.error.issues);
  }
  try {
    const supplier = await createSupplier(parsed.data);
    getActorName(userId)
      .then((nama) => notifySupplierCreated(supplier.id, supplier.name, nama))
      .catch(() => {});
    return NextResponse.json({ success: true, data: ringkasPemasok(supplier) });
  } catch (error) {
    if (error instanceof Error && error.message === "Supplier code already exists") {
      return tolak(409, error.message);
    }
    console.error("Failed to sync supplier create:", error);
    return tolak(500, "Failed to create supplier");
  }
}

async function handleSupplierUpdate(payload: unknown) {
  // `categoryId` adalah sisa antrean lama; dibuang seperti dulu, bukan ditolak.
  const bersih =
    payload && typeof payload === "object"
      ? Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter(([k]) => k !== "categoryId"))
      : payload;
  const parsed = skemaUbahPemasok.safeParse(bersih);
  if (!parsed.success) {
    return tolak(400, "Invalid supplier payload", parsed.error.issues);
  }
  const { id, ...rest } = parsed.data;
  try {
    const supplier = await updateSupplier(id, rest);
    return NextResponse.json({ success: true, data: ringkasPemasok(supplier) });
  } catch (error) {
    if (error instanceof Error && error.message === "Supplier code already exists") {
      return tolak(409, error.message);
    }
    if ((error as { code?: unknown })?.code === "P2025") {
      return tolak(404, "Supplier not found");
    }
    console.error("Failed to sync supplier update:", error);
    return tolak(500, "Failed to update supplier");
  }
}

function tanggalAtauKosong(val: Date | string | null | undefined): Date | undefined {
  if (val == null || val === "") return undefined;
  return val instanceof Date ? val : new Date(val);
}

/**
 * Antrean PO luring → `POFormData`. Sengaja tidak memakai
 * `createPurchaseOrderFromOfflinePayload`: helper itu mengubah `variantSku` dan
 * `notes` yang kosong menjadi `null`, yang ditolak `poSchema`, sehingga setiap
 * PO luring gagal disinkronkan. Di sini yang kosong menjadi `undefined`.
 */
async function poDariAntrean(payload: OfflinePOCreatePayload): Promise<POFormData> {
  const items = payload.items.map((item) => ({
    itemId: item.itemId,
    variantSku: item.variantSku?.trim() || undefined,
    qty: item.qty,
    price: item.price,
    ppnIncluded: item.ppnIncluded ?? false,
    uomId: item.uomId ?? "",
    notes: item.notes ?? undefined,
  }));
  if (items.some((i) => !i.uomId)) {
    const itemIds = [...new Set(items.map((i) => i.itemId).filter((id): id is string => typeof id === "string"))];
    const dbItems = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, uomId: true } });
    const uomByItem = new Map(dbItems.map((r) => [r.id, r.uomId]));
    for (const line of items) {
      if (!line.uomId) line.uomId = uomByItem.get(line.itemId) ?? "";
    }
  }
  return {
    supplierId: payload.supplierId,
    etaDate: tanggalAtauKosong(payload.etaDate) ?? new Date(),
    paymentDueDate: tanggalAtauKosong(payload.paymentDueDate),
    notes: payload.notes,
    terms: payload.terms,
    items: items as POFormData["items"],
  };
}

async function handlePOCreate(payload: unknown, userId: string) {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { items?: unknown }).items)) {
    return tolak(400, "Invalid purchase order payload");
  }
  try {
    const data = await poDariAntrean(payload as OfflinePOCreatePayload);
    // Tanpa lead time, sama seperti jalur luring sebelumnya (rantai tidak dimuat luring).
    const po = await createPurchaseOrder(data, userId, { applyLeadTime: false });
    getActorName(userId)
      .then((nama) => notifyPOCreated(po.id, po.docNumber, nama))
      .catch(() => {});
    return NextResponse.json({ success: true, data: { id: po.id, docNumber: po.docNumber } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return tolak(400, "Invalid purchase order payload", error.issues);
    }
    console.error("Failed to sync PO create:", error);
    return tolak(500, "Failed to create purchase order");
  }
}
