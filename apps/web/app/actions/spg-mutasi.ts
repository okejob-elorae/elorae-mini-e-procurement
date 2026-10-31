"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import {
  ARAH_MUTASI,
  bacaAturanMutasi,
  HARI_PENGINGAT_MAKS,
  KEPUTUSAN_ARAH,
  KUNCI_ATURAN_MUTASI,
  MODE_SALDO_MUTASI,
  type AturanMutasi,
} from "@/lib/spg/mutasi-aturan";
import {
  ajukanMutasi,
  alihkanTujuanMutasi,
  batalkanMutasi,
  kirimMutasi,
  putuskanSelisihMutasi,
  setujuiMutasi,
  terimaMutasiKantor,
  tolakMutasi,
  type BarisKurangSaldo,
} from "@/lib/spg/mutasi-writer";
import { getActiveVisit } from "@/lib/stores/queries";
import { cariKunjunganAntrean } from "@/lib/pwa/kunjungan-antrean";

/**
 * Aksi mutasi antar toko — SPG (ajukan, kirim, batal) dan kantor (setujui,
 * tolak, batalkan, alihkan tujuan, terima atas nama toko, putuskan selisih),
 * plus kartu pengaturannya.
 *
 * Toko SPG TIDAK PERNAH diambil dari layar: selalu `User.assignedStoreId`.
 * Hasil dikembalikan sebagai kode, bukan dilempar, supaya pesan galat tidak
 * disamarkan Next di produksi.
 *
 * Izin (tanpa kode izin baru): SPG `spg_sales:record`; keputusan kantor
 * `field_sales_orders:approve` (yang menyetujui pesanan lapangan); menerima atas
 * nama toko `stores:manage` (pengelola toko).
 */

export type HasilMutasiAksi =
  | { ok: true; id: string; docNo: string; status: string; kurangSaldo?: BarisKurangSaldo[] }
  | { ok: false; code: string; noKonsi?: string[]; kurang?: BarisKurangSaldo[] };

type KodeUmum = "FORBIDDEN" | "NO_ASSIGNED_STORE" | "NO_ACTIVE_VISIT" | "KUNJUNGAN_TIDAK_SAH" | "VALIDATION";

/**
 * Kiriman dari antrean HP (dicatat tanpa sinyal): diikat ke kunjungan saat
 * pekerjaannya dilakukan, bukan ke check-in yang aktif saat sinyal kembali.
 */
type Antrean = { visitId?: string | null; visitClientId?: string | null };

async function konteksSpg(
  butuhKunjungan: boolean,
  antrean?: Antrean,
): Promise<{ userId: string; storeId: string; kunjunganId: string | null } | { ok: false; code: KodeUmum }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { assignedStoreId: true } });
  if (!me?.assignedStoreId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  // Barang berpindah dari rak toko ini: mengajukan dan mengirim adalah pekerjaan
  // DI toko. Dari antrean HP, kunjungannya boleh sudah check-out (sinyal sering
  // kembali sesudah pulang), tapi harus milik SPG ini di tokonya.
  if (antrean) {
    const kunjunganId = await cariKunjunganAntrean({ userId: session.user.id, storeId: me.assignedStoreId, ...antrean });
    if (!kunjunganId) return { ok: false, code: "KUNJUNGAN_TIDAK_SAH" };
    return { userId: session.user.id, storeId: me.assignedStoreId, kunjunganId };
  }
  if (butuhKunjungan) {
    const aktif = await getActiveVisit(session.user.id);
    if (!aktif || aktif.storeId !== me.assignedStoreId) return { ok: false, code: "NO_ACTIVE_VISIT" };
  }
  return { userId: session.user.id, storeId: me.assignedStoreId, kunjunganId: null };
}

/** Kolom bersama kiriman dari antrean HP. */
const kolomAntrean = {
  /** Dikirim dari antrean HP (dicatat tanpa sinyal). */
  luring: z.boolean().optional(),
  /** Saat pekerjaannya dilakukan di HP (ISO) — hanya bersama `luring`. */
  waktuTangkap: z.string().datetime().optional(),
  visitId: z.string().min(1).max(100).nullable().optional(),
  visitClientId: z.string().min(1).max(100).nullable().optional(),
};

const antreanDari = (d: { luring?: boolean; visitId?: string | null; visitClientId?: string | null }): Antrean | undefined =>
  d.luring ? { visitId: d.visitId ?? null, visitClientId: d.visitClientId ?? null } : undefined;

const waktuTangkapDari = (d: { luring?: boolean; waktuTangkap?: string }): Date | null =>
  d.luring && d.waktuTangkap ? new Date(d.waktuTangkap) : null;

async function konteksKantor(izin: string): Promise<{ userId: string } | { ok: false; code: "FORBIDDEN" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], izin)) return { ok: false, code: "FORBIDDEN" };
  return { userId: session.user.id };
}

