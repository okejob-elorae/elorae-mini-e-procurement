"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import {
  bukaTautanPortal,
  buatTautanPortal,
  cabutTautanPortal,
  daftarTautanPortal,
  muatAturanPortalToko,
  type GagalBuatTautan,
} from "@/lib/field-sales/portal-toko";
import type { KeadaanTautan } from "@/lib/field-sales/portal-toko-aturan";
import { pembatasPeriksaPortal } from "@/lib/field-sales/portal-toko-batas";
import {
  kirimPesananPortal,
  pratinjauPortal,
  skemaBarisPortal,
  type HasilKirimPortal,
  type PratinjauPortal,
} from "@/lib/field-sales/portal-writer";

/**
 * Portal pesan mandiri toko — aksi server.
 *
 * DUA kelompok, dengan penjaga yang sama sekali berbeda:
 *
 * 1. PUBLIK (toko, tanpa sesi): `pratinjauPesananPortalAksi`, `kirimPesananPortalAksi`.
 *    Pemanggilnya hanya memegang token. Token dibuka ULANG di setiap panggilan —
 *    tautan yang dicabut semenit lalu langsung mati — dan id toko TIDAK PERNAH
 *    diterima dari peramban: tokonya adalah toko milik tautan itu. Galat apa pun
 *    tentang tautan dijawab satu kode, `TAUTAN_TIDAK_BERLAKU`. Pratinjau dan
 *    kiriman berbagi satu jatah per tautan per menit (`pembatasPeriksaPortal`):
 *    tanpa itu, pratinjau berulang bisa dipakai menebak stok. Lewat jatah →
 *    `TERLALU_SERING`.
 *
 * 2. PENGELOLA (sesi wajib): buat / cabut / daftar tautan. Boleh bagi pemegang
 *    `stores:manage` (kantor), atau salesman yang MEMEGANG toko itu
 *    (`Store.salesmanId`) dari HP-nya.
 *
 * Token tidak pernah ditulis ke log.
 */

export type GagalTautanPublik = { ok: false; code: "TAUTAN_TIDAK_BERLAKU" };
export type TerlaluSeringPortal = { ok: false; code: "TERLALU_SERING" };

export async function pratinjauPesananPortalAksi(
  token: unknown,
  lines: unknown,
): Promise<PratinjauPortal | GagalTautanPublik | TerlaluSeringPortal | { ok: false; code: "TIDAK_SAH" }> {
  const buka = await bukaTautanPortal(token);
  if (!buka.ok) return { ok: false, code: "TAUTAN_TIDAK_BERLAKU" };
  if (!pembatasPeriksaPortal.coba(buka.akses.linkId)) return { ok: false, code: "TERLALU_SERING" };
  const parsed = skemaBarisPortal.safeParse(lines);
  if (!parsed.success) return { ok: false, code: "TIDAK_SAH" };
  return pratinjauPortal(buka.akses, parsed.data);
}

export async function kirimPesananPortalAksi(token: unknown, input: unknown): Promise<HasilKirimPortal | GagalTautanPublik | TerlaluSeringPortal> {
  const buka = await bukaTautanPortal(token);
  if (!buka.ok) return { ok: false, code: "TAUTAN_TIDAK_BERLAKU" };
  if (!pembatasPeriksaPortal.coba(buka.akses.linkId)) return { ok: false, code: "TERLALU_SERING" };
  return kirimPesananPortal(buka.akses, input);
}

// ── Pengelola tautan ──────────────────────────────────────────────────────

type GagalKelola = { ok: false; code: "UNAUTHORIZED" | "FORBIDDEN" | "TOKO_TIDAK_ADA" };

/**
 * Kantor (`stores:manage`) boleh untuk toko mana pun. Salesman (`pwa:access`)
 * hanya untuk toko yang IA pegang — dibaca ulang dari basis data setiap kali,
 * jadi salesman yang tokonya dipindahkan kehilangan aksesnya seketika.
 */
async function bolehKelola(storeId: unknown): Promise<{ ok: true; userId: string; storeId: string } | GagalKelola> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, code: "UNAUTHORIZED" };
  if (typeof storeId !== "string" || storeId === "") return { ok: false, code: "TOKO_TIDAK_ADA" };
  const izin = session.user.permissions ?? [];
  const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { id: true, salesmanId: true } });
  if (!toko) return { ok: false, code: "TOKO_TIDAK_ADA" };
  if (hasPermission(izin, PERMISSIONS.STORES_MANAGE)) return { ok: true, userId, storeId: toko.id };
  if (izin.includes("pwa:access") && toko.salesmanId === userId) return { ok: true, userId, storeId: toko.id };
  return { ok: false, code: "FORBIDDEN" };
}

