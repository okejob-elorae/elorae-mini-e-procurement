import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { parseSettlement, isSupportedMarketplace } from "@/lib/finance/settlement/parser";
import {
  hapusSettlementBelumDijurnal,
  persistSettlement,
  SettlementGandaError,
} from "@/lib/finance/settlement/persist";

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
    const parsed = parseSettlement(marketplace, buffer);
    if (!parsed.ok) {
      return NextResponse.json({ errors: parsed.errors }, { status: 422 });
    }

    let hasil: Awaited<ReturnType<typeof persistSettlement>>;
    try {
      hasil = await persistSettlement({
        parsed: parsed.data,
        fileName: file.name,
        uploadedById: session.user.id,
        marketplace,
      });
    } catch (e) {
      // Berkas yang sama sudah pernah diunggah: tolak dan sebut unggahan pertamanya.
      if (e instanceof SettlementGandaError) {
        return NextResponse.json(
          {
            code: e.code,
            pertama: { ...e.pertama, uploadedAt: e.pertama.uploadedAt.toISOString() },
          },
          { status: 409 },
        );
      }
      throw e;
    }

    const { settlementId, checksumOk, checksumVariance, lineCount } = hasil;
    return NextResponse.json({ settlementId, checksumOk, checksumVariance, lineCount });
  } catch (error) {
    console.error("Settlement upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

/**
 * Membatalkan unggahan yang BELUM dijurnal (salah unggah / unggahan kembar).
 * Isi: `{ settlementId, alasan }`. Izin sama dengan mengunggah; jejaknya di AuditLog.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
    }
    const perms = (session.user as { permissions?: string[] }).permissions ?? [];
    if (!hasPermission(perms, PERMISSIONS.SETTLEMENTS_MANAGE)) {
      return NextResponse.json({ ok: false, code: "FORBIDDEN" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
    }
    const b = (typeof body === "object" && body !== null ? body : {}) as { settlementId?: unknown; alasan?: unknown };
    if (typeof b.settlementId !== "string" || typeof b.alasan !== "string") {
      return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
    }

    const hasil = await hapusSettlementBelumDijurnal({
      settlementId: b.settlementId,
      userId: session.user.id,
      alasan: b.alasan,
    });
    if (hasil.ok) return NextResponse.json(hasil);
    const status = hasil.code === "TIDAK_DITEMUKAN" ? 404 : hasil.code === "SUDAH_DIJURNAL" ? 409 : 400;
    return NextResponse.json(hasil, { status });
  } catch (error) {
    console.error("Settlement delete error:", error);
    return NextResponse.json({ ok: false, code: "ERROR" }, { status: 500 });
  }
}
