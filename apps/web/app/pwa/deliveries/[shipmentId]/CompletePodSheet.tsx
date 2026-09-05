"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, MapPin, Truck } from "lucide-react";
import { completePodAction } from "../actions";
import { enqueueCompletion } from "@/lib/pwa/offline/completion-queue";
import { evaluateCheckinRadius } from "@/lib/pwa/checkin-radius";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Line = { id: string; productName: string; plannedQty: number };

type Props = {
  shipmentId: string;
  storeName: string;
  docNo: string;
  storeLat: number | null;
  storeLng: number | null;
  effectiveRadiusMeters: number;
  lines: Line[];
};

type ProofState =
  | { status: "idle"; file: File | null }
  | { status: "uploading"; file: File }
  | { status: "uploaded"; file: File; url: string; key: string }
  | { status: "error"; file: File };

type GpsState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ready"; lat: number; lng: number }
  | { status: "denied" }
  | { status: "error" };

export function CompletePodSheet({
  shipmentId, storeName, docNo, storeLat, storeLng, effectiveRadiusMeters, lines,
}: Props) {
  const t = useTranslations("pwa.deliveries");
  const tErr = useTranslations("deliveryShipments");
  const [isPending, startTransition] = useTransition();
  const [proof, setProof] = useState<ProofState>({ status: "idle", file: null });
  const [notaProof, setNotaProof] = useState<ProofState>({ status: "idle", file: null });
  const [signedByName, setSignedByName] = useState("");
  const [gps, setGps] = useState<GpsState>({ status: "idle" });
  const [clientId] = useState(() => crypto.randomUUID());
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>(
    () => Object.fromEntries(lines.map((l) => [l.id, String(l.plannedQty)])),
  );
  const [success, setSuccess] = useState(false);
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- request once on mount
  }, []);

  function requestLocation(): void {
    setGps({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ status: "ready", lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setGps(err.code === err.PERMISSION_DENIED ? { status: "denied" } : { status: "error" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  async function uploadProof(file: File): Promise<void> {
    setProof({ status: "uploading", file });
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("shipmentId", shipmentId);
      formData.append("clientId", `${clientId}-goods`);
      const res = await fetch("/pwa/api/upload/delivery-pod-proof", { method: "POST", body: formData });
      if (!res.ok) throw new Error("upload failed");
      const data = (await res.json()) as { url: string; key: string };
      setProof({ status: "uploaded", file, url: data.url, key: data.key });
    } catch {
      setProof({ status: "error", file });
      toast.error(t("proofUploadError"));
    }
  }

  async function uploadNotaProof(file: File): Promise<void> {
    setNotaProof({ status: "uploading", file });
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("shipmentId", shipmentId);
      formData.append("clientId", `${clientId}-nota`);
      const res = await fetch("/pwa/api/upload/delivery-pod-proof", { method: "POST", body: formData });
      if (!res.ok) throw new Error("upload failed");
      const data = (await res.json()) as { url: string; key: string };
      setNotaProof({ status: "uploaded", file, url: data.url, key: data.key });
    } catch {
      setNotaProof({ status: "error", file });
      toast.error(t("notaPhotoUploadError"));
    }
  }

  const proofReady = proof.status === "uploaded";
  const notaProofReady = notaProof.status === "uploaded";
  const gpsReady = gps.status === "ready";
  const canSubmit =
    proofReady && notaProofReady && signedByName.trim().length > 0 && gpsReady && !isPending;

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
    if (!canSubmit || gps.status !== "ready" || proof.status !== "uploaded" || notaProof.status !== "uploaded") return;
    if (!navigator.onLine) {
      queueOffline();
      return;
    }
    startTransition(async () => {
      try {
        const result = await completePodAction({
          shipmentId,
          proofPhotoUrl: proof.url,
          proofPhotoR2Key: proof.key,
          gps: { lat: gps.lat, lng: gps.lng },
          signatureUrl: notaProof.url,
          signatureR2Key: notaProof.key,
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
      } catch {
        queueOffline();
      }
    });
  }

  function queueOffline(): void {
    if (gps.status !== "ready" || proof.status !== "uploaded" || notaProof.status !== "uploaded") return;
    const check = preCheckPasses();
    if (!check.ok) {
      toast.error(tErr(check.reasonKey as any));
      return;
    }
    startTransition(async () => {
      try {
        await enqueueCompletion({
          shipmentId,
          goodsPhotoBlob: proof.file,
          notaPhotoBlob: notaProof.file,
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
    });
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
          disabled={isPending || proof.status === "uploading"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadProof(file);
          }}
        />
        {proof.status === "uploading" && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("proofUploading")}
          </p>
        )}
        {proof.status === "uploaded" && (
          <p className="text-xs text-muted-foreground">{t("proofUploaded", { name: proof.file.name })}</p>
        )}
        {proof.status === "error" && <p className="text-xs text-destructive">{t("proofUploadError")}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pod-nota-proof">{t("notaPhotoLabel")}</Label>
        <Input
          id="pod-nota-proof"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          className="h-10"
          disabled={isPending || notaProof.status === "uploading"}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void uploadNotaProof(file);
          }}
        />
        {notaProof.status === "uploading" && (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> {t("notaPhotoUploading")}
          </p>
        )}
        {notaProof.status === "uploaded" && (
          <p className="text-xs text-muted-foreground">{t("notaPhotoUploaded", { name: notaProof.file.name })}</p>
        )}
        {notaProof.status === "error" && <p className="text-xs text-destructive">{t("notaPhotoUploadError")}</p>}
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
