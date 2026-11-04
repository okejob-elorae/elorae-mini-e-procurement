"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { parseDateOnly } from "@/lib/date-only";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { csvAlamatKirim } from "@/lib/creative/sampel-aturan";
import { barisAlamatKirim, cariBarangSampel, type BarangPilihanSampel } from "@/lib/creative/sampel-queries";
import {
  hapusPengiriman,
  simpanPengiriman,
  tandaiDiterima,
  type KodeGagalSampel,
  type KurangStokSampel,
  type PindahTahap,
} from "@/lib/creative/sampel-writer";
import { hariIniWib } from "@/lib/tanggal-isian";

/*
 * Aksi pengiriman sampel KOL. Setiap ekspor berkas "use server" adalah
 * endpoint yang bisa dipanggil langsung: izinnya diperiksa di setiap aksi,
 * pengguna diambil dari sesi, dan isian dari klien diperiksa bentuknya di sini
 * — tidak ada yang dipercaya hanya karena layar tidak mengirimnya.
 */

export type KodeAksiSampel = KodeGagalSampel | "TANPA_AKSES" | "GAGAL" | "TANGGAL_TIDAK_VALID";

export type HasilSimpanPengirimanAksi =
  | { ok: true; id: string; berangkat: boolean; diterima: boolean; ulang: boolean; tahap: PindahTahap }
  | { ok: false; kode: KodeAksiSampel; detail?: string; kurang?: KurangStokSampel[] };

export type HasilAksiSederhana = { ok: true; ulang?: boolean; tahap?: PindahTahap } | { ok: false; kode: KodeAksiSampel };

async function izin(): Promise<{ userId: string; bolehUbah: boolean } | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  const p = s.user.permissions ?? [];
  if (!hasPermission(p, PERMISSIONS.CREATIVE_VIEW)) return null;
  return { userId: s.user.id, bolehUbah: hasPermission(p, PERMISSIONS.CREATIVE_MANAGE) };
}

function segarkan() {
  // Pengiriman mengubah antrean Sampel, detail kolaborasi, Hari ini, dan angka biaya
  // sekaligus — semuanya di bawah tata letak Kreatif.
  revalidatePath("/backoffice/kreatif", "layout");
}

/** Teks dari klien: `undefined` dibiarkan, selain teks/null dianggap kosong. */
const teks = (v: unknown): string | null | undefined => (v === undefined ? undefined : typeof v === "string" ? v : null);

/** "YYYY-MM-DD" → awal hari WIB; `undefined` dibiarkan; isian rusak = galat. */
function tanggal(v: unknown): { ok: true; nilai: Date | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, nilai: undefined };
  if (v === null || v === "") return { ok: true, nilai: null };
  if (typeof v !== "string") return { ok: false };
  const d = parseDateOnly(v);
  return d ? { ok: true, nilai: d } : { ok: false };
}

export async function simpanPengirimanAction(input: {
  id?: string | null;
  kolaborasiId: string;
  courier?: string | null;
  trackingNo?: string | null;
  tanpaResi?: boolean;
  /** "YYYY-MM-DD"; kosong padahal resi terisi = hari ini. */
  sentAt?: string | null;
  receivedAt?: string | null;
  shippingCost?: number | null;
  note?: string | null;
  baris?: { itemId: string; variantSku: string | null; qty: number }[];
  kunci?: string | null;
}): Promise<HasilSimpanPengirimanAksi> {
  const i = await izin();
  if (!i?.bolehUbah) return { ok: false, kode: "TANPA_AKSES" };
  if (!input || typeof input !== "object") return { ok: false, kode: "GAGAL" };
  const kirim = tanggal(input.sentAt);
  const terima = tanggal(input.receivedAt);
  if (!kirim.ok || !terima.ok) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };
  const ongkir = input.shippingCost;
  const baris = Array.isArray(input.baris)
    ? input.baris.map((b) => ({
        itemId: typeof b?.itemId === "string" ? b.itemId : "",
        variantSku: typeof b?.variantSku === "string" ? b.variantSku : null,
        qty: typeof b?.qty === "number" ? b.qty : Number.NaN,
      }))
    : undefined;
  try {
    const r = await simpanPengiriman({
      id: typeof input.id === "string" && input.id ? input.id : null,
      kolaborasiId: String(input.kolaborasiId ?? ""),
      courier: teks(input.courier),
      trackingNo: teks(input.trackingNo),
      tanpaResi: input.tanpaResi === true,
      sentAt: kirim.nilai,
      receivedAt: terima.nilai,
      shippingCost: ongkir === undefined ? undefined : typeof ongkir === "number" ? ongkir : null,
      note: teks(input.note),
      baris,
      kunci: typeof input.kunci === "string" ? input.kunci : null,
      olehUserId: i.userId,
    });
    if (!r.ok) {
      return r.kode === "STOK_KURANG" ? { ok: false, kode: r.kode, kurang: r.kurang } : { ok: false, kode: r.kode, detail: r.detail };
    }
    segarkan();
    return { ok: true, id: r.id, berangkat: r.berangkat, diterima: r.diterima, ulang: r.ulang, tahap: r.tahap };
  } catch (err) {
    console.error("simpanPengiriman gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function tandaiDiterimaAction(input: { pengirimanId: string; receivedAt: string }): Promise<HasilAksiSederhana> {
  const i = await izin();
  if (!i?.bolehUbah) return { ok: false, kode: "TANPA_AKSES" };
  const t = tanggal(input?.receivedAt || hariIniWib());
  if (!t.ok || !t.nilai) return { ok: false, kode: "TANGGAL_TIDAK_VALID" };
  try {
    const r = await tandaiDiterima({ pengirimanId: String(input.pengirimanId ?? ""), receivedAt: t.nilai, olehUserId: i.userId });
    if (!r.ok) return r;
    segarkan();
    return { ok: true, ulang: r.ulang, tahap: r.tahap };
  } catch (err) {
    console.error("tandaiDiterima gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function hapusPengirimanAction(input: { pengirimanId: string }): Promise<HasilAksiSederhana> {
  const i = await izin();
  if (!i?.bolehUbah) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const r = await hapusPengiriman({ pengirimanId: String(input?.pengirimanId ?? ""), olehUserId: i.userId });
    if (!r.ok) return r;
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("hapusPengiriman gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function cariBarangSampelAction(
  cari: string,
): Promise<{ ok: true; barang: BarangPilihanSampel[] } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  const i = await izin();
  if (!i?.bolehUbah) return { ok: false, kode: "TANPA_AKSES" };
  try {
    return { ok: true, barang: await cariBarangSampel(typeof cari === "string" ? cari.slice(0, 100) : "") };
  } catch (err) {
    console.error("cariBarangSampel gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** "Daftar alamat kirim" untuk gudang — antrean Perlu dikirim dengan saringan layar. */
export async function eksporAlamatKirimAction(input: {
  cari?: string | null;
  campaignId?: string | null;
}): Promise<{ ok: true; csv: string; namaBerkas: string; jumlah: number; terpotong: boolean } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" }> {
  const i = await izin();
  if (!i) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const { baris, terpotong } = await barisAlamatKirim({
      cari: typeof input?.cari === "string" ? input.cari.slice(0, 100) : null,
      campaignId: typeof input?.campaignId === "string" && input.campaignId ? input.campaignId : null,
    });
    return { ok: true, csv: csvAlamatKirim(baris), namaBerkas: `alamat-kirim-sampel-${hariIniWib()}.csv`, jumlah: baris.length, terpotong };
  } catch (err) {
    console.error("eksporAlamatKirim gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
