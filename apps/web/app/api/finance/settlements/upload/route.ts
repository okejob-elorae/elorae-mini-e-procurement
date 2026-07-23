import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseShopeeSettlement } from "@/lib/finance/settlement/shopee-settlement-parser";
import { persistSettlement } from "@/lib/finance/settlement/persist";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const perms = (session.user as { permissions?: string[] }).permissions ?? [];
  if (!hasPermission(perms, PERMISSIONS.SETTLEMENTS_MANAGE)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parsed = parseShopeeSettlement(buffer);
  if (!parsed.ok) {
    return NextResponse.json({ errors: parsed.errors }, { status: 422 });
  }

  const { settlementId, checksumOk, checksumVariance, lineCount } = await persistSettlement({
    parsed: parsed.data,
    fileName: file.name,
    uploadedById: session.user.id,
    marketplace: "SHOPEE",
  });

  return NextResponse.json({ settlementId, checksumOk, checksumVariance, lineCount });
}
