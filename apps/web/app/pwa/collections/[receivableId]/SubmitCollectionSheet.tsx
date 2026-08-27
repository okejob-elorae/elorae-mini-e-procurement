"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Loader2, Wallet } from "lucide-react";
import { roundCents } from "@elorae/db/pricing";
import { submitCollectionAction, type CollectionActionReason } from "@/app/actions/collections";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  receivableId: string;
  storeName: string;
  docNo: string;
  outstandingAmount: number;
  dueDateIso: string;
  pendingSubmittedAmount: number;
};

type ProofState =
  | { status: "idle"; file: File | null }
  | { status: "uploading"; file: File }
  | { status: "uploaded"; file: File; url: string; key: string }
  | { status: "error"; file: File };

/**
 * The reasons this task's brief names explicitly get their own copy. Every other reason
 * `submitCollectionAction` can return (INVALID_REQUEST, INVALID_AMOUNT, NOT_FOUND — a
 * receivable that got settled/reassigned between page load and submit) falls back to
 * `errGeneric`, which is this repo's established fallback-message key (see `pwa.storeChanges`).
 */
const REASON_KEY: Partial<Record<CollectionActionReason, string>> = {
  FORBIDDEN: "errForbidden",
  OVER_COLLECTED: "errOverCollected",
  ALREADY_SETTLED: "errAlreadySettled",
  NOT_ASSIGNED_COLLECTOR: "errNotAssignedCollector",
};

function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

function roundedAmount(raw: string): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? roundCents(parsed) : 0;
}

