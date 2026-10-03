"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import idMessages from "@/lib/i18n/messages/id.json";
import { auth } from "@/lib/auth";
import { bolehMelapor, bolehMembacaArsip, bolehMengelola } from "@/lib/receivables/izin";
import { tanggalWib } from "@/lib/receivables/giro";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatDisplayDate } from "@/lib/date-only";
import type { AlasanGagalTugas, AlasanGagalTutup } from "@/lib/receivables/tugas-tagih";
import { batalkanTugasTagih, buatTugasTagih, tandaiSudahDitagih } from "@/lib/receivables/tugas-tagih-writer";
import { idKlaimDariNomor, tautanPesanKlaim, type TautanPesanKlaim } from "@/lib/receivables/tugas-tagih-queries";

/**
 * Aksi tugas tagih dan tautan pesan WhatsApp ke toko.
 *
 * Mengembalikan kode, tidak melempar: di produksi Next menyamarkan pesan error
 * menjadi digest acak, jadi melempar berarti operator melihat "terjadi
 * kesalahan" tanpa tahu apa yang salah.
 */

export type KodeAksiTugas =
  | "TANPA_AKSES"
  | "TENGGAT_TIDAK_VALID"
  | AlasanGagalTugas
  | AlasanGagalTutup
  | "TIDAK_DITEMUKAN"
  | "GAGAL";

export type HasilAksiTugas = { ok: true } | { ok: false; kode: KodeAksiTugas };

function segarkan(storeId?: string) {
  revalidatePath("/backoffice/tugas-tagih");
  revalidatePath("/pwa/piutang");
  revalidatePath("/pwa");
  if (storeId) revalidatePath(`/pwa/piutang/${storeId}`);
}

/**
 * Kabar ke orang yang ditugasi. Teksnya dari berkas bahasa (bukan ditulis di
 * sini) dan dipatok Indonesia: kabar disimpan sebagai satu teks, sementara
 * bahasa tampilan dipilih di HP penerimanya. Dipanggil SESUDAH transaksi dan
 * tidak pernah melempar — tugasnya sudah tersimpan, kabar yang gagal tidak
 * boleh membuatnya tampak gagal.
 */
async function kabarTugasBaru(input: {
  taskId: string;
  storeId: string;
  assigneeId: string;
  nilai: number;
  jumlahFaktur: number;
  tenggat: Date | null;
}): Promise<void> {
  try {
    const toko = await prisma.store.findUnique({ where: { id: input.storeId }, select: { name: true } });
    const t = createTranslator({
      locale: "id",
      messages: idMessages as unknown as AbstractIntlMessages,
      namespace: "pwa.tugasTagih",
    }) as unknown as (k: string, v?: Record<string, string | number>) => string;
    await kabariPengguna(input.assigneeId, {
      jenis: JENIS_KABAR.TUGAS_TAGIH_BARU,
      judul: t("kabarJudul", { toko: toko?.name ?? "—" }),
      isi: input.tenggat
        ? t("kabarIsi", {
            count: input.jumlahFaktur,
            nilai: formatIDR(input.nilai),
            date: formatDisplayDate(input.tenggat),
          })
        : t("kabarIsiTanpaTenggat", { count: input.jumlahFaktur, nilai: formatIDR(input.nilai) }),
      data: { storeId: input.storeId, taskId: input.taskId },
    });
  } catch (err) {
    console.error("[kabar] tugas tagih baru gagal", input.taskId, err);
  }
}

/**
 * Buat tugas tagih — keputusan penagihan, jadi `receivables:manage`.
 * Tenggat wajib ("YYYY-MM-DD", WIB): tugas tanpa batas waktu tidak pernah
 * terlambat, dan tidak ada yang menagihnya.
 */
export async function buatTugasTagihAction(input: {
  storeId: string;
  receivableIds: string[];
  assigneeId: string;
  tenggat: string;
  catatan?: string;
}): Promise<HasilAksiTugas> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  if (!bolehMengelola(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };

  const tenggat = tanggalWib(input.tenggat ?? "");
  if (!tenggat) return { ok: false, kode: "TENGGAT_TIDAK_VALID" };

  try {
    const hasil = await buatTugasTagih({
      storeId: input.storeId,
      receivableIds: Array.isArray(input.receivableIds) ? input.receivableIds : [],
      assigneeId: input.assigneeId,
      tenggat,
      catatan: input.catatan,
      olehUserId: session.user.id,
    });
    if (!hasil.ok) return { ok: false, kode: hasil.alasan };
    segarkan(hasil.storeId);
    if (hasil.assigneeId !== session.user.id) {
      void kabarTugasBaru({
        taskId: hasil.id,
        storeId: hasil.storeId,
        assigneeId: hasil.assigneeId,
        nilai: hasil.nilai,
        jumlahFaktur: hasil.jumlahFaktur,
        tenggat,
      });
    }
    return { ok: true };
  } catch (err) {
    console.error("buatTugasTagih gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/**
 * "Sudah ditagih" dari HP. Izinnya sama dengan melapor BKM; penjaga yang
 * sesungguhnya ada di penulis — hanya orang yang ditugasi yang bisa menutupnya.
 */
export async function tandaiSudahDitagihAction(taskId: string, hasil: string): Promise<HasilAksiTugas> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  if (!bolehMelapor(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };

  try {
    const h = await tandaiSudahDitagih({ taskId, olehUserId: session.user.id, hasil: String(hasil ?? "") });
    if (!h.ok) return { ok: false, kode: h.alasan };
    segarkan(h.storeId);
    return { ok: true };
  } catch (err) {
    console.error("tandaiSudahDitagih gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

/** Batalkan tugas — kantor, `receivables:manage`, alasan wajib. */
export async function batalkanTugasTagihAction(taskId: string, alasan: string): Promise<HasilAksiTugas> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  if (!bolehMengelola(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };

  try {
    const h = await batalkanTugasTagih({ taskId, olehUserId: session.user.id, alasan: String(alasan ?? "") });
    if (!h.ok) return { ok: false, kode: h.alasan };
    segarkan(h.storeId);
    return { ok: true };
  } catch (err) {
    console.error("batalkanTugasTagih gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}

export type HasilTautanPesan = { ok: true; tautan: TautanPesanKlaim | null } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

/**
 * Tautan WhatsApp untuk BKM yang BARU saja dicatat formulir (formulir hanya
 * mengenal nomor dokumennya).
 *
 * Hanya pelapor/pembuat BKM itu, atau pembaca arsip piutang: tautannya
 * membawa nomor HP toko dan daftar fakturnya.
 */
export async function tautanPesanKlaimBaruAction(docNo: string): Promise<HasilTautanPesan> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const klaim = await idKlaimDariNomor(String(docNo ?? ""));
    if (!klaim) return { ok: true, tautan: null };
    const pemilik = klaim.salesmanId === session.user.id || klaim.createdById === session.user.id;
    if (!pemilik && !bolehMembacaArsip(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
    const peta = await tautanPesanKlaim([klaim.id]);
    return { ok: true, tautan: peta.get(klaim.id) ?? null };
  } catch (err) {
    console.error("tautanPesanKlaimBaru gagal:", err);
    return { ok: false, kode: "GAGAL" };
  }
}
