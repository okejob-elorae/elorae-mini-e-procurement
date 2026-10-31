"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import type { PindahTertunda } from "./usePindahTahap";

/**
 * Alasan untuk mundur, keluar jalur, atau membuka lagi — wajib, dan tercatat di
 * riwayat kolaborasi. Dipakai tabel, papan (seret mundur/keluar), aksi massal,
 * dan halaman rincian. Keluar jalur memakai tombol merah.
 */
export function DialogAlasanPindah({
  tertunda,
  onBatal,
  onLanjut,
}: {
  tertunda: PindahTertunda | null;
  onBatal: () => void;
  onLanjut: (alasan: string) => void;
}) {
  const t = useTranslations("kreatifRuang");
  const tk = dinamis(t);
  const [alasan, setAlasan] = useState("");
  const kosong = alasan.trim() === "";
  const p = tertunda;

  return (
    <AlertDialog
      open={p !== null}
      onOpenChange={(buka) => {
        if (!buka) {
          setAlasan("");
          onBatal();
        }
      }}
    >
      <AlertDialogContent>
        {p ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{tk(`kolaborasi.alasan.judul.${p.jenis}`, { tahap: tk(`tahap.${p.ke}`) })}</AlertDialogTitle>
              <AlertDialogDescription>
                {p.sasaran.length === 1
                  ? t("kolaborasi.alasan.untuk", { siapa: p.sasaran[0].kolNama })
                  : t("kolaborasi.alasan.untukBanyak", { n: p.sasaran.length })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="alasan-pindah-tahap">{t("kolaborasi.alasan.label")}</Label>
              <Textarea
                id="alasan-pindah-tahap"
                value={alasan}
                onChange={(e) => setAlasan(e.target.value)}
                placeholder={t("kolaborasi.alasan.placeholder")}
                rows={3}
                maxLength={1000}
                autoFocus
              />
              {kosong ? <p className="text-xs text-muted-foreground">{t("kolaborasi.alasan.wajib")}</p> : null}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("kolaborasi.alasan.batal")}</AlertDialogCancel>
              <AlertDialogAction
                variant={p.jenis === "KELUAR" ? "destructive" : "default"}
                disabled={kosong}
                onClick={() => {
                  const teks = alasan.trim();
                  setAlasan("");
                  onLanjut(teks);
                }}
              >
                {t("kolaborasi.alasan.lanjut")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : null}
      </AlertDialogContent>
    </AlertDialog>
  );
}
