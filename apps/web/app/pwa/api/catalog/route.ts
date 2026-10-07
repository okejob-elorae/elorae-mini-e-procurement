import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { listCatalogForPwa } from "@/lib/catalog/queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pwaAccessGuard(session.user.permissions) !== "render") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) return NextResponse.json({ error: "storeId required" }, { status: 400 });

  const payload = await listCatalogForPwa(storeId);
  if (!payload) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  return NextResponse.json(payload);
}
