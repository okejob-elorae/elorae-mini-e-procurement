import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { uploadToR2, isConfigured } from "@/lib/r2";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SLOT_PATTERN = /^(program-\d+|adminfee)$/;
const DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.SETTLEMENTS_SUBMIT)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isConfigured()) return NextResponse.json({ error: "R2 not configured" }, { status: 503 });

  const form = await req.formData();
  const file = form.get("file");
  const draftId = form.get("draftId");
  const slot = form.get("slot");

  if (!(file instanceof File) || typeof draftId !== "string" || !draftId || typeof slot !== "string" || !slot) {
    return NextResponse.json({ error: "file, draftId, slot required" }, { status: 400 });
  }
  /**
   * `slot` is interpolated directly into the object key below. Reject anything
   * that does not match the deduction-slot shape so a caller cannot escape its
   * own prefix (path traversal) or collide with another deduction's evidence.
   */
  if (!SLOT_PATTERN.test(slot)) return NextResponse.json({ error: "invalid slot" }, { status: 400 });
  /**
   * `draftId` is also interpolated directly into the object key. There is no
   * DRAFT row to check ownership against, so a guessable id would let a caller
   * overwrite another salesman's evidence before they submit. The client always
   * mints a `crypto.randomUUID()`, so requiring that shape costs nothing
   * legitimate while keeping the id unguessable, and it bounds the length too.
   */
  if (!DRAFT_ID_PATTERN.test(draftId)) return NextResponse.json({ error: "invalid draftId" }, { status: 400 });
  /**
   * `draftId` is durable past this upload step — it becomes `StoreSettlement.idempotencyKey` on
   * submit, and the object key stays `settlement-proofs/${draftId}/${slot}.*` forever. Without
   * this check, any caller holding `settlements:submit` who learns a submitted draftId could
   * `PutObject` over the audited evidence of a PENDING settlement awaiting approval. Evidence for
   * an already-submitted document is immutable from this route; the error body deliberately does
   * not name whose settlement it is.
   */
  const alreadySubmitted = await prisma.storeSettlement.findUnique({
    where: { idempotencyKey: draftId },
    select: { id: true },
  });
  if (alreadySubmitted) return NextResponse.json({ error: "evidence locked" }, { status: 409 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: `type ${file.type} not allowed` }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "file exceeds 10MB" }, { status: 400 });

  try {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `settlement-proofs/${draftId}/${slot}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(key, buffer, file.type);
    return NextResponse.json({ url, key });
  } catch (e) {
    console.error("settlement-proof upload error:", e);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
