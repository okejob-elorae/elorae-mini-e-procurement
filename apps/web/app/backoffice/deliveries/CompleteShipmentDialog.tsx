"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getShipmentAction, completeShipmentAction } from "@/app/actions/delivery-shipments";
import { pesanGagalPengiriman } from "@/lib/delivery/pesan-galat";

type Props = {
  shipmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
};

type Line = { id: string; orderLineId: string; productName: string; plannedQty: number };

type Jumlah = { diterima: string; kembali: string; hilang: string };

/**
 * Who records the store's receipt (`penerimaPod`, read with the shipment): `PENERIMAAN` — this
 * confirmation is the receipt; `PEMEGANG` — the store's SPG stopped while the goods were on the road
 * and the holder salesman records the PIC's receipt (P45a), unless a door refusal is recorded or
 * nothing is handed over; `SERAH_TERIMA` — the handover only (an SPG receives, or the receipt exists).
 */
type JenisPod = "PENERIMAAN" | "PEMEGANG" | "SERAH_TERIMA";

/**
 * `loading` and `error` never show the form: with no lines loaded, an empty form reads as "this
 * shipment has no lines". `notFound` is the action's `null` (no permission, or the row is gone)
 * and is not retryable.
 */
type LoadState = { status: "loading" } | { status: "loaded" } | { status: "error"; reason: "failed" | "notFound" };

const angka = (v: string | undefined) => (v === undefined || v.trim() === "" ? 0 : Number(v));

/**
 * The expedition's confirmation (owner putus answer 2026-11-02). The nota (putus) and the transfer
 * (konsi) were written when the shipment was created, so no date is asked here.
 *
 * - A store WITH an SPG: one figure per line, "Diserahkan" — the SPG records refused and lost
 *   pieces on her receive form (P40).
 * - A store WITHOUT one: this confirmation IS the store's receipt — every planned piece is diterima
 *   toko, retur langsung (refused at the door) or hilang di perjalanan, and they must add up.
 * - A store whose SPG stopped while the goods were on the road (P45a): "Diserahkan" plus "Retur
 *   langsung"; the holder salesman records what the PIC got. A door refusal, or nothing handed over,
 *   turns this confirmation into the receipt as before (the writer's rule), so the lost column
 *   appears and the figures must add up.
 */
