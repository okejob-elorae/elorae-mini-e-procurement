import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { uploadToR2, isConfigured } from "@/lib/r2";
import { prisma } from "@elorae/db";
import { attachVisitPhoto, VisitOwnershipError } from "@/lib/field-sales/visit-photo-writer";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pwaAccessGuard(session.user.permissions) !== "render") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isConfigured()) return NextResponse.json({ error: "R2 not configured" }, { status: 503 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const visitId = form.get("visitId") as string | null;
  const clientId = form.get("clientId") as string | null;
  const caption = ((form.get("caption") as string | null) || "").trim() || undefined;
  const capturedAtRaw = form.get("capturedAt") as string | null;

  if (!file || !visitId || !clientId) return NextResponse.json({ error: "file, visitId, clientId required" }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: `type ${file.type} not allowed` }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "file exceeds 10MB" }, { status: 400 });

  const capturedAt = capturedAtRaw ? new Date(Number(capturedAtRaw)) : new Date();

  try {
    const already = await prisma.visitPhoto.findUnique({ where: { clientId }, select: { id: true, url: true } });
    if (already) return NextResponse.json(already);

    const owned = await prisma.storeVisit.findFirst({ where: { id: visitId, userId: session.user.id }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "visit not found" }, { status: 404 });

    const key = `visit-photos/${visitId}/${clientId}.jpg`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(key, buffer, file.type);
    const photo = await prisma.$transaction((tx) =>
      attachVisitPhoto(tx, { visitId, salesmanId: session.user.id, clientId, url, r2Key: key, caption, capturedAt }));
    return NextResponse.json(photo);
  } catch (e) {
    if (e instanceof VisitOwnershipError) return NextResponse.json({ error: "visit not found" }, { status: 404 });
    console.error("visit-photo upload error:", e);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
