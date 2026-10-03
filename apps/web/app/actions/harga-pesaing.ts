"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { kirimanUlang, periksaHargaPesaing, type KodeTolakHargaPesaing } from "@/lib/salesman/harga-pesaing";
import { rentangLaporan } from "@/lib/salesman/checklist-toko";
import { kunjunganUntukCatat, laporanHargaPesaing } from "@/lib/salesman/checklist-queries";

/**
 * Harga pesaing: salesman mencatat dari HP selama kunjungan di toko; kantor
 * membaca dan mengekspornya (`stores:view`).
 */

const idSah = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 64;

export type HasilCatatHargaPesaing =
  | { ok: true; id: string }
  | { ok: false; kode: KodeTolakHargaPesaing | "TANPA_AKSES" | "KUNJUNGAN_TIDAK_SAH" | "GAGAL" };

export async function catatHargaPesaingAction(input: {
  storeId: string;
  visitId: string;
  brand: string;
  productName: string;
  category: string | null;
  price: number;
  note: string | null;
  photoUrl: string | null;
}): Promise<HasilCatatHargaPesaing> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || pwaAccessGuard(session.user.permissions) !== "render") return { ok: false, kode: "TANPA_AKSES" };
  if (!input || !idSah(input.storeId) || !idSah(input.visitId)) return { ok: false, kode: "KUNJUNGAN_TIDAK_SAH" };
  const periksa = periksaHargaPesaing(input);
  if (!periksa.ok) return periksa;
  const h = periksa.nilai;

  try {
    const sekarang = new Date();
    const kunjungan = await kunjunganUntukCatat(userId, input.storeId, input.visitId, sekarang);
    if (!kunjungan) return { ok: false, kode: "KUNJUNGAN_TIDAK_SAH" };

    // Tabelnya tidak punya kunci idempoten: kiriman ulang (jawaban server
    // hilang di jalan) dikenali dari isinya yang sama dalam jeda singkat.
    const terakhir = await prisma.competitorPrice.findMany({
      where: { storeId: input.storeId, createdById: userId },
      select: { id: true, brand: true, productName: true, category: true, price: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const ulang = terakhir.find((t) => kirimanUlang(h, { ...t, price: t.price.toString() }, sekarang));
    if (ulang) return { ok: true, id: ulang.id };

    const baru = await prisma.competitorPrice.create({
      data: {
        storeId: input.storeId,
        visitId: kunjungan.id,
        brand: h.brand,
        productName: h.productName,
        category: h.category,
        price: h.price,
        note: h.note,
        photoUrl: h.photoUrl,
        createdById: userId,
      },
      select: { id: true },
    });
    revalidatePath(`/pwa/stores/${input.storeId}/harga-pesaing`);
    revalidatePath("/backoffice/harga-pesaing");
    return { ok: true, id: baru.id };
  } catch (err) {
    console.error("catatHargaPesaingAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

// ─── Ekspor (kantor) ─────────────────────────────────────────────────────────

export type LabelEksporHargaPesaing = {
  judul: string;
  ringkasan: string;
  rincian: string;
  semuaKategori: string;
  kolom: {
    merek: string;
    kategori: string;
    jumlah: string;
    min: string;
    rata: string;
    maks: string;
    tanggal: string;
    toko: string;
    area: string;
    produk: string;
    harga: string;
    catatan: string;
    oleh: string;
    foto: string;
  };
};

export type HasilEksporHargaPesaing = { ok: true; base64: string; filename: string } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

const teks = (x: unknown, cadangan: string): string => (typeof x === "string" && x.trim() ? x.slice(0, 200) : cadangan);

/**
 * Excel dua lembar: ringkasan min/rata/maks per merek × kategori, dan rincian
 * setiap catatan. Label kolom dikirim layar supaya mengikuti bahasa pengguna.
 */
export async function eksporHargaPesaingAction(
  saring: { dari?: string | null; sampai?: string | null; merek?: string | null; kategori?: string | null; groupId?: string | null },
  label: LabelEksporHargaPesaing,
): Promise<HasilEksporHargaPesaing> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_VIEW)) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = rentangLaporan(saring?.dari, saring?.sampai, new Date());
    const data = await laporanHargaPesaing({
      dari: r.dari,
      sampai: r.sampai,
      merek: typeof saring?.merek === "string" ? saring.merek.slice(0, 60) : null,
      kategori: typeof saring?.kategori === "string" ? saring.kategori.slice(0, 60) : null,
      groupId: idSah(saring?.groupId) ? saring.groupId : null,
    });
    const L = label ?? ({} as LabelEksporHargaPesaing);
    const k = L.kolom ?? ({} as LabelEksporHargaPesaing["kolom"]);
    const periode = `${r.dariStr} – ${r.sampaiStr}`;

    type Sel = string | number;
    const ringkas: Sel[][] = [
      [`${teks(L.judul, "Harga pesaing")} — ${periode}`],
      [],
      [teks(k.merek, "Merek"), teks(k.kategori, "Kategori"), teks(k.jumlah, "Jumlah"), teks(k.min, "Min"), teks(k.rata, "Rata-rata"), teks(k.maks, "Maks")],
      ...data.ringkas.map((g): Sel[] => [g.merek, g.kategori ?? teks(L.semuaKategori, "—"), g.jumlah, g.min, g.rata, g.maks]),
    ];
    const rincian: Sel[][] = [
      [
        teks(k.tanggal, "Tanggal"),
        teks(k.toko, "Toko"),
        teks(k.area, "Area"),
        teks(k.merek, "Merek"),
        teks(k.produk, "Produk"),
        teks(k.kategori, "Kategori"),
        teks(k.harga, "Harga"),
        teks(k.catatan, "Catatan"),
        teks(k.oleh, "Dicatat oleh"),
        teks(k.foto, "Foto"),
      ],
      ...data.baris.map((b): Sel[] => [
        b.hari,
        b.toko,
        b.area ?? "",
        b.merek,
        b.produk,
        b.kategori ?? "",
        b.harga,
        b.catatan ?? "",
        b.oleh,
        b.fotoUrl ?? "",
      ]),
    ];

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(ringkas);
    ws1["!cols"] = [24, 20, 10, 14, 14, 14].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws1, teks(L.ringkasan, "Ringkasan").slice(0, 31));
    const ws2 = XLSX.utils.aoa_to_sheet(rincian);
    ws2["!cols"] = [12, 24, 8, 20, 28, 16, 14, 30, 20, 30].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws2, teks(L.rincian, "Rincian").slice(0, 31));
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    return { ok: true, base64: buffer.toString("base64"), filename: `harga-pesaing-${r.dariStr}-${r.sampaiStr}.xlsx` };
  } catch (err) {
    console.error("eksporHargaPesaingAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}
