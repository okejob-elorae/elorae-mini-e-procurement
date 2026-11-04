import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { uploadToR2, isConfigured } from "@/lib/r2";
import { buildR2Key, isSafeR2KeySegment } from "@/lib/r2-key";
import { exceedsDeclaredLength } from "@/lib/uploads/content-length";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const JENIS_SUMBER = new Set(["KONSI_TRANSFER", "PUTUS_DELIVERY"]);

const tolak = (error: string, status: number) => NextResponse.json({ error }, { status });

/**
 * Foto penerimaan kiriman oleh SALESMAN PEMEGANG toko, ke R2 (pemilik P45a "benar": penanggung
 * jawab toko menerima barang SPG yang sudah berhenti, salesman pemegang mencatatnya saat
 * berkunjung — nama penanggung jawab + foto).
 *
 * Hanya pemegang toko itu (`Store.salesmanId`), dan hanya untuk dokumen kiriman TOKO ITU (transfer
 * konsinyasi atau nota putus). Kuncinya terikat pada dokumennya —
 * `store-receipt-photos/<storeId>/<sourceType>-<sourceId>/<clientId>.<ext>` — folder yang sama
 * yang diperiksa penulis penerimaannya (`terimaKirimanPemegang`), jadi satu foto tidak bisa
 * menjadi bukti penerimaan dokumen lain. Penulis itu juga yang memeriksa kunjungan, toko tanpa
 * SPG, dan status pengirimannya; rute ini hanya menyimpan fotonya.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return tolak("TANPA_AKSES", 401);
  if (pwaAccessGuard(session.user.permissions) !== "render") return tolak("TANPA_AKSES", 403);
  if (!isConfigured()) return tolak("GAGAL", 503);
  if (exceedsDeclaredLength(req, MAX_FILE_SIZE)) return tolak("TERLALU_BESAR", 413);

  const form = await req.formData();
  const file = form.get("file");
  const teks = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  const storeId = teks("storeId");
  const sourceType = teks("sourceType");
  const sourceId = teks("sourceId");
  const clientId = teks("clientId");

  if (!isSafeR2KeySegment(storeId) || !isSafeR2KeySegment(sourceId) || !isSafeR2KeySegment(clientId)) {
    return tolak("ISIAN_TIDAK_VALID", 400);
  }
  if (!JENIS_SUMBER.has(sourceType)) return tolak("ISIAN_TIDAK_VALID", 400);
  if (!(file instanceof File)) return tolak("FILE_WAJIB", 400);
  if (!ALLOWED_TYPES.has(file.type)) return tolak("JENIS_TIDAK_DIIZINKAN", 400);
  if (file.size > MAX_FILE_SIZE) return tolak("TERLALU_BESAR", 400);

  try {
    const toko = await prisma.store.findUnique({ where: { id: storeId }, select: { salesmanId: true } });
    if (!toko) return tolak("TIDAK_DITEMUKAN", 404);
    if (toko.salesmanId !== session.user.id) return tolak("BUKAN_PEMEGANG", 403);

    // Dokumennya harus kiriman ke toko ini — dokumen toko lain sama dengan tidak ada.
    const dokumen =
      sourceType === "KONSI_TRANSFER"
        ? await prisma.konsiTransfer.findFirst({ where: { id: sourceId, storeId }, select: { id: true } })
        : await prisma.fieldSalesDelivery.findFirst({ where: { id: sourceId, order: { storeId } }, select: { id: true } });
    if (!dokumen) return tolak("TIDAK_DITEMUKAN", 404);

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = buildR2Key("store-receipt-photos", [storeId, `${sourceType}-${sourceId}`, clientId], ext);
    const url = await uploadToR2(key, Buffer.from(await file.arrayBuffer()), file.type);
    return NextResponse.json({ url, key });
  } catch (e) {
    console.error("store-receipt-photo upload error:", e);
    return tolak("GAGAL", 500);
  }
}
