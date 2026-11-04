"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Ban, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { blokirKolAction, bukaBlokirKolAction } from "@/app/actions/kreatif-kol";
import { pesanGagalKol } from "../format-kol";

/**
 * "Jangan diajak lagi" / "Buka blokir". Keduanya wajib beralasan dan tercatat
 * di riwayat. KOL yang diblokir tetap ada; kolaborasi baru dengannya ditolak.
 */
export function TombolBlokir({ kolId, nama, diblokir }: { kolId: string; nama: string; diblokir: boolean }) {
  const t = useTranslations("kreatifRuang");
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [sibuk, startSibuk] = useTransition();

  const kirim = () => {
    const teks = alasan.trim();
    if (!teks) return;
    startSibuk(async () => {
      const r = diblokir ? await bukaBlokirKolAction(kolId, teks) : await blokirKolAction(kolId, teks);
      if (!r.ok) {
        toast.error(pesanGagalKol(t, r.kode));
        return;
      }
      toast.success(diblokir ? t("kol.blokir.okBuka", { nama }) : t("kol.blokir.ok", { nama }));
      setBuka(false);
      setAlasan("");
      router.refresh();
    });
  };

  return (
    <>
      <Button variant="outline" onClick={() => setBuka(true)}>
        {diblokir ? <Undo2 className="mr-1.5 h-4 w-4" /> : <Ban className="mr-1.5 h-4 w-4" />}
        {diblokir ? t("kol.blokir.tombolBuka") : t("kol.blokir.tombol")}
      </Button>
      <AlertDialog
        open={buka}
        onOpenChange={(b) => {
          if (!sibuk) setBuka(b);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{diblokir ? t("kol.blokir.judulBuka", { nama }) : t("kol.blokir.judul", { nama })}</AlertDialogTitle>
            {!diblokir && <AlertDialogDescription>{t("kol.blokir.akibat")}</AlertDialogDescription>}
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="kol-alasan-blokir">{t("kol.blokir.alasan")}</Label>
            <Textarea
              id="kol-alasan-blokir"
              rows={3}
              maxLength={1000}
              placeholder={diblokir ? undefined : t("kol.blokir.alasanPh")}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("kol.blokir.batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant={diblokir ? "default" : "destructive"}
              disabled={sibuk || !alasan.trim()}
              onClick={(e) => {
                // Dialog tetap terbuka sampai aksinya selesai; ditutup dari `kirim`.
                e.preventDefault();
                kirim();
              }}
            >
              {sibuk && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {diblokir ? t("kol.blokir.konfirmasiBuka") : t("kol.blokir.konfirmasi")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
