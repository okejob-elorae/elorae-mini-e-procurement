"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { periksaPanduan, type KodeTolakPanduan } from "@/lib/salesman/checklist-toko";

/**
 * Panduan display: kantor menulis cara memajang (teks + gambar contoh) untuk
 * jenis toko / area / rentang tanggal tertentu (`stores:manage`); salesman
 * melihatnya di layar daftar periksa dan mengirim foto hasil display yang
 * ditandai `VisitPhoto.displayGuideId`.
 */

const idSah = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 64;

function segarkan() {
  revalidatePath("/backoffice/panduan-display");
}

export type HasilSimpanPanduan =
  | { ok: true; id: string }
  | { ok: false; kode: KodeTolakPanduan | "TANPA_AKSES" | "TIDAK_DITEMUKAN" | "GAGAL" };

export async function simpanPanduanAction(input: {
  id?: string | null;
  judul: string;
  isi: string;
  gambarUrl: string | null;
  termsType: string | null;
  groupId: string | null;
  mulai: string | null;
  selesai: string | null;
}): Promise<HasilSimpanPanduan> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) return { ok: false, kode: "TANPA_AKSES" };
  const periksa = periksaPanduan(input);
  if (!periksa.ok) return periksa;
  const p = periksa.nilai;

  try {
    if (p.groupId && (await prisma.storeGroup.count({ where: { id: p.groupId } })) === 0) return { ok: false, kode: "AREA_TIDAK_SAH" };
    // Tanggal adalah hari WIB: mulai = awal hari, selesai = AKHIR hari (inklusif),
    // tidak bergantung zona waktu server (produksi berjalan di UTC).
    const data = {
      title: p.judul,
      body: p.isi,
      imageUrl: p.gambarUrl,
      termsType: p.termsType,
      groupId: p.groupId,
      activeFrom: p.mulai ? new Date(`${p.mulai}T00:00:00.000+07:00`) : null,
      activeTo: p.selesai ? new Date(`${p.selesai}T23:59:59.999+07:00`) : null,
    };
    if (input.id) {
      if (!idSah(input.id)) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      const r = await prisma.displayGuide.updateMany({ where: { id: input.id }, data });
      if (r.count === 0) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      segarkan();
      revalidatePath(`/backoffice/panduan-display/${input.id}`);
      return { ok: true, id: input.id };
    }
    const baru = await prisma.displayGuide.create({ data: { ...data, createdById: userId }, select: { id: true } });
    segarkan();
    return { ok: true, id: baru.id };
  } catch (err) {
    console.error("simpanPanduanAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilUbahPanduan = { ok: true } | { ok: false; kode: "TANPA_AKSES" | "TIDAK_DITEMUKAN" | "DIPAKAI" | "GAGAL" };

export async function aturAktifPanduanAction(id: string, aktif: boolean): Promise<HasilUbahPanduan> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  if (!idSah(id) || typeof aktif !== "boolean") return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await prisma.displayGuide.updateMany({ where: { id }, data: { isActive: aktif } });
    if (r.count === 0) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    segarkan();
    revalidatePath(`/backoffice/panduan-display/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("aturAktifPanduanAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Hapus hanya panduan yang belum punya foto hasil. `VisitPhoto.displayGuideId`
 * tidak dijaga foreign key, jadi menghapus panduan yang sudah dipakai
 * meninggalkan foto yang menunjuk ke panduan yang tidak ada.
 */
export async function hapusPanduanAction(id: string): Promise<HasilUbahPanduan> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  if (!idSah(id)) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    if ((await prisma.visitPhoto.count({ where: { displayGuideId: id } })) > 0) return { ok: false, kode: "DIPAKAI" };
    const r = await prisma.displayGuide.deleteMany({ where: { id } });
    if (r.count === 0) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    segarkan();
    return { ok: true };
  } catch (err) {
    console.error("hapusPanduanAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

// ─── HP: tandai foto kunjungan sebagai hasil display ─────────────────────────

const MAKS_TANDA = 50;

export type HasilTandaiFoto = { ok: true; selesai: string[] } | { ok: false; kode: "TANPA_AKSES" | "TIDAK_SAH" | "GAGAL" };

/**
 * Tandai foto kunjungan sebagai jawaban satu panduan display.
 *
 * Fotonya naik lewat antrean foto kunjungan yang sudah ada (bisa tertunda
 * karena sinyal), jadi penandaan dilakukan TERPISAH dan diulang oleh HP sampai
 * fotonya ada di server. `selesai` = clientId yang tidak perlu dikirim lagi:
 * sudah ditandai, atau panduannya sudah tidak ada (mengulang tidak akan pernah
 * berhasil). Foto yang belum naik tidak termasuk — HP mencobanya lagi nanti.
 * Hanya foto dari kunjungan milik pengguna ini yang bisa ditandai.
 */
export async function tandaiFotoPanduanAction(tanda: { clientId: string; guideId: string }[]): Promise<HasilTandaiFoto> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || pwaAccessGuard(session.user.permissions) !== "render") return { ok: false, kode: "TANPA_AKSES" };
  if (!Array.isArray(tanda) || tanda.length > MAKS_TANDA) return { ok: false, kode: "TIDAK_SAH" };
  const sah = tanda.filter((t) => t && idSah(t.guideId) && typeof t.clientId === "string" && t.clientId.length > 0 && t.clientId.length <= 100);
  if (sah.length === 0) return { ok: true, selesai: [] };

  try {
    const ada = new Set(
      (await prisma.displayGuide.findMany({ where: { id: { in: [...new Set(sah.map((t) => t.guideId))] } }, select: { id: true } })).map(
        (g) => g.id,
      ),
    );
    const selesai: string[] = [];
    for (const t of sah) {
      if (!ada.has(t.guideId)) {
        selesai.push(t.clientId);
        continue;
      }
      const r = await prisma.visitPhoto.updateMany({
        where: { clientId: t.clientId, visit: { userId } },
        data: { displayGuideId: t.guideId },
      });
      if (r.count > 0) selesai.push(t.clientId);
    }
    return { ok: true, selesai };
  } catch (err) {
    console.error("tandaiFotoPanduanAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}
