import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { ambilTokoTetap, spgBerhentiPada } from "@/lib/pwa/peran";
import { uploadToR2, isConfigured } from "@/lib/r2";
import { buildR2Key, isSafeR2KeySegment } from "@/lib/r2-key";
import { exceedsDeclaredLength } from "@/lib/uploads/content-length";
import { bacaJenisFotoReturPembeli, PREFIX_FOTO_RETUR_PEMBELI } from "@/lib/spg/foto-retur-pembeli-kunci";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const tolak = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Satu foto retur pembeli SPG ke R2 (P14, P77): `barang` saat melapor, `struk`
 * saat uang pembeli dikembalikan. Kuncinya PASTI —
 * `spg-sale-returns/<storeId>/<kunci laporan>/<barang|struk>.<ext>` — jadi
 * unggah ulang (langsung atau dari antrean HP) menimpa objek yang sama.
 * `storeId` selalu dari server, tidak pernah dari HP: toko tetap SPG
 * (`User.assignedStoreId`), atau — untuk SPG yang sudah ditandai berhenti —
 * toko yang dilepasnya (`spgBerhentiPada`), supaya foto pekerjaan antreannya
 * tetap naik. Apakah pekerjaan itu masih dicatat diputuskan aksinya menurut saat
 * ditangkap di HP (`tokoSpgUntukAntrean`).
 *
 * Dua cara:
 * - `kunci` (sebelum laporannya ada; kunci formulir = `idempotencyKey`
 *   laporannya): belum ada laporan berkunci itu → tulis. Laporan SPG ini sendiri
 *   yang sudah menyimpan foto jenis itu → kembalikan kunci TERSIMPAN tanpa
 *   menulis (jawaban yang hilang lalu dikirim ulang). Selain itu 409.
 * - `returnId` (langkah "Uang sudah dikembalikan", hanya `struk`): laporan SPG
 *   ini di tokonya. Uangnya sudah tercatat → kembalikan kunci struk yang
 *   tersimpan. Belum tercatat → tulis, apa pun statusnya: penulisnya
 *   (`catatUangDikembalikan`) yang memutuskan — MENUNGGU/DISETUJUI dicatat,
 *   DITOLAK menjadi beban SPG, DIBATALKAN dibuka lagi atau diberitahukan ke
 *   kantor dengan foto struknya. Ditandai kantor "uang ternyata sudah
 *   dikembalikan" saat menolak (P78) dan masih DITOLAK: belum ada struk → tulis
 *   (struknya dilampirkan), sudah ada → kunci tersimpan. Bertanda kantor tetapi
 *   tidak lagi DITOLAK (penolakannya dibatalkan, P82) → 409, sama dengan
 *   penulisnya (`SUDAH_DICATAT`). Laporan orang lain atau yang tidak ada → 404
 *   yang sama.
 *
 * Foto ditampilkan hanya dari kunci tersimpannya (`urlFotoReturPembeli`).
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return tolak("TANPA_AKSES", 401);
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SPG_SALES_RECORD)) return tolak("TANPA_AKSES", 403);
  const storeId = (await ambilTokoTetap(session.user.id)) ?? (await spgBerhentiPada(session.user.id))?.storeId ?? null;
  if (!storeId || !isSafeR2KeySegment(storeId)) return tolak("TANPA_AKSES", 403);
  if (!isConfigured()) return tolak("GAGAL", 503);
  if (exceedsDeclaredLength(req, MAX_FILE_SIZE)) return tolak("TERLALU_BESAR", 413);

  const form = await req.formData();
  const file = form.get("file");
  const jenis = bacaJenisFotoReturPembeli(form.get("jenis"));
  const kunciMentah = form.get("kunci");
  const returnIdMentah = form.get("returnId");
  const kunci = typeof kunciMentah === "string" && kunciMentah ? kunciMentah : null;
  const returnId = typeof returnIdMentah === "string" && returnIdMentah ? returnIdMentah : null;

  if (!jenis) return tolak("ISIAN_TIDAK_VALID", 400);
  if ((kunci === null) === (returnId === null)) return tolak("ISIAN_TIDAK_VALID", 400);
  if (kunci !== null && !isSafeR2KeySegment(kunci)) return tolak("ISIAN_TIDAK_VALID", 400);
  if (returnId !== null && (!isSafeR2KeySegment(returnId) || jenis !== "struk")) return tolak("ISIAN_TIDAK_VALID", 400);
  if (!(file instanceof File)) return tolak("FILE_WAJIB", 400);
  if (!ALLOWED_TYPES.has(file.type)) return tolak("JENIS_TIDAK_DIIZINKAN", 400);
  if (file.size > MAX_FILE_SIZE) return tolak("TERLALU_BESAR", 400);

  let folderKunci: string;
  if (kunci !== null) {
    const ada = await prisma.spgSaleReturn.findUnique({
      where: { idempotencyKey: kunci },
      select: { createdById: true, storeId: true, goodsPhotoR2Key: true, refundSlipR2Key: true },
    });
    if (ada) {
      const milik = ada.createdById === session.user.id && ada.storeId === storeId;
      const tersimpan = jenis === "barang" ? ada.goodsPhotoR2Key : ada.refundSlipR2Key;
      if (milik && tersimpan) return NextResponse.json({ key: tersimpan });
      return tolak("KEADAAN", 409);
    }
    folderKunci = kunci;
  } else {
    const r = await prisma.spgSaleReturn.findUnique({
      where: { id: returnId! },
      select: { createdById: true, storeId: true, status: true, idempotencyKey: true, refundedAt: true, refundSlipR2Key: true, refundMarkedById: true },
    });
    if (!r || r.createdById !== session.user.id || r.storeId !== storeId) return tolak("TIDAK_DITEMUKAN", 404);
    if (r.refundedAt !== null) {
      return r.refundSlipR2Key ? NextResponse.json({ key: r.refundSlipR2Key }) : tolak("KEADAAN", 409);
    }
    const tandaKantor = r.refundMarkedById !== null;
    if (tandaKantor && r.status === "DITOLAK" && r.refundSlipR2Key) return NextResponse.json({ key: r.refundSlipR2Key });
    const bolehTulis = tandaKantor
      ? r.status === "DITOLAK"
      : r.status === "MENUNGGU" || r.status === "DISETUJUI" || r.status === "DITOLAK" || r.status === "DIBATALKAN";
    if (!bolehTulis || !isSafeR2KeySegment(r.idempotencyKey)) return tolak("KEADAAN", 409);
    folderKunci = r.idempotencyKey;
  }

  try {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = buildR2Key(PREFIX_FOTO_RETUR_PEMBELI, [storeId, folderKunci, jenis], ext);
    await uploadToR2(key, Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json({ key });
  } catch (e) {
    console.error("spg-sale-return-photo upload error:", e);
    return tolak("GAGAL", 500);
  }
}
