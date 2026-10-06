"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";
import { createFieldSalesOrder } from "@/lib/field-sales/writer";
import { KreditDiblokirError } from "@/lib/field-sales/kredit-pesanan";
import { NoActiveVisitError, MinQtyViolationError } from "@/lib/field-sales/errors";
import { BarangTanpaHargaError } from "@/lib/field-sales/harga-wajib";
import { getPackRatio } from "@/app/actions/settings/pack-ratio";
import {
  HARI_BARU_MAKS,
  MAKS_ANGGARAN,
  MAKS_ARTIKEL,
  MAKS_PCS_ARTIKEL,
  MAKS_SISA_LEWATI,
  ARTIKEL_BAWAAN,
  SUMBER_RENCANA,
} from "@/lib/field-sales/smart-request/kriteria";
import { susunRencanaKirim } from "@/lib/field-sales/smart-request/rencana";
import { muatBahanRencana } from "@/lib/field-sales/smart-request/rencana-queries";
import { susunDraf, type DrafRencana } from "@/lib/field-sales/smart-request/rencana-draf";
import type { SubmitResult } from "@/app/pwa/stores/[id]/catalog/actions";

/**
 * Rencana kirim: susun draf pesanan dari kriteria (baca saja), lalu kirim draf
 * yang sudah ditinjau salesman lewat penulis pesanan biasa.
 *
 * Penjaga yang sama di kedua aksi, dinilai di server:
 *   - hanya pemegang `pwa:access`, dan SPG (toko tetap) ditolak — ia tidak mengambil pesanan;
 *   - toko harus ada dan aktif;
 *   - kunci "hanya toko sendiri": toko pegangan orang lain ditolak.
 * Kunjungan aktif hanya syarat MENGIRIM (dinilai penulis), bukan menyusun —
 * salesman boleh menyiapkan rencana sebelum tiba.
 */

type TokoRencana = { id: string; termsType: "PUTUS" | "KONSI"; marginPercent: number | null };

/**
 * Salesman yang masuk: `pwa:access` dan BUKAN SPG — SPG (toko tetap) menjual
 * dari layarnya sendiri dan tidak mengambil pesanan.
 */
async function salesmanMasuk(): Promise<string | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !(session.user.permissions ?? []).includes("pwa:access")) return null;
  if (await ambilTokoTetap(userId)) return null;
  return userId;
}

/** Toko aktif yang boleh dipegang salesman ini (kunci "hanya toko sendiri"). */
async function tokoBoleh(
  storeId: string,
  userId: string,
): Promise<{ ok: true; toko: TokoRencana } | { ok: false; code: "TOKO_TIDAK_AKTIF" | "BUKAN_TOKO_SAYA" }> {
  const toko = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, isActive: true, termsType: true, marginPercent: true, salesmanId: true },
  });
  if (!toko || !toko.isActive) return { ok: false, code: "TOKO_TIDAK_AKTIF" };
  if (!bolehPegangToko({ terkunci: await tokoTerkunci(), penanggungJawabId: toko.salesmanId, userId })) {
    return { ok: false, code: "BUKAN_TOKO_SAYA" };
  }
  return {
    ok: true,
    toko: {
      id: toko.id,
      termsType: toko.termsType,
      marginPercent: toko.marginPercent == null ? null : Number(toko.marginPercent),
    },
  };
}

export type HasilBangunRencana =
  | ({ ok: true } & DrafRencana)
  | { ok: false; code: "UNAUTHORIZED" | "TOKO_TIDAK_AKTIF" | "BUKAN_TOKO_SAYA" | "TIDAK_VALID" | "NO_RATIO" };

const bangunSchema = z.object({
  storeId: z.string().min(1).max(64),
  kategoriIds: z.array(z.string().min(1).max(64)).min(1).max(100),
  sumber: z.array(z.enum(SUMBER_RENCANA)).min(1),
  jumlah: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("PACK") }),
    z.object({ mode: z.literal("PCS"), pcs: z.number().int().min(1).max(MAKS_PCS_ARTIKEL) }),
  ]),
  hariBaru: z.number().int().min(1).max(HARI_BARU_MAKS),
  lewatiSisaMin: z.number().int().min(1).max(MAKS_SISA_LEWATI).nullable(),
  maksArtikel: z.number().int().min(1).max(MAKS_ARTIKEL).optional(),
  anggaran: z.number().int().min(1).max(MAKS_ANGGARAN).nullable(),
});

