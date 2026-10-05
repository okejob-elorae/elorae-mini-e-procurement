"use client";

import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import type { BarisStok } from "@/lib/spg/queries";
import type { JenisGerakanStok } from "@/lib/spg/kantor-queries";
import { cn } from "@/lib/utils";

export type GerakanStokTampil = {
  id: string;
  /** Sudah diformat di server. */
  waktu: string;
  jenis: JenisGerakanStok;
  nama: string;
  variantSku: string;
  qty: number;
  oleh: string;
};

const WARNA_JENIS: Record<GerakanStokTampil["jenis"], string> = {
  TERIMA: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  JUAL: "border-sky-500/40 text-sky-700 dark:text-sky-300",
  OPNAME: "border-amber-500/40 text-amber-800 dark:text-amber-300",
  MUTASI_KELUAR: "border-violet-500/40 text-violet-700 dark:text-violet-300",
  MUTASI_MASUK: "border-teal-500/40 text-teal-700 dark:text-teal-300",
  RETUR_KELUAR: "border-rose-500/40 text-rose-700 dark:text-rose-300",
  RETUR_PEMBELI: "border-orange-500/40 text-orange-700 dark:text-orange-300",
};

const bertanda = (n: number) => (n > 0 ? `+${n}` : String(n));
/** Titik ribuan tanpa `Intl` — keluaran server dan browser harus sama persis. */
const ribuan = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Stok barang di toko ini menurut buku stok toko (gerakan SPG), plus gerakan
 * terakhirnya. Saldo negatif sengaja ditampilkan apa adanya — penjualan tidak
 * pernah ditolak karena stok sistem nol, jadi minus adalah tanda opname
 * dibutuhkan, bukan galat.
 */
export function StokTokoCard({ stok, gerakan }: { stok: BarisStok[]; gerakan: GerakanStokTampil[] }) {
  const t = useTranslations("stores.stockCard");
  const td = dinamis(t);

  const adaStok = stok.filter((s) => s.qty > 0);
  const minus = stok.filter((s) => s.qty < 0).length;
  const pcs = adaStok.reduce((n, s) => n + s.qty, 0);
  const kosong = stok.length === 0 && gerakan.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Boxes className="h-4 w-4" />
          {t("title")}
          {!kosong ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({t("summary", { sku: adaStok.length, pcs: ribuan(pcs) })}
              {minus > 0 ? (
                <>
                  {" · "}
                  <span className="text-red-600 dark:text-red-400">{t("summaryNegative", { count: minus })}</span>
                </>
              ) : null}
              )
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {kosong ? (
          <div className="py-8 text-center">
            <Boxes className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">{t("emptyTitle")}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("emptyBody")}</p>
          </div>
        ) : (
          <div className="grid gap-6 2xl:grid-cols-2">
            <section className="min-w-0 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("balanceTitle")}
              </h3>
              <div className="max-h-96 overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>{t("colItem")}</TableHead>
                      <TableHead>{t("colVariant")}</TableHead>
                      <TableHead className="text-right">{t("colBalance")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stok.map((s) => (
                      <TableRow key={`${s.itemId}::${s.variantSku}`}>
                        <TableCell className="min-w-[10rem] whitespace-normal">{s.nama}</TableCell>
                        <TableCell className="whitespace-normal">
                          {s.varian ? <span className="block text-sm">{s.varian}</span> : null}
                          <span className="font-mono text-xs text-muted-foreground">{s.sku || "—"}</span>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold tabular-nums",
                            s.qty < 0 && "text-red-600 dark:text-red-400",
                            s.qty === 0 && "font-normal text-muted-foreground",
                          )}
                        >
                          {s.qty}
                          {s.qty < 0 ? (
                            <Badge variant="outline" className="ml-2 border-red-500/40 text-red-700 dark:text-red-300">
                              {t("negative")}
                            </Badge>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>

            <section className="min-w-0 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("movementsTitle")}
                <span className="ml-2 font-normal normal-case tracking-normal">
                  {t("movementsHint", { count: gerakan.length })}
                </span>
              </h3>
              <div className="max-h-96 overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>{t("colTime")}</TableHead>
                      <TableHead>{t("colKind")}</TableHead>
                      <TableHead>{t("colItem")}</TableHead>
                      <TableHead className="text-right">{t("colQty")}</TableHead>
                      <TableHead className="hidden 2xl:table-cell">{t("colBy")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gerakan.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{g.waktu}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={WARNA_JENIS[g.jenis]}>
                            {td(`kind.${g.jenis}`)}
                          </Badge>
                        </TableCell>
                        <TableCell className="min-w-[9rem] whitespace-normal">
                          <span className="block text-sm">{g.nama}</span>
                          {g.variantSku ? (
                            <span className="font-mono text-xs text-muted-foreground">{g.variantSku}</span>
                          ) : null}
                          {/* Di bawah 2xl pencatatnya menumpang di sini. */}
                          <span className="block text-xs text-muted-foreground 2xl:hidden">{g.oleh}</span>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            g.qty < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
                          )}
                        >
                          {bertanda(g.qty)}
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground 2xl:table-cell">{g.oleh}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
