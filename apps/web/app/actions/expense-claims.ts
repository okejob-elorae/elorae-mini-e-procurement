"use server";

import { revalidatePath } from "next/cache";
import * as XLSX from "xlsx";
import { Prisma, prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { formatIDR } from "@/lib/sales-orders/format";
import { formatDisplayDate } from "@/lib/date-only";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import type { AdminNotification } from "@elorae/db";
import {
  bacaBulan,
  bolehMelihatBiaya,
  bolehMembayarBiaya,
  bolehMengajukanBiaya,
  bolehMenyetujuiBiaya,
  ENTITAS_BIAYA,
  JEJAK_BIAYA,
  KATEGORI_NOTIF_BIAYA,
  periksaBiaya,
  periksaPindahBiaya,
  STATUS_BIAYA,
  type KategoriBiaya,
  type KodeTolakBiaya,
  type KodeTolakPindah,
  type StatusBiaya,
} from "@/lib/salesman/biaya";
import { daftarBiayaKantor, pengaturanBiayaDb } from "@/lib/salesman/biaya-queries";

/**
 * Klaim biaya perjalanan salesman: mengajukan (HP), menyetujui/menolak
 * (atasan), menandai dibayar (keuangan), dan ekspor bulanan.
 *
 * Setiap aksi mengembalikan KODE, tidak melempar — di produksi Next
 * menyamarkan pesan galat jadi digest acak. Setiap perubahan status menulis
 * `AuditLog` DI DALAM transaksi yang sama: baris klaim hanya menyimpan
 * keputusan terakhir, jejaknya menyimpan siapa memutuskan apa dan kapan.
 * Kabar ke salesman dikirim SESUDAH transaksi dan tidak pernah membatalkannya.
 */

// ─── Mengajukan (HP) ─────────────────────────────────────────────────────────

export type HasilAjukanBiaya =
  | { ok: true; id: string }
  | { ok: false; kode: KodeTolakBiaya | "TANPA_AKSES" | "KUNJUNGAN_TIDAK_SAH" | "KUNCI_WAJIB" | "GAGAL" };

export async function ajukanBiayaAction(input: {
  tanggal: string;
  kategori: string;
  nilai: number;
  catatan?: string | null;
  fotoUrl?: string | null;
  /** Kunjungan yang berjalan saat formulir dibuka; null = tanpa kunjungan. */
  visitId?: string | null;
  /** Dibuat HP sekali per formulir — dua ketukan Kirim tetap satu klaim. */
  idempotencyKey: string;
}): Promise<HasilAjukanBiaya> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !bolehMengajukanBiaya(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  if (!input || typeof input !== "object") return { ok: false, kode: "GAGAL" };

  const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!kunci || kunci.length > 100) return { ok: false, kode: "KUNCI_WAJIB" };

  try {
    // Kunci diperiksa PALING DULU: kiriman ulang dari klaim yang sudah
    // tersimpan tidak boleh ditolak oleh aturan yang berubah sejak kiriman
    // pertama (mis. tanggalnya kini lewat batas hari).
    const sudah = await prisma.expenseClaim.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, userId: true } });
    if (sudah) return sudah.userId === userId ? { ok: true, id: sudah.id } : { ok: false, kode: "KUNCI_WAJIB" };

    const pengaturan = await pengaturanBiayaDb();
    const periksa = periksaBiaya(
      {
        tanggal: input.tanggal,
        kategori: input.kategori,
        nilai: input.nilai,
        catatan: input.catatan ?? null,
        fotoUrl: input.fotoUrl ?? null,
      },
      pengaturan,
      new Date(),
    );
    if (!periksa.ok) return { ok: false, kode: periksa.kode };

    // Kunjungan harus milik salesman ini. Tidak harus masih terbuka: biaya
    // yang dicatat sesudah check-out tetap milik kunjungan tempat ia terjadi.
    let visitId: string | null = null;
    if (typeof input.visitId === "string" && input.visitId) {
      const v = await prisma.storeVisit.findFirst({ where: { id: input.visitId, userId }, select: { id: true } });
      if (!v) return { ok: false, kode: "KUNJUNGAN_TIDAK_SAH" };
      visitId = v.id;
    }

    const b = periksa.nilai;
    let notifikasi: AdminNotification | null = null;
    const id = await prisma.$transaction(async (tx) => {
      const klaim = await tx.expenseClaim.create({
        data: {
          userId,
          spentAt: b.spentAt,
          category: b.kategori,
          amount: b.nilai,
          photoUrl: b.fotoUrl,
          note: b.catatan,
          visitId,
          idempotencyKey: kunci,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: JEJAK_BIAYA.DIAJUKAN,
          entityType: ENTITAS_BIAYA,
          entityId: klaim.id,
          changes: { after: { status: "DIAJUKAN", tanggal: b.tanggal, kategori: b.kategori, nilai: b.nilai, visitId } },
        },
      });
      // Penyetuju diberi tahu — tanpa ini ajuan menunggu sampai seseorang kebetulan membuka halamannya.
      notifikasi = await tx.adminNotification.create({
        data: {
          category: KATEGORI_NOTIF_BIAYA.DIAJUKAN,
          severity: "INFO",
          title: `Biaya perjalanan diajukan · ${formatIDR(String(b.nilai))}`,
          message: `${NAMA_KATEGORI[b.kategori as KategoriBiaya] ?? b.kategori} tanggal ${formatDisplayDate(b.spentAt)} menunggu persetujuan.`,
          metadata: { claimId: klaim.id },
        },
      });
      return klaim.id;
    });
    if (notifikasi) void fanOutAdminNotification(notifikasi);

    revalidatePath("/pwa/biaya");
    revalidatePath("/backoffice/biaya-perjalanan");
    return { ok: true, id };
  } catch (err) {
    // Dua kiriman berkunci sama yang berpacu: yang kalah membaca milik pemenang.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const ada = await prisma.expenseClaim.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, userId: true } });
      if (ada && ada.userId === userId) return { ok: true, id: ada.id };
    }
    console.error("ajukanBiayaAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}

// ─── Keputusan kantor ────────────────────────────────────────────────────────

export type HasilKeputusanBiaya =
  | { ok: true }
  | {
      ok: false;
      kode: KodeTolakPindah | "TANPA_AKSES" | "TIDAK_DITEMUKAN" | "MILIK_SENDIRI" | "SUDAH_DIPUTUSKAN" | "GAGAL";
    };

/** Nama kategori untuk teks kabar (disimpan sebagai teks di antrean notifikasi). */
const NAMA_KATEGORI: Record<KategoriBiaya, string> = {
  BENSIN: "Bensin",
  PARKIR: "Parkir",
  TOL: "Tol",
  MAKAN: "Makan",
  LAINNYA: "Lainnya",
};

async function putuskan(
  id: string,
  ke: Extract<StatusBiaya, "DISETUJUI" | "DITOLAK" | "DIBAYAR">,
  alasanMentah?: string | null,
): Promise<HasilKeputusanBiaya> {
  const session = await auth();
  const pelakuId = session?.user?.id;
  const izin = session?.user?.permissions;
  const boleh = ke === "DIBAYAR" ? bolehMembayarBiaya(izin) : bolehMenyetujuiBiaya(izin);
  if (!pelakuId || !boleh) return { ok: false, kode: "TANPA_AKSES" };
  if (typeof id !== "string" || !id) return { ok: false, kode: "TIDAK_DITEMUKAN" };

  try {
    const klaim = await prisma.expenseClaim.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, spentAt: true, category: true, amount: true },
    });
    if (!klaim) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    // Tidak ada yang memutuskan uangnya sendiri.
    if (klaim.userId === pelakuId) return { ok: false, kode: "MILIK_SENDIRI" };

    const periksa = periksaPindahBiaya(klaim.status, ke, alasanMentah);
    if (!periksa.ok) {
      // Klaim yang sudah diputuskan orang lain lebih dulu: katakan itu, bukan
      // "perpindahan tidak sah" yang membingungkan. Membayar klaim yang belum
      // disetujui (atau ditolak) tetap TRANSISI_TIDAK_SAH — itu bukan balapan.
      const sudah =
        periksa.kode === "TRANSISI_TIDAK_SAH" &&
        (ke === "DIBAYAR" ? klaim.status === "DIBAYAR" : klaim.status !== "DIAJUKAN");
      return { ok: false, kode: sudah ? "SUDAH_DIPUTUSKAN" : periksa.kode };
    }

    const sekarang = new Date();
    const data =
      ke === "DIBAYAR"
        ? { status: ke, paidById: pelakuId, paidAt: sekarang }
        : { status: ke, reviewedById: pelakuId, reviewedAt: sekarang, reviewNote: periksa.alasan };

    let notifikasiBayar: AdminNotification | null = null;
    const berhasil = await prisma.$transaction(async (tx) => {
      // Bandingkan-lalu-tukar: dua orang yang menekan bersamaan tidak bisa
      // sama-sama "berhasil" — yang kedua mendapati statusnya sudah bergeser.
      const r = await tx.expenseClaim.updateMany({ where: { id, status: klaim.status }, data });
      if (r.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          userId: pelakuId,
          action: JEJAK_BIAYA[ke],
          entityType: ENTITAS_BIAYA,
          entityId: id,
          changes: { before: { status: klaim.status }, after: { status: ke } },
          reason: periksa.alasan,
        },
      });
      // Disetujui → keuangan yang membayar perlu tahu ada yang harus dibayar.
      if (ke === "DISETUJUI") {
        notifikasiBayar = await tx.adminNotification.create({
          data: {
            category: KATEGORI_NOTIF_BIAYA.PERLU_DIBAYAR,
            severity: "INFO",
            title: `Biaya perjalanan perlu dibayar · ${formatIDR(klaim.amount.toString())}`,
            message: `${NAMA_KATEGORI[klaim.category as KategoriBiaya] ?? klaim.category} tanggal ${formatDisplayDate(klaim.spentAt)} sudah disetujui.`,
            metadata: { claimId: id },
          },
        });
      }
      return true;
    });
    if (!berhasil) return { ok: false, kode: "SUDAH_DIPUTUSKAN" };
    if (notifikasiBayar) void fanOutAdminNotification(notifikasiBayar);

    const ringkas = `${NAMA_KATEGORI[klaim.category as KategoriBiaya] ?? klaim.category} · ${formatIDR(
      klaim.amount.toString(),
    )} (${formatDisplayDate(klaim.spentAt)})`;
    await kabariPengguna(
      klaim.userId,
      ke === "DISETUJUI"
        ? {
            jenis: JENIS_KABAR.BIAYA_DISETUJUI,
            judul: "Biaya perjalanan disetujui",
            isi: `${ringkas} disetujui, menunggu dibayar.`,
            data: { claimId: id },
          }
        : ke === "DITOLAK"
          ? {
              jenis: JENIS_KABAR.BIAYA_DITOLAK,
              judul: "Biaya perjalanan ditolak",
              isi: `${ringkas}. Alasan: ${periksa.alasan ?? "-"}`,
              data: { claimId: id },
            }
          : {
              jenis: JENIS_KABAR.BIAYA_DIBAYAR,
              judul: "Biaya perjalanan dibayar",
              isi: `${ringkas} sudah dibayar.`,
              data: { claimId: id },
            },
    );

    revalidatePath("/backoffice/biaya-perjalanan");
    revalidatePath(`/backoffice/biaya-perjalanan/${id}`);
    revalidatePath("/pwa/biaya");
    return { ok: true };
  } catch (err) {
    console.error("keputusan biaya gagal", ke, id, err);
    return { ok: false, kode: "GAGAL" };
  }
}

