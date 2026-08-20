import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pwaAccessGuard } from "@/lib/pwa/guard";
import { uploadToR2, isConfigured } from "@/lib/r2";
import { createFieldReturn } from "@/lib/field-sales/retur/writer";
import { FieldReturnError } from "@/lib/field-sales/retur/errors";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * POST /pwa/api/retur
 * Records a store return raised by a field salesman: lines + transport
 * details + a photo of the store's paper nota retur. The photo is uploaded
 * to R2 BEFORE the writer runs — R2 is the only non-transactional step, so
 * a writer failure afterwards leaves an inert orphan object rather than
 * holding a database transaction open across a network upload.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (pwaAccessGuard(session.user.permissions) !== "render") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isConfigured()) return NextResponse.json({ error: "R2 not configured" }, { status: 503 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const storeId = (form.get("storeId") as string | null) ?? "";
  const visitId = (form.get("visitId") as string | null) || null;
  const transport = (form.get("transport") as string | null) ?? "";
  const expeditionName = (form.get("expeditionName") as string | null) || null;
  const resiNo = (form.get("resiNo") as string | null) || null;
  const note = (form.get("note") as string | null) || null;
  const linesRaw = (form.get("lines") as string | null) ?? "";

  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `type ${file.type} not allowed` }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "file exceeds 10MB" }, { status: 400 });
  if (storeId.trim() === "") return NextResponse.json({ error: "storeId required" }, { status: 400 });
  if (transport !== "SELF_CARRY" && transport !== "EXPEDITION") {
    return NextResponse.json({ error: "transport invalid" }, { status: 400 });
  }

  let lines: unknown;
  try {
    lines = JSON.parse(linesRaw);
  } catch {
    return NextResponse.json({ error: "lines invalid" }, { status: 400 });
  }
  if (!Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: "lines required" }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const r2Key = `field-returns/${storeId}/${crypto.randomUUID()}.${ext}`;

  let url: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    url = await uploadToR2(r2Key, buf, file.type);
  } catch (err) {
    console.error("[field-retur] upload failed", err);
    return NextResponse.json({ error: "upload failed" }, { status: 502 });
  }

  try {
    const res = await createFieldReturn({
      storeId,
      visitId,
      raisedById: session.user.id,
      transport,
      expeditionName,
      resiNo,
      notaPhotoUrl: url,
      notaPhotoR2Key: r2Key,
      note,
      lines: lines as never,
    });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof FieldReturnError) {
      const status = err.code === "STORE_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ code: err.code }, { status });
    }
    console.error("[field-retur] create failed", err);
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
