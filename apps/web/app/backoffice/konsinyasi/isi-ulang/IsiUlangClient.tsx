"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRightLeft, ChevronDown, ChevronRight, PackageOpen, PackagePlus, Search, Snail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RingkasanStok } from "@/lib/konsinyasi/isi-ulang";

export type TokoIsiUlang = {
  id: string;
  code: string;
  name: string;
  termsType: "PUTUS" | "KONSI";
  spg: boolean;
  area: string | null;
  source: "BUKU_TOKO" | "TITIPAN";
  ringkas: RingkasanStok;
  isiUlang: { nama: string; varian: string | null; qty: number; saranQty: number; kurangGudang: boolean }[];
};

export type BarisTidakLaku = {
  kunci: string;
  storeId: string;
  storeName: string;
  nama: string;
  varian: string | null;
  qty: number;
  perkiraan: boolean;
  /** Sudah diformat di server. */
  terakhirLaku: string | null;
  tujuan: { storeId: string; storeName: string; terjual60: number } | null;
};

/** Titik ribuan tanpa `Intl` — keluaran server dan browser harus sama persis. */
const ribuan = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export function IsiUlangClient({
  toko,
  tidakLaku,
  bolehAturTarget,
}: {
  toko: TokoIsiUlang[];
  tidakLaku: BarisTidakLaku[];
  bolehAturTarget: boolean;
}) {
  const t = useTranslations("konsiIsiUlang");
  const [cari, setCari] = useState("");
  const [hanyaPerlu, setHanyaPerlu] = useState(true);
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set());

  const q = cari.trim().toLowerCase();
  const cocok = (s: string) => !q || s.toLowerCase().includes(q);

  const daftarToko = toko
    .filter((s) => (!hanyaPerlu || s.ringkas.barisIsiUlang > 0) && (cocok(s.name) || cocok(s.code) || cocok(s.area ?? "")))
    .sort((a, b) => b.ringkas.pcsIsiUlang - a.ringkas.pcsIsiUlang || a.name.localeCompare(b.name));
  const daftarTidakLaku = tidakLaku.filter((b) => cocok(b.storeName) || cocok(b.nama));

  const perluIsi = toko.filter((s) => s.ringkas.barisIsiUlang > 0);
  const totalPcs = perluIsi.reduce((n, s) => n + s.ringkas.pcsIsiUlang, 0);
  const tanpaTarget = toko.filter((s) => !s.ringkas.adaTarget).length;

  function alih(id: string) {
    setTerbuka((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        meta={t("meta", { stores: perluIsi.length, pcs: ribuan(totalPcs), slow: tidakLaku.length })}
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("searchPlaceholder")}
            placeholder={t("searchPlaceholder")}
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="hanya-perlu" checked={hanyaPerlu} onCheckedChange={setHanyaPerlu} />
          <Label htmlFor="hanya-perlu">{t("onlyNeeding")}</Label>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5" />
            {t("refillTitle")}
          </CardTitle>
          {tanpaTarget > 0 ? <p className="text-sm text-muted-foreground">{t("noTargetCount", { count: tanpaTarget })}</p> : null}
        </CardHeader>
        <CardContent>
          {daftarToko.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title={hanyaPerlu ? t("refillEmpty") : t("storesEmpty")}
              description={hanyaPerlu ? t("refillEmptyBody") : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("col.store")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("col.area")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("col.source")}</TableHead>
                    <TableHead className="text-right">{t("col.lines")}</TableHead>
                    <TableHead className="text-right">{t("col.pcs")}</TableHead>
                    <TableHead>{t("col.flags")}</TableHead>
                    <TableHead className="text-right">{t("col.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daftarToko.map((s) => {
                    const buka = terbuka.has(s.id);
                    return (
                      <Fragment key={s.id}>
                        <TableRow>
                          <TableCell className="whitespace-normal">
                            <div className="flex items-start gap-1">
                              {s.isiUlang.length > 0 ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="-ml-2 h-7 w-7 shrink-0"
                                  aria-expanded={buka}
                                  aria-label={buka ? t("hideLines", { store: s.name }) : t("showLines", { store: s.name })}
                                  onClick={() => alih(s.id)}
                                >
                                  {buka ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                              ) : null}
                              <div className="min-w-0">
                                <Link href={`/backoffice/stores/${s.id}`} className="font-medium hover:underline">
                                  {s.name}
                                </Link>
                                <p className="text-xs text-muted-foreground">
                                  {s.code} · {s.termsType === "KONSI" ? t("typeKonsi") : t("typePutus")}
                                  {s.spg ? ` · ${t("hasSpg")}` : ""}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden whitespace-normal 2xl:table-cell">
                            {s.area ?? <span className="text-muted-foreground">{t("noArea")}</span>}
                          </TableCell>
                          <TableCell className="hidden 2xl:table-cell">
                            {s.source === "BUKU_TOKO" ? t("sourceBuku") : t("sourceTitipan")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{ribuan(s.ringkas.barisIsiUlang)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{ribuan(s.ringkas.pcsIsiUlang)}</TableCell>
                          <TableCell className="whitespace-normal">
                            <div className="flex flex-wrap gap-1">
                              {!s.ringkas.adaTarget ? <Badge variant="outline">{t("noTargets")}</Badge> : null}
                              {s.ringkas.minus > 0 ? (
                                <Badge variant="outline" className="border-red-500/50 text-red-700 dark:text-red-300">
                                  {t("chipMinus", { count: s.ringkas.minus })}
                                </Badge>
                              ) : null}
                              {s.ringkas.hampirHabis > 0 ? (
                                <Badge variant="outline" className="border-amber-500/50 text-amber-800 dark:text-amber-300">
                                  {t("chipLow", { count: s.ringkas.hampirHabis })}
                                </Badge>
                              ) : null}
                              {s.ringkas.tidakLaku > 0 ? (
                                <Badge variant="outline" className="border-sky-500/50 text-sky-700 dark:text-sky-300">
                                  {t("chipSlow", { count: s.ringkas.tidakLaku })}
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button asChild variant="ghost" size="sm">
                                <Link href={`/backoffice/stores/${s.id}`}>{t("openStore")}</Link>
                              </Button>
                              {bolehAturTarget ? (
                                <Button asChild variant="outline" size="sm">
                                  <Link href={`/backoffice/stores/${s.id}/target-stok`}>{t("setTargets")}</Link>
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                        {buka ? (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={7} className="whitespace-normal">
                              <ul className="grid gap-1 text-sm sm:grid-cols-2 2xl:grid-cols-3">
                                {s.isiUlang.map((l, i) => (
                                  <li key={i} className="flex justify-between gap-3 rounded-md border bg-background px-3 py-1.5">
                                    <span className="min-w-0 truncate">
                                      {l.nama}
                                      {l.varian ? <span className="text-muted-foreground"> · {l.varian}</span> : null}
                                    </span>
                                    <span className="shrink-0 tabular-nums">
                                      <span className="text-muted-foreground">{t("lineStock", { qty: ribuan(l.qty) })}</span>{" "}
                                      <span className="font-medium">+{ribuan(l.saranQty)}</span>
                                      {l.kurangGudang ? <span className="ml-1 text-amber-700 dark:text-amber-300">{t("warehouseShort")}</span> : null}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Snail className="h-5 w-5" />
            {t("slowTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {daftarTidakLaku.length === 0 ? (
            <EmptyState icon={Snail} title={t("slowEmpty")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("col.item")}</TableHead>
                    <TableHead>{t("col.store")}</TableHead>
                    <TableHead className="text-right">{t("col.qty")}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t("col.lastSold")}</TableHead>
                    <TableHead>{t("col.suggestion")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daftarTidakLaku.map((b) => (
                    <TableRow key={b.kunci}>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{b.nama}</p>
                        {b.varian ? <p className="text-xs text-muted-foreground">{b.varian}</p> : null}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <Link href={`/backoffice/stores/${b.storeId}`} className="hover:underline">
                          {b.storeName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.perkiraan ? "≈" : ""}
                        {ribuan(b.qty)}
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell">
                        {b.terakhirLaku ?? <span className="text-muted-foreground">{t("neverSold")}</span>}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {b.tujuan ? (
                          <span className="inline-flex items-center gap-1.5">
                            <ArrowRightLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span>
                              {t("moveTo")}{" "}
                              <Link href={`/backoffice/stores/${b.tujuan.storeId}`} className="font-medium hover:underline">
                                {b.tujuan.storeName}
                              </Link>{" "}
                              <span className="text-xs text-muted-foreground">{t("soldThere", { qty: ribuan(b.tujuan.terjual60) })}</span>
                            </span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t("noSuggestion")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
