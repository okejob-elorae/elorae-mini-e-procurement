"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, ClipboardPaste, Loader2 } from "lucide-react";
import { tempelLinkVideoAction } from "@/app/actions/kreatif-performa";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { angkaTitik } from "@/lib/creative/angka-konten";
import { BATAS_LINK_TEMPEL, bacaLinkVideo, JENIS_ORANG_VIDEO, type JenisOrangVideo } from "@/lib/creative/link-video";
import type { HasilTempelLink } from "@/lib/creative/tempel-link-writer";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
import { bangunkanEkstensi } from "./bangunkan-ekstensi";

type HasilBerhasil = Extract<HasilTempelLink, { ok: true }>;

/**
 * "Tempel link": satu langkah untuk menambah video KOL/afiliasi ke Performa
 * video. Link dihitung di peramban saat diketik (pembaca yang sama dengan
 * server, `link-video.ts`); server yang membuka link pendek, membuat orang dan
 * kolaborasinya bila belum ada, dan mengantrekan cek pertamanya.
 */
export function DialogTempelLink() {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [teks, setTeks] = useState("");
  const [jenis, setJenis] = useState<JenisOrangVideo>("AFILIASI");
  const [hasil, setHasil] = useState<HasilBerhasil | null>(null);
  const [sibuk, mulai] = useTransition();
  const baca = useMemo(() => bacaLinkVideo(teks), [teks]);

  const reset = () => {
    setTeks("");
    setHasil(null);
  };

  const kirim = () =>
    mulai(async () => {
      const r = await tempelLinkVideoAction({ teks, jenis });
      if (!r.ok) {
        toast.error(r.kode === "TERLALU_BANYAK" ? t("performa.err.TERLALU_BANYAK", { n: BATAS_LINK_TEMPEL }) : td(`performa.err.${r.kode}`));
        return;
      }
      setHasil(r);
      if (r.ditambahkan > 0 || r.kolBaru > 0) router.refresh();
      if (r.ditambahkan > 0) bangunkanEkstensi();
    });

  const terlaluBanyak = baca.link.length > BATAS_LINK_TEMPEL;

  return (
    <>
      <Button
        onClick={() => {
          // Dikosongkan saat dibuka, bukan saat ditutup — supaya isinya tidak berganti selama animasi tutup.
          reset();
          setBuka(true);
        }}
      >
        <ClipboardPaste className="h-4 w-4" aria-hidden />
        {t("performa.tempel")}
      </Button>
      <Dialog open={buka} onOpenChange={(v) => (sibuk ? undefined : setBuka(v))}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("performa.dialog.judul")}</DialogTitle>
          </DialogHeader>

          {!hasil ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                kirim();
              }}
            >
              <div className="space-y-2">
                <Label id="tempel-jenis">{t("performa.dialog.jenis")}</Label>
                <div role="radiogroup" aria-labelledby="tempel-jenis" className="grid grid-cols-2 gap-2">
                  {JENIS_ORANG_VIDEO.map((j) => (
                    <Button
                      key={j}
                      type="button"
                      role="radio"
                      aria-checked={jenis === j}
                      variant={jenis === j ? "default" : "outline"}
                      disabled={sibuk}
                      onClick={() => setJenis(j)}
                    >
                      {td(`performa.dialog.jenis${j}`)}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tempel-teks">{t("performa.dialog.link")}</Label>
                <Textarea
                  id="tempel-teks"
                  rows={12}
                  className="min-h-56 font-mono text-sm"
                  placeholder={t("performa.dialog.placeholder")}
                  value={teks}
                  disabled={sibuk}
                  onChange={(e) => setTeks(e.target.value)}
                  aria-describedby="tempel-hitung"
                />
                <p id="tempel-hitung" className={cn("text-xs tabular-nums text-muted-foreground", terlaluBanyak && "text-destructive")}>
                  {terlaluBanyak
                    ? t("performa.err.TERLALU_BANYAK", { n: BATAS_LINK_TEMPEL })
                    : [
                        t("performa.dialog.hitung", { n: angkaTitik(baca.link.length) }),
                        baca.ditolak.length ? t("performa.dialog.hitungDitolak", { n: angkaTitik(baca.ditolak.length) }) : null,
                        baca.kembar ? t("performa.dialog.hitungKembar", { n: angkaTitik(baca.kembar) }) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setBuka(false)} disabled={sibuk}>
                  {t("performa.dialog.batal")}
                </Button>
                <Button type="submit" disabled={sibuk || terlaluBanyak || (baca.link.length === 0 && baca.ditolak.length === 0)}>
                  {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {sibuk ? t("performa.dialog.menambahkan") : t("performa.dialog.kirim")}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <ul className="space-y-1.5 text-sm" aria-live="polite">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  <span className="tabular-nums">{t("performa.hasil.ditambahkan", { n: angkaTitik(hasil.ditambahkan) })}</span>
                </li>
                {hasil.kolBaru > 0 ? <li className="pl-6 tabular-nums">{t("performa.hasil.kolBaru", { n: angkaTitik(hasil.kolBaru) })}</li> : null}
                {hasil.sudahAda > 0 ? <li className="pl-6 tabular-nums">{t("performa.hasil.sudahAda", { n: angkaTitik(hasil.sudahAda) })}</li> : null}
                {hasil.kembar > 0 ? <li className="pl-6 tabular-nums">{t("performa.hasil.kembar", { n: angkaTitik(hasil.kembar) })}</li> : null}
              </ul>
              {hasil.gagal.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">{t("performa.hasil.gagal", { n: angkaTitik(hasil.gagal.length) })}</p>
                  <ul className="max-h-[40vh] space-y-2 overflow-y-auto rounded-md border p-3 text-sm">
                    {hasil.gagal.map((g, i) => (
                      <li key={`${g.baris}-${i}`} className="space-y-0.5">
                        <p className="break-all font-mono text-xs">{g.baris}</p>
                        <p className="text-xs text-muted-foreground">{td(`performa.alasan.${g.alasan}`)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={reset}>
                  {t("performa.dialog.lagi")}
                </Button>
                <Button type="button" onClick={() => setBuka(false)}>
                  {t("performa.dialog.tutup")}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
