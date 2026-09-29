import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { uploadToR2, isConfigured } from "@/lib/r2";
import { buildR2Key, isSafeR2KeySegment } from "@/lib/r2-key";
import { isSameActorReplay } from "@/lib/delivery/pod-completion-guard";

export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROOF_KINDS = new Set(["goods", "nota"]);

/**
 * Uploads one proof photo for a SALESMAN_CARRY completion. Keys are DETERMINISTIC
 * (`delivery-pod-proofs/<shipmentId>/<goods|nota>.<ext>`), so a retried upload — online or from
 * the offline queue — overwrites the same object instead of orphaning a new one.
 *
 * Authorization is against the shipment, not just the permission: any `deliveries:pod` holder
 * could otherwise write objects under any shipment's proof prefix. A shipment that is missing,
 * not SALESMAN_CARRY, or carried by someone else all return the SAME 404 body, so a shipment that
 * is not yours is indistinguishable from one that does not exist (same stance as the PWA
 * completion page's `notFound()`). The writer's `NOT_CARRIER` check remains the enforcement for
 * the completion itself; this only guards the evidence.
 *
 * By status:
 * - IN_TRANSIT: writes to R2 and returns `{ url, key }`.
 * - DELIVERED / PARTIALLY_DELIVERED by the SAME actor (`isSameActorReplay`, the predicate shared with
 *   `completeDeliveryShipment`'s replay guard): a lost-response REPLAY. The client (and the
 *   offline queue) re-uploads both photos before calling the completion action, and
 *   `completeDeliveryShipment` deliberately returns ok for a same-actor replay. Refusing here
 *   would turn an already-successful completion into 20 retries and a false stuck-delivery admin
 *   alert; overwriting would replace photos that are now audited evidence. So nothing is written
 *   and the STORED object for that kind is returned instead, which is exactly what the replayed
 *   completion payload needs. A stored pair that is null is a 409.
 * - anything else (PACKED, CANCELLED, delivered by a different actor): 409.
 *
 * ACCEPTED residual window: an upload that passed the IN_TRANSIT check can still land after the
 * same carrier's completion commits, overwriting the same deterministic key of the same shipment
 * with that carrier's own newer photo. Deliberately NOT closed with a post-upload re-check and
 * delete like `settlement-proof`: there the object is an orphan candidate, here the key IS the
 * key the completion just recorded, so deleting it would destroy the audited evidence.
 */
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
  const clientId = form.get("clientId");

  if (!(file instanceof File) || typeof shipmentId !== "string" || !shipmentId || typeof clientId !== "string" || !clientId) {
    return NextResponse.json({ error: "file, shipmentId, clientId required" }, { status: 400 });
  }
  if (!isSafeR2KeySegment(shipmentId)) return NextResponse.json({ error: "invalid shipmentId" }, { status: 400 });
  if (!PROOF_KINDS.has(clientId)) return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: `type ${file.type} not allowed` }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "file exceeds 10MB" }, { status: 400 });

  const shipment = await prisma.deliveryShipment.findUnique({
    where: { id: shipmentId },
    select: {
      method: true,
      status: true,
      carriedById: true,
      deliveredById: true,
      proofPhotoUrl: true,
      proofPhotoR2Key: true,
      signatureUrl: true,
      signatureR2Key: true,
    },
  });
  if (!shipment || shipment.method !== "SALESMAN_CARRY" || shipment.carriedById !== session.user.id) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  if (isSameActorReplay(shipment, session.user.id)) {
    const stored =
      clientId === "goods"
        ? { url: shipment.proofPhotoUrl, key: shipment.proofPhotoR2Key }
        : { url: shipment.signatureUrl, key: shipment.signatureR2Key };
    if (!stored.url || !stored.key) return NextResponse.json({ error: "INVALID_STATE" }, { status: 409 });
    return NextResponse.json({ url: stored.url, key: stored.key });
  }
  if (shipment.status !== "IN_TRANSIT") {
    return NextResponse.json({ error: "INVALID_STATE" }, { status: 409 });
  }

  try {
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = buildR2Key("delivery-pod-proofs", [shipmentId, clientId], ext);
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await uploadToR2(key, buffer, file.type);
    return NextResponse.json({ url, key });
  } catch (e) {
    console.error("delivery-pod-proof upload error:", e);
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }
}
