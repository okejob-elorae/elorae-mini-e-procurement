"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Loader2, XCircle } from "lucide-react";
import { batalkanTukarSayaAction } from "@/app/actions/tukar-barang";
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
import { dinamis } from "@/lib/i18n/dinamis";
import { BATAS_TEKS_TUKAR, statusTukarTerbuka } from "@/lib/salesman/tukar-barang";
import type { BarisTukarSaya } from "@/lib/salesman/tukar-queries";
import { cn } from "@/lib/utils";
import { nadaStatusTukar } from "./tampilan";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

export function TukarSayaClient({ baris }: { baris: BarisTukarSaya[] }) {
  const t = useTranslations("pwa.tukar");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [batal, setBatal] = useState<BarisTukarSaya | null>(null);
  const [alasan, setAlasan] = useState("");

  const konfirmasiBatal = () =>
    mulai(async () => {
      if (!batal) return;
      try {
        const r = await batalkanTukarSayaAction(batal.id, alasan.trim() || null);
        if (r.ok) {
          toast.success(t("saya.okBatal", { docNo: batal.docNo }));
          setBatal(null);
          setAlasan("");
          router.refresh();
        } else {
          toast.error(td(`err.${r.kode}`));
          if (r.kode === "SUDAH_DIPUTUSKAN" || r.kode === "SUDAH_SELESAI") router.refresh();
        }
      } catch {
        toast.error(t("jaringan"));
      }
    });

  const ringkas = (isi: { nama: string; qty: number }[]) => isi.map((x) => `${x.nama} ×${x.qty}`).join(", ");

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("saya.judul")}</h1>
          <TombolBantuanHp judul={t("saya.judul")} />
        </div>
      </header>

      {baris.length === 0 ? (
        <section className="beranda-kartu space-y-2 text-center">
          <ArrowLeftRight className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">{t("saya.kosong")}</p>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("saya.judul")}>
          <ul className="divide-y">
            {baris.map((b) => (
              <li key={b.id} className="flex min-h-14 gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <ArrowLeftRight className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-medium leading-tight">{b.toko}</span>
                      <span className="block text-xs text-muted-foreground">
                        {b.docNo} · {b.dibuat}
                      </span>
                    </span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusTukar(b.status))}>
                      {td(`status.${b.status}`)}
                    </span>
                  </div>
                  <p className="flex items-start gap-1.5 text-sm">
                    <ArrowDownToLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t("masukSingkat")} />
                    <span>{ringkas(b.masuk)}</span>
                  </p>
                  <p className="flex items-start gap-1.5 text-sm">
                    <ArrowUpFromLine className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label={t("keluarSingkat")} />
                    <span>{ringkas(b.keluar)}</span>
                  </p>
                  {b.status === "DISETUJUI" ? (
                    <p className="text-xs text-muted-foreground">{t("saya.menungguGudang")}</p>
                  ) : null}
                  {b.status === "SELESAI" && b.selesai ? (
                    <p className="text-xs text-muted-foreground">{t("saya.selesaiPada", { tanggal: b.selesai })}</p>
                  ) : null}
                  {b.catatanKeputusan && (b.status === "DITOLAK" || b.status === "DIBATALKAN") ? (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {t("saya.alasan", { alasan: b.catatanKeputusan })}
                    </p>
                  ) : b.catatanKeputusan ? (
                    <p className="rounded-lg bg-muted px-3 py-2 text-sm">{t("saya.catatanKantor", { catatan: b.catatanKeputusan })}</p>
                  ) : null}
                  {statusTukarTerbuka(b.status) ? (
                    <Button type="button" variant="outline" size="sm" disabled={sibuk} onClick={() => setBatal(b)}>
                      <XCircle className="h-4 w-4" aria-hidden />
                      {t("saya.batalkan")}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AlertDialog
        open={batal !== null}
        onOpenChange={(v) => {
          if (!v) {
            setBatal(null);
            setAlasan("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("saya.batalJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("saya.batalIsi", { docNo: batal?.docNo ?? "", toko: batal?.toko ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tukar-batal-alasan">{t("saya.batalAlasan")}</Label>
            <Textarea
              id="tukar-batal-alasan"
              value={alasan}
              rows={2}
              maxLength={BATAS_TEKS_TUKAR}
              onChange={(e) => setAlasan(e.target.value)}
              disabled={sibuk}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("saya.jangan")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                // Dialog tetap terbuka sampai server menjawab.
                e.preventDefault();
                konfirmasiBatal();
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("saya.yaBatalkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
