"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, Loader2, Pencil, Plus, Ruler, Trash2 } from "lucide-react";
import { hapusTabelUkuranAction } from "@/app/actions/size-charts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ringkasUkuran } from "@/lib/items/size-chart";
import type { BarisDaftarTabelUkuran, KategoriTabelUkuran } from "@/lib/items/size-chart-queries";
import { cn } from "@/lib/utils";
import { FormTabelUkuran } from "./FormTabelUkuran";

/**
 * Daftar tabel ukuran. Satu tabel aktif per kategori menjadi bawaan semua
 * barang kategori itu; tabel tanpa kategori dipasang langsung di barang.
 * Hapus dimatikan selama ada barang yang memasangnya — nonaktifkan saja.
 */
export function TabelUkuranClient({
  data,
  kategori,
  bolehUbah,
}: {
  data: BarisDaftarTabelUkuran[];
  kategori: KategoriTabelUkuran[];
  bolehUbah: boolean;
}) {
  const t = useTranslations("sizeCharts");
  const router = useRouter();
  const [buka, setBuka] = useState<{ mode: "baru" } | { mode: "ubah"; baris: BarisDaftarTabelUkuran } | null>(null);
  const [hapus, setHapus] = useState<BarisDaftarTabelUkuran | null>(null);
  const [menghapus, mulaiHapus] = useTransition();

  const aktif = data.filter((d) => d.isActive).length;

  const lakukanHapus = () => {
    if (!hapus) return;
    const sasaran = hapus;
    mulaiHapus(async () => {
      const h = await hapusTabelUkuranAction(sasaran.id);
      if (h.ok) {
        toast.success(t("toast.dihapus", { name: sasaran.name }));
        setHapus(null);
        router.refresh();
        return;
      }
      if (h.code === "DIPAKAI") toast.error(t("hapus.dipakai", { count: h.jumlah }));
      else if (h.code === "TANPA_AKSES") toast.error(t("galat.tanpaAkses"));
      else if (h.code === "TIDAK_DITEMUKAN") toast.error(t("galat.tidakDitemukan"));
      else toast.error(t("galat.gagal"));
      if (h.code === "TIDAK_DITEMUKAN") {
        setHapus(null);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        description={t("deskripsi")}
        meta={data.length > 0 ? t("ringkas", { total: data.length, aktif }) : undefined}
        actions={
          bolehUbah ? (
            <Button onClick={() => setBuka({ mode: "baru" })}>
              <Plus className="mr-2 h-4 w-4" />
              {t("tambah")}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5" aria-hidden />
            {t("kartuJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <EmptyState
              icon={Ruler}
              title={t("kosong.judul")}
              description={t("kosong.isi")}
              action={
                bolehUbah ? (
                  <Button variant="outline" onClick={() => setBuka({ mode: "baru" })}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("tambah")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolom.nama")}</TableHead>
                  <TableHead>{t("kolom.kategori")}</TableHead>
                  <TableHead>{t("kolom.pengukuran")}</TableHead>
                  <TableHead>{t("kolom.ukuran")}</TableHead>
                  <TableHead>{t("kolom.dipakai")}</TableHead>
                  <TableHead>{t("kolom.status")}</TableHead>
                  <TableHead className="w-[96px] text-right">{t("kolom.aksi")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id} className={cn(!row.isActive && "text-muted-foreground")}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">{t(`satuan.${row.unit}`)}</span>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {row.categoryId ? (row.categoryName ?? t("kategoriHilang")) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="max-w-[280px] whitespace-normal text-sm">{row.columns.join(", ")}</TableCell>
                    <TableCell className="max-w-[200px] whitespace-normal text-sm">{ringkasUkuran(row.rows)}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {row.dipakaiBarang > 0 ? t("dipakai", { count: row.dipakaiBarang }) : t("dipakaiTidak")}
                    </TableCell>
                    <TableCell>
                      {row.isActive ? (
                        <Badge className="border-emerald-600/25 bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400">
                          {t("aktif")}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{t("nonaktif")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setBuka({ mode: "ubah", baris: row })}
                          aria-label={bolehUbah ? t("ubahAria", { name: row.name }) : t("lihatAria", { name: row.name })}
                          title={bolehUbah ? t("ubah") : t("lihat")}
                        >
                          {bolehUbah ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Button>
                        {bolehUbah ? (
                          <span title={row.dipakaiBarang > 0 ? t("hapus.dipakai", { count: row.dipakaiBarang }) : t("hapus.tombol")}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setHapus(row)}
                              disabled={row.dipakaiBarang > 0}
                              aria-label={
                                row.dipakaiBarang > 0
                                  ? t("hapus.dipakai", { count: row.dipakaiBarang })
                                  : t("hapus.aria", { name: row.name })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {buka ? (
        <FormTabelUkuran
          key={buka.mode === "ubah" ? buka.baris.id : "baru"}
          awal={buka.mode === "ubah" ? buka.baris : null}
          kategori={kategori}
          bolehUbah={bolehUbah}
          onTutup={() => setBuka(null)}
          onTersimpan={() => {
            setBuka(null);
            router.refresh();
          }}
        />
      ) : null}

      <AlertDialog open={!!hapus} onOpenChange={(o) => !o && !menghapus && setHapus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hapus.judul")}</AlertDialogTitle>
            <AlertDialogDescription>
              {hapus?.categoryId ? t("hapus.isiKategori", { name: hapus.name }) : t("hapus.isi", { name: hapus?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={menghapus}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={menghapus}
              onClick={(e) => {
                e.preventDefault();
                lakukanHapus();
              }}
            >
              {menghapus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("hapus.tombol")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
