"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ambilSuratPo } from "@/app/actions/settings/surat-po";
import { MAKS_PANJANG_SURAT_PO, SURAT_PO_BAWAAN, type SuratPo } from "@/lib/purchase-orders/surat-po";

/**
 * Cetak PO: paragraf pembuka dan penutup surat terisi dari bawaan
 * (Pengaturan → Pajak → Surat PO) dan boleh diubah untuk cetakan ini saja —
 * bawaannya tidak berubah.
 */
export function DialogCetakPo({
  open,
  onOpenChange,
  onCetak,
}: {
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  onCetak: (surat: SuratPo) => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <IsiCetakPo
          onBatal={() => onOpenChange(false)}
          onCetak={(surat) => {
            onOpenChange(false);
            void onCetak(surat);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function IsiCetakPo({ onBatal, onCetak }: { onBatal: () => void; onCetak: (surat: SuratPo) => void }) {
  const t = useTranslations("purchaseOrders.cetak");
  const [surat, setSurat] = useState<SuratPo | null>(null);
  const [gagalMuat, setGagalMuat] = useState(false);

  useEffect(() => {
    let batal = false;
    ambilSuratPo()
      .then((h) => {
        if (batal) return;
        if (h.ok) setSurat(h.surat);
        else {
          setSurat({ ...SURAT_PO_BAWAAN });
          setGagalMuat(true);
        }
      })
      .catch(() => {
        if (batal) return;
        setSurat({ ...SURAT_PO_BAWAAN });
        setGagalMuat(true);
      });
    return () => {
      batal = true;
    };
  }, []);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("judul")}</DialogTitle>
      </DialogHeader>
      {!surat ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("memuat")}
        </p>
      ) : (
        <div className="space-y-4">
          {gagalMuat ? <p className="text-sm text-muted-foreground">{t("gagalMuat")}</p> : null}
          <div className="space-y-2">
            <Label htmlFor="cetak-pembuka">{t("pembuka")}</Label>
            <Textarea
              id="cetak-pembuka"
              rows={3}
              maxLength={MAKS_PANJANG_SURAT_PO}
              value={surat.pembuka}
              onChange={(e) => setSurat({ ...surat, pembuka: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cetak-penutup">{t("penutup")}</Label>
            <Textarea
              id="cetak-penutup"
              rows={3}
              maxLength={MAKS_PANJANG_SURAT_PO}
              value={surat.penutup}
              onChange={(e) => setSurat({ ...surat, penutup: e.target.value })}
            />
          </div>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBatal}>
          {t("batal")}
        </Button>
        <Button type="button" disabled={!surat} onClick={() => surat && onCetak(surat)}>
          <Printer className="mr-2 h-4 w-4" />
          {t("cetak")}
        </Button>
      </DialogFooter>
    </>
  );
}
