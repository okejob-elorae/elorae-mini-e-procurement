"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, ChevronUp, PackageOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { AngkaSerap, ArtikelSerap, StatusSerap } from "@/lib/salesman/penyerapan";
import type { HasilPenyerapan } from "@/lib/salesman/penyerapan-queries";
import { cn } from "@/lib/utils";

/** Artikel yang tampil sebelum "Tampilkan semua". */
const AWAL_TAMPIL = 10;

export const NADA_STATUS_SERAP: Record<StatusSerap, string> = {
  CEPAT: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  NORMAL: "bg-primary/15 text-foreground",
  LAMBAT: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  BELUM_ADA_DATA: "bg-muted text-muted-foreground",
};

/**
 * Penyerapan per artikel di analisa toko: barang yang masuk ke toko vs yang
 * laku dan yang masih di rak, dengan status dan saran tindakan. Yang perlu
 * tindakan di atas (isi ulang, lalu jangan kirim lagi). Hanya potong barang —
 * tidak ada rupiah, untuk jenis toko apa pun.
 *
 * Toko putus tanpa buku stok tidak melaporkan penjualannya: kartunya hanya
 * mengatakan itu, tidak mengarang angka laku.
 */
export function PenyerapanKartu({ data, periode }: { data: HasilPenyerapan; periode: number }) {
  const t = useTranslations("pwaPenyerapan");
  const td = dinamis(t);
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 0 });
  const [semua, setSemua] = useState(false);
  const r = data.ringkas;
  const tampil = semua ? data.artikel : data.artikel.slice(0, AWAL_TAMPIL);
  const adaPerkiraan = data.artikel.some((a) => a.perkiraan);

  return (
    <section className="beranda-kartu space-y-3" aria-labelledby="serap-judul">
      <div>
        <h2 id="serap-judul" className="beranda-judul">
          {t("judul")}
        </h2>
        <p className="text-xs text-muted-foreground">{td(`sumber.${data.sumber}`, { n: periode })}</p>
      </div>

      {data.sumber === "TANPA_LAPORAN" ? (
        <div className="flex items-start gap-3 rounded-lg bg-muted/60 px-3 py-3">
          <PackageOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("tanpaLaporanJudul")}</p>
            <p className="text-sm text-muted-foreground">{t("tanpaLaporanIsi")}</p>
          </div>
        </div>
      ) : data.artikel.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("kosong", { n: periode })}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Angka label={t("masuk")} nilai={angka.format(r.masuk)} />
            <Angka label={t("laku")} nilai={data.adaDataLaku ? angka.format(r.laku) : "—"} />
            <Angka label={t("sisa")} nilai={angka.format(r.sisa)} />
          </dl>
          {r.persen !== null ? (
            <div>
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={r.persen}
                aria-label={t("terserapLabel")}
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${r.persen}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t("terserapTotal", { pct: r.persen })}</p>
            </div>
          ) : null}
          {!data.adaDataLaku ? <p className="rounded-lg bg-muted px-3 py-2 text-sm">{t("belumAdaLaporan", { n: periode })}</p> : null}

          {r.isiUlang > 0 || r.janganKirim > 0 ? (
            <p className="flex flex-wrap gap-1.5">
              {r.isiUlang > 0 ? (
                <Badge variant="outline" className={cn("border-transparent", NADA_STATUS_SERAP.CEPAT)}>
                  {t("hitungIsiUlang", { n: r.isiUlang })}
                </Badge>
              ) : null}
              {r.janganKirim > 0 ? (
                <Badge variant="outline" className={cn("border-transparent", NADA_STATUS_SERAP.LAMBAT)}>
                  {t("hitungJanganKirim", { n: r.janganKirim })}
                </Badge>
              ) : null}
            </p>
          ) : null}

          <ul className="divide-y border-t">
            {tampil.map((a) => (
              <BarisArtikel key={a.itemId} a={a} jenisToko={data.jenisToko} angka={angka} adaLaku={data.adaDataLaku} />
            ))}
          </ul>
          {data.artikel.length > AWAL_TAMPIL ? (
            <Button type="button" variant="outline" className="w-full" onClick={() => setSemua((x) => !x)}>
              {semua ? t("ringkas") : t("tampilkanSemua", { n: data.artikel.length })}
            </Button>
          ) : null}
          {data.jumlahArtikel > data.artikel.length ? (
            <p className="text-xs text-muted-foreground">{t("terpotong", { n: data.jumlahArtikel - data.artikel.length })}</p>
          ) : null}

          <p className="text-xs text-muted-foreground">{t("penjelasan")}</p>
          {adaPerkiraan ? <p className="text-xs text-muted-foreground">{t("catatanPerkiraan")}</p> : null}
        </>
      )}
    </section>
  );
}

