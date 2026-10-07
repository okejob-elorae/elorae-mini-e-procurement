"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelWorkOrder, type BahanBelumKembali } from "@/app/actions/production";
import { BATAS_ALASAN_BATAL_WO } from "@/lib/production/kembali-bahan";

/**
 * Batalkan perintah kerja dengan alasan WAJIB — dipakai daftar dan rincian WO.
 * Dulu `confirm()` bawaan peramban dan alasan kosong. Bila bahan masih di CMT,
 * dialog tetap terbuka dan menyebut bahannya (kembalikan dulu di rincian WO).
 */
export function DialogBatalWo({
  open,
  onOpenChange,
  woId,
  docNumber,
  diRincian = false,
  onSelesai,
}: {
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  woId: string;
  docNumber: string;
  /** Di halaman rincian tautan "buka perintah kerja" tidak perlu. */
  diRincian?: boolean;
  onSelesai: () => void;
}) {
  const t = useTranslations("workOrders.batal");
  const tTolak = useTranslations("productionErrors");
  const [alasan, setAlasan] = useState("");
  const [sisa, setSisa] = useState<BahanBelumKembali[] | null>(null);
  const [sibuk, mulai] = useTransition();
  const kosong = alasan.trim() === "";

  const tutup = (buka: boolean) => {
    if (!buka) {
      setAlasan("");
      setSisa(null);
    }
    onOpenChange(buka);
  };

  const kirim = () => {
    const teks = alasan.trim();
    if (!teks) return;
    mulai(async () => {
      try {
        const hasil = await cancelWorkOrder(woId, "", teks);
        if (hasil.ok) {
          toast.success(t("berhasil", { docNumber }));
          tutup(false);
          onSelesai();
          return;
        }
        if (hasil.code === "WO_SUDAH_KELUAR_BAHAN") {
          setSisa(hasil.sisa);
          return;
        }
        toast.error(tTolak.has(hasil.code) ? tTolak(hasil.code) : t("gagal"));
        if (hasil.code === "WO_SUDAH_DIBATALKAN" || hasil.code === "WO_SUDAH_ADA_PENERIMAAN") {
          tutup(false);
          onSelesai();
        }
      } catch {
        toast.error(t("gagal"));
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={tutup}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("judul", { docNumber })}</AlertDialogTitle>
          <AlertDialogDescription>{t("deskripsi")}</AlertDialogDescription>
        </AlertDialogHeader>
        {sisa ? (
          <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <p className="font-medium">{t("masihDiCmt")}</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {sisa.map((s) => (
                <li key={s.nama}>
                  {s.nama}: {s.qty.toLocaleString("id-ID", { maximumFractionDigits: 2 })} {s.satuan}
                </li>
              ))}
            </ul>
            {!diRincian && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/backoffice/work-orders/${woId}`}>{t("bukaRincian")}</Link>
              </Button>
            )}
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor={`alasan-batal-wo-${woId}`}>{t("alasanLabel")}</Label>
          <Textarea
            id={`alasan-batal-wo-${woId}`}
            value={alasan}
            maxLength={BATAS_ALASAN_BATAL_WO}
            onChange={(e) => setAlasan(e.target.value)}
            placeholder={t("alasanPlaceholder")}
            rows={3}
          />
          {kosong && <p className="text-xs text-muted-foreground">{t("alasanDulu")}</p>}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("jangan")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={kosong || sibuk}
            onClick={(e) => {
              // Dialog tetap terbuka sampai server menjawab (penolakan ditampilkan di sini).
              e.preventDefault();
              kirim();
            }}
          >
            {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("ya")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
