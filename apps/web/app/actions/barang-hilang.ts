"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { parseItemVariants } from "@/lib/items/variants";
import { labelVarian } from "@/lib/konsinyasi/stok-di-toko";
import { bolehMengelola } from "@/lib/receivables/izin";
import {
  batalkanBarangHilang,
  buatBarangHilang,
  putuskanBarangHilang,
  tandaiSalesDipotong,
  tandaiTokoDitagih,
  ubahKeputusanHilang,
} from "@/lib/spg/hilang-writer";

/**
 * Aksi kantor barang hilang. Semua tulisan dijaga `receivables:manage` —
 * menetapkan beban adalah keputusan penagihan (`bolehMengelola`,
 * lib/receivables/izin.ts), dan pemisahan tugas itulah yang membuat potongan
 * gaji/komisi bisa dipertanggungjawabkan. Melihat cukup `spg_sales:view`
 * (halaman memagari dirinya). Aksi mengembalikan `{ ok:false, code }`, tidak
 * pernah melempar.
 */

type Gagal = { ok: false; code: string };

async function pengelola(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return bolehMengelola(session.user.permissions) ? session.user.id : null;
}

async function sesi(): Promise<{ userId: string } | Gagal> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (!bolehMengelola(session.user.permissions)) return { ok: false, code: "FORBIDDEN" };
  return { userId: session.user.id };
}

const segarkan = (lossId?: string) => {
  revalidatePath("/backoffice/barang-hilang");
  if (lossId) revalidatePath(`/backoffice/barang-hilang/${lossId}`);
  revalidatePath("/pwa/beban");
};

export type BarangHilangCari = { itemId: string; sku: string; nama: string; varian: { variantSku: string; label: string | null }[] };

/** Cari barang jadi untuk formulir catat manual (nama atau SKU, minimal 2 huruf). */
export async function cariBarangHilangAction(query: string): Promise<{ ok: true; barang: BarangHilangCari[] } | Gagal> {
  if (!(await pengelola())) return { ok: false, code: "FORBIDDEN" };
  const q = String(query ?? "").trim().slice(0, 100);
  if (q.length < 2) return { ok: true, barang: [] };
  const rows = await prisma.item.findMany({
    where: {
      isActive: true,
      type: "FINISHED_GOOD",
      OR: [{ sku: { contains: q, mode: "insensitive" } }, { nameId: { contains: q, mode: "insensitive" } }],
    },
    orderBy: { nameId: "asc" },
    take: 20,
    select: { id: true, sku: true, nameId: true, variants: true },
  });
  return {
    ok: true,
    barang: rows.map((r) => {
      const skus = [...new Set(parseItemVariants(r.variants).map((v) => (v.sku ?? "").trim()).filter(Boolean))];
      return {
        itemId: r.id,
        sku: r.sku,
        nama: r.nameId,
        varian: skus.length ? skus.map((s) => ({ variantSku: s, label: labelVarian(r.variants, s) })) : [{ variantSku: "", label: null }],
      };
    }),
  };
}

export async function buatBarangHilangAction(input: {
  storeId?: string | null;
  baris: { itemId: string; variantSku: string; qty: number }[];
  catatan: string;
  idempotencyKey: string;
}): Promise<{ ok: true; id: string } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  const r = await buatBarangHilang({ ...input, userId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan(r.id);
  return { ok: true, id: r.id };
}

/**
 * `bagian` = pembagian SEBELUM keringanan. Dengan `keringananPersen` (bulat
 * 1–100), server sendiri yang mengurangi bagian SPG/SALES dan memindahkan
 * selisihnya ke Elorae — angka hasil hitungan layar tidak dipercaya.
 */
type IsianKeputusan = {
  lossId: string;
  bagian: { bearer: string; bearerUserId: string | null; amount: number }[];
  total?: number | null;
  catatan?: string | null;
  keringananPersen?: number | null;
};

export async function putuskanBarangHilangAction(input: IsianKeputusan): Promise<{ ok: true } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  const r = await putuskanBarangHilang({ ...input, olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan(r.id);
  return { ok: true };
}

export async function ubahKeputusanHilangAction(input: IsianKeputusan): Promise<{ ok: true } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  const r = await ubahKeputusanHilang({ ...input, catatan: input.catatan ?? "", olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan(r.id);
  return { ok: true };
}

export async function batalkanBarangHilangAction(input: { lossId: string; alasan: string }): Promise<{ ok: true } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  const r = await batalkanBarangHilang({ lossId: input.lossId, alasan: input.alasan, olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan(r.id);
  return { ok: true };
}

/** Bagian TOKO di toko putus sudah ditagih ke toko (di luar sistem). */
export async function tandaiTokoDitagihAction(input: { shareId: string; catatan?: string | null }): Promise<{ ok: true } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  const r = await tandaiTokoDitagih({ shareId: input.shareId, catatan: input.catatan, olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan(r.lossId);
  return { ok: true };
}

/** Laporan komisi salesman: beban SALES sudah dipotong dari komisi bulan itu. */
export async function tandaiSalesDipotongAction(input: {
  salesmanId: string;
  bulan: string;
  jumlah: number;
  kunci: string;
  catatan?: string | null;
}): Promise<{ ok: true; dipotong: number } | Gagal> {
  const s = await sesi();
  if ("ok" in s) return s;
  if (typeof input.salesmanId !== "string" || !input.salesmanId) return { ok: false, code: "INVALID" };
  const r = await tandaiSalesDipotong({ ...input, olehUserId: s.userId });
  if (!r.ok) return { ok: false, code: r.kode };
  segarkan();
  revalidatePath("/backoffice/laporan/komisi-salesman");
  return { ok: true, dipotong: r.dipotong };
}
