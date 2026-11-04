"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CopyCheck, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { cekKembarAction } from "@/app/actions/kreatif-kol";
import type { KelompokKembarKol } from "@/lib/creative/kol-queries";
import { BATAS_KELOMPOK_KEMBAR } from "@/lib/creative/kol-aturan";
import { angkaPenuh, pesanGagalKol, ringkasAngka } from "./format-kol";

/**
 * "Cek kembar": semua KOL aktif yang nomor WA-nya sama (sesudah dinormalkan)
 * atau username-nya sama di platform mana pun, per kelompok. Kelompok yang
 * sudah lebih dari sekali dikirimi barang diberi tanda merah.
 */
export function TombolCekKembar() {
  const t = useTranslations("kreatifRuang");
  const tc = useTranslations("creative");
  const [buka, setBuka] = useState(false);
  const [hasil, setHasil] = useState<{ kelompok: KelompokKembarKol[]; terpotong: boolean } | null>(null);
  const [memuat, startMuat] = useTransition();

  const bukaDanPeriksa = () => {
    setBuka(true);
    setHasil(null);
    startMuat(async () => {
      const r = await cekKembarAction();
      if (!r.ok) {
        toast.error(pesanGagalKol(t, r.kode));
        setBuka(false);
        return;
      }
      setHasil({ kelompok: r.kelompok, terpotong: r.terpotong });
    });
  };

  return (
    <>
    <Button variant="outline" onClick={bukaDanPeriksa}>
      <CopyCheck className="mr-1.5 h-4 w-4" />
      {t("kol.cekKembar")}
    </Button>
    <Dialog open={buka} onOpenChange={setBuka}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("kol.cekKembarDlg.judul")}</DialogTitle>
        </DialogHeader>
        {memuat || !hasil ? (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("kol.cekKembarDlg.memuat")}
          </p>
        ) : hasil.kelompok.length === 0 ? (
          <EmptyState icon={Users} title={t("kol.cekKembarDlg.kosong")} />
        ) : (
          <div className="space-y-3">
            {hasil.kelompok.map((g, i) => (
              <div key={g.anggota.map((a) => a.id).join("-") || i} className="rounded-md border">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase tracking-wide">
                  {g.nomorSama && <span>{t("kol.cekKembarDlg.nomorSama", { nomor: g.nomorSama })}</span>}
                  {g.handleSama && <span>{t("kol.cekKembarDlg.handleSama", { handle: g.handleSama })}</span>}
                  {g.kirimTotal > 1 && (
                    <span className="normal-case text-red-600 dark:text-red-400">{t("kol.cekKembarDlg.kirimN", { n: g.kirimTotal })}</span>
                  )}
                </div>
                <ul className="divide-y">
                  {g.anggota.map((a) => {
                    const utama = a.akun[0];
                    return (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {utama ? `@${utama.handle}` : a.nama}
                            {a.diblokir && (
                              <StatusPill tone="attention" className="ml-2 align-middle">
                                {t("kol.diblokirPill")}
                              </StatusPill>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {[
                              a.nama,
                              utama ? `${tc(`platform${utama.platform}`)} · ${ringkasAngka(utama.followers)}` : null,
                              t("kol.cekKembarDlg.anggota", { kolab: angkaPenuh(a.jumlahKolaborasi), kirim: angkaPenuh(a.jumlahKirim) }),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/backoffice/kreatif/kol/${a.id}`}>{t("kol.cekKembarDlg.buka")}</Link>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {hasil.terpotong && (
              <p className="text-xs text-muted-foreground">{t("kol.cekKembarDlg.terpotong", { n: BATAS_KELOMPOK_KEMBAR })}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
