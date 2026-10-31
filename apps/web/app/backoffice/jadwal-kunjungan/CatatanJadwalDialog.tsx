"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAKS_CATATAN_JADWAL } from "@/lib/salesman/jadwal";

/** Ubah catatan kantor untuk satu toko di satu hari. Kosong = hapus catatannya. */
export function CatatanJadwalDialog({
  open,
  onOpenChange,
  toko,
  labelHari,
  awal,
  menyimpan,
  onSimpan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toko: string;
  labelHari: string;
  awal: string;
  menyimpan: boolean;
  onSimpan: (note: string | null) => void;
}) {
  const t = useTranslations("jadwalKunjungan");
  const [isi, setIsi] = useState(awal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("catatanJudul", { toko })}</DialogTitle>
          <DialogDescription>{t("catatanDeskripsi", { tanggal: labelHari })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="jadwal-catatan">{t("kolom.catatan")}</Label>
          <Textarea
            id="jadwal-catatan"
            value={isi}
            maxLength={MAKS_CATATAN_JADWAL}
            rows={3}
            placeholder={t("catatanPlaceholder")}
            onChange={(e) => setIsi(e.target.value)}
          />
          <p className="text-right text-xs tabular-nums text-muted-foreground">
            {isi.length}/{MAKS_CATATAN_JADWAL}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={menyimpan}>
            {t("batal")}
          </Button>
          <Button onClick={() => onSimpan(isi.trim() === "" ? null : isi)} disabled={menyimpan}>
            {menyimpan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {menyimpan ? t("menyimpan") : t("simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
