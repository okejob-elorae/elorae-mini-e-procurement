import { NextResponse } from "next/server";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { getObjectFromR2, isConfigured } from "@/lib/r2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function downloadFilename(r2Key: string, salesOrderId: string, contentType: string): string {
  const base = r2Key.split("/").pop()?.trim();
  if (base) return base.replace(/[^\w.\-()+ ]+/g, "_");
  const ext =
    contentType.includes("mp4") ? "mp4"
    : contentType.includes("quicktime") ? "mov"
    : contentType.includes("matroska") ? "mkv"
    : "webm";
  return `packing-video-${salesOrderId}.${ext}`;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ salesOrderId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const perms = session.user.permissions ?? [];
  const allowed =
    hasPermission(perms, PERMISSIONS.SALES_ORDERS_VIEW) ||
    hasPermission(perms, PERMISSIONS.SALES_RETURNS_VIEW) ||
    hasPermission(perms, PERMISSIONS.PACKER_MENU);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isConfigured()) {
    return NextResponse.json({ error: "R2 not configured" }, { status: 503 });
  }

  const { salesOrderId } = await ctx.params;
  if (!salesOrderId) {
    return NextResponse.json({ error: "salesOrderId required" }, { status: 400 });
  }

  const video = await prisma.packingVideo.findUnique({
    where: { salesOrderId },
    select: { r2Key: true, contentType: true },
  });
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  try {
    const obj = await getObjectFromR2(video.r2Key);
    if (!obj.Body) {
      return NextResponse.json({ error: "Empty object" }, { status: 404 });
    }

    const filename = downloadFilename(video.r2Key, salesOrderId, video.contentType);
    const stream = obj.Body.transformToWebStream();
    const headers = new Headers({
      "Content-Type": video.contentType || obj.ContentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    });
    if (obj.ContentLength != null) {
      headers.set("Content-Length", String(obj.ContentLength));
    }

    return new NextResponse(stream, { status: 200, headers });
  } catch (err) {
    console.error("[packing-videos/download]", err);
    return NextResponse.json({ error: "Download failed" }, { status: 502 });
  }
}
