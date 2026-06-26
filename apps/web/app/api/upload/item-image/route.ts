import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { uploadToR2, isConfigured } from "@/lib/r2";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { validateMime, validateSize } from "@/lib/items/images/validators";

export const dynamic = "force-dynamic";

function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const perms = (session.user as { permissions?: string[] }).permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.ITEMS_MANAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (!isConfigured()) {
    return NextResponse.json({ error: "R2 storage is not configured" }, { status: 503 });
  }

  const itemIdParam = new URL(request.url).searchParams.get("itemId");
  const itemId = itemIdParam || "_pending";

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const urls: string[] = [];

  for (const file of files) {
    const mimeCheck = validateMime(file.type);
    if (!mimeCheck.ok) {
      return NextResponse.json({ error: mimeCheck.code, message: mimeCheck.message }, { status: 400 });
    }
    const sizeCheck = validateSize(file.size);
    if (!sizeCheck.ok) {
      return NextResponse.json({ error: sizeCheck.code, message: sizeCheck.message }, { status: 400 });
    }

    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
    const key = `items/${itemId}/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(key, buffer, file.type);
    urls.push(url);
  }

  return NextResponse.json({ urls });
}
