"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { simpanKontenKolAction, type IsianKontenKolAksi } from "@/app/actions/kreatif-konten";
import {
  platformDariLink,
  SEMUA_FORMAT_KONTEN,
  SEMUA_PLATFORM_KONTEN,
  sahLink,
  type FormatKonten,
  type PlatformKol,
} from "@/lib/creative/konten-kol";
import type { KontenPanel } from "@/lib/creative/konten-kol-queries";
import { useKabarKonten } from "./kabar-konten";

type Isian = {
  platform: PlatformKol;
  format: FormatKonten;
  link: string;
  liveAt: string;
  draftLink: string;
  plannedAt: string;
  adCode: string;
  adCodeUntil: string;
};

function awal(k: KontenPanel | null): Isian {
  return {
    platform: (k?.platform as PlatformKol) ?? "TIKTOK",
    format: (k?.format as FormatKonten) ?? "VIDEO",
    link: k?.link ?? "",
    liveAt: k?.tayangHari ?? "",
    draftLink: k?.draftLink ?? "",
    plannedAt: k?.rencanaHari ?? "",
    adCode: k?.adCode ?? "",
    adCodeUntil: k?.adCodeSampai ?? "",
  };
}

/**
 * Tambah/ubah satu konten. Saat mengubah, HANYA kolom yang berubah yang
 * dikirim — penulisnya tidak menyentuh kolom yang tidak dikirim.
 */
export function DialogKontenKol({
  kolaborasiId,
  konten,
  buka,
  onBuka,
}: {
  kolaborasiId: string;
  /** null = konten baru. */
  konten: KontenPanel | null;
  buka: boolean;
  onBuka: (buka: boolean) => void;
}) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const tc = useTranslations("creative");
  const router = useRouter();
  const kabar = useKabarKonten();
  const [isi, setIsi] = useState<Isian>(() => awal(konten));
  const [pending, start] = useTransition();
  const [kunci, setKunci] = useState<string | null>(null);
  // Isian dimulai ulang setiap kali dialog dibuka untuk konten lain.
  const kunciSekarang = `${buka}-${konten?.id ?? "baru"}`;
  if (kunci !== kunciSekarang) {
    setKunci(kunciSekarang);
    setIsi(awal(konten));
  }

  const ubah = <K extends keyof Isian>(k: K, v: Isian[K]) => setIsi((s) => ({ ...s, [k]: v }));
  const linkSalah = (v: string) => Boolean(v.trim()) && !sahLink(v);

  const simpan = () => {
    if (linkSalah(isi.link) || linkSalah(isi.draftLink)) {
      kabar.gagal("LINK_TIDAK_SAH");
      return;
    }
    const lama = awal(konten);
    const kirim: IsianKontenKolAksi = { id: konten?.id ?? null, kolaborasiId };
    const beda = <K extends keyof Isian>(k: K) => !konten || isi[k] !== lama[k];
    if (beda("platform")) kirim.platform = isi.platform;
    if (beda("format")) kirim.format = isi.format;
    if (beda("link")) kirim.link = isi.link.trim() || null;
    if (beda("liveAt")) kirim.liveAt = isi.liveAt || null;
    if (beda("draftLink")) kirim.draftLink = isi.draftLink.trim() || null;
    if (beda("plannedAt")) kirim.plannedAt = isi.plannedAt || null;
    if (beda("adCode")) kirim.adCode = isi.adCode.trim() || null;
    if (beda("adCodeUntil")) kirim.adCodeUntil = isi.adCodeUntil || null;
    start(async () => {
      const r = await simpanKontenKolAction(kirim);
      if (r.ok) {
        kabar.sukses(konten ? "kontenKol.ok.diubah" : "kontenKol.ok.dicatat", r.maju);
        onBuka(false);
        router.refresh();
      } else {
        kabar.gagal(r.kode);
      }
    });
  };

  return (
    <Dialog open={buka} onOpenChange={onBuka}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{konten ? t("dialog.ubah") : t("dialog.tambah")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t("dialog.platform")}</Label>
              <Select value={isi.platform} onValueChange={(v) => ubah("platform", v as PlatformKol)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEMUA_PLATFORM_KONTEN.map((p) => (
                    <SelectItem key={p} value={p}>
                      {tc(`platform${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("dialog.format")}</Label>
              <Select value={isi.format} onValueChange={(v) => ubah("format", v as FormatKonten)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEMUA_FORMAT_KONTEN.map((f) => (
                    <SelectItem key={f} value={f}>
                      {tc(`format${f}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <Label htmlFor="konten-link">{t("dialog.link")}</Label>
              <Input
                id="konten-link"
                value={isi.link}
                inputMode="url"
                placeholder="https://"
                aria-invalid={linkSalah(isi.link)}
                onChange={(e) => {
                  const v = e.target.value;
                  ubah("link", v);
                  const p = platformDariLink(v);
                  if (p && !konten) ubah("platform", p);
                }}
              />
              {linkSalah(isi.link) ? <p className="text-xs text-destructive">{t("err.LINK_TIDAK_SAH")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="konten-tayang">{t("dialog.tanggalTayang")}</Label>
              <TanggalInput id="konten-tayang" value={isi.liveAt} onChange={(e) => ubah("liveAt", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <Label htmlFor="konten-draf">{t("dialog.linkDraf")}</Label>
              <Input
                id="konten-draf"
                value={isi.draftLink}
                inputMode="url"
                placeholder="https://"
                aria-invalid={linkSalah(isi.draftLink)}
                onChange={(e) => ubah("draftLink", e.target.value)}
              />
              {linkSalah(isi.draftLink) ? <p className="text-xs text-destructive">{t("err.LINK_TIDAK_SAH")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="konten-rencana">{t("dialog.rencana")}</Label>
              <TanggalInput id="konten-rencana" value={isi.plannedAt} onChange={(e) => ubah("plannedAt", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <div className="space-y-1.5">
              <Label htmlFor="konten-iklan">{t("dialog.kodeIklan")}</Label>
              <Input id="konten-iklan" value={isi.adCode} maxLength={191} onChange={(e) => ubah("adCode", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="konten-iklan-sampai">{t("dialog.kodeIklanSampai")}</Label>
              <TanggalInput id="konten-iklan-sampai" value={isi.adCodeUntil} onChange={(e) => ubah("adCodeUntil", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onBuka(false)} disabled={pending}>
            {t("batal")}
          </Button>
          <Button onClick={simpan} disabled={pending}>
            {t("simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
