"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TanggalInput } from "@/components/ui/tanggal-input";
import type { KalenderKerja } from "@/lib/production/hari-kerja";
import type { StatusLangkah } from "@/lib/production/jadwal";
import type { LangkahRuangKerja } from "@/lib/production/jadwal-queries";
import { ubahStatusLangkahAction } from "@/app/actions/jadwal-produksi";
import { labelPendek, pratinjauStatus, statusUsulan, tanggalJadwalSah } from "./ruang-kerja";
import type { HasilAksi } from "./pakai-aksi";

const SEMUA_STATUS: StatusLangkah[] = ["BELUM", "PROSES", "SELESAI"];

type Props = {
  langkah: LangkahRuangKerja | null;
  semuaLangkah: LangkahRuangKerja[];
  mulai: string;
  hariIni: string;
  kal: KalenderKerja;
  sibuk: boolean;
  jalankan: (aksi: () => Promise<HasilAksi>, pesanBerhasil: string) => Promise<boolean>;
  onOpenChange: (buka: boolean) => void;
};

/** Ubah status satu langkah; SELESAI meminta tanggal selesai sebenarnya (bawaan hari ini, tidak boleh sesudahnya). */
export function DialogStatusLangkah({ langkah, onOpenChange, ...isi }: Props) {
  return (
    <Dialog open={!!langkah} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {langkah ? <IsiStatus key={langkah.id} langkah={langkah} onOpenChange={onOpenChange} {...isi} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function IsiStatus({
  langkah,
  semuaLangkah,
  mulai,
  hariIni,
  kal,
  sibuk,
  jalankan,
  onOpenChange,
}: Omit<Props, "langkah"> & { langkah: LangkahRuangKerja }) {
  const t = useTranslations("jadwalProduksi.ruang");
  const tServer = useTranslations("jadwalProduksi.server");
  const locale = useLocale();
  const [status, setStatus] = useState<StatusLangkah>(statusUsulan(langkah.status));
  const [tanggal, setTanggal] = useState(langkah.doneDate ?? hariIni);

  const tanggalSah = tanggalJadwalSah(tanggal) && tanggal <= hariIni;
  const doneDate = status === "SELESAI" ? tanggal : null;
  const sama = status === langkah.status && (status !== "SELESAI" || tanggal === langkah.doneDate);
  const bolehSimpan = !sibuk && !sama && (status !== "SELESAI" || tanggalSah);

  const pratinjau =
    status !== "SELESAI" || tanggalSah
      ? pratinjauStatus({ langkah: semuaLangkah, stepId: langkah.id, status, doneDate, mulai, kal })
      : null;

  const simpan = async () => {
    const ok = await jalankan(
      () => ubahStatusLangkahAction({ stepId: langkah.id, status, doneDate }),
      t("berhasilStatus"),
    );
    if (ok) onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("statusJudul")}</DialogTitle>
        <DialogDescription>{langkah.name}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("kolStatus")}>
          {SEMUA_STATUS.map((s) => (
            <Button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              variant={status === s ? "default" : "outline"}
              onClick={() => setStatus(s)}
            >
              {t(`status${s}`)}
            </Button>
          ))}
        </div>

        {status === "SELESAI" ? (
          <div className="space-y-2">
            <Label htmlFor="tanggal-selesai">{t("tanggalSelesai")}</Label>
            <TanggalInput
              id="tanggal-selesai"
              value={tanggal}
              max={hariIni}
              required
              aria-invalid={!tanggalSah}
              onChange={(e) => setTanggal(e.target.value)}
            />
            {!tanggalSah ? <p className="text-sm text-destructive">{tServer("errTANGGAL_TIDAK_SAH")}</p> : null}
          </div>
        ) : null}

        {pratinjau && pratinjau.selesaiPadaBaru ? (
          <p className="text-sm text-muted-foreground">
            {pratinjau.selesaiPadaBaru === pratinjau.selesaiPadaLama
              ? t("perkiraanTetap", { tanggal: labelPendek(pratinjau.selesaiPadaBaru, hariIni, locale) })
              : t("perkiraanBerubah", {
                  lama: labelPendek(pratinjau.selesaiPadaLama, hariIni, locale),
                  baru: labelPendek(pratinjau.selesaiPadaBaru, hariIni, locale),
                })}
          </p>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("batal")}
        </Button>
        <Button type="button" disabled={!bolehSimpan} onClick={() => void simpan()}>
          {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("simpan")}
        </Button>
      </DialogFooter>
    </>
  );
}
