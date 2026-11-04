"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageIcon, Loader2, Plus, Undo2 } from "lucide-react";
import { tarikIzinAction } from "@/app/actions/izin";
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
import type { AjuanLain } from "@/lib/salesman/izin";
import type { BarisIzinSaya, IzinSaya as DataIzinSaya } from "@/lib/salesman/izin-queries";
import { cn } from "@/lib/utils";
import { FormIzin } from "./FormIzin";
import { IkonJenisIzin, nadaStatusIzin } from "./tampilan-izin";

/**
 * Izin, sakit & cuti di layar Absen: sisa cuti tahun ini, tombol ajukan, dan
 * ajuan saya dengan statusnya. Ajuan yang masih menunggu bisa ditarik;
 * yang sudah disetujui hanya bisa dicabut kantor.
 */
export function IzinSaya({ data, kuotaCutiTahunan }: { data: DataIzinSaya; kuotaCutiTahunan: number }) {
  const t = useTranslations("pwa.izin");
  const td = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [tarik, setTarik] = useState<BarisIzinSaya | null>(null);
  const [pending, mulai] = useTransition();

  const lain = useMemo<AjuanLain[]>(
    () => data.baris.map((b) => ({ type: b.jenis, startDay: b.mulai, endDay: b.selesai, status: b.status })),
    [data.baris],
  );

  const jalankanTarik = (b: BarisIzinSaya) =>
    mulai(async () => {
      try {
        const r = await tarikIzinAction(b.id);
        if (r.ok) toast.success(t("ditarik"));
        else toast.error(td(`err.${r.kode}`));
      } catch {
        toast.error(t("luring"));
      } finally {
        setTarik(null);
        router.refresh();
      }
    });

  const { cuti } = data;

  return (
    <>
      <section className="beranda-kartu space-y-3">
        <h2 className="beranda-judul">{t("judul")}</h2>
        <p className="text-sm">
          {t("sisaCuti", { tahun: cuti.tahun, sisa: cuti.sisa, kuota: cuti.kuota })}
          {cuti.menunggu > 0 ? (
            <span className="text-muted-foreground"> · {t("cutiMenunggu", { n: cuti.menunggu })}</span>
          ) : null}
        </p>
        <Button size="lg" className="w-full" onClick={() => setBuka(true)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          {t("ajukan")}
        </Button>
      </section>

      {data.baris.length > 0 ? (
        <section className="beranda-kartu beranda-kartu-daftar" aria-label={t("daftarJudul")}>
          <h2 className="beranda-judul px-4 pt-3">{t("daftarJudul")}</h2>
          <ul className="divide-y">
            {data.baris.map((b) => (
              <li key={b.id} className="flex gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <IkonJenisIzin jenis={b.jenis} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block font-medium leading-tight">
                        {td(`jenis.${b.jenis}`)} · {b.rentang}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t("hariKerja", { n: b.hariKerja })} · {t("diajukanPada", { waktu: b.diajukan })}
                      </span>
                    </span>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusIzin(b.status))}>
                      {b.ditarikSendiri ? t("status.DITARIK") : td(`status.${b.status}`)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{b.alasan}</p>
                  {b.catatanKantor ? (
                    <p
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm",
                        b.status === "DISETUJUI" ? "bg-muted" : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {t("catatanKantor", { catatan: b.catatanKantor })}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    {b.fotoUrl ? (
                      <a
                        href={b.fotoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-1 text-xs font-medium underline decoration-primary decoration-2 underline-offset-4"
                      >
                        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
                        {t("lihatFoto")}
                      </a>
                    ) : null}
                    {b.status === "DIAJUKAN" ? (
                      <Button variant="outline" size="sm" onClick={() => setTarik(b)} disabled={pending}>
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                        {t("tarik")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <FormIzin
        buka={buka}
        onBuka={setBuka}
        hariIni={data.hariIni}
        kuotaCutiTahunan={kuotaCutiTahunan}
        lain={lain}
        hariTidakKerja={data.hariTidakKerja}
      />

      <AlertDialog open={tarik !== null} onOpenChange={(v) => !v && !pending && setTarik(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tarikJudul")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tarik ? t("tarikIsi", { jenis: td(`jenis.${tarik.jenis}`), rentang: tarik.rentang }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                // Tetap terbuka sampai server menjawab — dialog yang menutup duluan menyembunyikan kegagalannya.
                e.preventDefault();
                if (tarik) jalankanTarik(tarik);
              }}
            >
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              {t("tarik")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
