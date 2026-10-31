"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Loader2 } from "lucide-react";
import { tutupPO } from "@/app/actions/purchase-orders";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/*
 * "Tutup PO" untuk PO kurang kirim: barang yang belum datang tidak akan
 * dikirim lagi. Alasan wajib; GRN berikutnya ke PO ini ditolak.
 */

type BarisSisa = { id: string; nama: string; sisa: number; satuan: string };

export function TutupPoDialog({
  poId,
  docNumber,
  sisa,
  disabled,
  onSelesai,
}: {
  poId: string;
  docNumber: string;
  sisa: BarisSisa[];
  disabled?: boolean;
  onSelesai: () => void | Promise<void>;
}) {
  const t = useTranslations("purchaseOrders.tutup");
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [sedang, mulai] = useTransition();
  const alasanKosong = alasan.trim().length === 0;

  const kirim = () => {
    if (alasanKosong) return;
    mulai(async () => {
      const hasil = await tutupPO(poId, alasan);
      if (!hasil.ok) {
        toast.error(t(`err.${hasil.code}` as never));
        return;
      }
      toast.success(t("berhasil", { docNumber: hasil.docNumber, qty: hasil.qtySisa.toLocaleString("id-ID") }));
      setBuka(false);
      setAlasan("");
      await onSelesai();
    });
  };

  return (
    <Dialog
      open={buka}
      onOpenChange={(v) => {
        if (sedang) return;
        setBuka(v);
        if (!v) setAlasan("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <Ban className="h-4 w-4 mr-2" />
          {t("tombol")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("judul", { docNumber })}</DialogTitle>
          <DialogDescription>{t("penjelasan")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {sisa.length > 0 && (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("sisaJudul")}</p>
              <ul className="text-sm text-muted-foreground space-y-0.5">
                {sisa.map((b) => (
                  <li key={b.id} className="flex justify-between gap-4">
                    <span className="min-w-0 break-words">{b.nama}</span>
                    <span className="shrink-0 tabular-nums">
                      {b.sisa.toLocaleString("id-ID")} {b.satuan}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="alasanTutupPo">{t("alasanLabel")}</Label>
            <Textarea
              id="alasanTutupPo"
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
              placeholder={t("alasanPlaceholder")}
              rows={3}
            />
            {alasanKosong && <p className="text-xs text-muted-foreground">{t("alasanWajib")}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setBuka(false)} disabled={sedang}>
            {t("batal")}
          </Button>
          <Button onClick={kirim} disabled={sedang || alasanKosong}>
            {sedang && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {sedang ? t("menutup") : t("konfirmasi")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
