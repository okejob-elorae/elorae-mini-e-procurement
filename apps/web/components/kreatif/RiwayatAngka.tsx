"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { riwayatAngkaAction } from "@/app/actions/kreatif-konten";
import { angkaTitik } from "@/lib/creative/angka-konten";
import { KOLOM_ANGKA } from "@/lib/creative/konten-kol";
import type { BarisAngka } from "@/lib/creative/konten-kol-queries";
import { formatDisplayDate } from "@/lib/date-only";

/** Tabel semua baris angka satu konten, terbaru dulu. */
export function TabelRiwayatAngka({ baris }: { baris: BarisAngka[] }) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const locale = useLocale();
  if (baris.length === 0) return <p className="py-3 text-center text-sm text-muted-foreground">{t("angka.belumAda")}</p>;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("kolom.tanggal")}</TableHead>
            {KOLOM_ANGKA.map((k) => (
              <TableHead key={k} className="text-right">
                {t(`kolom.${k}`)}
              </TableHead>
            ))}
            <TableHead>{t("kolom.oleh")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {baris.map((b) => (
            <TableRow key={b.id}>
              <TableCell className="text-sm tabular-nums">
                {formatDisplayDate(b.recordedAt, locale)}
                {b.sumber || b.catatan ? (
                  <span className="block max-w-48 truncate text-xs text-muted-foreground" title={[b.sumber, b.catatan].filter(Boolean).join(" · ")}>
                    {[b.sumber, b.catatan].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
              </TableCell>
              {KOLOM_ANGKA.map((k) => (
                <TableCell key={k} className="text-right text-sm tabular-nums">
                  {angkaTitik(b[k])}
                </TableCell>
              ))}
              <TableCell className="text-xs text-muted-foreground">{b.pencatat ?? "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Tombol kecil yang membuka riwayat angka satu konten (dimuat saat dibuka). */
export function RiwayatAngkaPopover({ kontenId, jumlah }: { kontenId: string; jumlah: number }) {
  const t = useTranslations("kreatifRuang.kontenKol");
  const [baris, setBaris] = useState<BarisAngka[] | null>(null);
  const [galat, setGalat] = useState(false);

  const muat = () => {
    setBaris(null);
    setGalat(false);
    riwayatAngkaAction(kontenId)
      .then((r) => (r.ok ? setBaris(r.baris) : setGalat(true)))
      .catch(() => setGalat(true));
  };

  return (
    <Popover onOpenChange={(o) => o && muat()}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={jumlah === 0}
          aria-label={t("angka.riwayat", { n: jumlah })}
          title={t("angka.riwayat", { n: jumlah })}
        >
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,600px)] p-2">
        <p className="px-2 pb-1 text-sm font-medium">{t("angka.riwayat", { n: jumlah })}</p>
        {galat ? (
          <p className="py-3 text-center text-sm text-destructive">{t("err.GAGAL")}</p>
        ) : baris === null ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <TabelRiwayatAngka baris={baris} />
        )}
      </PopoverContent>
    </Popover>
  );
}
