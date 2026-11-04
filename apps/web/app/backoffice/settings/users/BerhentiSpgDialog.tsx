"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { aturMulaiSpgAction, batalkanSpgBerhentiAction, tandaiSpgBerhentiAction } from "@/app/actions/settings/spg-berhenti";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { dinamis } from "@/lib/i18n/dinamis";

export type SpgPengguna = {
  id: string;
  nama: string;
  mulai: string | null;
  berhenti: string | null;
  tokoBerhenti: string | null;
  aktif: boolean;
  /** Bulan kerja yang gaji & komisinya sudah dibayar ("YYYY-MM"). */
  bulanDibayar: string[];
};

type Mode = "MULAI" | "BERHENTI" | "BATAL";

const hariIniWib = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const tanggal = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
const namaBulan = (b: string) => new Date(`${b}-01T00:00:00+07:00`).toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "Asia/Jakarta" });

/**
 * Tanggal mulai bekerja, "SPG berhenti", dan pembatalannya (B27, P62, P66) dari baris Pengguna.
 * Semua tombol = `settings_security:manage` (halaman ini sendiri sudah memerlukannya). SPG tidak
 * pernah pindah toko: yang berhenti ditandai berhenti, bukan dipindah.
 */
export function SpgBerhentiAksi({ spg }: { spg: SpgPengguna }) {
  const t = useTranslations("settings.users.spg");
  const td = dinamis(useTranslations("settings.users.spg"));
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [mode, setMode] = useState<Mode | null>(null);
  const [hari, setHari] = useState(hariIniWib());
  const [alasan, setAlasan] = useState("");

  const buka = (m: Mode) => {
    setHari(m === "MULAI" ? (spg.mulai ?? hariIniWib()) : hariIniWib());
    setAlasan("");
    setMode(m);
  };

  const kirim = () =>
    mulai(async () => {
      try {
        const r =
          mode === "MULAI"
            ? await aturMulaiSpgAction({ userId: spg.id, mulai: hari })
            : mode === "BERHENTI"
              ? await tandaiSpgBerhentiAction({ userId: spg.id, hariTerakhir: hari, alasan })
              : await batalkanSpgBerhentiAction({ userId: spg.id, alasan });
        if (!r.ok) {
          toast.error(td(`err.${r.code}`));
          return;
        }
        toast.success(td(`ok.${mode}`));
        setMode(null);
        router.refresh();
      } catch {
        toast.error(td("err.GAGAL"));
      }
    });

  return (
    <div className="mt-1 space-y-1 text-xs text-muted-foreground">
      <p>{spg.mulai ? t("mulai", { tanggal: tanggal(spg.mulai) }) : <span className="text-amber-800 dark:text-amber-300">{t("tanpaMulai")}</span>}</p>
      {spg.berhenti ? <p className="text-amber-800 dark:text-amber-300">{t("berhenti", { tanggal: tanggal(spg.berhenti), toko: spg.tokoBerhenti ?? "—" })}</p> : null}
      <div className="flex flex-wrap gap-1">
        <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => buka("MULAI")}>
          {t("aturMulai")}
        </Button>
        {spg.berhenti ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => buka("BATAL")}>
            {t("batalBerhenti")}
          </Button>
        ) : spg.aktif ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => buka("BERHENTI")}>
            {t("tandaiBerhenti")}
          </Button>
        ) : null}
      </div>

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !sibuk && setMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{mode ? td(`judul.${mode}`, { nama: spg.nama }) : ""}</DialogTitle>
            <DialogDescription>{mode ? td(`isi.${mode}`) : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {mode === "MULAI" || mode === "BERHENTI" ? (
              <div className="space-y-2">
                <Label htmlFor="spg-hari">{mode === "MULAI" ? t("labelMulai") : t("labelTerakhir")}</Label>
                <TanggalInput id="spg-hari" value={hari} max={hariIniWib()} required onChange={(e) => setHari(e.target.value)} />
              </div>
            ) : null}
            {mode === "BERHENTI" && hari && spg.bulanDibayar.includes(hari.slice(0, 7)) ? (
              // Bulan itu sudah dibayar penuh: pembayarannya dibiarkan, tidak dihitung ulang dengan
              // hari terakhir ini (tinjauan rancangan akhir butir 10, menunggu jawaban pemilik).
              <p className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">{t("bulanSudahDibayar", { bulan: namaBulan(hari.slice(0, 7)) })}</p>
            ) : null}
            {mode === "BERHENTI" || mode === "BATAL" ? (
              <div className="space-y-2">
                <Label htmlFor="spg-alasan">{t("alasan")}</Label>
                <Textarea id="spg-alasan" rows={3} maxLength={500} value={alasan} onChange={(e) => setAlasan(e.target.value)} />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={sibuk} onClick={() => setMode(null)}>
              {t("tutup")}
            </Button>
            <Button
              type="button"
              variant={mode === "BERHENTI" ? "destructive" : "default"}
              disabled={sibuk || ((mode === "MULAI" || mode === "BERHENTI") && !hari) || ((mode === "BERHENTI" || mode === "BATAL") && !alasan.trim())}
              onClick={kirim}
            >
              {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {mode ? td(`tombol.${mode}`) : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
