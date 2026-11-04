"use server";

import { revalidatePath } from "next/cache";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import {
  bacaJawaban,
  bacaPertanyaan,
  bentukSimpanan,
  hitungSkor,
  periksaTemplate,
  templateBerlaku,
  type KodeTolakTemplate,
} from "@/lib/salesman/checklist-toko";
import { kunjunganUntukCatat, skorSebelumnya, type SkorSebelumnya } from "@/lib/salesman/checklist-queries";

/**
 * Daftar periksa display toko: kantor menyusun template (`stores:manage`),
 * salesman mengisinya di toko dari HP (sesi salesman + kunjungan di toko itu).
 *
 * Setiap aksi mengembalikan KODE, tidak melempar — di produksi Next
 * menyamarkan pesan galat jadi digest acak.
 */

const idSah = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 64;

function segarkanKantor() {
  revalidatePath("/backoffice/checklist-toko");
  revalidatePath("/backoffice/checklist-toko/laporan");
}

// ─── Template (kantor) ───────────────────────────────────────────────────────

export type HasilSimpanTemplate =
  | { ok: true; id: string }
  | { ok: false; kode: KodeTolakTemplate | "TANPA_AKSES" | "TIDAK_DITEMUKAN" | "GAGAL"; indeks?: number };

export async function simpanTemplateChecklistAction(input: {
  id?: string | null;
  nama: string;
  termsType: string | null;
  pertanyaan: unknown[];
}): Promise<HasilSimpanTemplate> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  const periksa = periksaTemplate(input);
  if (!periksa.ok) return periksa;
  const t = periksa.nilai;
  const data = {
    name: t.nama,
    termsType: t.termsType,
    questions: t.pertanyaan as unknown as Prisma.InputJsonValue,
  };
  try {
    if (input?.id) {
      if (!idSah(input.id)) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      const r = await prisma.visitChecklistTemplate.updateMany({ where: { id: input.id }, data });
      if (r.count === 0) return { ok: false, kode: "TIDAK_DITEMUKAN" };
      segarkanKantor();
      revalidatePath(`/backoffice/checklist-toko/${input.id}`);
      return { ok: true, id: input.id };
    }
    const baru = await prisma.visitChecklistTemplate.create({ data, select: { id: true } });
    segarkanKantor();
    return { ok: true, id: baru.id };
  } catch (err) {
    console.error("simpanTemplateChecklistAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilUbahTemplate = { ok: true } | { ok: false; kode: "TANPA_AKSES" | "TIDAK_DITEMUKAN" | "DIPAKAI" | "GAGAL" };

export async function aturAktifTemplateChecklistAction(id: string, aktif: boolean): Promise<HasilUbahTemplate> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  if (!idSah(id) || typeof aktif !== "boolean") return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const r = await prisma.visitChecklistTemplate.updateMany({ where: { id }, data: { isActive: aktif } });
    if (r.count === 0) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    segarkanKantor();
    return { ok: true };
  } catch (err) {
    console.error("aturAktifTemplateChecklistAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * Hapus hanya template yang BELUM pernah diisi. Yang sudah punya hasil
 * dinonaktifkan saja: laporannya menampilkan nama template, dan hasil lama
 * tanpa template kehilangan konteksnya.
 */
export async function hapusTemplateChecklistAction(id: string): Promise<HasilUbahTemplate> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.STORES_MANAGE)) {
    return { ok: false, kode: "TANPA_AKSES" };
  }
  if (!idSah(id)) return { ok: false, kode: "TIDAK_DITEMUKAN" };
  try {
    const dipakai = await prisma.visitChecklistResult.count({ where: { templateId: id } });
    if (dipakai > 0) return { ok: false, kode: "DIPAKAI" };
    const r = await prisma.visitChecklistTemplate.deleteMany({ where: { id } });
    if (r.count === 0) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    segarkanKantor();
    return { ok: true };
  } catch (err) {
    console.error("hapusTemplateChecklistAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

// ─── Mengisi di toko (HP) ────────────────────────────────────────────────────

export type HasilSimpanChecklist =
  | { ok: true; score: number; maxScore: number; persen: number | null; sebelumnya: SkorSebelumnya | null }
  | {
      ok: false;
      kode: "TANPA_AKSES" | "KUNJUNGAN_TIDAK_SAH" | "TEMPLATE_TIDAK_ADA" | "JAWABAN_TIDAK_SAH" | "WAJIB_DIJAWAB" | "GAGAL";
      pertanyaanId?: string;
    };

/**
 * Simpan hasil daftar periksa satu kunjungan. Satu hasil per kunjungan per
 * template — kirim ulang MENIMPA hasil sebelumnya (salesman membetulkan
 * jawaban sebelum meninggalkan toko). Skor dihitung di sini dari jawaban.
 */
export async function simpanChecklistAction(input: {
  storeId: string;
  visitId: string;
  templateId: string;
  jawaban: unknown;
}): Promise<HasilSimpanChecklist> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || pwaAccessGuard(session.user.permissions) !== "render") return { ok: false, kode: "TANPA_AKSES" };
  if (!input || !idSah(input.storeId) || !idSah(input.visitId) || !idSah(input.templateId)) {
    return { ok: false, kode: "KUNJUNGAN_TIDAK_SAH" };
  }

  try {
    const sekarang = new Date();
    const [kunjungan, toko, template] = await Promise.all([
      kunjunganUntukCatat(userId, input.storeId, input.visitId, sekarang),
      prisma.store.findUnique({ where: { id: input.storeId }, select: { termsType: true } }),
      prisma.visitChecklistTemplate.findUnique({ where: { id: input.templateId } }),
    ]);
    if (!kunjungan || !toko) return { ok: false, kode: "KUNJUNGAN_TIDAK_SAH" };
    if (!template || templateBerlaku([template], toko.termsType).length === 0) return { ok: false, kode: "TEMPLATE_TIDAK_ADA" };

    const pertanyaan = bacaPertanyaan(template.questions);
    if (pertanyaan.length === 0) return { ok: false, kode: "TEMPLATE_TIDAK_ADA" };
    const baca = bacaJawaban(pertanyaan, input.jawaban);
    if (!baca.ok) return { ok: false, kode: baca.kode, pertanyaanId: baca.pertanyaanId };

    const skor = hitungSkor(pertanyaan, baca.jawaban);
    const data = {
      answers: bentukSimpanan(baca.jawaban, skor.rincian) as unknown as Prisma.InputJsonValue,
      score: skor.score,
      maxScore: skor.maxScore,
      createdById: userId,
    };
    const kunci = { visitId_templateId: { visitId: kunjungan.id, templateId: template.id } };
    try {
      await prisma.visitChecklistResult.upsert({
        where: kunci,
        create: { visitId: kunjungan.id, templateId: template.id, ...data },
        update: data,
      });
    } catch (err) {
      // Dua kiriman yang berpacu: yang kalah membuat baris yang sudah ada — timpa saja.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        await prisma.visitChecklistResult.update({ where: kunci, data });
      } else {
        throw err;
      }
    }

    const sebelumnya = await skorSebelumnya(input.storeId, template.id, kunjungan.id);
    revalidatePath(`/pwa/stores/${input.storeId}/checklist`);
    segarkanKantor();
    return { ok: true, score: skor.score, maxScore: skor.maxScore, persen: skor.persen, sebelumnya };
  } catch (err) {
    console.error("simpanChecklistAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}
