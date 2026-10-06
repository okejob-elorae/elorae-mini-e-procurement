"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { JENIS_KIRIMAN } from "@/lib/spg/kiriman";
import { ALASAN_PERMINTAAN } from "@/lib/spg/saran-minta";
import { catatBarangDicari, catatOpname, mintaKiriman, terimaKiriman, ubahStatusPermintaan } from "@/lib/spg/stok-writer";
import { getActiveVisit } from "@/lib/stores/queries";
import { cariKunjunganAntrean } from "@/lib/pwa/kunjungan-antrean";

/**
 * Aksi stok toko untuk SPG (terima kiriman, opname, minta kiriman, barang
 * dicari) dan satu aksi kantor (status permintaan kiriman). Permintaan kiriman
 * juga dikabarkan ke salesman pemegang toko oleh penulisnya (`mintaKiriman`).
 *
 * Toko TIDAK PERNAH diambil dari layar: selalu toko tetap SPG
 * (`User.assignedStoreId`). Hasil dikembalikan sebagai kode, bukan dilempar,
 * supaya pesan galat tidak disamarkan Next di produksi.
 */

type KodeUmum = "FORBIDDEN" | "NO_ASSIGNED_STORE" | "NO_ACTIVE_VISIT" | "KUNJUNGAN_TIDAK_SAH" | "VALIDATION";
export type HasilSpgStok<T extends object = object> = ({ ok: true } & T) | { ok: false; code: string; noKonsi?: string[] };

/**
 * Kiriman dari antrean HP (dicatat tanpa sinyal): diikat ke kunjungan saat
 * pekerjaannya dilakukan, bukan ke check-in yang aktif saat sinyal kembali.
 */
type Antrean = { visitId?: string | null; visitClientId?: string | null };

async function konteks(
  butuhKunjungan: boolean,
  antrean?: Antrean,
): Promise<{ userId: string; storeId: string } | { ok: false; code: KodeUmum }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { assignedStoreId: true } });
  if (!me?.assignedStoreId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  // Menghitung barang dan menerima kiriman adalah pekerjaan DI toko — sama
  // dengan mencatat penjualan, butuh check-in di toko itu. Dari antrean HP,
  // kunjungannya boleh sudah check-out (sinyal sering kembali sesudah pulang),
  // tapi harus milik SPG ini di tokonya.
  if (antrean) {
    const visitId = await cariKunjunganAntrean({ userId: session.user.id, storeId: me.assignedStoreId, ...antrean });
    if (!visitId) return { ok: false, code: "KUNJUNGAN_TIDAK_SAH" };
  } else if (butuhKunjungan) {
    const aktif = await getActiveVisit(session.user.id);
    if (!aktif || aktif.storeId !== me.assignedStoreId) return { ok: false, code: "NO_ACTIVE_VISIT" };
  }
  return { userId: session.user.id, storeId: me.assignedStoreId };
}

/** Kolom bersama kiriman dari HP: kunci sekali per formulir, dan tanda antrean. */
const kolomAntrean = {
  idempotencyKey: z.string().min(1).max(100).optional(),
  /** Dikirim dari antrean HP (dicatat tanpa sinyal). */
  luring: z.boolean().optional(),
  /** Saat pekerjaannya dilakukan di HP (ISO) — hanya bersama `luring`. */
  waktuTangkap: z.string().datetime().optional(),
  visitId: z.string().min(1).max(100).nullable().optional(),
  visitClientId: z.string().min(1).max(100).nullable().optional(),
};

const antreanDari = (d: { luring?: boolean; visitId?: string | null; visitClientId?: string | null }): Antrean | undefined =>
  d.luring ? { visitId: d.visitId ?? null, visitClientId: d.visitClientId ?? null } : undefined;

const segarkan = () => {
  revalidatePath("/pwa");
  revalidatePath("/pwa/spg/stok");
  revalidatePath("/pwa/spg/terima");
  revalidatePath("/pwa/spg/opname");
  revalidatePath("/pwa/spg/mutasi");
};

const terimaSchema = z.object({
  sourceType: z.enum(JENIS_KIRIMAN as [string, ...string[]]),
  sourceId: z.string().min(1),
  diterima: z
    .array(
      z.object({
        lineId: z.string().min(1),
        qtyReceived: z.number().int().min(0).max(100_000),
        // Barang rusak saat tiba (≤ diterima) — penulis memeriksa batasnya,
        // keterangan wajibnya, dan bahwa fotonya foto kita (`/api/foto/<id>`).
        qtyDamaged: z.number().int().min(0).max(100_000).optional(),
        damageNote: z.string().max(500).optional(),
        damagePhotoUrl: z.string().max(200).nullable().optional(),
      }),
    )
    .min(1),
  note: z.string().max(500).optional(),
  ...kolomAntrean,
});

