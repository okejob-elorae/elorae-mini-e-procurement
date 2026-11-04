"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, Loader2, Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { aturAktifPromoKonterAction, hapusPromoKonterAction } from "@/app/actions/promo-konter";
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
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";

/**
 * Aksi satu baris promo: ubah, nyalakan/matikan, hapus. Hapus hanya untuk promo
 * yang belum pernah dipakai; yang sudah dipakai ditawari dimatikan — dialog
 * yang sama berpindah ke tawaran itu kalau server menolak `SUDAH_DIPAKAI`.
 */
export function TombolPromoKonter({
  id,
  nama,
  isActive,
  nota,
  bolehUbah,
  sesudahHapus,
}: {
  id: string;
  nama: string;
  isActive: boolean;
  nota: number;
  bolehUbah: boolean;
  /** Ke mana sesudah dihapus (halaman ubah kembali ke daftar); kosong = segarkan di tempat. */
  sesudahHapus?: string;
}) {
  const t = useTranslations("promoKonter");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [buka, setBuka] = useState(false);
  const [dipakai, setDipakai] = useState(nota);

  const galat = (code: string) => toast.error(td(`err.${["UNAUTHORIZED", "FORBIDDEN", "TIDAK_ADA"].includes(code) ? code : "GAGAL"}`));

  const atur = (aktif: boolean) =>
    mulai(async () => {
      const r = await aturAktifPromoKonterAction(id, aktif);
      if (!r.ok) {
        galat(r.code);
        return;
      }
      toast.success(aktif ? t("okNyala") : t("okMati"));
      setBuka(false);
      router.refresh();
    });

  const hapus = () =>
    mulai(async () => {
      const r = await hapusPromoKonterAction(id);
      if (!r.ok) {
        if (r.code === "SUDAH_DIPAKAI") {
          // Tetap di dialog: sekarang ia menawarkan "Matikan".
          setDipakai(Math.max(1, r.nota));
          return;
        }
        galat(r.code);
        return;
      }
      toast.success(t("okHapus"));
      setBuka(false);
      if (sesudahHapus) router.push(sesudahHapus);
      else router.refresh();
    });

  return (
    <div className="flex items-center justify-end gap-1">
      <Button asChild variant="ghost" size="icon" aria-label={bolehUbah ? t("ubah") : t("lihat")} title={bolehUbah ? t("ubah") : t("lihat")}>
        <Link href={`/backoffice/promo-konter/${id}`}>{bolehUbah ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Link>
      </Button>
      {bolehUbah ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            disabled={sibuk}
            onClick={() => atur(!isActive)}
            aria-label={isActive ? t("matikan") : t("nyalakan")}
            title={isActive ? t("matikan") : t("nyalakan")}
          >
            {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={sibuk}
            onClick={() => {
              setDipakai(nota);
              setBuka(true);
            }}
            aria-label={t("hapus")}
            title={t("hapus")}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </>
      ) : null}

      <AlertDialog open={buka} onOpenChange={(o) => !sibuk && setBuka(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dipakai > 0 ? t("hapusDipakaiJudul") : t("hapusJudul", { nama })}</AlertDialogTitle>
            <AlertDialogDescription>
              {dipakai > 0 ? (isActive ? t("hapusDipakaiIsi", { n: dipakai }) : t("hapusDipakaiSudahMati", { n: dipakai })) : t("hapusIsi")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            {dipakai > 0 ? (
              isActive ? (
                <AlertDialogAction
                  disabled={sibuk}
                  onClick={(e) => {
                    e.preventDefault();
                    atur(false);
                  }}
                >
                  {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("matikan")}
                </AlertDialogAction>
              ) : null
            ) : (
              <AlertDialogAction
                variant="destructive"
                disabled={sibuk}
                onClick={(e) => {
                  e.preventDefault();
                  hapus();
                }}
              >
                {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t("hapus")}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
