"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDateTime } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bacaChipBayar } from "@/lib/creative/bayar-aturan";
import { csvTagihan, namaBerkasTagihan } from "@/lib/creative/bayar-csv";
import { semuaBarisBayar } from "@/lib/creative/bayar-queries";
import {
  catatPembayaran,
  catatPembayaranBanyak,
  type HasilBayar,
  type HasilBayarBanyak,
  type KodeGagalBayar,
} from "@/lib/creative/bayar-writer";

/*
 * Pembayaran fee KOL. Setiap ekspor berkas "use server" adalah endpoint yang
 * bisa dipanggil langsung, jadi izinnya diperiksa di SETIAP aksi dan
 * pencatatnya selalu diambil dari sesi — tidak pernah dari klien.
 */

type KodeAksi = KodeGagalBayar | "TANPA_AKSES" | "GAGAL";

async function izin(): Promise<{ userId: string; bolehUbah: boolean } | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  if (!hasPermission(p, PERMISSIONS.CREATIVE_VIEW)) return null;
  return { userId: s.user.id, bolehUbah: hasPermission(p, PERMISSIONS.CREATIVE_MANAGE) };
}

const angkaAtauNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const teksAtauNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function segarkan() {
  revalidatePath("/backoffice/kreatif", "layout");
}

export async function catatPembayaranAction(input: {
  kolaborasiId: string;
  status: string;
  jumlah?: number | null;
  tanggal?: string | null;
  catatan?: string | null;
}): Promise<HasilBayar | { ok: false; kode: KodeAksi }> {
  const i = await izin();
  if (!i?.bolehUbah) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await catatPembayaran({
      kolaborasiId: String(input?.kolaborasiId ?? ""),
      status: String(input?.status ?? ""),
      jumlah: angkaAtauNull(input?.jumlah),
      tanggal: teksAtauNull(input?.tanggal),
      catatan: input?.catatan === undefined ? undefined : teksAtauNull(input.catatan),
      olehUserId: i.userId,
    });
    if (r.ok && r.berubah) segarkan();
    return r;
  } catch (err) {
    console.error("catatPembayaran gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function catatPembayaranBanyakAction(input: {
  items: { kolaborasiId: string; jumlah?: number | null }[];
  status: string;
  tanggal?: string | null;
}): Promise<HasilBayarBanyak | { ok: false; kode: KodeAksi; kolaborasiId?: string }> {
  const i = await izin();
  if (!i?.bolehUbah) return { ok: false, kode: "TANPA_AKSES" };
  const items = Array.isArray(input?.items) ? input.items : [];
  try {
    const r = await catatPembayaranBanyak({
      items: items.map((it) => ({ kolaborasiId: String(it?.kolaborasiId ?? ""), jumlah: angkaAtauNull(it?.jumlah) })),
      status: String(input?.status ?? ""),
      tanggal: teksAtauNull(input?.tanggal),
      olehUserId: i.userId,
    });
    if (r.ok && r.berubah > 0) segarkan();
    return r;
  } catch (err) {
    console.error("catatPembayaranBanyak gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** CSV "Daftar tagihan" untuk saringan layar yang sedang dibuka (semua halaman). */
export async function eksporTagihanAction(input: {
  chip?: string;
  cari?: string | null;
  campaignId?: string | null;
}): Promise<{ ok: true; isi: string; namaBerkas: string } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  const i = await izin();
  if (!i) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const hariIni = hariIniWib();
    const baris = await semuaBarisBayar(
      { chip: bacaChipBayar(input?.chip), cari: teksAtauNull(input?.cari), campaignId: teksAtauNull(input?.campaignId) },
      hariIni,
    );
    const isi = csvTagihan(
      baris.map((b) => ({
        username: b.handle,
        namaKol: b.kolNama,
        namaPenerima: b.namaPenerima,
        campaign: b.campaignNama,
        tahap: b.tahap,
        fee: b.fee,
        dibayar: b.dibayar,
        sisa: b.sisa,
        payStatus: b.payStatus,
        paidAt: b.paidAt,
        catatan: b.payNote,
      })),
      `Daftar tagihan KOL — dibuat ${formatDisplayDateTime(new Date())} WIB`,
    );
    return { ok: true, isi, namaBerkas: namaBerkasTagihan(hariIni) };
  } catch (err) {
    console.error("eksporTagihan gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