function segarkan(id?: string) {
  revalidatePath("/pwa");
  revalidatePath("/pwa/spg/mutasi");
  revalidatePath("/pwa/spg/terima");
  revalidatePath("/pwa/spg/stok");
  revalidatePath("/backoffice/spg-transfers");
  if (id) {
    revalidatePath(`/pwa/spg/mutasi/${id}`);
    revalidatePath(`/backoffice/spg-transfers/${id}`);
  }
}

type HasilPenulis =
  | { ok: true; id: string; docNo: string; status: string; kurangSaldo?: BarisKurangSaldo[] }
  | { ok: false; kode: string; noKonsi?: string[]; kurang?: BarisKurangSaldo[] };

function keAksi(h: HasilPenulis): HasilMutasiAksi {
  if (h.ok) {
    segarkan(h.id);
    return { ok: true, id: h.id, docNo: h.docNo, status: h.status, ...(h.kurangSaldo?.length ? { kurangSaldo: h.kurangSaldo } : {}) };
  }
  return { ok: false, code: h.kode, ...(h.noKonsi ? { noKonsi: h.noKonsi } : {}), ...(h.kurang ? { kurang: h.kurang } : {}) };
}

// ─── SPG ─────────────────────────────────────────────────────────────────────

const ajukanSchema = z.object({
  toStoreId: z.string().min(1).max(100),
  alasan: z.string().max(500),
  baris: z
    .array(z.object({ itemId: z.string().min(1).max(100), variantSku: z.string().max(200).nullable(), qty: z.number().int().min(1).max(10_000) }))
    .min(1)
    .max(200),
  idempotencyKey: z.string().min(1).max(100),
  ...kolomAntrean,
});

/**
 * SPG mengajukan mutasi. Dari antrean HP (`luring`): diikat ke kunjungan saat
 * diajukan, dan bertanggal waktu tangkapnya (lihat `ajukanMutasi`).
 */
export async function ajukanMutasiAction(input: unknown): Promise<HasilMutasiAksi> {
  const parsed = ajukanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksSpg(true, antreanDari(parsed.data));
  if ("ok" in k) return k;
  const h = await ajukanMutasi({
    userId: k.userId,
    fromStoreId: k.storeId,
    toStoreId: parsed.data.toStoreId,
    alasan: parsed.data.alasan,
    baris: parsed.data.baris.map((b) => ({ ...b, variantSku: b.variantSku ?? "" })),
    idempotencyKey: parsed.data.idempotencyKey,
    kunjunganId: k.kunjunganId,
    waktuTangkap: waktuTangkapDari(parsed.data),
  });
  return keAksi(h);
}

const idSchema = z.object({ transferId: z.string().min(1).max(100) });

const kirimSchema = idSchema.extend({
  /** Kunci kiriman dari HP, sekali per ketukan "Ya, sudah dikirim". */
  idempotencyKey: z.string().min(1).max(100).optional(),
  ...kolomAntrean,
});

/**
 * SPG menandai barang dikirim. Dari antrean HP (`luring`): stok toko asal
 * keluar pada waktu ditandai di HP, bukan saat sinyal kembali (lihat `kirimMutasi`).
 */
export async function kirimMutasiAction(input: unknown): Promise<HasilMutasiAksi> {
  const parsed = kirimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksSpg(true, antreanDari(parsed.data));
  if ("ok" in k) return k;
  return keAksi(
    await kirimMutasi({
      transferId: parsed.data.transferId,
      userId: k.userId,
      storeId: k.storeId,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      kunjunganId: k.kunjunganId,
      waktuTangkap: waktuTangkapDari(parsed.data),
    }),
  );
}

const batalSpgSchema = idSchema.extend({ alasan: z.string().max(500).optional() });

/** SPG toko asal membatalkan sebelum barang dikirim. Tidak butuh check-in: tidak ada barang yang bergerak. */
export async function batalkanMutasiSpgAction(input: unknown): Promise<HasilMutasiAksi> {
  const parsed = batalSpgSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksSpg(false);
  if ("ok" in k) return k;
  return keAksi(
    await batalkanMutasi({ transferId: parsed.data.transferId, olehUserId: k.userId, sebagai: "SPG", storeId: k.storeId, alasan: parsed.data.alasan }),
  );
}

// ─── Kantor ──────────────────────────────────────────────────────────────────

const teksSchema = idSchema.extend({ teks: z.string().max(500).optional() });

