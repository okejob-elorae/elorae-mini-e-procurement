"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TanggalInput } from "@/components/ui/tanggal-input";
import type { KalenderKerja } from "@/lib/production/hari-kerja";
import type { LangkahRuangKerja } from "@/lib/production/jadwal-queries";
import { aturMulaiJadwalAction } from "@/app/actions/jadwal-produksi";
import { labelPendek, peringatanJadwal, pratinjauMulai, type ModeJadwal } from "./ruang-kerja";
import type { HasilAksi } from "./pakai-aksi";
import { PilihMode } from "./PilihMode";
import { PeringatanMulaiLewat } from "./PeringatanMulaiLewat";

type Props = {
  buka: boolean;
  planStageId: string;
  scheduleStart: string | null;
  deadline: string | null;
  langkah: LangkahRuangKerja[];
  hariIni: string;
  kal: KalenderKerja;
  sibuk: boolean;
  jalankan: (aksi: () => Promise<HasilAksi>, pesanBerhasil: string) => Promise<boolean>;
  onOpenChange: (buka: boolean) => void;
};

/** Tanggal mulai (susun maju) atau tenggat (susun mundur) tahap; semua langkah disusun ulang. */
export function DialogAturMulai({ buka, onOpenChange, ...isi }: Props) {
  return (
    <Dialog open={buka} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">{buka ? <IsiAturMulai onOpenChange={onOpenChange} {...isi} /> : null}</DialogContent>
    </Dialog>
  );
}

function IsiAturMulai({
  planStageId,
  scheduleStart,
  deadline,
  langkah,
  hariIni,
  kal,
  sibuk,
  jalankan,
  onOpenChange,
}: Omit<Props, "buka">) {
  const t = useTranslations("jadwalProduksi.ruang");
  const tServer = useTranslations("jadwalProduksi.server");
  const locale = useLocale();
  const [mode, setMode] = useState<ModeJadwal>(deadline ? "MUNDUR" : "MAJU");
  const [tanggal, setTanggal] = useState(deadline ?? scheduleStart ?? hariIni);

  const pratinjau = pratinjauMulai({ langkah, mode, tanggal, kal });
  const pendek = (teks: string | null) => labelPendek(teks, hariIni, locale);

  const simpan = async () => {
    const ok = await jalankan(() => aturMulaiJadwalAction({ planStageId, mode, tanggal }), t("berhasilMulai"));
    if (ok) onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("aturMulaiJudul")}</DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <PilihMode mode={mode} onChange={setMode} />
        <div className="space-y-2">
          <Label htmlFor="atur-mulai-tanggal">{mode === "MAJU" ? t("tanggalMulai") : t("tanggalTenggat")}</Label>
          <TanggalInput
            id="atur-mulai-tanggal"
            value={tanggal}
            required
            aria-invalid={!pratinjau.ok}
            onChange={(e) => setTanggal(e.target.value)}
          />
          {!pratinjau.ok ? <p className="text-sm text-destructive">{tServer("errTANGGAL_TIDAK_SAH")}</p> : null}
        </div>
        {pratinjau.ok ? (
          <p className="text-sm text-muted-foreground">
            {pratinjau.selesaiPada
              ? t("pratinjauMulai", { mulai: pendek(pratinjau.mulai), selesai: pendek(pratinjau.selesaiPada) })
              : t("pratinjauMulaiKosong", { mulai: pendek(pratinjau.mulai) })}
          </p>
        ) : null}
        {pratinjau.ok && mode === "MUNDUR" ? (
          <PeringatanMulaiLewat
            pendek={pendek}
            peringatan={peringatanJadwal({
              langkah: langkah.map((l, i) => ({ name: l.name, status: l.status, targetDate: pratinjau.target[i] ?? "" })),
              mulai: pratinjau.mulai,
              tenggat: pratinjau.tenggat,
              hariIni,
              kal,
            })}
          />
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("batal")}
        </Button>
        <Button type="button" disabled={sibuk || !pratinjau.ok} onClick={() => void simpan()}>
          {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("simpan")}
        </Button>
      </DialogFooter>
    </>
  );
}
