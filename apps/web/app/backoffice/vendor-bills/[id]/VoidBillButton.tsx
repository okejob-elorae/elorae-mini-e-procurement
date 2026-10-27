"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { voidVendorBillAction } from "@/app/actions/vendor-billing";

export function VoidBillButton({ billId, userId }: { billId: string; userId: string }) {
  const t = useTranslations("vendorBills");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await voidVendorBillAction(billId, reason, userId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(t("voided", { docNumber: res.docNumber }));
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t("void")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("voidTitle")}</DialogTitle>
            <DialogDescription>{t("voidBody")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="vb-void-reason">{t("voidReason")}</Label>
            <Textarea id="vb-void-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("back")}
            </Button>
            <Button variant="destructive" onClick={submit} disabled={busy || reason.trim() === ""}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("void")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