export async function terimaKirimanAction(input: unknown): Promise<HasilSpgStok<{ receiptId: string }>> {
  const parsed = terimaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks(true, antreanDari(parsed.data));
  if ("ok" in k) return k;
  const hasil = await terimaKiriman({
    storeId: k.storeId,
    userId: k.userId,
    sourceType: parsed.data.sourceType as (typeof JENIS_KIRIMAN)[number],
    sourceId: parsed.data.sourceId,
    diterima: parsed.data.diterima,
    note: parsed.data.note,
    idempotencyKey: parsed.data.idempotencyKey ?? null,
    waktuTangkap: parsed.data.luring && parsed.data.waktuTangkap ? new Date(parsed.data.waktuTangkap) : null,
  });
  // Mutasi (MUTASI / MUTASI_KEMBALI) memakai jalur yang sama; penolakan siklus
  // terkunci membawa nomor siklusnya supaya layar bisa menyebutnya.
  if (!hasil.ok) return { ok: false, code: hasil.alasan, ...(hasil.noKonsi ? { noKonsi: hasil.noKonsi } : {}) };
  segarkan();
  if (parsed.data.sourceType === "MUTASI" || parsed.data.sourceType === "MUTASI_KEMBALI") {
    revalidatePath(`/pwa/spg/mutasi/${parsed.data.sourceId}`);
    revalidatePath("/backoffice/spg-transfers");
  }
  if (parsed.data.diterima.some((d) => (d.qtyDamaged ?? 0) > 0)) revalidatePath("/backoffice/spg-kiriman-rusak");
  return { ok: true, receiptId: hasil.receiptId };
}

const barisSchema = z.object({ itemId: z.string().min(1), variantSku: z.string().nullable() });

const opnameSchema = z.object({
  // `umurHitungMs`: berapa lama sebelum disimpan baris itu dihitung — saldo acuannya saat itu.
  baris: z
    .array(barisSchema.extend({ qtyCounted: z.number().int().min(0).max(100_000), umurHitungMs: z.number().int().min(0).optional() }))
    .min(1)
    .max(2_000),
  note: z.string().max(500).optional(),
  ...kolomAntrean,
});

export async function catatOpnameAction(
  input: unknown,
): Promise<HasilSpgStok<{ opnameId: string; selisih: number; dilewati?: number }>> {
  const parsed = opnameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks(true, antreanDari(parsed.data));
  if ("ok" in k) return k;
  const hasil = await catatOpname({
    storeId: k.storeId,
    userId: k.userId,
    baris: parsed.data.baris,
    note: parsed.data.note,
    idempotencyKey: parsed.data.idempotencyKey ?? null,
    waktuTangkap: parsed.data.luring && parsed.data.waktuTangkap ? new Date(parsed.data.waktuTangkap) : null,
  });
  if (!hasil.ok) return { ok: false, code: hasil.alasan };
  segarkan();
  return { ok: true, opnameId: hasil.opnameId, selisih: hasil.selisih, ...(hasil.dilewati ? { dilewati: hasil.dilewati } : {}) };
}

const mintaSchema = z.object({
  baris: z
    .array(
      barisSchema.extend({
        qty: z.number().int().min(1).max(10_000),
        // Alasan baris: dari saran/analisa, atau MANUAL (dipilih sendiri). Tanpa alasan = MANUAL.
        alasan: z.enum(ALASAN_PERMINTAAN).optional(),
      }),
    )
    .min(1)
    .max(500),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1).max(100),
});

export async function mintaKirimanAction(input: unknown): Promise<HasilSpgStok<{ requestId: string }>> {
  const parsed = mintaSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks(false);
  if ("ok" in k) return k;
  const hasil = await mintaKiriman({ storeId: k.storeId, userId: k.userId, ...parsed.data });
  if (!hasil.ok) return { ok: false, code: hasil.alasan };
  revalidatePath("/pwa/spg/stok");
  revalidatePath("/pwa/permintaan");
  revalidatePath("/backoffice/spg-requests");
  return { ok: true, requestId: hasil.requestId };
}

const dicariSchema = z.object({
  itemId: z.string().min(1).nullable().optional(),
  variantSku: z.string().nullable().optional(),
  description: z.string().min(1).max(200),
  qty: z.number().int().min(1).max(999),
});

export async function catatBarangDicariAction(input: unknown): Promise<HasilSpgStok> {
  const parsed = dicariSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteks(false);
  if ("ok" in k) return k;
  const hasil = await catatBarangDicari({ storeId: k.storeId, userId: k.userId, ...parsed.data });
  if (!hasil.ok) return { ok: false, code: hasil.alasan };
  revalidatePath("/pwa/spg/dicari");
  revalidatePath("/backoffice/spg-lost-sales");
  return { ok: true };
}

const statusSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(["DIPROSES", "SELESAI", "DITOLAK"]),
  note: z.string().max(500).optional(),
});

/**
 * Kantor: ubah status permintaan kiriman. Dijaga `stores:manage`. SPG yang
 * meminta diberi kabar (`PERMINTAAN_STOK_DIPROSES`) oleh penulisnya, sesudah
 * statusnya tersimpan.
 */
export async function ubahStatusPermintaanAction(input: unknown): Promise<HasilSpgStok> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const hasil = await ubahStatusPermintaan({ ...parsed.data, userId: session.user.id });
  if (!hasil.ok) return { ok: false, code: hasil.alasan };
  revalidatePath("/backoffice/spg-requests");
  return { ok: true };
}
