"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { mintaRevisiAction } from "@/app/actions/kreatif-konten";
import { useKabarKonten } from "./kabar-konten";

/** Minta revisi draf — catatan wajib; tercatat juga di catatan kolaborasi. */
export function DialogMintaRevisi({
  kontenId,
  namaKol,
  buka,
  onBuka,
}: {
  kontenId: string | null;
  namaKol?: string;
  buka: boolean;
  onBuka: (buka: boolean) => void;
}) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const router = useRouter();
  const kabar = useKabarKonten();
  const [catatan, setCatatan] = useState("");
  const [pending, start] = useTransition();

  const kirim = () => {
    if (!kontenId || !catatan.trim()) return;
    start(async () => {
      const r = await mintaRevisiAction(kontenId, catatan);
      if (r.ok) {
        kabar.sukses("kontenKol.ok.revisi");
        setCatatan("");
        onBuka(false);
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });
  };

  return (
    <Dialog
      open={buka}
      onOpenChange={(o) => {
        if (!o) setCatatan("");
        onBuka(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("revisi.judul")}</DialogTitle>
          {namaKol ? <DialogDescription>{namaKol}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="catatan-revisi">{t("revisi.label")}</Label>
          <Textarea
            id="catatan-revisi"
            rows={4}
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder={t("revisi.placeholder")}
            maxLength={2000}
          />
          {!catatan.trim() ? <p className="text-xs text-muted-foreground">{t("revisi.wajib")}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onBuka(false)} disabled={pending}>
            {t("batal")}
          </Button>
          <Button onClick={kirim} disabled={pending || !catatan.trim()}>
            {t("revisi.kirim")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
