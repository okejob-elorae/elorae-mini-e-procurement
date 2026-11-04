"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { ubahStatusLangkahAction } from "@/app/actions/jadwal-produksi";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { dinamis } from "@/lib/i18n/dinamis";
import type { StatusLangkah } from "@/lib/production/jadwal";
import { labelTanggal } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import { NADA_STATUS, RUANG_KERJA_TAHAP } from "./follow-up";

export type LangkahDialog = {
  stepId: string;
  name: string;
  status: StatusLangkah;
  /** "YYYY-MM-DD" */
  target: string;
  tahapId: string;
  tahapName: string;
};

const SEMUA_STATUS: StatusLangkah[] = ["BELUM", "PROSES", "SELESAI"];

/**
 * Ubah status satu langkah jadwal dari Follow-up produksi. SELESAI meminta
 * tanggal selesai sebenarnya (bawaan hari ini WIB, tidak boleh sesudahnya) —
 * tanggal itu menggeser target langkah sesudahnya di tahap yang sama.
 */
export function UbahStatusDialog({
  langkah,
  awal,
  hariIni,
  bolehUbah,
  onTutup,
  onBerhasil,
}: {
  langkah: LangkahDialog | null;
  awal: StatusLangkah;
  hariIni: string;
  bolehUbah: boolean;
  onTutup: () => void;
  onBerhasil: (stepId: string) => void;
}) {
  const t = useTranslations("jadwalProduksi");
  return (
    <Dialog open={langkah !== null} onOpenChange={(buka) => !buka && onTutup()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("followUp.dialog.judul")}</DialogTitle>
        </DialogHeader>
        {langkah ? (
          <IsiDialog
            // Dipasang ulang per langkah: pilihan dan tanggal tidak terbawa dari langkah sebelumnya.
            key={`${langkah.stepId}:${awal}`}
            langkah={langkah}
            awal={awal}
            hariIni={hariIni}
            bolehUbah={bolehUbah}
            onTutup={onTutup}
            onBerhasil={onBerhasil}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function IsiDialog({
  langkah,
  awal,
  hariIni,
  bolehUbah,
  onTutup,
  onBerhasil,
}: {
  langkah: LangkahDialog;
  awal: StatusLangkah;
  hariIni: string;
  bolehUbah: boolean;
  onTutup: () => void;
  onBerhasil: (stepId: string) => void;
}) {
  const t = useTranslations("jadwalProduksi");
  const td = dinamis(t);
  const locale = useLocale();
  const [pilihan, setPilihan] = useState<StatusLangkah>(awal);
  const [tanggal, setTanggal] = useState(hariIni);
  const [menyimpan, mulai] = useTransition();

  const alasan =
    pilihan === langkah.status && pilihan !== "SELESAI"
      ? t("followUp.dialog.alasanSama")
      : pilihan === "SELESAI" && !tanggal
        ? t("followUp.dialog.alasanTanggal")
        : null;

  const simpan = () =>
    mulai(async () => {
      const hasil = await ubahStatusLangkahAction({
        stepId: langkah.stepId,
        status: pilihan,
        doneDate: pilihan === "SELESAI" ? tanggal : null,
      });
      if (!hasil.ok) {
        toast.error(td(`server.err${hasil.code}`));
        return;
      }
      toast.success(t("followUp.dialog.disimpan"));
      onBerhasil(langkah.stepId);
    });

  return (
    <>
      <div className="space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">{t("followUp.kolom.proses")}</dt>
          <dd className="font-medium">{langkah.name}</dd>
          <dt className="text-muted-foreground">{t("followUp.kolom.tahap")}</dt>
          <dd>
            <Link href={RUANG_KERJA_TAHAP(langkah.tahapId)} className="inline-flex items-center gap-1 text-tautan hover:underline">
              {langkah.tahapName}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </dd>
          <dt className="text-muted-foreground">{t("followUp.kolom.target")}</dt>
          <dd>{labelTanggal(langkah.target, locale)}</dd>
          <dt className="text-muted-foreground">{t("followUp.kolom.status")}</dt>
          <dd>
            <StatusPill tone={NADA_STATUS[langkah.status]}>{td(`followUp.status.${langkah.status}`)}</StatusPill>
          </dd>
        </dl>

        {bolehUbah ? (
          <>
            <div className="space-y-2">
              <Label>{t("followUp.dialog.statusBaru")}</Label>
              <div role="radiogroup" aria-label={t("followUp.dialog.statusBaru")} className="grid grid-cols-3 gap-2">
                {SEMUA_STATUS.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={pilihan === s}
                    variant="outline"
                    onClick={() => setPilihan(s)}
                    className={cn(pilihan === s && "border-primary ring-1 ring-primary")}
                  >
                    {td(`followUp.status.${s}`)}
                  </Button>
                ))}
              </div>
            </div>
            {pilihan === "SELESAI" ? (
              <div className="space-y-2">
                <Label htmlFor="tanggal-selesai">{t("followUp.dialog.tanggalSelesai")}</Label>
                <TanggalInput
                  id="tanggal-selesai"
                  value={tanggal}
                  max={hariIni}
                  required
                  onChange={(e) => setTanggal(e.target.value)}
                />
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("followUp.dialog.hanyaLihat")}</p>
        )}
      </div>
      <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center">
        {bolehUbah && alasan ? <p className="text-xs text-muted-foreground sm:mr-auto">{alasan}</p> : null}
        <Button type="button" variant="outline" onClick={onTutup} disabled={menyimpan}>
          {bolehUbah ? t("followUp.dialog.batal") : t("followUp.dialog.tutup")}
        </Button>
        {bolehUbah ? (
          <Button type="button" onClick={simpan} disabled={menyimpan || alasan !== null}>
            {menyimpan ? t("followUp.dialog.menyimpan") : t("followUp.dialog.simpan")}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}