function BarisArtikel({
  a,
  jenisToko,
  angka,
  adaLaku,
}: {
  a: ArtikelSerap;
  jenisToko: "PUTUS" | "KONSI";
  angka: Intl.NumberFormat;
  adaLaku: boolean;
}) {
  const t = useTranslations("pwaPenyerapan");
  const [buka, setBuka] = useState(false);
  const adaVarian = a.varian.some((v) => v.label !== null);
  const idVarian = `serap-varian-${a.itemId}`;

  return (
    <li className="space-y-1.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium leading-tight">{a.nama}</p>
          {a.sku ? <p className="truncate font-mono text-[11px] text-muted-foreground">{a.sku}</p> : null}
        </div>
        <TandaStatus status={a.status} />
      </div>
      <Angka3 x={a} angka={angka} adaLaku={adaLaku} />
      <Saran x={a} jenisToko={jenisToko} angka={angka} />
      {adaVarian ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2"
            aria-expanded={buka}
            aria-controls={idVarian}
            onClick={() => setBuka((x) => !x)}
          >
            {buka ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
            {t("perUkuran", { n: a.varian.length })}
          </Button>
          {buka ? (
            <ul id={idVarian} className="space-y-2 rounded-lg bg-muted/50 px-3 py-2">
              {a.varian.map((v) => (
                <li key={v.variantSku || "-"} className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium leading-tight">{v.label ?? t("tanpaUkuran")}</span>
                    <TandaStatus status={v.status} />
                  </div>
                  <Angka3 x={v} angka={angka} adaLaku={adaLaku} />
                  <Saran x={v} jenisToko={jenisToko} angka={angka} ringkas />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/** Masuk · laku · sisa. Tanpa laporan laku, laku ditulis "—", bukan 0 — nol berarti "tidak laku". */
function Angka3({ x, angka, adaLaku }: { x: AngkaSerap; angka: Intl.NumberFormat; adaLaku: boolean }) {
  const t = useTranslations("pwaPenyerapan");
  const kira = x.perkiraan ? "≈" : "";
  return (
    <>
      <p className="text-xs tabular-nums text-muted-foreground">
        {t("barisAngka", {
          masuk: angka.format(x.masuk),
          laku: adaLaku ? `${kira}${angka.format(x.laku)}` : "—",
          sisa: `${kira}${angka.format(x.sisa)}`,
        })}
        {x.awal > 0 ? ` · ${t("barisAwal", { n: angka.format(x.awal) })}` : ""}
      </p>
      {x.persen !== null || x.umurHari !== null ? (
        <p className="text-xs tabular-nums text-muted-foreground">
          {[x.persen !== null && x.status !== "BELUM_ADA_DATA" ? t("barisTerserap", { pct: x.persen }) : null, x.umurHari !== null ? t("barisUmur", { n: x.umurHari }) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </>
  );
}

function Saran({ x, jenisToko, angka, ringkas = false }: { x: AngkaSerap; jenisToko: "PUTUS" | "KONSI"; angka: Intl.NumberFormat; ringkas?: boolean }) {
  const t = useTranslations("pwaPenyerapan");
  if (x.saran === "ISI_ULANG") {
    return (
      <p className={cn("rounded-lg text-sm", ringkas ? "text-emerald-800 dark:text-emerald-300" : "px-3 py-2", !ringkas && NADA_STATUS_SERAP.CEPAT)}>
        {x.saranQty > 0 ? t("saranIsiUlang", { n: angka.format(x.saranQty) }) : t("saranIsiUlangTanpaQty")}
      </p>
    );
  }
  if (x.saran === "JANGAN_KIRIM") {
    return (
      <p className={cn("rounded-lg text-sm", ringkas ? "text-amber-800 dark:text-amber-300" : "px-3 py-2", !ringkas && NADA_STATUS_SERAP.LAMBAT)}>
        {jenisToko === "PUTUS" ? t("saranJanganKirimPutus") : t("saranJanganKirimKonsi")}
      </p>
    );
  }
  return null;
}

function TandaStatus({ status }: { status: StatusSerap }) {
  const td = dinamis(useTranslations("pwaPenyerapan"));
  return (
    <Badge variant="outline" className={cn("shrink-0 border-transparent", NADA_STATUS_SERAP[status])}>
      {td(`status.${status}`)}
    </Badge>
  );
}

function Angka({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-2">
      <dt className="text-[11px] leading-tight text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{nilai}</dd>
    </div>
  );
}
