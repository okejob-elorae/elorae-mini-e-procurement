import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { uploadToR2, isConfigured } from "@/lib/r2";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.DELIVERIES_POD)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isConfigured()) return NextResponse.json({ error: "R2 not configured" }, { status: 503 });

  const form = await req.formData();
  const file = form.get("file");
  const shipmentId = form.get("shipmentId");

  if (!(file instanceof File) || typeof shipmentId !== "string" || !shipmentId) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: `type ${file.type} not allowed` }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "file exceeds 10MB" }, { status: 400 });

  try {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `delivery-proofs/${shipmentId}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(key, buffer, file.type);
    return NextResponse.json({ url, key });
  } catch (e) {
    console.error("delivery-proof upload error:", e);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