export async function setujuiBiayaAction(id: string): Promise<HasilKeputusanBiaya> {
  return putuskan(id, "DISETUJUI");
}

export async function tolakBiayaAction(id: string, alasan: string): Promise<HasilKeputusanBiaya> {
  return putuskan(id, "DITOLAK", alasan);
}

export async function tandaiDibayarBiayaAction(id: string): Promise<HasilKeputusanBiaya> {
  return putuskan(id, "DIBAYAR");
}

// ─── Ekspor ──────────────────────────────────────────────────────────────────

/**
 * Teks kolom dan nilai dikirim dari klien: aplikasi ini menerjemahkan lewat
 * penyedia bahasa di klien dan tidak punya konfigurasi next-intl di server,
 * jadi berkas Excel ikut bahasa layar orang yang mengunduhnya.
 */
export type LabelEksporBiaya = {
  judul: string;
  kolom: {
    tanggal: string;
    salesman: string;
    kategori: string;
    nilai: string;
    catatan: string;
    toko: string;
    status: string;
    diajukan: string;
    diputuskanOleh: string;
    diputuskanPada: string;
    alasan: string;
    dibayarOleh: string;
    dibayarPada: string;
    foto: string;
  };
  ringkasan: string;
  total: string;
  ada: string;
  kategori: Record<string, string>;
  status: Record<string, string>;
};

