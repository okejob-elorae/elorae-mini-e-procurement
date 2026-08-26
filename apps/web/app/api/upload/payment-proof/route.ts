import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { uploadToR2, isConfigured } from "@/lib/r2";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

/**
 * POST — uploads one payment proof file to R2 and returns both the public URL and the R2 key,
 * following the `attachVisitPhoto` pattern (`apps/web/lib/field-sales/visit-photo-writer.ts`) of
 * carrying the two together: `recordPaymentAction` stores `proofUrl` and `proofR2Key` as a pair,
 * so the key has to reach the client too rather than only the URL.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.PAYMENTS_MANAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!isConfigured()) {
    return NextResponse.json({ error: "R2 storage is not configured" }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `File type "${file.type}" is not allowed` }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds the 10 MB limit" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const key = `payments/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await uploadToR2(key, buffer, file.type);

  return NextResponse.json({ url, key });
}
