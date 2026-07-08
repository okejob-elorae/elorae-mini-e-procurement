"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  approveStoreChangeRequestAction, rejectStoreChangeRequestAction, type StoreChangeActionResult,
} from "@/app/actions/store-changes";

type Fields = { name: string; address: string; phone: string | null; contactName: string | null; lat: number | null; lng: number | null };
type Props = {
  requestId: string; storeId: string; requestedByLabel: string;
  proposed: Fields; old: Fields; canManage: boolean;
};

function loc(lat: number | null, lng: number | null): string | null {
  if (lat === null || lng === null) return null;
  return `${lat}, ${lng}`;
}

export function StoreChangeReviewCard({ requestId, storeId, requestedByLabel, proposed, old, canManage }: Props) {
  const t = useTranslations("stores.storeChanges");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (!canManage) return null;

  const rows: Array<{ label: string; from: string; to: string }> = [];
  const push = (label: string, from: string | null, to: string | null) => {
    if ((from ?? "") !== (to ?? "")) rows.push({ label, from: from ?? t("empty"), to: to ?? t("empty") });
  };
  push(t("fieldName"), old.name, proposed.name);
  push(t("fieldAddress"), old.address, proposed.address);
  push(t("fieldPhone"), old.phone, proposed.phone);
  push(t("fieldContact"), old.contactName, proposed.contactName);
  push(t("fieldLocation"), loc(old.lat, old.lng), loc(proposed.lat, proposed.lng));

  function handle(r: StoreChangeActionResult, success: string) {
    if (r.ok) { toast.success(success); setApproveOpen(false); setRejectOpen(false); setReason(""); router.refresh(); return; }
    const map: Record<string, string> = {
      FORBIDDEN: t("errForbidden"), NOT_FOUND: t("errNotFound"),
      INVALID_STATE: t("errInvalidState"), STORE_GONE: t("errStoreGone"),
    };
    toast.error(map[r.reason] ?? t("errGeneric"));
  }

  function approve() {
    startTransition(async () => {
      try { handle(await approveStoreChangeRequestAction(requestId, storeId), t("approved")); }
      catch { toast.error(t("errGeneric")); }
    });
  }
  function reject() {
    const rsn = reason.trim();
    if (!rsn) return;
    startTransition(async () => {
      try { handle(await rejectStoreChangeRequestAction(requestId, storeId, rsn), t("rejected")); }
      catch { toast.error(t("errGeneric")); }
    });
  }

  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="text-base">{t("reviewTitle")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("requestedBy", { name: requestedByLabel })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1 pr-4">{t("colField")}</th>
                <th className="pb-1 pr-4">{t("colBefore")}</th>
                <th className="pb-1">{t("colAfter")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t">
                  <td className="py-1 pr-4 text-muted-foreground">{r.label}</td>
                  <td className="py-1 pr-4 line-through text-muted-foreground">{r.from}</td>
                  <td className="py-1 font-medium">{r.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <Button disabled={isPending} onClick={() => setApproveOpen(true)}>{t("approve")}</Button>
          <Button variant="destructive" disabled={isPending} onClick={() => setRejectOpen(true)}>{t("reject")}</Button>
        </div>
      </CardContent>

      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("approve")}</AlertDialogTitle>
            <AlertDialogDescription>{t("approveConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={approve}>{t("approve")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rejectOpen} onOpenChange={(o) => { setRejectOpen(o); if (!o) setReason(""); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reject")}</AlertDialogTitle>
            <AlertDialogDescription>{t("rejectConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t("rejectReasonLabel")}</label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} disabled={isPending} rows={3} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={isPending || !reason.trim()} onClick={reject}>{t("reject")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
