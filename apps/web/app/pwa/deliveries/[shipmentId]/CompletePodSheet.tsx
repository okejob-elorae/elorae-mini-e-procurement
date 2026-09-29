"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, MapPin, Truck } from "lucide-react";
import { completePodAction } from "../actions";
import { enqueueCompletion } from "@/lib/pwa/offline/completion-queue";
import { PodUploadRefusedError, throwIfPodUploadRefused } from "@/lib/pwa/offline/pod-upload-refusal";
import { evaluateCheckinRadius } from "@/lib/pwa/checkin-radius";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ShipmentActionReason } from "@/app/actions/delivery-shipments";
import { recordedQtyByShipmentLine, type SerializedReplay } from "@/lib/field-sales/replay-detail";

type Line = { id: string; orderLineId: string; productName: string; plannedQty: number };

/** The refusal the inline Alert explains; `replay` rides along only on `REPLAY_MISMATCH`. */
type Failure = { reason: ShipmentActionReason; replay?: SerializedReplay };

type Props = {
  shipmentId: string;
  storeName: string;
  docNo: string;
  storeLat: number | null;
  storeLng: number | null;
  effectiveRadiusMeters: number;
  isKonsi: boolean;
  lines: Line[];
};

type GpsState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; lat: number; lng: number }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "error" };

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Mirrors the server's own validation in apps/web/app/pwa/api/upload/delivery-pod-proof/route.ts — keep both in sync. */
function fileCheckPasses(file: File): { ok: true } | { ok: false; reasonKey: string } {
  if (!ALLOWED_FILE_TYPES.has(file.type)) return { ok: false, reasonKey: "err.INVALID_FILE_TYPE" };
  if (file.size > MAX_FILE_SIZE) return { ok: false, reasonKey: "err.FILE_TOO_LARGE" };
  return { ok: true };
}

