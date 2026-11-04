"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { TombolWa } from "@/components/kreatif/TombolWa";
import { AlamatKirim, KolSampel } from "@/components/kreatif/pengiriman/InfoKirim";
import { teksBaris, teksBerhasil, teksGagal } from "@/components/kreatif/pengiriman/isian-pengiriman";
import { tandaiDiterimaAction } from "@/app/actions/kreatif-sampel";
import { formatDisplayDate } from "@/lib/date-only";
import { umurMerah } from "@/lib/creative/sampel-aturan";
import type { BarisPengirimanSampel } from "@/lib/creative/sampel-queries";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";

type Props = {
  b: BarisPengirimanSampel;
  tab: "dalam-perjalanan" | "sudah-sampai";
  /** Dalam perjalanan: kirim → terima; Sudah sampai: terima → tayang. */
  ambangHari: number;
  hariIni: string;
  bolehMengelola: boolean;
  onSelesai: () => void;
};

/** Kurir di atas, nomor resi (atau "tanpa resi") di bawah, tanggal kirim di bawahnya lagi. */
export function SelResi({ b }: { b: Pick<BarisPengirimanSampel, "courier" | "trackingNo" | "tanpaResi" | "sentAt"> }) {
  const t = useTranslations("kreatifRuang.sampel");
  const locale = useLocale();
  return (
    <div className="min-w-0 text-sm">
      {b.courier ? <div className="text-xs text-muted-foreground">{b.courier}</div> : null}
      <div className={cn("break-all", b.tanpaResi ? "text-muted-foreground italic" : "font-mono text-xs")}>
        {b.tanpaResi ? t("tanpaResiTeks") : b.trackingNo}
      </div>
      {b.sentAt ? <div className="text-xs text-muted-foreground">{t("dikirimTanggal", { tanggal: formatDisplayDate(b.sentAt, locale) })}</div> : null}
    </div>
  );
}

/**
 * Satu paket yang sudah berangkat. Dalam perjalanan: tanggal terima (bawaan
 * hari ini) + ✓ menandai sampai dan memajukan tahap. Sudah sampai: berapa
 * hari kontennya ditunggu sejak paket diterima.
 */
export function BarisPaket({ b, tab, ambangHari, hariIni, bolehMengelola, onSelesai }: Props) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const locale = useLocale();
  const [terima, setTerima] = useState(hariIni);
  const [menyimpan, mulaiSimpan] = useTransition();
  const merah = umurMerah(b.umurHari, ambangHari);

  const tandai = () => {
    if (!terima) {
      toast.error(t("sampel.err.TANGGAL_TIDAK_VALID"));
      return;
    }
    mulaiSimpan(async () => {
      const r = await tandaiDiterimaAction({ pengirimanId: b.pengirimanId, receivedAt: terima });
      if (!r.ok) {
        toast.error(teksGagal(td, r));
        return;
      }
      toast.success(teksBerhasil(td, "terima", r));
      onSelesai();
    });
  };

  return (
    <TableRow>
      <TableCell className="max-w-[220px] align-top whitespace-normal">
        <KolSampel kol={b.kol} />
        <div className="mt-1 text-xs text-muted-foreground 2xl:hidden">{b.campaign?.nama ?? t("sampel.tanpaCampaign")}</div>
      </TableCell>
      <TableCell className="hidden align-top text-sm 2xl:table-cell">
        {b.campaign?.nama ?? <span className="text-muted-foreground">{t("sampel.tanpaCampaign")}</span>}
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <AlamatKirim kol={b.kol} />
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <ul className="space-y-0.5 text-sm">
          {b.baris.map((x, i) => (
            <li key={`${x.itemId}-${x.variantSku ?? ""}-${i}`} className="break-words">
              {teksBaris(x)}
            </li>
          ))}
        </ul>
      </TableCell>
      <TableCell className="align-top">
        <SelResi b={b} />
      </TableCell>
      {tab === "dalam-perjalanan" ? (
        <>
          <TableCell className={cn("text-right align-top tabular-nums", merah && "font-bold text-destructive")}>
            {t("sampel.hari", { n: b.umurHari })}
          </TableCell>
          <TableCell className="align-top">
            {bolehMengelola ? (
              <div className="flex items-center gap-1.5">
                <TanggalInput
                  value={terima}
                  onChange={(e) => setTerima(e.target.value)}
                  min={b.sentAt ?? undefined}
                  max={hariIni}
                  required
                  aria-label={t("sampel.tanggalTerima")}
                  className="h-8 w-40"
                  disabled={menyimpan}
                />
                <Button
                  type="button"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={t("sampel.tandaiTerima")}
                  title={t("sampel.tandaiTerima")}
                  onClick={tandai}
                  disabled={menyimpan}
                >
                  {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                </Button>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">—</span>
            )}
          </TableCell>
        </>
      ) : (
        <>
          <TableCell className="align-top text-sm whitespace-nowrap">{formatDisplayDate(b.receivedAt, locale)}</TableCell>
          <TableCell className={cn("text-right align-top tabular-nums", merah && "font-bold text-destructive")}>
            {t("sampel.hari", { n: b.umurHari })}
          </TableCell>
        </>
      )}
      <TableCell className="text-right align-top">
        <div className="flex justify-end gap-1">
          <TombolWa kolId={b.kol.id} kolaborasiId={b.kolaborasiId} bolehMengelola={bolehMengelola} />
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link href={`/backoffice/kreatif/kolaborasi/${b.kolaborasiId}`} aria-label={t("sampel.bukaKolaborasi", { doc: b.docNo })} title={t("sampel.bukaKolaborasi", { doc: b.docNo })}>
              <ExternalLink className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
