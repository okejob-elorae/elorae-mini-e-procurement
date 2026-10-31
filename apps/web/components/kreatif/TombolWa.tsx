"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { catatKirimWaAction, siapkanPesanWaAction } from "@/app/actions/kreatif-wa";
import { tautanWa } from "@/lib/creative/wa";
import type { PesanWaSiap } from "@/lib/creative/wa-writer";

/*
 * Tombol WhatsApp bertemplate — SATU komponen untuk semua layar Kreatif.
 *
 * Membuka dialog berisi template yang sudah terisi data KOL/kolaborasi; klik
 * satu template membuka wa.me di tab baru (dibuka SINKRON di klik supaya tidak
 * diblokir peramban), lalu mencatat "Kirim WA: <template>" sebagai kontak
 * terakhir. Elorae tidak pernah mengirim pesan sendiri.
 */

type Props = {
  kolId: string;
  kolaborasiId?: string | null;
  bolehMengelola: boolean;
  /** "ikon" untuk baris tabel, "tombol" untuk kartu/detail. */
  bentuk?: "ikon" | "tombol";
  label?: string;
  /** Kunci template yang paling cocok untuk konteksnya (mis. "follow-up"); ditaruh paling atas dan ditandai. */
  templateAwal?: string;
};

type Siap = { nomor: string | null; namaKol: string; pesan: PesanWaSiap[] };

export function TombolWa({ kolId, kolaborasiId, bolehMengelola, bentuk = "ikon", label, templateAwal }: Props) {
  const t = useTranslations("kreatifRuang.wa");
  const [buka, setBuka] = useState(false);
  const [siap, setSiap] = useState<Siap | null>(null);
  const [memuat, startMuat] = useTransition();
  const [, startCatat] = useTransition();

  const muat = () => {
    setSiap(null);
    startMuat(async () => {
      const r = await siapkanPesanWaAction({ kolId, kolaborasiId: kolaborasiId ?? null });
      if (!r.ok) {
        toast.error(t(r.kode === "TANPA_AKSES" ? "errAkses" : "errMuat"));
        setBuka(false);
        return;
      }
      const pesan = templateAwal
        ? [...r.pesan.filter((p) => p.kunci === templateAwal), ...r.pesan.filter((p) => p.kunci !== templateAwal)]
        : r.pesan;
      setSiap({ nomor: r.nomor, namaKol: r.namaKol, pesan });
    });
  };

  const kirim = (pesan: PesanWaSiap | null) => {
    if (!siap?.nomor) return;
    const url = tautanWa(siap.nomor, pesan?.isi ?? null);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    setBuka(false);
    if (!bolehMengelola) return;
    startCatat(async () => {
      const r = await catatKirimWaAction({ kolId, kolaborasiId: kolaborasiId ?? null, templateNama: pesan?.nama ?? null });
      if (r.ok) toast.success(r.tahapBaru ? t("okDicatatMaju") : t("okDicatat"));
      else toast.error(t("errCatat"));
    });
  };

  return (
    <>
      {bentuk === "ikon" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={label ?? t("tombol")}
          title={label ?? t("tombol")}
          onClick={() => {
            setBuka(true);
            muat();
          }}
        >
          <MessageCircle className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setBuka(true);
            muat();
          }}
        >
          <MessageCircle className="mr-2 h-4 w-4" />
          {label ?? t("tombol")}
        </Button>
      )}
      <Dialog open={buka} onOpenChange={setBuka}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{siap ? t("judul", { nama: siap.namaKol }) : t("tombol")}</DialogTitle>
            <DialogDescription>{siap?.nomor ? t("deskripsi") : null}</DialogDescription>
          </DialogHeader>
          {memuat || !siap ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            </div>
          ) : !siap.nomor ? (
            <div className="space-y-3">
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">{t("nomorKosong")}</p>
              {bolehMengelola ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/backoffice/kreatif/kol/${kolId}`}>{t("isiNomor")}</Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                {siap.pesan.map((p) => (
                  <li key={p.kunci}>
                    <button
                      type="button"
                      onClick={() => kirim(p)}
                      className={
                        "w-full rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" +
                        (p.kunci === templateAwal ? " border-primary/60 bg-primary/5" : "")
                      }
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {p.nama}
                        {p.kunci === templateAwal ? (
                          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium">{t("disarankan")}</span>
                        ) : null}
                      </span>
                      <span className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{p.isi}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="outline" className="w-full" onClick={() => kirim(null)}>
                {t("tanpaPesan")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
