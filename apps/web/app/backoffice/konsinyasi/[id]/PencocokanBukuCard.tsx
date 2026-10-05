"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisPencocokan } from "@/lib/konsinyasi/pencocokan";
import type { PencocokanSiklus } from "@/lib/konsinyasi/pencocokan-queries";

const angka = (n: number | null) => (n === null ? "—" : n.toLocaleString("id-ID"));

/**
 * Angka acuan satu baris terjual: buku toko (catatan SPG) kalau ada, lalu angka
 * resmi, laporan toko, laporan SPG. Sel yang berbeda dari acuan disorot.
 */
function acuan(b: BarisPencocokan): number | null {
  const t = b.terjual;
  return t.buku ?? t.resmi ?? t.laporanToko ?? t.laporanSpg;
}

/** Buku stok toko vs laporan laku konsinyasi untuk satu siklus. */
export function PencocokanBukuCard({ data }: { data: PencocokanSiklus }) {
  const t = useTranslations("konsinyasi.cocokBuku");
  const td = dinamis(t);
  const locale = useLocale();
  const [hanyaSelisih, setHanyaSelisih] = useState(false);
  const r = data.ringkas;

  const barisTerjual = data.baris.filter(
    (b) => b.terjualBerselisih || Object.values(b.terjual).some((v) => v !== null && v !== 0),
  );
  const barisStok = data.baris.filter(
    (b) => b.stok && (b.stok.buku !== 0 || b.stok.titipan !== 0 || b.stok.dalamProses !== 0 || b.stok.hilangTercatat !== 0),
  );
  // Kolom "Sudah dicatat hilang" hanya muncul kalau ada barangnya.
  const adaHilangTercatat = barisStok.some((b) => (b.stok?.hilangTercatat ?? 0) !== 0);
  const tampilTerjual = hanyaSelisih ? barisTerjual.filter((b) => b.terjualBerselisih) : barisTerjual;
  const tampilStok = hanyaSelisih ? barisStok.filter((b) => b.stokBerselisih) : barisStok;

  const namaBulan = (periode: string) =>
    new Intl.DateTimeFormat(locale.toLowerCase().startsWith("en") ? "en-GB" : "id-ID", { month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(
      new Date(`${periode}-01T00:00:00+07:00`),
    );

  const kolom = {
    buku: data.sumber.buku,
    nota: data.sumber.nota,
    resmi: data.sumber.resmi,
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="text-base">{t("title")}</CardTitle>
          {r.cocok === null ? (
            <StatusPill tone="waiting">{t("none")}</StatusPill>
          ) : r.cocok ? (
            <StatusPill tone="settled">{t("ok")}</StatusPill>
          ) : (
            <StatusPill tone="attention">{t("diff", { count: r.barangBerselisih })}</StatusPill>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.adaBuku && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{t("noBook")}</span>
          </p>
        )}
        {data.bukuMulaiTengahBulan && data.bukuMulai && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{t("bookStarted", { date: formatDisplayDate(data.bukuMulai, locale) })}</span>
          </p>
        )}
        {r.barangKemungkinanHilang > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/[0.05] p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span>{t("lost", { count: r.barangKemungkinanHilang, pcs: r.pcsKemungkinanHilang })}</span>
          </p>
        )}

        {data.baris.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Switch id="cocok-hanya-selisih" checked={hanyaSelisih} onCheckedChange={setHanyaSelisih} />
              <Label htmlFor="cocok-hanya-selisih" className="text-sm font-normal">
                {t("onlyDiff")}
              </Label>
            </div>

            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t("soldTitle")}</h3>
              {tampilTerjual.length === 0 ? (
                <p className="text-sm text-muted-foreground">{hanyaSelisih ? t("emptyFiltered") : t("empty")}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("colItem")}</TableHead>
                        {kolom.buku && <TableHead className="text-right">{t("colBook")}</TableHead>}
                        {kolom.nota && <TableHead className="text-right">{t("colNota")}</TableHead>}
                        <TableHead className="text-right">{t("colSpg")}</TableHead>
                        <TableHead className="text-right">{t("colToko")}</TableHead>
                        {kolom.resmi && <TableHead className="text-right">{t("colOfficial")}</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tampilTerjual.map((b) => {
                        const ac = acuan(b);
                        const sel = (v: number | null, dibandingkan = true) => (
                          <TableCell
                            className={cn(
                              "text-right tabular-nums",
                              !dibandingkan && "text-muted-foreground",
                              dibandingkan && b.terjualBerselisih && v !== null && v !== ac && "font-semibold text-destructive",
                            )}
                          >
                            {angka(v)}
                          </TableCell>
                        );
                        return (
                          <TableRow key={b.kunci} className={cn(b.terjualBerselisih && "bg-destructive/[0.06]")}>
                            <NamaBarang b={b} label={t("unknownName")} />
                            {kolom.buku && sel(b.terjual.buku)}
                            {kolom.nota && sel(b.terjual.nota, false)}
                            {sel(b.terjual.laporanSpg)}
                            {sel(b.terjual.laporanToko)}
                            {kolom.resmi && sel(b.terjual.resmi)}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>

            {r.adaStok && (
              <section className="space-y-2">
                <h3 className="text-sm font-medium">{t("stockTitle")}</h3>
                {tampilStok.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{hanyaSelisih ? t("emptyFiltered") : t("empty")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("colItem")}</TableHead>
                          <TableHead className="text-right">{t("colStockBook")}</TableHead>
                          <TableHead className="text-right">{t("colTitipan")}</TableHead>
                          <TableHead className="text-right">{t("colInProcess")}</TableHead>
                          {adaHilangTercatat && <TableHead className="text-right">{t("colRecordedLost")}</TableHead>}
                          <TableHead className="text-right">{t("colExpected")}</TableHead>
                          <TableHead className="text-right">{t("colGap")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tampilStok.map((b) => {
                          const s = b.stok!;
                          return (
                            <TableRow
                              key={b.kunci}
                              className={cn(s.selisih < 0 && "bg-destructive/[0.06]", s.selisih > 0 && "bg-amber-500/[0.06]")}
                            >
                              <NamaBarang b={b} label={t("unknownName")} />
                              <TableCell className="text-right tabular-nums">{angka(s.buku)}</TableCell>
                              <TableCell className="text-right tabular-nums">{angka(s.titipan)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">
                                {s.dalamProses === 0 ? "—" : angka(s.dalamProses)}
                              </TableCell>
                              {adaHilangTercatat && (
                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                  {s.hilangTercatat === 0 ? "—" : angka(s.hilangTercatat)}
                                </TableCell>
                              )}
                              <TableCell className="text-right tabular-nums">{angka(s.seharusnya)}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {s.selisih < 0 ? (
                                  <span className="font-semibold text-destructive">
                                    {t("short", { qty: -s.selisih })}
                                    <span className="block text-xs font-normal">{t("maybeLost")}</span>
                                  </span>
                                ) : s.selisih > 0 ? (
                                  <span className="font-semibold text-amber-600 dark:text-amber-500">{t("over", { qty: s.selisih })}</span>
                                ) : (
                                  "0"
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {data.bulanSementara.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t("provisional", {
                      months: data.bulanSementara.map((m) => `${namaBulan(m.periode)} (${td(`dasar.${m.dasar}`)})`).join(", "),
                    })}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NamaBarang({ b, label }: { b: BarisPencocokan; label: string }) {
  return (
    <TableCell className="whitespace-normal">
      <span className="font-medium">{b.nama}</span>
      {b.sku && <span className="block font-mono text-xs text-muted-foreground">{b.sku}</span>}
      {b.itemId === null && <span className="block text-xs text-amber-600 dark:text-amber-500">{label}</span>}
    </TableCell>
  );
}
