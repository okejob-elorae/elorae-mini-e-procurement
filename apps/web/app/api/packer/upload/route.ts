import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { uploadToR2, isConfigured } from "@/lib/r2";
import { prisma } from "@elorae/db";
import { getFallbackSalesOrderId, findSalesOrderByTrackingNumber } from "@/lib/packer/queries";
import {
  upsertPackingVideo,
  PackerOrderNotFoundError,
  PackerVideoConflictError,
} from "@/lib/packer/mutations";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_TYPES = new Set([
  "video/webm",
  "video/mp4",
  "video/quicktime",
  "video/x-matroska",
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const perms = session.user.permissions ?? [];
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    console.error("packer upload formData parse failed:", err);
    return NextResponse.json(
      {
        error:
          "Gagal baca file upload (body terlalu besar atau terpotong). Coba rekam lebih pendek, atau restart dev server setelah update limit.",
      },
      { status: 413 },
    );
  }
  const replace = String(form.get("replace") ?? "false") === "true";
  const canUpload =
    hasPermission(perms, PERMISSIONS.PACKER_RECORD) ||
    hasPermission(perms, PERMISSIONS.PACKER_EDIT);
  if (!canUpload) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 503 });
  }

  const file = form.get("file") as File | null;
  let salesOrderId = (form.get("salesOrderId") as string | null)?.trim() || "";
  const barcode = (form.get("barcode") as string | null)?.trim() || "";
  const durationRaw = form.get("durationSec") as string | null;

  if (!file) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  if (!salesOrderId && barcode) {
    const matched = await findSalesOrderByTrackingNumber(barcode);
    if (matched) salesOrderId = matched.id;
  }
  if (!salesOrderId) {
    salesOrderId = (await getFallbackSalesOrderId()) ?? "";
  }
  if (!salesOrderId) {
    return NextResponse.json(
      { error: "Tidak ada sales order di database untuk menampung video" },
      { status: 400 },
    );
  }
  if (!ALLOWED_TYPES.has(file.type) && !file.type.startsWith("video/")) {
    return NextResponse.json(
      { error: `type ${file.type || "unknown"} not allowed` },
      { status: 400 },
    );
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "file exceeds 100MB" }, { status: 400 });
  }

  const durationSec =
    durationRaw != null && durationRaw !== ""
      ? Number(durationRaw)
      : null;
  if (durationSec != null && !Number.isFinite(durationSec)) {
    return NextResponse.json({ error: "invalid durationSec" }, { status: 400 });
  }

  const ext =
    file.type.includes("mp4")
      ? "mp4"
      : file.type.includes("quicktime")
        ? "mov"
        : "webm";
  const key = `packing-videos/${salesOrderId}/${Date.now()}.${ext}`;

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const videoUrl = await uploadToR2(
      key,
      buffer,
      file.type || "video/webm",
    );
    const existing = await prisma.packingVideo.findUnique({
      where: { salesOrderId },
      select: { id: true },
    });
    const row = await upsertPackingVideo({
      salesOrderId,
      userId: session.user.id,
      r2Key: key,
      videoUrl,
      contentType: file.type || "video/webm",
      sizeBytes: file.size,
      durationSec:
        durationSec != null && Number.isFinite(durationSec)
          ? Math.round(durationSec * 100) / 100
          : null,
      replace: replace || !!existing,
    });
    return NextResponse.json({
      id: row.id,
      videoUrl: row.videoUrl,
      salesOrderId: row.salesOrderId,
    });
  } catch (e) {
    if (e instanceof PackerOrderNotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    if (e instanceof PackerVideoConflictError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("packing-video upload error:", e);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
