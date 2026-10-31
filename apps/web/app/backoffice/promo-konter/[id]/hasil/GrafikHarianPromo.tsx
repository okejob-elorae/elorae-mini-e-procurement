"use client";

import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TitikHarian } from "@/lib/spg/efektivitas-promo";
import { angkaId } from "../../efektivitas-tampil";

/** Garis masa promo memakai warna kategoris pertama; pembanding abu-abu putus-putus (acuan, bukan seri kedua). */
const WARNA_PROMO = "var(--viz-1)";
const WARNA_PEMBANDING = "var(--muted-foreground)";

const fmtHari = (locale: string) =>
  new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Potong bersih barang sasaran per "hari ke-k" — masa promo vs periode
 * pembanding, berjajar menurut urutan hari. Tabel angkanya ada di bawah grafik.
 */
export function GrafikHarianPromo({ data, totalPromo, totalPembanding }: { data: TitikHarian[]; totalPromo: number; totalPembanding: number }) {
  const t = useTranslations("efektivitasPromo.hasil.grafik");
  const locale = useLocale();
  const fmt = fmtHari(locale);
  const tanggal = (iso: string) => fmt.format(new Date(`${iso}T00:00:00Z`));
  const kosong = totalPromo === 0 && totalPembanding === 0;

  return (
    <div className="viz space-y-3">
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: WARNA_PROMO }} />
          <span className="text-muted-foreground">{t("seriPromo")}</span>
          <span className="font-medium tabular-nums">{t("pcs", { n: angkaId(totalPromo) })}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="w-4 border-t-2 border-dashed" style={{ borderColor: WARNA_PEMBANDING }} />
          <span className="text-muted-foreground">{t("seriPembanding")}</span>
          <span className="font-medium tabular-nums">{t("pcs", { n: angkaId(totalPembanding) })}</span>
        </li>
      </ul>
      <div className="relative h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="efektivitas-promo" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={WARNA_PROMO} stopOpacity={0.3} />
                <stop offset="100%" stopColor={WARNA_PROMO} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="hariKe"
              tickFormatter={(v) => t("hariKe", { n: String(v) })}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis
              hide={kosong}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const titik = active && payload?.length ? (payload[0].payload as TitikHarian) : null;
                return titik ? (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                    <p className="mb-1 font-medium">{t("hariKe", { n: String(titik.hariKe) })}</p>
                    <p className="flex items-center gap-2 tabular-nums">
                      <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: WARNA_PROMO }} />
                      <span className="text-muted-foreground">{tanggal(titik.tanggalPromo)}</span>
                      <span className="ml-auto pl-3 font-medium">{t("pcs", { n: angkaId(titik.promo) })}</span>
                    </p>
                    <p className="flex items-center gap-2 tabular-nums">
                      <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: WARNA_PEMBANDING }} />
                      <span className="text-muted-foreground">{tanggal(titik.tanggalPembanding)}</span>
                      <span className="ml-auto pl-3 font-medium">{t("pcs", { n: angkaId(titik.pembanding) })}</span>
                    </p>
                  </div>
                ) : null;
              }}
            />
            <Line
              type="monotone"
              dataKey="pembanding"
              stroke={WARNA_PEMBANDING}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              isAnimationActive={false}
            />
            <Area type="monotone" dataKey="promo" stroke={WARNA_PROMO} strokeWidth={2} fill="url(#efektivitas-promo)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        {kosong ? (
          <div className="absolute inset-0 grid place-items-center">
            <p className="text-sm text-muted-foreground">{t("kosong")}</p>
          </div>
        ) : null}
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{t("lihatTabel")}</summary>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-md border">
          <Table className="text-xs tabular-nums">
            <TableHeader>
              <TableRow>
                <TableHead>{t("kolomHari")}</TableHead>
                <TableHead>{t("seriPromo")}</TableHead>
                <TableHead className="text-right">{t("kolomPcs")}</TableHead>
                <TableHead>{t("seriPembanding")}</TableHead>
                <TableHead className="text-right">{t("kolomPcs")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((d) => (
                <TableRow key={d.hariKe}>
                  <TableCell>{d.hariKe}</TableCell>
                  <TableCell>{tanggal(d.tanggalPromo)}</TableCell>
                  <TableCell className="text-right">{angkaId(d.promo)}</TableCell>
                  <TableCell>{tanggal(d.tanggalPembanding)}</TableCell>
                  <TableCell className="text-right">{angkaId(d.pembanding)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  );
}
