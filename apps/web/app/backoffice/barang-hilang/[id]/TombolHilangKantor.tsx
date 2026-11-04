"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CircleX, Loader2, ReceiptText } from "lucide-react";
import { batalkanBarangHilangAction, tandaiTokoDitagihAction } from "@/app/actions/barang-hilang";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_TEKS_HILANG } from "@/lib/spg/hilang";

type Hasil = { ok: true } | { ok: false; code: string };

function useJalankan() {
  const t = useTranslations("barangHilang");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const jalankan = (aksi: () => Promise<Hasil>, sukses: string, selesai: () => void) =>
    mulai(async () => {
      let h: Hasil;
      try {
        h = await aksi();
      } catch {
        toast.error(t("err.NETWORK"));
        return;
      }
      if (!h.ok) {
        toast.error(td(`err.${h.code}`));
        router.refresh();
        return;
      }
      toast.success(sukses);
      selesai();
      router.refresh();
    });
  return { t, sibuk, jalankan };
}

/** Batalkan catatan barang hilang — alasan wajib. Server menolak bila sudah ada potongan/tagihan. */
export function BatalkanHilang({ lossId }: { lossId: string }) {
  const { t, sibuk, jalankan } = useJalankan();
  const [buka, setBuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  return (
    <AlertDialog open={buka} onOpenChange={setBuka}>
      <AlertDialogTrigger asChild>
        <Button variant="outline">
          <CircleX className="mr-1.5 h-4 w-4" />
          {t("batal.tombol")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("batal.judul")}</AlertDialogTitle>
          <AlertDialogDescription>{t("batal.deskripsi")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="hilang-batal-alasan">{t("batal.alasan")}</Label>
          <Textarea id="hilang-batal-alasan" value={alasan} maxLength={BATAS_TEKS_HILANG} onChange={(e) => setAlasan(e.target.value)} rows={3} placeholder={t("batal.contoh")} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("batal.kembali")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={sibuk || alasan.trim() === ""}
            onClick={(e) => {
              e.preventDefault();
              jalankan(() => batalkanBarangHilangAction({ lossId, alasan }), t("batal.ok"), () => {
                setBuka(false);
                setAlasan("");
              });
            }}
          >
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {t("batal.simpan")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Bagian TOKO di toko putus: tandai sudah ditagih ke toko (catatan opsional, mis. nomor nota). */
export function TandaiTokoDitagih({ shareId }: { shareId: string }) {
  const { t, sibuk, jalankan } = useJalankan();
  const [buka, setBuka] = useState(false);
  const [catatan, setCatatan] = useState("");
  return (
    <AlertDialog open={buka} onOpenChange={setBuka}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ReceiptText className="mr-1.5 h-4 w-4" />
          {t("tagih.tombol")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("tagih.judul")}</AlertDialogTitle>
          <AlertDialogDescription>{t("tagih.deskripsi")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="hilang-tagih-catatan">{t("tagih.catatan")}</Label>
          <Textarea id="hilang-tagih-catatan" value={catatan} maxLength={BATAS_TEKS_HILANG} onChange={(e) => setCatatan(e.target.value)} rows={2} />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={sibuk}>{t("batal.kembali")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={sibuk}
            onClick={(e) => {
              e.preventDefault();
              jalankan(() => tandaiTokoDitagihAction({ shareId, catatan: catatan.trim() || null }), t("tagih.ok"), () => {
                setBuka(false);
                setCatatan("");
              });
            }}
          >
            {sibuk ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            {t("tagih.simpan")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