export function CompletePodSheet({
  shipmentId, storeName, docNo, storeLat, storeLng, effectiveRadiusMeters, isKonsi, lines,
}: Props) {
  const t = useTranslations("pwa.deliveries");
  const tErr = useTranslations("deliveryShipments");
  const [isPending, startTransition] = useTransition();
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [notaProofFile, setNotaProofFile] = useState<File | null>(null);
  const [signedByName, setSignedByName] = useState("");
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const gpsStatusRef = useRef<GpsState["status"]>("idle");
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(lines.map((l) => [l.id, String(l.plannedQty)])),
  );
  const [success, setSuccess] = useState(false);
  const [queued, setQueued] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    gpsStatusRef.current = gps.status;
  }, [gps.status]);

  useEffect(() => {
    requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- request once on mount
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.permissions) return;
    let permStatus: PermissionStatus | null = null;
    let cancelled = false;
    navigator.permissions.query({ name: "geolocation" as PermissionName }).then(
      (status) => {
        if (cancelled) return;
        permStatus = status;
        /* Read through the ref: this handler outlives the render it closed over, and re-requesting over a good or in-flight fix would drop it back to locating mid-form. */
        status.onchange = () => {
          const current = gpsStatusRef.current;
          if (status.state === "granted" && current !== "ready" && current !== "locating") requestLocation();
        };
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
      if (permStatus) permStatus.onchange = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribe once on mount
  }, []);

  function requestLocation(): void {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGps({ status: "unsupported" });
      return;
    }
    setGps({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ status: "ready", lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setGps(err.code === err.PERMISSION_DENIED ? { status: "denied" } : { status: "error" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  async function uploadPhoto(file: File, kind: "goods" | "nota"): Promise<{ url: string; key: string }> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("shipmentId", shipmentId);
    formData.append("clientId", kind);
    const res = await fetch("/pwa/api/upload/delivery-pod-proof", { method: "POST", body: formData });
    throwIfPodUploadRefused(res);
    if (!res.ok) throw new Error(`upload failed: ${kind}`);
    return res.json();
  }

  const gpsReady = gps.status === "ready";
  const canSubmit =
    proofFile !== null && notaProofFile !== null && signedByName.trim().length > 0 && gpsReady && !isPending;

  function preCheckPasses(): { ok: true } | { ok: false; reasonKey: string } {
    if (!signedByName.trim()) return { ok: false, reasonKey: "err.MISSING_SIGNED_BY" };
    if (gps.status !== "ready") return { ok: false, reasonKey: "err.MISSING_GPS" };
    const { distanceMeters, outOfRadius } = evaluateCheckinRadius({
      checkin: { lat: gps.lat, lng: gps.lng },
      store: { lat: storeLat, lng: storeLng },
      effectiveRadiusMeters,
    });
    if (distanceMeters === null) return { ok: false, reasonKey: "err.STORE_NOT_GEOCODED" };
    if (outOfRadius) return { ok: false, reasonKey: "err.GPS_OUT_OF_RADIUS" };
    for (const line of lines) {
      const qty = Number(qtyInputs[line.id] ?? "0");
      if (qty > line.plannedQty) return { ok: false, reasonKey: "err.OVER_PLANNED" };
      if (!Number.isInteger(qty) || qty < 0) {
        return { ok: false, reasonKey: "err.INVALID_QTY" };
      }
    }
    return { ok: true };
  }

  function submit(): void {
    if (!canSubmit || gps.status !== "ready" || !proofFile || !notaProofFile) return;
    const goodsCheck = fileCheckPasses(proofFile);
    if (!goodsCheck.ok) {
      toast.error(tErr(goodsCheck.reasonKey as any));
      return;
    }
    const notaCheck = fileCheckPasses(notaProofFile);
    if (!notaCheck.ok) {
      toast.error(tErr(notaCheck.reasonKey as any));
      return;
    }
    setFailure(null);
    const capturedGps = gps;
    const capturedProofFile = proofFile;
    const capturedNotaFile = notaProofFile;
    if (!navigator.onLine) {
      startTransition(async () => {
        await queueOffline(capturedProofFile, capturedNotaFile);
      });
      return;
    }
    startTransition(async () => {
      try {
        const goods = await uploadPhoto(capturedProofFile, "goods");
        const nota = await uploadPhoto(capturedNotaFile, "nota");
        const result = await completePodAction({
          shipmentId,
          proofPhotoUrl: goods.url,
          proofPhotoR2Key: goods.key,
          gps: { lat: capturedGps.lat, lng: capturedGps.lng },
          signatureUrl: nota.url,
          signatureR2Key: nota.key,
          signedByName: signedByName.trim(),
          lines: lines.map((l) => ({
            shipmentLineId: l.id,
            deliveredQty: Number(qtyInputs[l.id] ?? "0"),
          })),
        });
        if (result.ok) {
          toast.success(t("submitSuccess"));
          setSuccess(true);
          return;
        }
        toast.error(tErr(`err.${result.reason}` as any));
        const replay = result.replay;
        setFailure({ reason: result.reason, replay });
        if (result.reason === "REPLAY_MISMATCH" && replay) {
          /**
           * The delivery is already recorded, so one more Submit with ITS quantities completes the
           * shipment consistently. Filled per shipment line, so an order line two shipment lines
           * share is not asked for twice.
           */
          const recordedQty = recordedQtyByShipmentLine(lines, replay);
          setQtyInputs(
            Object.fromEntries(lines.map((l) => [l.id, String(recordedQty.get(l.id) ?? 0)])),
          );
        }
      } catch (e) {
        if (e instanceof PodUploadRefusedError) {
          toast.error(tErr(`err.${e.reason}` as any));
          return;
        }
        await queueOffline(capturedProofFile, capturedNotaFile);
      }
    });
  }

  async function queueOffline(goodsFile: File, notaFile: File): Promise<void> {
    if (gps.status !== "ready") return;
    const check = preCheckPasses();
    if (!check.ok) {
      toast.error(tErr(check.reasonKey as any));
      return;
    }
    try {
      await enqueueCompletion({
        shipmentId,
        storeName,
        docNo,
        goodsPhotoBlob: goodsFile,
        notaPhotoBlob: notaFile,
        signedByName: signedByName.trim(),
        gpsLat: gps.lat,
        gpsLng: gps.lng,
        lines: lines.map((l) => ({
          shipmentLineId: l.id,
          deliveredQty: Number(qtyInputs[l.id] ?? "0"),
        })),
        capturedAt: Date.now(),
      });
      toast.success(t("queuedToast"));
      setQueued(true);
    } catch {
      toast.error(t("errGeneric"));
    }
  }

  if (success || queued) {
    return (
      <div className="p-4">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="rounded-full bg-primary p-3">
              <CheckCircle2 className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{queued ? t("queuedSuccess") : t("submitSuccess")}</p>
              <p className="mt-1 text-lg font-semibold">{storeName}</p>
              <p className="text-xs text-muted-foreground">{docNo}</p>
            </div>
          </CardContent>
        </Card>
        <div className="mt-4">
          <Button asChild className="w-full">
            <Link href="/pwa/deliveries">
              <ArrowLeft className="h-4 w-4" />
              {t("title")}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const replay = failure?.replay;
  const recordedQty = replay ? recordedQtyByShipmentLine(lines, replay) : new Map<string, number>();

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="-ml-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/pwa/deliveries">
            <ArrowLeft className="h-4 w-4" />
            {t("title")}
          </Link>
        </Button>
      </header>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary p-2 shrink-0">
              <Truck className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold leading-tight">{storeName}</p>
              <p className="truncate text-xs text-muted-foreground">{docNo}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("detailTitle")}</h2>

      <div className="space-y-1.5">
        <Label>{t("locationLabel")}</Label>
        {gps.status === "locating" && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("locating")}
          </p>
        )}
        {gps.status === "ready" && (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" /> {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
          </p>
        )}
        {gps.status === "denied" && (
          <Alert variant="destructive">
            <AlertDescription>{t("permissionDenied")}</AlertDescription>
            <Button type="button" variant="outline" size="sm" className="col-start-2 mt-2 h-10 w-full" onClick={requestLocation}>
              {t("locationRetry")}
            </Button>
          </Alert>
        )}
        {gps.status === "unsupported" && (
          <Alert variant="destructive">
            <AlertDescription>{t("locationUnsupported")}</AlertDescription>
          </Alert>
        )}
        {gps.status === "error" && (
          <div className="text-sm text-destructive flex items-center gap-2">
            <span>{t("locationError")}</span>
            <Button type="button" variant="link" size="sm" onClick={requestLocation}>{t("locationRetry")}</Button>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pod-proof">{t("proofLabel")}</Label>
        <Input
          id="pod-proof"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="h-10"
          disabled={isPending}
          onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
        />
        {proofFile && <p className="text-xs text-muted-foreground">{t("proofUploaded", { name: proofFile.name })}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pod-nota-proof">{isKonsi ? t("notaPhotoLabelKonsi") : t("notaPhotoLabel")}</Label>
        <Input
          id="pod-nota-proof"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="h-10"
          disabled={isPending}
          onChange={(e) => setNotaProofFile(e.target.files?.[0] ?? null)}
        />
        {notaProofFile && <p className="text-xs text-muted-foreground">{t("notaPhotoUploaded", { name: notaProofFile.name })}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pod-signed-by">{t("signedByLabel")}</Label>
        <Input
          id="pod-signed-by"
          type="text"
          maxLength={120}
          placeholder={t("signedByPlaceholder")}
          className="h-10"
          disabled={isPending}
          value={signedByName}
          onChange={(e) => setSignedByName(e.target.value)}
        />
      </div>

      {failure && (failure.reason === "REPLAY_MISMATCH" || failure.reason === "RESERVATION_MISMATCH") && (
        <Alert variant="destructive">
          {replay && <AlertTitle>{t("replayTitle", { docNo: replay.docNo })}</AlertTitle>}
          <AlertDescription>
            <p>{tErr(`err.${failure.reason}` as any)}</p>
            {replay && (
              <>
                <p className="font-medium">{t("replayLinesLabel")}</p>
                <ul className="w-full space-y-0.5">
                  {lines.map((line) => (
                    <li key={line.id} className="truncate">
                      {t("replayLine", {
                        product: line.productName,
                        qty: recordedQty.get(line.id) ?? 0,
                      })}
                    </li>
                  ))}
                </ul>
                <p>{t("replayHint")}</p>
              </>
            )}
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{line.productName}</p>
              <p className="text-xs text-muted-foreground">{t("plannedLabel")}: {line.plannedQty}</p>
            </div>
            <Input
              type="number"
              min={0}
              max={line.plannedQty}
              className="w-20 h-10"
              value={qtyInputs[line.id] ?? ""}
              disabled={isPending}
              onChange={(e) => setQtyInputs((prev) => ({ ...prev, [line.id]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button type="button" className="w-full" size="lg" disabled={!canSubmit} onClick={submit}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? t("submitting") : t("submitButton")}
        </Button>
      </div>
    </div>
  );
}
