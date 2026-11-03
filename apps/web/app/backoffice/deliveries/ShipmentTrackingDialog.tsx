"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getShipmentAction,
  updateShipmentTrackingAction,
  reassignShipmentCarrierAction,
  shipShipmentAction,
} from "@/app/actions/delivery-shipments";

/** "1,5" or "1.5" → 1.5; "" → null (clears); anything else → NaN (the server refuses it). */
function bacaBerat(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (t === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : Number.NaN;
}

type Props = {
  shipmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  carriers: { id: string; name: string }[];
};

/**
 * `loading` and `error` never show the editable form: an empty or default-filled form is
 * indistinguishable from a real shipment that simply has no data. `notFound` is the action's
 * `null` (no permission, or the row is gone) and is not retryable.
 */
type LoadState = { status: "loading" } | { status: "loaded" } | { status: "error"; reason: "failed" | "notFound" };

export function ShipmentTrackingDialog({ shipmentId, open, onOpenChange, onDone, carriers }: Props) {
  const t = useTranslations("deliveryShipments");
  const [carrierName, setCarrierName] = useState("");
  const [resiNumber, setResiNumber] = useState("");
  const [method, setMethod] = useState("");
  const [carriedById, setCarriedById] = useState("");
  /* The carrier on the row as loaded: the "Change carrier" button stays disabled until the selection differs. */
  const [savedCarriedById, setSavedCarriedById] = useState("");
  const [status, setStatus] = useState("");
  const [isKonsi, setIsKonsi] = useState(false);
  /* Weight (kg) and the handover-to-courier photo showing it: both mandatory before an expedition leaves (P35, P43). */
  const [berat, setBerat] = useState("");
  const [adaFotoSerah, setAdaFotoSerah] = useState(false);
  const [fotoSerah, setFotoSerah] = useState<{ url: string; key: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  /* Gates the whole form: until the detail arrives, `isKonsi` is a default, not a fact. */
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const detailLoaded = loadState.status === "loaded";
  const isExpedition = method === "EXPEDITION";
  /* IN_TRANSIT freezes everything but the carrier, which has its own action. */
  const isReassignOnly = status === "IN_TRANSIT" && method === "SALESMAN_CARRY";
  /* Until the detail arrives `method` is empty, so the heading falls back to the expedition wording. */
  const dialogMode = isReassignOnly ? "reassign" : method === "SALESMAN_CARRY" ? "carry" : "expedition";
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    /* Dropped on cleanup so a slow response for a previous shipment cannot overwrite this one. */
    let cancelled = false;
    setLoadState({ status: "loading" });
    getShipmentAction(shipmentId)
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          setLoadState({ status: "error", reason: "notFound" });
          return;
        }
        setCarrierName(detail.carrierName ?? "");
        setResiNumber(detail.resiNumber ?? "");
        setMethod(detail.method ?? "");
        setCarriedById(detail.carriedById ?? "");
        setSavedCarriedById(detail.carriedById ?? "");
        setStatus(detail.status ?? "");
        setIsKonsi(detail.orderType === "KONSI");
        setBerat(detail.weightKg !== null && detail.weightKg !== undefined ? String(detail.weightKg) : "");
        setAdaFotoSerah(Boolean(detail.adaFotoSerah));
        setFotoSerah(null);
        setLoadState({ status: "loaded" });
      })
      .catch(() => {
        if (!cancelled) setLoadState({ status: "error", reason: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, shipmentId, loadAttempt]);

  /**
   * Every action call below is wrapped. A rejection inside `startTransition` is otherwise
   * swallowed whole — no toast, no state change, the dialog simply stops responding — and in
   * production a thrown server action is digest-masked, so there is nothing for the operator to
   * read either. The action layer's `mapError` returns a named reason for everything it can
   * classify; these catches cover the rest.
   */
  function trackingPayload() {
    return {
      shipmentId,
      carrierName: isExpedition ? carrierName : undefined,
      resiNumber: isExpedition ? resiNumber : undefined,
      carriedById: carriedById || undefined,
      weightKg: isExpedition ? bacaBerat(berat) : undefined,
      ...(isExpedition && fotoSerah ? { handoverPhotoUrl: fotoSerah.url, handoverPhotoR2Key: fotoSerah.key } : {}),
    };
  }

  async function uploadFotoSerah(file: File): Promise<void> {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("shipmentId", shipmentId);
      const res = await fetch("/backoffice/api/upload/delivery-handover", { method: "POST", body: form });
      if (!res.ok) {
        toast.error(t(res.status === 413 ? "err.FILE_TOO_LARGE" : "err.UNEXPECTED"));
        return;
      }
      const body = (await res.json()) as { url?: string; key?: string };
      if (!body.url || !body.key) {
        toast.error(t("err.UNEXPECTED"));
        return;
      }
      setFotoSerah({ url: body.url, key: body.key });
      setAdaFotoSerah(true);
    } catch {
      toast.error(t("err.UNEXPECTED"));
    } finally {
      setUploading(false);
    }
  }

  function handleSave(): void {
    startTransition(async () => {
      try {
        const result = await updateShipmentTrackingAction(trackingPayload());
        if (!result.ok) {
          toast.error(t(`err.${result.reason}` as any));
          return;
        }
        toast.success(t("save"));
        onDone();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  function handleShip(): void {
    /* The nota (putus) was issued when the shipment was created; nothing about dates is asked here. */
    if (method === "SALESMAN_CARRY" && !carriedById) {
      toast.error(t("err.MISSING_CARRIER"));
      return;
    }
    if (isExpedition && !resiNumber) {
      toast.error(t("shipMissingResi"));
      return;
    }
    if (isExpedition && bacaBerat(berat) === null) {
      toast.error(t("err.MISSING_WEIGHT"));
      return;
    }
    if (isExpedition && Number.isNaN(bacaBerat(berat))) {
      toast.error(t("err.INVALID_WEIGHT"));
      return;
    }
    if (isExpedition && !adaFotoSerah) {
      toast.error(t("err.MISSING_HANDOVER_PHOTO"));
      return;
    }
    startTransition(async () => {
      try {
        const trackingResult = await updateShipmentTrackingAction(trackingPayload());
        if (!trackingResult.ok) {
          toast.error(t(`err.${trackingResult.reason}` as any));
          return;
        }
        const result = await shipShipmentAction({ shipmentId });
        if (!result.ok) {
          toast.error(t(`err.${result.reason}` as any));
          return;
        }
        toast.success(t("ship"));
        onOpenChange(false);
        onDone();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }

  function handleReassign(): void {
    if (!carriedById) {
      toast.error(t("err.MISSING_CARRIER"));
      return;
    }
    startTransition(async () => {
      try {
        const result = await reassignShipmentCarrierAction({ shipmentId, carriedById });
        if (!result.ok) {
          toast.error(t(`err.${result.reason}` as any));
          return;
        }
        toast.success(t("changeCarrierSuccess"));
        onOpenChange(false);
        onDone();
      } catch {
        toast.error(t("err.UNEXPECTED"));
      }
    });
  }


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`editTrackingTitle.${dialogMode}`)}</DialogTitle>
          <DialogDescription>{t(`editTrackingDescription.${dialogMode}`)}</DialogDescription>
        </DialogHeader>
        {loadState.status === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("loadingDetail")}
          </div>
        )}
        {loadState.status === "error" && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>
              {loadState.reason === "notFound" ? t("loadNotFoundTitle") : t("loadFailedTitle")}
            </AlertTitle>
            <AlertDescription>
              <p>
                {loadState.reason === "notFound" ? t("loadNotFoundDescription") : t("loadFailedDescription")}
              </p>
              {loadState.reason === "failed" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 h-10"
                  onClick={() => setLoadAttempt((n) => n + 1)}
                >
                  {t("loadRetry")}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {detailLoaded && (
          <div className="space-y-4">
            {isExpedition && (
              <>
                <div>
                  <Label htmlFor="carrierName">{t("carrierNameLabel")}</Label>
                  <Input id="carrierName" value={carrierName} onChange={(e) => setCarrierName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="resiNumber">{t("resiNumberLabel")}</Label>
                  <Input id="resiNumber" value={resiNumber} onChange={(e) => setResiNumber(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="weightKg">{t("weightLabel")}</Label>
                  <Input id="weightKg" inputMode="decimal" value={berat} onChange={(e) => setBerat(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="handoverPhoto">{t("handoverPhotoLabel")}</Label>
                  <Input
                    id="handoverPhoto"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploading || isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadFotoSerah(file);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    {uploading ? t("uploading") : adaFotoSerah ? t("handoverPhotoSaved") : t("handoverPhotoHint")}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">{t("shipRequirementsHint")}</p>
              </>
            )}
            {method === "SALESMAN_CARRY" && (
              <>
                <div>
                  <Label htmlFor="carriedBy">{t("carriedByLabel")}</Label>
                  <SearchableCombobox
                    id="carriedBy"
                    options={carriers.map((c) => ({ value: c.id, label: c.name }))}
                    value={carriedById}
                    onValueChange={setCarriedById}
                    placeholder={t("carriedByPlaceholder")}
                    searchPlaceholder={t("carrierSearchPlaceholder")}
                    emptyMessage={t("carrierSearchEmpty")}
                  />
                  {isReassignOnly && (
                    <p className="mt-2 text-xs text-muted-foreground">{t("changeCarrierHint")}</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
        <DialogFooter className="flex-wrap gap-2">
          {/* "Tidak jadi dikirim" lives on the register row, gated on the permission its document needs. */}
          {isReassignOnly ? (
            <Button
              className="min-h-10"
              onClick={handleReassign}
              disabled={isPending || !detailLoaded || !carriedById || carriedById === savedCarriedById}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("changeCarrier")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleSave} disabled={isPending || !detailLoaded}>
                {t("save")}
              </Button>
              <Button onClick={handleShip} disabled={isPending || !detailLoaded || uploading}>
                {t("ship")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
