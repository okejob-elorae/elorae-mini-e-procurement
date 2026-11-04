"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { pasangTemplatAkunAction, pratinjauTemplatAkunAction } from "@/app/actions/finance-saldo-awal";
import { NAMA_TEMPLAT_AKUN } from "@/lib/finance/templat-akun/templat";
import type { RencanaTemplat } from "@/lib/finance/templat-akun/rencana";

export type RingkasTemplatAkun = { akunBaru: number; peranBaru: number; konflik: number };

/**
 * Kartu "Pasang templat" di Bagan Akun: sekali klik membuat akun templat yang
 * kodenya belum ada dan memetakan peran posting yang masih kosong. Pemetaan
 * yang sudah ada tidak pernah diubah. Rencana lengkapnya dibaca ulang saat
 * dialog dibuka, dan sekali lagi di dalam transaksi pemasangan.
 */
export function KartuTemplatAkun({ ringkas }: { ringkas: RingkasTemplatAkun }) {
  const t = useTranslations("templatAkun");
  const tPeran = useTranslations("financeAccountMapping.role");
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const [rencana, setRencana] = useState<RencanaTemplat | null>(null);
  const [memuat, mulaiMuat] = useTransition();
  const [memasang, mulaiPasang] = useTransition();

  const lengkap = ringkas.akunBaru + ringkas.peranBaru === 0;

  const bukaDialog = () => {
    setBuka(true);
    setRencana(null);
    mulaiMuat(async () => {
      const r = await pratinjauTemplatAkunAction();
      if (!r.ok) {
        toast.error(t(`galat.${r.kode}`));
        setBuka(false);
        return;
      }
      setRencana(r.rencana);
    });
  };

  const pasang = () =>
    mulaiPasang(async () => {
      const r = await pasangTemplatAkunAction();
      if (!r.ok) {
        toast.error(t(`galat.${r.kode}`));
        return;
      }
      toast.success(t("sukses", { akun: r.akunDibuat, peran: r.peranDipetakan }));
      setBuka(false);
      router.refresh();
    });

  const kosong = rencana !== null && rencana.akunBaru.length === 0 && rencana.pemetaanBaru.length === 0;

  return (
    <>
      <Card className="py-0">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <LayoutTemplate className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">{t("judul", { nama: NAMA_TEMPLAT_AKUN })}</p>
            <p className="text-sm text-muted-foreground">
              {lengkap ? t("sudah") : t("ringkas", { akun: ringkas.akunBaru, peran: ringkas.peranBaru })}
              {ringkas.konflik > 0 ? ` · ${t("konflik", { n: ringkas.konflik })}` : ""}
            </p>
          </div>
          <Button variant={lengkap ? "outline" : "default"} onClick={bukaDialog}>
            {lengkap ? t("lihat") : t("tombol")}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={buka} onOpenChange={(o) => !memasang && setBuka(o)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("dialog.judul", { nama: NAMA_TEMPLAT_AKUN })}</DialogTitle>
            <DialogDescription>{t("dialog.deskripsi")}</DialogDescription>
          </DialogHeader>
          {memuat || !rencana ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("dialog.memuat")}
            </p>
          ) : kosong ? (
            <p className="text-sm text-muted-foreground">{t("dialog.kosong")}</p>
          ) : (
            <div className="space-y-4 text-sm">
              {rencana.akunBaru.length > 0 ? (
                <section className="space-y-1">
                  <p className="font-medium">{t("dialog.akunBaru", { n: rencana.akunBaru.length })}</p>
                  <ul className="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
                    {rencana.akunBaru.map((a) => (
                      <li key={a.kode}>
                        <span className="font-mono text-xs text-muted-foreground">{a.kode}</span> {a.nama}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {rencana.pemetaanBaru.length > 0 ? (
                <section className="space-y-1">
                  <p className="font-medium">{t("dialog.peranBaru", { n: rencana.pemetaanBaru.length })}</p>
                  <ul className="space-y-0.5">
                    {rencana.pemetaanBaru.map((p) => (
                      <li key={p.peran}>
                        {tPeran(p.peran)} → <span className="font-mono text-xs text-muted-foreground">{p.kode}</span> {p.nama}
                        {p.akunBaru ? <span className="text-muted-foreground"> · {t("baru")}</span> : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
          {rencana && rencana.konflik.length > 0 ? (
            <section className="space-y-1 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-400">{t("dialog.konflik", { n: rencana.konflik.length })}</p>
              <ul className="space-y-0.5 text-muted-foreground">
                {rencana.konflik.map((k) => (
                  <li key={`${k.kode}-${k.sebab}`}>
                    <span className="font-mono text-xs">{k.kode}</span> {k.nama} — {t(`sebab.${k.sebab}`)}
                    {k.peran.length > 0 ? ` (${k.peran.map((p) => tPeran(p)).join(", ")})` : ""}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {rencana && rencana.peranSudahDipetakan.length > 0 ? (
            <p className="text-sm text-muted-foreground">{t("dialog.tetap", { n: rencana.peranSudahDipetakan.length })}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuka(false)} disabled={memasang}>
              {t("dialog.tutup")}
            </Button>
            {!kosong ? (
              <Button onClick={pasang} disabled={memasang || memuat || !rencana}>
                {memasang ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {t("dialog.pasang")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
