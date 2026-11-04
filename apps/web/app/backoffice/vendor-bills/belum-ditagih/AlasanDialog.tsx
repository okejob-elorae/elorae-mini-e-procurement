"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Dialog dengan alasan wajib (1–500 huruf): "Tidak perlu invoice", batalkan permintaan, batalkan pembebasan. */
export function AlasanDialog({
  buka,
  judul,
  isi,
  tombol,
  onTutup,
  onKirim,
}: {
  buka: boolean;
  judul: string;
  isi: string;
  tombol: string;
  onTutup: () => void;
  onKirim: (alasan: string) => Promise<boolean>;
}) {
  const t = useTranslations("vendorBills.belumDitagih");
  const [alasan, setAlasan] = useState("");
  const [sibuk, setSibuk] = useState(false);
  const kirim = async () => {
    setSibuk(true);
    try {
      if (await onKirim(alasan.trim())) {
        setAlasan("");
        onTutup();
      }
    } finally {
      setSibuk(false);
    }
  };
  return (
    <Dialog open={buka} onOpenChange={(v) => !v && !sibuk && onTutup()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{judul}</DialogTitle>
          <DialogDescription>{isi}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="alasan-belum-ditagih">{t("alasan")}</Label>
          <Textarea id="alasan-belum-ditagih" rows={3} maxLength={500} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={sibuk} onClick={onTutup}>
            {t("batal")}
          </Button>
          <Button disabled={sibuk || alasan.trim().length === 0} onClick={() => void kirim()}>
            {sibuk && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tombol}
          </Button>
        </DialogFooter>
        {alasan.trim().length === 0 && <p className="text-right text-xs text-muted-foreground">{t("alasanWajib")}</p>}
      </DialogContent>
    </Dialog>
  );
}
