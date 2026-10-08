"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { saringBarisButa, type BarisButa, type SaringanButa } from "../angka-sistem";

/*
 * Tinjauan baris opname TANPA angka sistem: hanya nama, SKU, dan yang sudah
 * dihitung. Dipakai selama menghitung dan bagi yang belum boleh melihat angka
 * sistem (lihat `angka-sistem.ts`) — muatannya memang tidak membawa angka itu.
 */

const PER_HALAMAN = 50;

function formatJumlah(n: number | null): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function TabelHitunganButa({ lines, isFabric }: { lines: BarisButa[]; isFabric: boolean }) {
  const t = useTranslations("stockOpname");
  const [saring, setSaring] = useState<SaringanButa>("all");
  const [cari, setCari] = useState("");
  const [halaman, setHalaman] = useState(1);

  const tersaring = useMemo(() => saringBarisButa(lines, saring, cari), [lines, saring, cari]);
  const totalHalaman = Math.max(1, Math.ceil(tersaring.length / PER_HALAMAN));
  const aman = Math.min(halaman, totalHalaman);
  const isi = tersaring.slice((aman - 1) * PER_HALAMAN, aman * PER_HALAMAN);

  return (
    <Card>
      <CardHeader className="space-y-4">
        <CardTitle>{t("reviewLines")}</CardTitle>
        <div className="flex flex-col sm:flex-row gap-3">
          <Select
            value={saring}
            onValueChange={(v) => {
              setSaring(v as SaringanButa);
              setHalaman(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAll")}</SelectItem>
              <SelectItem value="pending">{t("filterPending")}</SelectItem>
              <SelectItem value="counted">{t("filterCounted")}</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={cari}
              onChange={(e) => {
                setCari(e.target.value);
                setHalaman(1);
              }}
              placeholder={isFabric ? t("searchRollPlaceholder") : t("searchSkuPlaceholder")}
              className="pl-9"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t("showingLines", { shown: isi.length, total: tersaring.length })}</p>
      </CardHeader>
      <CardContent>
        {tersaring.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">{t("noLinesMatch")}</p>
        ) : (
          <>
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{isFabric ? t("roll") : t("item")}</TableHead>
                    <TableHead className="text-right">{t("counted")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isi.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <div className="font-medium leading-snug">{b.label}</div>
                        {b.sublabel ? (
                          <div className="text-muted-foreground text-xs mt-0.5 font-mono">{b.sublabel}</div>
                        ) : b.gabungan ? (
                          <div className="text-muted-foreground text-xs mt-0.5">{t("tanpaVarian")}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatJumlah(b.counted)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalHalaman > 1 ? (
              <div className="flex items-center justify-between mt-4">
                <p className="text-sm text-muted-foreground">{t("pageOf", { page: aman, total: totalHalaman })}</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={aman <= 1}
                    aria-label={t("previousPage")}
                    title={t("previousPage")}
                    onClick={() => setHalaman((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={aman >= totalHalaman}
                    aria-label={t("nextPage")}
                    title={t("nextPage")}
                    onClick={() => setHalaman((p) => Math.min(totalHalaman, p + 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
