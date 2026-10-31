"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah } from "@/lib/format/rupiah";
import { bacaKunciBulan, bulanSebelum, kunciBulan, labelBulan } from "@/lib/finance/periode/periode";
import { postingPenyusutanAction } from "@/app/actions/finance-aset";
import { pesanGalatAset } from "./pesan";

/** Bulan terakhir yang sudah berakhir ("YYYY-MM", bulan lalu dari `bulanIni`) — bulan berjalan tidak bisa disusutkan. */
function bulanTerakhirSelesai(bulanIni: string): string {
  const tb = bacaKunciBulan(bulanIni);
  return tb ? kunciBulan(bulanSebelum(tb)) : bulanIni;
}

/** Bulan terakhir yang sudah berakhir dan sebelas bulan sebelumnya ("YYYY-MM"), terbaru dulu. */
function duaBelasBulan(bulanIni: string): string[] {
  const awal = bacaKunciBulan(bulanTerakhirSelesai(bulanIni));
  if (!awal) return [bulanIni];
  const hasil: string[] = [];
  let tb = awal;
  for (let i = 0; i < 12; i++) {
    hasil.push(kunciBulan(tb));
    tb = bulanSebelum(tb);
  }
  return hasil;
}

type Props = {
  /** "YYYY-MM" bulan ini (WIB). */
  bulanIni: string;
  /** Hanya aset ini (halaman rincian); tanpa = semua aset. */
  asetIds?: string[];
  /** Aset yang bulan lalu (bulan terakhir yang sudah berakhir) belum disusutkan (halaman daftar). */
  jumlahTertunda?: number;
  variant?: "default" | "outline";
};

/** Tombol + dialog "Posting penyusutan" — dipakai daftar aset dan rincian satu aset. */
export function DialogPostingPenyusutan({ bulanIni, asetIds, jumlahTertunda, variant = "default" }: Props) {
  const t = useTranslations("asetTetap");
  const locale = useLocale();
  const router = useRouter();
  const [buka, setBuka] = useState(false);
  const terakhir = bulanTerakhirSelesai(bulanIni);
  const [bulan, setBulan] = useState(terakhir);
  const [pending, mulai] = useTransition();

  const pilihan = duaBelasBulan(bulanIni);

  const label = (k: string) => {
    const tb = bacaKunciBulan(k);
    return tb ? labelBulan(tb, locale) : k;
  };

  const kirim = () =>
    mulai(async () => {
      const r = await postingPenyusutanAction({ bulan, ...(asetIds ? { asetIds } : {}) });
      if (!r.ok) {
        toast.error(pesanGalatAset(t, r.kode, "peran" in r ? r.peran : undefined));
        return;
      }
      if (r.diposting > 0) toast.success(t("posting.hasil", { n: r.diposting, total: formatRupiah(r.totalNilai) }));
      else if (r.gagal.length === 0) toast.info(t("posting.tidakAda"));
      if (r.periodeDitutup > 0) toast.info(t("posting.ditutup", { n: r.periodeDitutup }));
      if (r.gagal.length > 0) {
        const peran = r.gagal.find((g) => g.peran)?.peran;
        toast.error(
          t("posting.gagal", { n: r.gagal.length, daftar: r.gagal.slice(0, 3).map((g) => `${g.kode} ${g.periode}`).join(", ") }) +
            (peran ? ` ${t("err.UNMAPPED_ROLE", { peran })}` : ""),
        );
      }
      setBuka(false);
      router.refresh();
    });

  return (
    <>
      <Button variant={variant} onClick={() => setBuka(true)}>
        <CalendarClock className="mr-2 h-4 w-4" />
        {t("posting.judul")}
      </Button>
      <Dialog open={buka} onOpenChange={(v) => !pending && setBuka(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("posting.judul")}</DialogTitle>
            <DialogDescription>{t("posting.isi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bulan-penyusutan">{t("posting.bulan")}</Label>
              <Select value={bulan} onValueChange={setBulan} disabled={pending}>
                <SelectTrigger id="bulan-penyusutan" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pilihan.map((k) => (
                    <SelectItem key={k} value={k}>
                      {label(k)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {jumlahTertunda != null && jumlahTertunda > 0 && bulan === terakhir ? (
              <p className="text-sm text-muted-foreground">{t("posting.tertunda", { n: jumlahTertunda, bulan: label(terakhir) })}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuka(false)} disabled={pending}>
              {t("batal")}
            </Button>
            <Button onClick={kirim} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pending ? t("posting.memposting") : t("posting.tombol")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