export function SubmitCollectionSheet({
  receivableId,
  storeName,
  docNo,
  outstandingAmount,
  dueDateIso,
  pendingSubmittedAmount,
}: Props) {
  const t = useTranslations("pwa.collections");
  const [isPending, startTransition] = useTransition();

  const collectable = roundCents(Math.max(0, outstandingAmount - pendingSubmittedAmount));

  const [amountInput, setAmountInput] = useState(collectable > 0 ? collectable.toFixed(2) : "");
  const [method, setMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [paidAt, setPaidAt] = useState(() => formatDateOnlyJakarta(new Date()));
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<ProofState>({ status: "idle", file: null });
  const [clientId] = useState(() => crypto.randomUUID());
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const parsedAmount = roundedAmount(amountInput);
  const amountValid = parsedAmount > 0;
  const paidAtValid = /^\d{4}-\d{2}-\d{2}$/.test(paidAt);
  const amountExceedsCollectable = parsedAmount > collectable + 0.005;
  const proofBusy = proof.status === "uploading";
  const canSubmit = amountValid && paidAtValid && !amountExceedsCollectable && !proofBusy && !isPending;

  function collectFull(): void {
    setAmountInput(collectable > 0 ? collectable.toFixed(2) : "0.00");
  }

  function handleFileChange(file: File | null): void {
    setProof({ status: "idle", file });
  }

  async function uploadProof(): Promise<void> {
    if (proof.status === "uploading" || proof.status === "uploaded" || !proof.file) return;
    const file = proof.file;
    setProof({ status: "uploading", file });
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("receivableId", receivableId);
      formData.append("clientId", clientId);
      const res = await fetch("/pwa/api/upload/collection-proof", { method: "POST", body: formData });
      if (!res.ok) throw new Error("upload failed");
      const data = (await res.json()) as { url: string; key: string };
      setProof({ status: "uploaded", file, url: data.url, key: data.key });
    } catch {
      setProof({ status: "error", file });
      toast.error(t("proofUploadError"));
    }
  }

  function submit(): void {
    if (!canSubmit) return;
    setSubmitError(null);
    startTransition(async () => {
      try {
        const result = await submitCollectionAction({
          receivableId,
          amount: parsedAmount,
          method,
          paidAt,
          note: note.trim() || undefined,
          proofUrl: proof.status === "uploaded" ? proof.url : undefined,
          proofR2Key: proof.status === "uploaded" ? proof.key : undefined,
          idempotencyKey,
        });
        if (result.ok) {
          toast.success(t("submitSuccess"));
          /* Rotate before the success screen so a back-navigation replay can never resubmit. */
          setIdempotencyKey(crypto.randomUUID());
          setSuccess(true);
          return;
        }
        const key = REASON_KEY[result.reason] ?? "errGeneric";
        setSubmitError(t(key));
        toast.error(t(key));
      } catch {
        setSubmitError(t("errGeneric"));
        toast.error(t("errGeneric"));
      }
    });
  }

  if (success) {
    return (
      <div className="p-4">
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <div className="rounded-full bg-primary p-3">
              <CheckCircle2 className="h-8 w-8 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("submitSuccess")}</p>
              <p className="mt-1 text-lg font-semibold">{storeName}</p>
              <p className="text-xs text-muted-foreground">{docNo}</p>
            </div>
          </CardContent>
        </Card>
        <div className="mt-4">
          <Button asChild className="w-full">
            <Link href="/pwa/collections">
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
          <Link href="/pwa/collections">
            <ArrowLeft className="h-4 w-4" />
            {t("title")}
          </Link>
        </Button>
      </header>

      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-primary p-2 shrink-0">
              <Wallet className="h-4 w-4 text-primary-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold leading-tight">{storeName}</p>
              <p className="truncate text-xs text-muted-foreground">{docNo}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t("colDueDate")}</p>
              <p className="tabular-nums">{formatDateOnlyJakarta(new Date(dueDateIso))}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t("colOutstanding")}</p>
              <p className="font-medium tabular-nums">{formatRupiah(collectable)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("submitSheetTitle")}</h2>

      <div className="space-y-1.5">
        <Label htmlFor="collection-amount">{t("amountLabel")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="collection-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            className="h-10 flex-1"
            value={amountInput}
            disabled={isPending}
            onChange={(e) => setAmountInput(e.target.value)}
            onBlur={() => setAmountInput(parsedAmount > 0 ? parsedAmount.toFixed(2) : "")}
            aria-invalid={!amountValid || amountExceedsCollectable}
          />
          <Button type="button" variant="outline" className="h-10 shrink-0" disabled={isPending} onClick={collectFull}>
            {t("collectFullButton")}
          </Button>
        </div>
        {!amountValid && <p className="text-xs text-destructive">{t("amountRequired")}</p>}
        {amountValid && amountExceedsCollectable && (
          <p className="text-xs text-destructive">{t("amountExceedsCollectable")}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="collection-paid-at">{t("paidAtLabel")}</Label>
          <Input
            id="collection-paid-at"
            type="date"
            className="h-10"
            value={paidAt}
            disabled={isPending}
            onChange={(e) => setPaidAt(e.target.value)}
            aria-invalid={!paidAtValid}
          />
          {!paidAtValid && <p className="text-xs text-destructive">{t("paidAtRequired")}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="collection-method">{t("methodLabel")}</Label>
          <Select value={method} onValueChange={(v) => setMethod(v as "CASH" | "TRANSFER")} disabled={isPending}>
            <SelectTrigger id="collection-method" className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CASH">{t("methodCash")}</SelectItem>
              <SelectItem value="TRANSFER">{t("methodTransfer")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="collection-note">{t("noteLabel")}</Label>
        <Textarea
          id="collection-note"
          rows={2}
          maxLength={500}
          value={note}
          disabled={isPending}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="collection-proof">{t("proofLabel")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="collection-proof"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="h-10 flex-1"
            disabled={isPending || proofBusy}
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={!proof.file || proof.status === "uploading" || proof.status === "uploaded" || isPending}
            onClick={() => void uploadProof()}
          >
            {proofBusy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {proofBusy ? t("proofUploading") : t("proofUploadButton")}
          </Button>
        </div>
        {proof.status === "uploaded" && (
          <p className="text-xs text-muted-foreground">{t("proofUploaded", { name: proof.file.name })}</p>
        )}
        {proof.status === "error" && <p className="text-xs text-destructive">{t("proofUploadError")}</p>}
      </div>

      {submitError && <p className="text-sm text-destructive">{submitError}</p>}

      <div className="sticky bottom-0 -mx-4 -mb-4 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <Button
          type="button"
          className="w-full"
          size="lg"
          disabled={!canSubmit}
          onClick={submit}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? t("submitting") : t("submitButton")}
        </Button>
      </div>
    </div>
  );
}
