import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { uploadToR2, isConfigured } from "@/lib/r2";
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
  const form = await req.formData();
  const replace = String(form.get("replace") ?? "false") === "true";
  const needed = replace ? PERMISSIONS.PACKER_EDIT : PERMISSIONS.PACKER_RECORD;
  if (!hasPermission(perms, needed)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isConfigured()) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 503 });
  }

  const file = form.get("file") as File | null;
  const salesOrderId = (form.get("salesOrderId") as string | null)?.trim();
  const durationRaw = form.get("durationSec") as string | null;

  if (!file || !salesOrderId) {
    return NextResponse.json(
      { error: "file and salesOrderId required" },
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
      replace,
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
