"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { buatPembatasJendela } from "@/lib/field-sales/portal-toko-batas";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { URUTAN_KOLOM_FORMULIR, type GalatFormulir, type KolomFormulir } from "@/lib/creative/formulir-kol-aturan";
import {
  bukaLinkFormulirKol,
  buatLinkFormulirKol,
  cabutLinkFormulirKol,
  kembalikanKolomKiriman,
  kirimFormulirKol,
  tandaiKirimanDicek,
} from "@/lib/creative/formulir-kol-writer";
import { siapkanPesanMintaData } from "@/lib/creative/wa-writer";

/*
 * Formulir data KOL. Dua kelompok aksi:
 *
 * - PUBLIK (`kirimFormulirKolAction`): dipanggil halaman `/data-kol/[token]` tanpa
 *   masuk. Token dibuka ulang setiap kali; semua masalah token dijawab satu kode
 *   `TIDAK_BERLAKU`; 10 kiriman per 10 menit per link (memori proses, seperti
 *   portal toko). KOL tidak pernah mengirim id KOL — id datang dari link.
 * - KANTOR: pengelola Kreatif (`creative:manage`) membuat/mencabut link, menandai
 *   kiriman dicek, dan mengembalikan kolom yang ditimpa.
 */

const pembatasKirim = buatPembatasJendela(10, 10 * 60_000);

const teks = (maks: number) => z.string().max(maks).default("");
const skemaIsian = z.object({
  recipientName: teks(500),
  phone: teks(100),
  email: teks(500),
  address: teks(4000),
  city: teks(500),
  province: teks(500),
  postalCode: teks(100),
  atasan: teks(100),
  bawahan: teks(100),
  tinggi: teks(50),
  hijab: z.enum(["", "ya", "tidak"]).default(""),
  catatanFit: teks(1000),
  bankName: teks(200),
  bankAccount: teks(100),
  bankHolder: teks(300),
  nik: teks(100),
  npwp: teks(100),
  setuju: z.boolean().default(false),
});

export type HasilKirimFormulirPublik =
  | { ok: true; berubah: number }
  | { ok: false; kode: "TIDAK_BERLAKU" | "TERLALU_SERING" | "KUNCI_TIDAK_ADA" | "GAGAL" }
  | { ok: false; kode: "ISIAN_TIDAK_SAH"; galat: GalatFormulir };

export async function kirimFormulirKolAction(token: unknown, input: unknown): Promise<HasilKirimFormulirPublik> {
  try {
    const akses = await bukaLinkFormulirKol(token);
    if (!akses) return { ok: false, kode: "TIDAK_BERLAKU" };
    if (!pembatasKirim.coba(akses.linkId)) return { ok: false, kode: "TERLALU_SERING" };
    const isian = skemaIsian.safeParse(input);
    if (!isian.success) return { ok: false, kode: "ISIAN_TIDAK_SAH", galat: {} };
    const r = await kirimFormulirKol({ token, isian: isian.data });
    if (r.ok && r.berubah > 0) {
      revalidatePath("/backoffice/kreatif", "layout");
      revalidatePath(`/backoffice/kreatif/kol/${akses.kolId}`);
    }
    return r;
  } catch (e) {
    console.error("[formulir KOL] kiriman gagal:", e);
    return { ok: false, kode: "GAGAL" };
  }
}

/* ─────────────────────────── kantor ─────────────────────────── */

async function bolehKelola(): Promise<string | null> {
  const s = await auth();
  if (!s?.user?.id) return null;
  return hasPermission(s.user.permissions ?? [], PERMISSIONS.CREATIVE_MANAGE) ? s.user.id : null;
}

function segarkan(kolId: string) {
  revalidatePath("/backoffice/kreatif", "layout");
  revalidatePath(`/backoffice/kreatif/kol/${kolId}`);
}

export type HasilBuatLinkAksi =
  | { ok: true; linkId: string; link: string; berlakuSampai: string; nomor: string | null; pesan: string; templateNama: string }
  | { ok: false; kode: "TANPA_AKSES" | "TIDAK_DITEMUKAN" | "KOL_DIBLOKIR" | "ALAMAT_TIDAK_SAH" | "GAGAL" };

/**
 * Buat link baru (mencabut yang lama) dan siapkan pesan WhatsApp-nya. `asal` = origin halaman
 * kantor yang memanggil (mis. https://elorae.cloud), supaya link mengikuti alamat yang sedang dipakai.
 */
export async function buatLinkFormulirKolAction(input: { kolId: string; asal: string }): Promise<HasilBuatLinkAksi> {
  const userId = await bolehKelola();
  if (!userId) return { ok: false, kode: "TANPA_AKSES" };
  const asal = String(input?.asal ?? "");
  if (!/^https?:\/\/[^/\s]+$/.test(asal)) return { ok: false, kode: "ALAMAT_TIDAK_SAH" };
  const kolId = String(input?.kolId ?? "");
  try {
    const r = await buatLinkFormulirKol({ kolId, olehUserId: userId });
    if (!r.ok) return r;
    const link = `${asal}/data-kol/${r.token}`;
    const pesan = await siapkanPesanMintaData({ kolId, link });
    segarkan(kolId);
    return {
      ok: true,
      linkId: r.linkId,
      link,
      berlakuSampai: r.berlakuSampai.toISOString(),
      nomor: pesan?.nomor ?? null,
      pesan: pesan?.pesan ?? link,
      templateNama: pesan?.templateNama ?? "",
    };
  } catch (e) {
    console.error("[formulir KOL] gagal membuat link:", e);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function cabutLinkFormulirKolAction(input: { linkId: string; kolId: string }) {
  const userId = await bolehKelola();
  if (!userId) return { ok: false as const, kode: "TANPA_AKSES" as const };
  try {
    const r = await cabutLinkFormulirKol({ linkId: String(input?.linkId ?? ""), olehUserId: userId });
    if (r.ok) segarkan(String(input?.kolId ?? ""));
    return r;
  } catch (e) {
    console.error("[formulir KOL] gagal mencabut link:", e);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}

export async function tandaiKirimanDicekAction(input: { submissionId: string; kolId: string }) {
  const userId = await bolehKelola();
  if (!userId) return { ok: false as const, kode: "TANPA_AKSES" as const };
  try {
    const r = await tandaiKirimanDicek({ submissionId: String(input?.submissionId ?? ""), olehUserId: userId });
    if (r.ok) segarkan(String(input?.kolId ?? ""));
    return r;
  } catch (e) {
    console.error("[formulir KOL] gagal menandai dicek:", e);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}

export async function kembalikanKolomKirimanAction(input: { submissionId: string; kolId: string; kolom: string }) {
  const userId = await bolehKelola();
  if (!userId) return { ok: false as const, kode: "TANPA_AKSES" as const };
  const kolom = String(input?.kolom ?? "");
  if (!(URUTAN_KOLOM_FORMULIR as readonly string[]).includes(kolom)) return { ok: false as const, kode: "TIDAK_BISA_DIKEMBALIKAN" as const };
  try {
    const r = await kembalikanKolomKiriman({ submissionId: String(input?.submissionId ?? ""), kolom: kolom as KolomFormulir, olehUserId: userId });
    if (r.ok) segarkan(String(input?.kolId ?? ""));
    return r;
  } catch (e) {
    console.error("[formulir KOL] gagal mengembalikan kolom:", e);
    return { ok: false as const, kode: "GAGAL" as const };
  }
}