export function CompleteShipmentDialog({ shipmentId, open, onOpenChange, onDone }: Props) {
  const t = useTranslations("deliveryShipments");
  const tTerima = useTranslations("pwa.spgTerima");
  const [lines, setLines] = useState<Line[]>([]);
  const [jumlah, setJumlah] = useState<Record<string, Jumlah>>({});
  const [proofPhotoUrl, setProofPhotoUrl] = useState("");
  const [proofPhotoR2Key, setProofPhotoR2Key] = useState("");
  const [isKonsi, setIsKonsi] = useState(false);
  const [jenis, setJenis] = useState<JenisPod>("SERAH_TERIMA");
  /** The store already recorded its receipt (e.g. the SPG refused every piece before the courier confirmed): handing over nothing is valid. */
  const [sudahDiterima, setSudahDiterima] = useState(false);
  const [beratKg, setBeratKg] = useState<number | null>(null);
  const [resi, setResi] = useState("");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const detailLoaded = loadState.status === "loaded";
  const [uploading, setUploading] = useState(false);
  /* The last refusal's sentence, kept on screen beside the form (the toast fades). */
  const [failure, setFailure] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setFailure(null);
    setProofPhotoUrl("");
    setProofPhotoR2Key("");
    setLoadState({ status: "loading" });
    /* Dropped on cleanup so a slow response for a previous shipment cannot overwrite this one. */
    let cancelled = false;
    getShipmentAction(shipmentId)
      .then((detail) => {
        if (cancelled) return;
        if (!detail) {
          setLoadState({ status: "error", reason: "notFound" });
          return;
        }
        const nextLines = detail.lines.map((l) => ({
          id: l.id,
          orderLineId: l.orderLineId,
          productName: l.productName,
          plannedQty: l.plannedQty,
        }));
        setLines(nextLines);
        setJumlah(Object.fromEntries(nextLines.map((l) => [l.id, { diterima: String(l.plannedQty), kembali: "0", hilang: "0" }])));
        setIsKonsi(detail.orderType === "KONSI");
        setJenis(
          detail.sudahDiterimaToko
            ? "SERAH_TERIMA"
            : detail.penerimaPod === "KURIR"
              ? "PENERIMAAN"
              : detail.penerimaPod === "PEMEGANG"
                ? "PEMEGANG"
                : "SERAH_TERIMA",
        );
        setSudahDiterima(detail.sudahDiterimaToko);
        setBeratKg(detail.weightKg);
        setResi(detail.resiNumber ?? "");
        setLoadState({ status: "loaded" });
      })
      .catch(() => {
        if (!cancelled) setLoadState({ status: "error", reason: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, shipmentId, loadAttempt]);

  async function handleUpload(file: File): Promise<void> {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("shipmentId", shipmentId);
      const res = await fetch("/backoffice/api/upload/delivery-proof", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("err.UNEXPECTED"));
        return;
      }
      setProofPhotoUrl(data.url);
      setProofPhotoR2Key(data.key);
    } catch {
      toast.error(t("err.UNEXPECTED"));
    } finally {
      setUploading(false);
    }
  }

  /* PEMEGANG: a door refusal, or nothing handed over, makes this confirmation the store's receipt (the writer's rule). */
  const adaTolak = lines.some((l) => angka(jumlah[l.id]?.kembali) > 0);
  const tanpaSerah = lines.length > 0 && lines.every((l) => angka(jumlah[l.id]?.diterima) === 0);
  const penerimaan = jenis === "PENERIMAAN" || (jenis === "PEMEGANG" && (adaTolak || tanpaSerah));
  const kolomTolak = penerimaan || jenis === "PEMEGANG";
  const barisSah = (line: Line) => {
    const j = jumlah[line.id];
    if (!j) return false;
    const nilai = [angka(j.diterima), kolomTolak ? angka(j.kembali) : 0, penerimaan ? angka(j.hilang) : 0];
    if (nilai.some((n) => !Number.isInteger(n) || n < 0)) return false;
    if (!penerimaan) return nilai[0] <= line.plannedQty;
    return nilai[0] + nilai[1] + nilai[2] === line.plannedQty;
  };
  const semuaSah = lines.every(barisSah);
  const adaDiserahkan = lines.some((l) => angka(jumlah[l.id]?.diterima) > 0);
  const canSubmit =
    detailLoaded && !isPending && !uploading && !!proofPhotoUrl && lines.length > 0 && semuaSah && (penerimaan || adaDiserahkan || sudahDiterima);

  function ubah(lineId: string, kolom: keyof Jumlah, nilai: string): void {
    setJumlah((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? { diterima: "0", kembali: "0", hilang: "0" }), [kolom]: nilai } }));
  }

  function handleSubmit(): void {
    if (!canSubmit) return;
    setFailure(null);
    const payloadLines = lines.map((line) => {
      const j = jumlah[line.id];
      return penerimaan
        ? { shipmentLineId: line.id, deliveredQty: angka(j?.diterima), returnedQty: angka(j?.kembali), lostQty: angka(j?.hilang) }
        : { shipmentLineId: line.id, deliveredQty: angka(j?.diterima) };
    });
    startTransition(async () => {
      try {
        const result = await completeShipmentAction({ shipmentId, proofPhotoUrl, proofPhotoR2Key, lines: payloadLines });
        if (!result.ok) {
          // TERIMA_GAGAL carries a store-receipt reason code: translated, never shown raw.
          const pesan = pesanGagalPengiriman(result.reason, result.detail, {
            teks: (k, v) => t(k as any, v),
            adaSebab: (k) => tTerima.has(`err.${k}` as any),
            sebab: (k) => tTerima(`err.${k}` as any),
          });
          toast.error(pesan);
          setFailure(pesan);
          return;
        }
        toast.success(t("complete"));
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
          <DialogTitle>{t("completeTitle")}</DialogTitle>
          <DialogDescription>
            {jenis === "PEMEGANG"
              ? t("completePemegangDescription")
              : penerimaan
                ? t("completeReceiptDescription")
                : t("completeDescription")}
          </DialogDescription>
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
            {failure && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p>{failure}</p>
                </AlertDescription>
              </Alert>
            )}
            <p className="text-xs text-muted-foreground">
              {t("completeEvidence", { resi: resi || "—", berat: beratKg === null ? "—" : beratKg.toLocaleString("id-ID") })}
            </p>
            <div>
              <Label htmlFor="proofPhoto">{t("proofPhoto")}</Label>
              <Input
                id="proofPhoto"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file);
                }}
              />
              {uploading && <p className="mt-1 text-xs text-muted-foreground">{t("uploading")}</p>}
              {!proofPhotoUrl && !uploading && (
                <p className="mt-1 text-xs text-muted-foreground">{t("proofPhotoRequired")}</p>
              )}
              {proofPhotoUrl && !uploading && (
                <img src={proofPhotoUrl} alt="" className="mt-2 h-24 w-24 rounded object-cover" />
              )}
            </div>
            {isKonsi && <p className="text-sm text-muted-foreground">{t("konsiCompleteNote")}</p>}
            <div className="space-y-3">
              {lines.map((line) => (
                <div key={line.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm">{line.productName}</span>
                    <span className="text-xs text-muted-foreground">{t("plannedQtyOf", { qty: line.plannedQty })}</span>
                  </div>
                  <div className={penerimaan ? "grid grid-cols-3 gap-2" : kolomTolak ? "grid grid-cols-2 gap-2" : "flex justify-end"}>
                    <div className="space-y-0.5">
                      <Label className="text-xs text-muted-foreground">{penerimaan ? t("podDiterima") : t("podDiserahkan")}</Label>
                      <Input
                        type="number"
                        min={0}
                        max={line.plannedQty}
                        className={kolomTolak ? "" : "w-24"}
                        value={jumlah[line.id]?.diterima ?? ""}
                        onChange={(e) => ubah(line.id, "diterima", e.target.value)}
                      />
                    </div>
                    {kolomTolak && (
                      <div className="space-y-0.5">
                        <Label className="text-xs text-muted-foreground">{t("podReturLangsung")}</Label>
                        <Input
                          type="number"
                          min={0}
                          max={line.plannedQty}
                          value={jumlah[line.id]?.kembali ?? ""}
                          onChange={(e) => ubah(line.id, "kembali", e.target.value)}
                        />
                      </div>
                    )}
                    {penerimaan && (
                      <div className="space-y-0.5">
                        <Label className="text-xs text-muted-foreground">{t("podHilang")}</Label>
                        <Input
                          type="number"
                          min={0}
                          max={line.plannedQty}
                          value={jumlah[line.id]?.hilang ?? ""}
                          onChange={(e) => ubah(line.id, "hilang", e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                  {!barisSah(line) && (
                    <p className="text-xs text-destructive">{penerimaan ? t("err.LINE_UNACCOUNTED") : t("err.OVER_PLANNED")}</p>
                  )}
                </div>
              ))}
              {!penerimaan && !adaDiserahkan && !sudahDiterima && <p className="text-xs text-muted-foreground">{t("err.POD_KOSONG")}</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button className="h-10" onClick={handleSubmit} disabled={!canSubmit}>
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