export type HasilEksporBiaya = { ok: true; base64: string; filename: string } | { ok: false; kode: "TANPA_AKSES" | "GAGAL" };

const teks = (x: unknown, cadangan: string): string => (typeof x === "string" && x.trim() ? x.slice(0, 200) : cadangan);

export async function eksporBiayaExcelAction(input: {
  bulan: string;
  status?: string | null;
  salesmanId?: string | null;
  label: LabelEksporBiaya;
}): Promise<HasilEksporBiaya> {
  const session = await auth();
  if (!session?.user?.id || !bolehMelihatBiaya(session.user.permissions)) return { ok: false, kode: "TANPA_AKSES" };
  try {
    const bulan = bacaBulan(input?.bulan, new Date());
    const status = STATUS_BIAYA.includes(input?.status as StatusBiaya) ? (input.status as StatusBiaya) : null;
    const salesmanId = typeof input?.salesmanId === "string" && input.salesmanId ? input.salesmanId : null;
    const L = input?.label ?? ({} as LabelEksporBiaya);
    const k = L.kolom ?? ({} as LabelEksporBiaya["kolom"]);
    const namaKategori = (x: string) => teks(L.kategori?.[x], x);
    const namaStatus = (x: string) => teks(L.status?.[x], x);

    const data = await daftarBiayaKantor({ bulan, status, salesmanId });
    type Sel = string | number;
    const rows: Sel[][] = [
      [`${teks(L.judul, "Biaya perjalanan")} — ${bulan}`],
      [],
      [
        teks(k.tanggal, "Tanggal"),
        teks(k.salesman, "Salesman"),
        teks(k.kategori, "Kategori"),
        teks(k.nilai, "Nilai"),
        teks(k.catatan, "Catatan"),
        teks(k.toko, "Toko"),
        teks(k.status, "Status"),
        teks(k.diajukan, "Diajukan"),
        teks(k.diputuskanOleh, "Diputuskan oleh"),
        teks(k.diputuskanPada, "Diputuskan pada"),
        teks(k.alasan, "Alasan"),
        teks(k.dibayarOleh, "Dibayar oleh"),
        teks(k.dibayarPada, "Dibayar pada"),
        teks(k.foto, "Foto"),
      ],
      ...[...data.baris]
        .sort((a, b) => a.tanggalIso.localeCompare(b.tanggalIso) || a.salesman.localeCompare(b.salesman))
        .map((b): Sel[] => [
          b.tanggalIso,
          b.salesman,
          namaKategori(b.kategori),
          b.nilai,
          b.catatan ?? "",
          b.toko ?? "",
          namaStatus(b.status),
          b.diajukan,
          b.diputuskanOleh ?? "",
          b.diputuskanPada ?? "",
          b.alasanTolak ?? "",
          b.dibayarOleh ?? "",
          b.dibayarPada ?? "",
          b.fotoUrl ? teks(L.ada, "Ada") : "",
        ]),
      [],
      [teks(L.ringkasan, "Ringkasan")],
      ...STATUS_BIAYA.map((s): Sel[] => [namaStatus(s), data.perStatus[s].jumlah, "", data.perStatus[s].nilai]),
      [teks(L.total, "Total"), data.total.jumlah, "", data.total.nilai],
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [12, 22, 12, 14, 30, 22, 14, 20, 20, 20, 30, 20, 20, 8].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, ws, bulan);
    const buffer = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    return { ok: true, base64: buffer.toString("base64"), filename: `biaya-perjalanan-${bulan}.xlsx` };
  } catch (err) {
    console.error("eksporBiayaExcelAction gagal", err);
    return { ok: false, kode: "GAGAL" };
  }
}