export type BarisTautanTampil = {
  id: string;
  label: string | null;
  keadaan: KeadaanTautan;
  /** Semua tanggal sudah diformat di server (WIB). */
  dibuat: string;
  berlakuSampai: string | null;
  dicabut: string | null;
  terakhirDipakai: string | null;
  pembuat: string | null;
};

export type HasilDaftarTautan =
  | {
      ok: true;
      tautan: BarisTautanTampil[];
      /** Portal dinyalakan pemilik? Kalau tidak, tautan tidak bisa dibuat dan yang ada tidak berlaku. */
      portalAktif: boolean;
      masaBerlakuHari: number;
      adaPemegang: boolean;
      tokoAktif: boolean;
    }
  | GagalKelola;

export async function daftarTautanPortalAksi(storeId: unknown): Promise<HasilDaftarTautan> {
  const g = await bolehKelola(storeId);
  if (!g.ok) return g;
  const [baris, aturan, toko] = await Promise.all([
    daftarTautanPortal(g.storeId),
    muatAturanPortalToko(),
    prisma.store.findUnique({ where: { id: g.storeId }, select: { salesmanId: true, isActive: true } }),
  ]);
  return {
    ok: true,
    portalAktif: aturan.aktif,
    masaBerlakuHari: aturan.masaBerlakuHari,
    adaPemegang: !!toko?.salesmanId,
    tokoAktif: !!toko?.isActive,
    tautan: baris.map((b) => ({
      id: b.id,
      label: b.label,
      keadaan: b.keadaan,
      dibuat: formatDisplayDateTime(b.createdAt),
      berlakuSampai: b.expiresAt ? formatDisplayDate(b.expiresAt) : null,
      dicabut: b.revokedAt ? formatDisplayDateTime(b.revokedAt) : null,
      terakhirDipakai: b.lastUsedAt ? formatDisplayDateTime(b.lastUsedAt) : null,
      pembuat: b.pembuat,
    })),
  };
}

export type HasilBuatTautanAksi =
  /** `token` mentah — SATU-SATUNYA kesempatan menampilkannya. Peramban merakit alamatnya sendiri. */
  | { ok: true; token: string; berlakuSampai: string }
  | GagalKelola
  | { ok: false; code: GagalBuatTautan };

export async function buatTautanPortalAksi(input: { storeId: unknown; label?: unknown; hari?: unknown }): Promise<HasilBuatTautanAksi> {
  const g = await bolehKelola(input?.storeId);
  if (!g.ok) return g;
  const hari = input.hari === undefined || input.hari === null || input.hari === "" ? null : Number(input.hari);
  if (hari !== null && !Number.isInteger(hari)) return { ok: false, code: "TIDAK_SAH" };
  const r = await buatTautanPortal({
    storeId: g.storeId,
    createdById: g.userId,
    label: typeof input.label === "string" ? input.label : null,
    hari,
  });
  if (!r.ok) return r;
  revalidatePath(`/backoffice/stores/${g.storeId}`);
  return { ok: true, token: r.token, berlakuSampai: formatDisplayDate(r.expiresAt) };
}

export type HasilCabutTautanAksi = { ok: true } | GagalKelola | { ok: false; code: "TIDAK_ADA" };

export async function cabutTautanPortalAksi(linkId: unknown): Promise<HasilCabutTautanAksi> {
  // Sesi dulu: tanpa masuk, ada-tidaknya sebuah id tautan pun tidak dijawab.
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHORIZED" };
  if (typeof linkId !== "string" || linkId === "") return { ok: false, code: "TIDAK_ADA" };
  // Izin dinilai atas toko milik TAUTAN itu, bukan atas id toko kiriman peramban.
  const tautan = await prisma.storePortalLink.findUnique({ where: { id: linkId }, select: { storeId: true } });
  if (!tautan) return { ok: false, code: "TIDAK_ADA" };
  const g = await bolehKelola(tautan.storeId);
  if (!g.ok) return g;
  const r = await cabutTautanPortal({ linkId, userId: g.userId });
  if (!r.ok) return r;
  revalidatePath(`/backoffice/stores/${g.storeId}`);
  return { ok: true };
}
