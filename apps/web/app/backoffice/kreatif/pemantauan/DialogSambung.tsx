"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2 } from "lucide-react";
import { buatKodeSambungAction } from "@/app/actions/kreatif-pantau";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NAMA_PERANGKAT_MAKS } from "@/lib/creative/pantau-aturan";
import { dinamis } from "@/lib/i18n/dinamis";

/**
 * Sambungkan perangkat: nama → kode 8 tanda. Kodenya hanya hidup di keadaan
 * dialog ini — tidak pernah disimpan di peramban — dan hilang begitu dialog
 * ditutup. Dengan `perangkatId`, kode baru dibuat untuk perangkat yang sudah
 * ada (sambung ulang) — tetap lewat tombol, tidak otomatis saat dialog dibuka.
 */
export function DialogSambung({
  perangkatId,
  nama: namaAwal,
  onTutup,
}: {
  perangkatId?: string;
  nama?: string;
  onTutup: (berubah: boolean) => void;
}) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const locale = useLocale();
  const [nama, setNama] = useState("");
  const [hasil, setHasil] = useState<{ kode: string; berlakuSampai: string; nama: string } | null>(null);
  const [sibuk, mulai] = useTransition();
  // Dialog ini hanya dirender di peramban (dibuka lewat klik), jadi `window` selalu ada.
  const [alamat] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));

  const buat = (input: { nama?: string; perangkatId?: string }) =>
    mulai(async () => {
      const r = await buatKodeSambungAction(input);
      if (r.ok) setHasil({ kode: r.kode, berlakuSampai: r.berlakuSampai, nama: r.nama });
      else toast.error(td(`pantau.err.${r.kode}`));
    });

  const salin = async (teks: string) => {
    try {
      await navigator.clipboard.writeText(teks);
      toast.success(t("pantau.sambung.disalin"));
    } catch {
      toast.error(t("pantau.sambung.gagalSalin"));
    }
  };

  const jam = (iso: string) =>
    new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(new Date(iso));

  return (
    <Dialog open onOpenChange={(b) => !b && !sibuk && onTutup(hasil !== null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{perangkatId ? t("pantau.sambung.judulUlang", { nama: namaAwal ?? "" }) : t("pantau.sambung.judul")}</DialogTitle>
          {hasil ? <DialogDescription>{t("pantau.sambung.sekaliTampil")}</DialogDescription> : null}
        </DialogHeader>

        {hasil ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">{t("pantau.sambung.kode")}</p>
              <div className="flex items-center gap-2">
                <output
                  className="flex-1 rounded-md border bg-muted px-3 py-2 text-center font-mono text-2xl font-semibold tracking-[0.3em] tabular-nums"
                  aria-live="polite"
                >
                  {hasil.kode}
                </output>
                <Button type="button" variant="outline" size="icon" onClick={() => salin(hasil.kode)} aria-label={t("pantau.sambung.salinKode")}>
                  <Copy className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("pantau.sambung.berlaku", { jam: jam(hasil.berlakuSampai) })}</p>
            </div>
            {alamat ? (
              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">{t("pantau.sambung.alamat")}</p>
                <div className="flex items-center gap-2">
                  <output className="min-w-0 flex-1 truncate rounded-md border px-3 py-2 font-mono text-sm">{alamat}</output>
                  <Button type="button" variant="outline" size="icon" onClick={() => salin(alamat)} aria-label={t("pantau.sambung.salinAlamat")}>
                    <Copy className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <form
            id="form-sambung"
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              buat(perangkatId ? { perangkatId } : { nama });
            }}
          >
            {perangkatId ? (
              <p className="text-sm">{t("pantau.sambung.ulangIsi")}</p>
            ) : (
              <>
                <Label htmlFor="nama-perangkat">{t("pantau.sambung.nama")}</Label>
                <Input
                  id="nama-perangkat"
                  value={nama}
                  maxLength={NAMA_PERANGKAT_MAKS}
                  onChange={(e) => setNama(e.target.value)}
                  placeholder={t("pantau.sambung.namaContoh")}
                  autoFocus
                  required
                />
              </>
            )}
          </form>
        )}

        <DialogFooter>
          {hasil ? (
            <Button type="button" onClick={() => onTutup(true)}>
              {t("pantau.sambung.selesai")}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onTutup(false)} disabled={sibuk}>
                {t("pantau.sambung.batal")}
              </Button>
              <Button type="submit" form="form-sambung" disabled={sibuk || (!perangkatId && !nama.trim())}>
                {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("pantau.sambung.buat")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
