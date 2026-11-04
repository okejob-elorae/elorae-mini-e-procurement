"use client";

import { useTranslations } from "next-intl";
import { rupiahTeks } from "@/lib/creative/angka-konten";
import type { TarifInfo } from "@/lib/creative/pph";

/**
 * Rincian hitungan PPh satu termin — bruto, DPP, lapisan tarif, tambahan tanpa
 * NPWP, PPh, neto — supaya keuangan bisa memeriksa angkanya sendiri.
 */
export function RincianPph({
  bruto,
  dpp,
  pph,
  neto,
  info,
  warisan = false,
}: {
  bruto: number;
  dpp: number;
  pph: number;
  neto: number;
  info: TarifInfo | null;
  warisan?: boolean;
}) {
  const t = useTranslations("kreatifRuang.termin.rincian");
  if (warisan) return <p className="text-xs text-muted-foreground">{t("warisan")}</p>;
  const baris = (label: string, nilai: string, tebal = false) => (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={tebal ? "font-semibold tabular-nums" : "tabular-nums"}>{nilai}</dd>
    </div>
  );
  return (
    <dl className="space-y-1 text-xs">
      {baris(info?.grossUp ? t("brutoGrossUp") : t("bruto"), rupiahTeks(bruto))}
      {info?.pasal === null || !info ? (
        <p className="text-muted-foreground">{t("tidakDipotong")}</p>
      ) : (
        <>
          {baris(t("dpp", { persen: info.porsiDppPersen }), rupiahTeks(dpp))}
          {info.lapisan.map((l, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 pl-3">
              <dt className="text-muted-foreground">{t("lapisan", { persen: l.persen, dasar: rupiahTeks(l.dasar) })}</dt>
              <dd className="tabular-nums">{rupiahTeks(l.pph)}</dd>
            </div>
          ))}
          {info.tambahanTanpaNpwpPersen > 0 ? (
            <p className="pl-3 text-muted-foreground">{t("tambahan", { persen: info.tambahanTanpaNpwpPersen })}</p>
          ) : null}
          {baris(t("pph", { pasal: info.pasal, efektif: info.tarifEfektifPersen }), rupiahTeks(pph))}
        </>
      )}
      {baris(t("neto"), rupiahTeks(neto), true)}
      {info?.grossUp ? <p className="text-muted-foreground">{t("ditanggung")}</p> : null}
    </dl>
  );
}