export async function setujuiMutasiAction(input: unknown): Promise<HasilMutasiAksi> {
  const parsed = teksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksKantor(PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
  if ("ok" in k) return k;
  return keAksi(await setujuiMutasi({ transferId: parsed.data.transferId, olehUserId: k.userId, catatan: parsed.data.teks }));
}

export async function tolakMutasiAction(input: unknown): Promise<HasilMutasiAksi> {
  const parsed = teksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksKantor(PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
  if ("ok" in k) return k;
  return keAksi(await tolakMutasi({ transferId: parsed.data.transferId, olehUserId: k.userId, alasan: parsed.data.teks }));
}

export async function batalkanMutasiKantorAction(input: unknown): Promise<HasilMutasiAksi> {
  const parsed = teksSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksKantor(PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
  if ("ok" in k) return k;
  return keAksi(await batalkanMutasi({ transferId: parsed.data.transferId, olehUserId: k.userId, sebagai: "KANTOR", alasan: parsed.data.teks }));
}

const alihkanSchema = teksSchema.extend({ toStoreId: z.string().min(1).max(100) });

export async function alihkanTujuanMutasiAction(input: unknown): Promise<HasilMutasiAksi> {
  const parsed = alihkanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksKantor(PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
  if ("ok" in k) return k;
  return keAksi(
    await alihkanTujuanMutasi({ transferId: parsed.data.transferId, olehUserId: k.userId, toStoreId: parsed.data.toStoreId, alasan: parsed.data.teks }),
  );
}

const selisihSchema = teksSchema.extend({ keputusan: z.enum(["HILANG", "KEMBALI"]), setujuSiklusTerkunci: z.boolean().optional() });

export async function putuskanSelisihMutasiAction(input: unknown): Promise<HasilMutasiAksi> {
  const parsed = selisihSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksKantor(PERMISSIONS.FIELD_SALES_ORDERS_APPROVE);
  if ("ok" in k) return k;
  return keAksi(
    await putuskanSelisihMutasi({
      transferId: parsed.data.transferId,
      olehUserId: k.userId,
      keputusan: parsed.data.keputusan,
      catatan: parsed.data.teks,
      setujuSiklusTerkunci: parsed.data.setujuSiklusTerkunci,
    }),
  );
}

const terimaKantorSchema = z.object({
  transferId: z.string().min(1).max(100),
  sumber: z.enum(["MUTASI", "MUTASI_KEMBALI"]),
  diterima: z.array(z.object({ lineId: z.string().min(1), qtyReceived: z.number().int().min(0).max(100_000) })).min(1),
  catatan: z.string().max(500).optional(),
  setujuSiklusTerkunci: z.boolean().optional(),
});

/** Kantor menerima atas nama toko tanpa SPG, atau kiriman yang macet. Dijaga `stores:manage`. */
export async function terimaMutasiKantorAction(input: unknown): Promise<{ ok: true } | { ok: false; code: string; noKonsi?: string[] }> {
  const parsed = terimaKantorSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const k = await konteksKantor(PERMISSIONS.STORES_MANAGE);
  if ("ok" in k) return k;
  const h = await terimaMutasiKantor({ ...parsed.data, olehUserId: k.userId });
  if (!h.ok) return { ok: false, code: h.alasan, ...(h.noKonsi ? { noKonsi: h.noKonsi } : {}) };
  segarkan(parsed.data.transferId);
  return { ok: true };
}

// ─── Pengaturan ──────────────────────────────────────────────────────────────

/**
 * Aturan mutasi (`SystemSetting["spg.mutasi"]`). Dijaga
 * `field_sales_orders:approve`, sama dengan pengaturan salesman lain. Nilai
 * yang disimpan harus terbaca kembali persis sama oleh `bacaAturanMutasi`,
 * supaya layar pengaturan tidak pernah menampilkan aturan yang berbeda dari
 * yang dipakai server.
 */
export async function simpanAturanMutasi(isi: AturanMutasi): Promise<{ ok: true } | { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "INVALID" }> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.FIELD_SALES_ORDERS_APPROVE)) return { ok: false, code: "FORBIDDEN" };
  if (
    !isi ||
    typeof isi !== "object" ||
    typeof isi.aktif !== "boolean" ||
    typeof isi.tujuanTanpaSpg !== "boolean" ||
    !(MODE_SALDO_MUTASI as readonly string[]).includes(isi.saldo) ||
    !Number.isInteger(isi.hariPengingat) ||
    isi.hariPengingat < 1 ||
    isi.hariPengingat > HARI_PENGINGAT_MAKS ||
    !isi.aturan ||
    typeof isi.aturan !== "object" ||
    !ARAH_MUTASI.every((a) => (KEPUTUSAN_ARAH as readonly string[]).includes(isi.aturan[a]))
  ) {
    return { ok: false, code: "INVALID" };
  }
  const aturan: AturanMutasi = {
    aktif: isi.aktif,
    aturan: Object.fromEntries(ARAH_MUTASI.map((a) => [a, isi.aturan[a]])) as AturanMutasi["aturan"],
    saldo: isi.saldo,
    tujuanTanpaSpg: isi.tujuanTanpaSpg,
    hariPengingat: isi.hariPengingat,
  };
  const nilai = JSON.stringify(aturan);
  // `LANGSUNG` untuk arah yang melibatkan toko PUTUS tidak terbaca kembali sama — ditolak di sini.
  if (JSON.stringify(bacaAturanMutasi(nilai)) !== nilai) return { ok: false, code: "INVALID" };

  await prisma.systemSetting.upsert({
    where: { key: KUNCI_ATURAN_MUTASI },
    create: { key: KUNCI_ATURAN_MUTASI, value: nilai },
    update: { value: nilai },
  });
  revalidatePath("/backoffice/settings/salesman");
  revalidatePath("/pwa/spg/mutasi");
  return { ok: true };
}
