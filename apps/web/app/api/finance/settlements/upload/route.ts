import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseSettlement, isSupportedMarketplace } from "@/lib/finance/settlement/parser";
import { persistSettlement } from "@/lib/finance/settlement/persist";
import { matchSettlement } from "@/lib/finance/settlement/match";
import { startSettlementResync } from "@/lib/finance/settlement/start-resync";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
]);

function isXlsxFile(file: File): boolean {
  if (ALLOWED_TYPES.has(file.type)) return true;
  return file.name.toLowerCase().endsWith(".xlsx");
}

export async function POST(request: NextRequest) {
  try {
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
    if (!isXlsxFile(file)) {
      return NextResponse.json({ error: "File must be an .xlsx spreadsheet" }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "File exceeds the 10 MB limit" }, { status: 400 });
    }

    const marketplaceRaw = formData.get("marketplace");
    const marketplace = typeof marketplaceRaw === "string" && marketplaceRaw ? marketplaceRaw : "SHOPEE";
    if (!isSupportedMarketplace(marketplace)) {
      return NextResponse.json({ error: `Unsupported marketplace "${marketplace}"` }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileSha256 = createHash("sha256").update(buffer).digest("hex");

    const duplicate = await prisma.settlement.findFirst({
      where: { marketplace, fileSha256 },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json({ error: "DUPLICATE_FILE", settlementId: duplicate.id }, { status: 409 });
    }

    const parsed = parseSettlement(marketplace, buffer);
    if (!parsed.ok) {
      return NextResponse.json({ errors: parsed.errors }, { status: 422 });
    }

    let persisted: Awaited<ReturnType<typeof persistSettlement>>;
    try {
      persisted = await persistSettlement({
        parsed: parsed.data,
        fileName: file.name,
        uploadedById: session.user.id,
        marketplace,
        fileSha256,
      });
    } catch (err) {
      /* Two identical uploads racing: the loser trips the (marketplace, fileSha256) unique and points at the winner. */
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await prisma.settlement.findFirst({
          where: { marketplace, fileSha256 },
          select: { id: true },
        });
        if (winner) {
          return NextResponse.json({ error: "DUPLICATE_FILE", settlementId: winner.id }, { status: 409 });
        }
      }
      throw err;
    }
    const { settlementId, checksumOk, checksumVariance, lineCount } = persisted;

    let matched: { matched: number; unmatched: number } | null = null;
    let resync: { started: true; seeded: number } | { started: false; reason: "NO_TARGETS" | "API_ERROR" | "MATCH_FAILED" };
    try {
      const m = await matchSettlement(settlementId);
      matched = { matched: m.matched, unmatched: m.unmatched };
      const r = await startSettlementResync(settlementId, session.user.id);
      /* NOT_FOUND cannot occur right after persist, so it's folded into API_ERROR here. */
      resync = r.ok ? { started: true, seeded: r.seeded } : { started: false, reason: r.code === "NO_TARGETS" ? "NO_TARGETS" : "API_ERROR" };
    } catch (err) {
      /* The settlement is already persisted — a match or fetch failure must not fail the upload; the page still offers Match and Resync by hand. */
      console.error("Settlement auto-match/fetch error:", err);
      resync = { started: false, reason: "MATCH_FAILED" };
    }

    return NextResponse.json({ settlementId, checksumOk, checksumVariance, lineCount, matched, resync });
  } catch (error) {
    console.error("Settlement upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
