import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { uploadToR2, deleteFromR2, isConfigured } from "@/lib/r2";

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
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: `type ${file.type} not allowed` }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "file exceeds 10MB" }, { status: 400 });
  /**
   * `draftId` is durable past this upload step — it becomes `StoreSettlement.idempotencyKey` on
   * submit, and the object key stays `settlement-proofs/${draftId}/${slot}.*` forever. Without
   * this check, any caller holding `settlements:submit` who learns a submitted draftId could
   * `PutObject` over the audited evidence of a PENDING settlement awaiting approval. Evidence for
   * an already-submitted document is immutable from this route; the error body deliberately does
   * not name whose settlement it is. Runs AFTER the cheap in-memory type/size checks — a
   * malformed upload should not pay a DB round trip, and a wrong-type or oversized upload against
   * a submitted draftId must still surface as its own 400, not this route's 409.
   */
  const alreadySubmitted = await prisma.storeSettlement.findUnique({
    where: { idempotencyKey: draftId },
    select: { id: true },
  });
  if (alreadySubmitted) return NextResponse.json({ error: "evidence locked" }, { status: 409 });

  try {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `settlement-proofs/${draftId}/${slot}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(key, buffer, file.type);

    /**
     * Compensating check, not a substitute for the one above — this is TOCTOU, not eliminated.
     * The pre-upload `findUnique` leaves a window open for exactly as long as `uploadToR2` takes:
     * a submit that inserts the `StoreSettlement` row in that window still lets this request land
     * its `PutObject` afterward, overwriting evidence the 409 exists to lock, even though this
     * caller already holds `settlements:submit` and the UUID `draftId` legitimately (their own
     * retry, a leaked id, or their own submit racing their own upload). Re-running the same check
     * AFTER the write narrows that window to "between the two DB reads" rather than closing it —
     * a conditional/immutable R2 write was considered and rejected, because a legitimate pre-submit
     * retry deliberately overwrites the same deterministic key and a write that refused that would
     * break the normal retry path this route exists to support.
     */
    const submittedAfterUpload = await prisma.storeSettlement.findUnique({
      where: { idempotencyKey: draftId },
      select: { id: true },
    });
    if (submittedAfterUpload) {
      /*
       * A stale object left in R2 is far better than reporting success on evidence about to be
       * treated as audited — so the delete failing must not turn this into a 500. Log and still
       * return the same 409 either way.
       */
      try {
        await deleteFromR2(key);
      } catch (deleteError) {
        console.error("settlement-proof post-upload cleanup failed:", deleteError);
      }
      return NextResponse.json({ error: "evidence locked" }, { status: 409 });
    }

    return NextResponse.json({ url, key });
  } catch (e) {
    console.error("settlement-proof upload error:", e);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
