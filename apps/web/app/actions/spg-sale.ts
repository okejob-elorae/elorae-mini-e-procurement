"use server";

import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { recordSpgSale, type AlasanTanpaMember, type KodeGagalJualSpg, type MemberNota } from "@/lib/spg/sale-writer";
import { getActiveVisit } from "@/lib/stores/queries";
import { cariKunjunganAntrean } from "@/lib/pwa/kunjungan-antrean";

export type KodeGagalJualSpgAksi = "FORBIDDEN" | "NO_ASSIGNED_STORE" | "NO_ACTIVE_VISIT" | "KUNJUNGAN_TIDAK_SAH" | "VALIDATION" | KodeGagalJualSpg;

/**
 * `member` = member pada nota ini (baru didaftarkan atau sudah member).
 * `tanpaMember` = pembeli minta didaftarkan tapi tidak jadi — notanya TETAP
 * tercatat, hanya tanpa member; layar menjelaskan alasannya. Nota yang dikirim
 * ulang dengan kunci yang sama tidak membawa keduanya.
 */
export type RecordSpgSaleActionResult =
  | {
      ok: true;
      spgSaleId: string;
      docNo: string;
      changeGiven: number;
      total: number;
      member?: MemberNota | null;
      tanpaMember?: AlasanTanpaMember | null;
    }
  | { ok: false; code: KodeGagalJualSpgAksi };

// storeId is NOT taken from the client — it's derived server-side from the SPG's
// fixed `assignedStoreId`, so an SPG can only ever record a sale at their own store.
const schema = z.object({
  cashReceived: z.number().min(0).optional(),
  saleLat: z.number().min(-90).max(90).nullable().optional(),
  saleLng: z.number().min(-180).max(180).nullable().optional(),
  note: z.string().max(500).optional(),
  idempotencyKey: z.string().min(1),
  lines: z.array(z.object({ itemId: z.string().min(1), variantSku: z.string().nullable(), qty: z.number().int().positive() })).min(1),
  pembeli: z
    .union([
      // `daftarMember`: pembeli setuju didaftarkan sebagai member Elorae di nota ini.
      z.object({ id: z.string().min(1), daftarMember: z.boolean().optional() }),
      z.object({
        nama: z.string().trim().min(1).max(100),
        hp: z.string().trim().min(6).max(30),
        setuju: z.boolean(),
        daftarMember: z.boolean().optional(),
      }),
    ])
    .nullable()
    .optional(),
  diskonManual: z
    .object({ jenis: z.enum(["PERSEN", "RUPIAH"]), nilai: z.number().positive(), alasan: z.string().max(200).nullable().optional() })
    .nullable()
    .optional(),
  /** Dikirim dari antrean HP (dijual tanpa sinyal). */
  luring: z.boolean().optional(),
  /** Waktu jual di HP (ISO) — hanya dipakai bersama `luring`. */
  waktuJual: z.string().datetime().optional(),
  /** Kunjungan (check-in) saat barang dijual — hanya dipakai bersama `luring`. */
  visitId: z.string().min(1).nullable().optional(),
  /**
   * Check-in yang dicatat TANPA sinyal (`StoreVisit.clientId`, dibuat HP) —
   * pengganti `visitId` untuk nota yang dijual di kunjungan itu. Hanya bersama `luring`.
   */
  visitClientId: z.string().min(1).max(100).nullable().optional(),
});

export async function recordSpgSaleAction(input: unknown): Promise<RecordSpgSaleActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "VALIDATION" };
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) {
    return { ok: false, code: "FORBIDDEN" };
  }
  // Authoritative store = the SPG's assigned store; never trust a client-supplied id.
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { assignedStoreId: true } });
  if (!me?.assignedStoreId) return { ok: false, code: "NO_ASSIGNED_STORE" };
  const d = parsed.data;

  // Penjualan di konter butuh check-in yang MASIH aktif di toko tetapnya — penjaga
  // halaman saja bisa dilewati dari tab basi atau panggilan aksi langsung.
  // Penjualan dari antrean HP (tanpa sinyal) diikat ke kunjungan saat barangnya
  // dijual: kunjungan itu harus milik SPG ini di tokonya, tapi boleh sudah
  // check-out — sinyal sering baru kembali sesudah SPG pulang.
  let visitId: string;
  if (d.luring && (d.visitId || d.visitClientId)) {
    const kunjungan = await cariKunjunganAntrean({
      userId: session.user.id,
      storeId: me.assignedStoreId,
      visitId: d.visitId ?? null,
      visitClientId: d.visitClientId ?? null,
    });
    if (!kunjungan) return { ok: false, code: "KUNJUNGAN_TIDAK_SAH" };
    visitId = kunjungan;
  } else {
    const activeVisit = await getActiveVisit(session.user.id);
    if (!activeVisit || activeVisit.storeId !== me.assignedStoreId) return { ok: false, code: "NO_ACTIVE_VISIT" };
    visitId = activeVisit.id;
  }

  const res = await recordSpgSale({
    salesmanId: session.user.id,
    storeId: me.assignedStoreId,
    lines: d.lines,
    cashReceived: d.cashReceived,
    saleLat: d.saleLat ?? null,
    saleLng: d.saleLng ?? null,
    note: d.note,
    idempotencyKey: d.idempotencyKey,
    pembeli: d.pembeli ?? null,
    diskonManual: d.diskonManual ?? null,
    luring: Boolean(d.luring),
    waktuJual: d.luring && d.waktuJual ? new Date(d.waktuJual) : null,
    visitId,
  });
  if (res.ok) {
    return {
      ok: true,
      spgSaleId: res.spgSaleId,
      docNo: res.docNo,
      changeGiven: res.changeGiven,
      total: res.total,
      member: res.member ?? null,
      tanpaMember: res.tanpaMember ?? null,
    };
  }
  return { ok: false, code: res.code };
}