export async function bangunRencanaKirimAction(input: unknown): Promise<HasilBangunRencana> {
  const userId = await salesmanMasuk();
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  const parsed = bangunSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "TIDAK_VALID" };
  const k = parsed.data;
  const penjaga = await tokoBoleh(k.storeId, userId);
  if (!penjaga.ok) return penjaga;
  const konsi = penjaga.toko.termsType === "KONSI";

  const ratio = await getPackRatio();
  if (k.jumlah.mode === "PACK" && ratio.length === 0) return { ok: false, code: "NO_RATIO" };

  const hariIni = new Date();
  const [{ bahan, info }, kategori] = await Promise.all([
    muatBahanRencana({
      storeId: penjaga.toko.id,
      termsType: penjaga.toko.termsType,
      marginPercent: penjaga.toko.marginPercent,
      kategoriIds: k.kategoriIds,
      sumber: k.sumber,
      hariIni,
    }),
    prisma.itemCategory.findMany({ where: { id: { in: k.kategoriIds } }, select: { id: true, name: true } }),
  ]);

  const hasil = susunRencanaKirim(
    bahan,
    {
      kategoriIds: k.kategoriIds,
      sumber: k.sumber,
      jumlah: k.jumlah,
      hariBaru: k.hariBaru,
      lewatiSisaMin: k.lewatiSisaMin,
      maksArtikel: k.maksArtikel ?? ARTIKEL_BAWAAN,
      // Konsinyasi tidak punya harga di HP, jadi juga tidak punya anggaran.
      anggaran: konsi ? null : k.anggaran,
      konsi,
    },
    ratio,
  );
  const draf = susunDraf({ hasil, info, namaKategori: new Map(kategori.map((c) => [c.id, c.name])), konsi });
  return { ok: true, ...draf };
}

export type HasilKirimRencana = SubmitResult | { ok: false; code: "TOKO_TIDAK_AKTIF" | "BUKAN_TOKO_SAYA" };

const kirimSchema = z.object({
  storeId: z.string().min(1).max(64),
  visitId: z.string().min(1).max(64).optional(),
  idempotencyKey: z.string().min(8).max(100),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1).max(64),
        variantSku: z.string().max(191),
        productName: z.string().min(1).max(300),
        qty: z.number().int().positive().max(MAKS_PCS_ARTIKEL * 10),
      }),
    )
    .min(1)
    .max(1000),
});

/**
 * Kirim draf yang sudah ditinjau. HP tidak pernah mengirim harga: penulis
 * menghitung harga toko putus sendiri dan memberi konsinyasi harga 0 (dinaikkan
 * saat disetujui). Minimum pesanan putus dilewati seperti pesanan cepat yang
 * lama — rencananya sendiri yang menentukan jumlah per artikel; kredit, kunjungan
 * aktif, dan persetujuan kantor tetap dinilai penulis.
 */
export async function kirimRencanaKirimAction(input: unknown): Promise<HasilKirimRencana> {
  const userId = await salesmanMasuk();
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  const parsed = kirimSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "EMPTY" };
  const penjaga = await tokoBoleh(parsed.data.storeId, userId);
  if (!penjaga.ok) return penjaga;
  try {
    const { orderId, orderNo, kreditDitahan } = await createFieldSalesOrder({
      storeId: penjaga.toko.id,
      salesmanId: userId,
      visitId: parsed.data.visitId,
      lines: parsed.data.lines.map((l) => ({ ...l, unitPrice: 0 })),
      idempotencyKey: parsed.data.idempotencyKey,
      skipMinQty: true,
    });
    revalidatePath(`/pwa/stores/${penjaga.toko.id}`);
    revalidatePath("/pwa/orders");
    return { ok: true, orderId, orderNo, kreditDitahan };
  } catch (e) {
    if (e instanceof KreditDiblokirError) return { ok: false, code: "KREDIT_DIBLOKIR", alasan: e.alasan };
    if (e instanceof NoActiveVisitError) return { ok: false, code: "NO_ACTIVE_VISIT" };
    if (e instanceof MinQtyViolationError) return { ok: false, code: "MIN_QTY", violations: e.violations };
    // Draf melewati barang tanpa harga; ini hanya terjadi bila harganya dikosongkan sesudah draf disusun.
    if (e instanceof BarangTanpaHargaError) return { ok: false, code: "BARANG_TANPA_HARGA", itemIds: e.itemIds };
    throw e;
  }
}
