"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BookImage, ClipboardCheck, ImageIcon, Plus, Trash2 } from "lucide-react";
import { aturAktifPanduanAction, hapusPanduanAction } from "@/app/actions/panduan-display";
import type { BarisPanduan } from "@/lib/salesman/checklist-queries";
import { dinamis } from "@/lib/i18n/dinamis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export function PanduanListClient({ baris, bolehKelola }: { baris: BarisPanduan[]; bolehKelola: boolean }) {
  const t = useTranslations("panduanDisplay");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [hapus, setHapus] = useState<BarisPanduan | null>(null);

  const aturAktif = (id: string, aktif: boolean) =>
    mulai(async () => {
      const r = await aturAktifPanduanAction(id, aktif);
      if (!r.ok) {
        toast.error(td(`err.${r.kode}`));
        return;
      }
      toast.success(aktif ? t("diaktifkan") : t("dinonaktifkan"));
      router.refresh();
    });

  const hapusSekarang = () =>
    mulai(async () => {
      if (!hapus) return;
      const r = await hapusPanduanAction(hapus.id);
      setHapus(null);
      if (!r.ok) {
        toast.error(td(`err.${r.kode}`));
        return;
      }
      toast.success(t("dihapus"));
      router.refresh();
    });

  const periode = (b: BarisPanduan) =>
    b.mulai && b.selesai
      ? t("periodeAntara", { mulai: b.mulai, selesai: b.selesai })
      : b.mulai
        ? t("periodeSejak", { mulai: b.mulai })
        : b.selesai
          ? t("periodeSampai", { selesai: b.selesai })
          : t("periodeSelalu");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        description={t("deskripsi")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/backoffice/checklist-toko">
                <ClipboardCheck className="h-4 w-4" aria-hidden />
                {t("keChecklist")}
              </Link>
            </Button>
            {bolehKelola ? (
              <Button asChild>
                <Link href="/backoffice/panduan-display/baru">
                  <Plus className="h-4 w-4" aria-hidden />
                  {t("baru")}
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookImage className="h-4 w-4" aria-hidden />
            {t("daftarJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {baris.length === 0 ? (
            <EmptyState
              icon={BookImage}
              title={t("kosongJudul")}
              description={t("kosongIsi")}
              action={
                bolehKelola ? (
                  <Button asChild>
                    <Link href="/backoffice/panduan-display/baru">
                      <Plus className="h-4 w-4" aria-hidden />
                      {t("baru")}
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-0" />
                    <TableHead>{t("kolJudul")}</TableHead>
                    <TableHead>{t("kolUntuk")}</TableHead>
                    <TableHead>{t("kolPeriode")}</TableHead>
                    <TableHead>{t("kolStatus")}</TableHead>
                    <TableHead className="text-right">{t("kolFoto")}</TableHead>
                    <TableHead>{t("kolAktif")}</TableHead>
                    {bolehKelola ? <TableHead className="w-0" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {baris.map((b) => (
                    <TableRow key={b.id} className={b.isActive ? undefined : "text-muted-foreground"}>
                      <TableCell>
                        {b.gambarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={b.gambarUrl} alt="" className="h-12 w-12 rounded-md border object-cover" loading="lazy" />
                        ) : (
                          <span className="grid h-12 w-12 place-items-center rounded-md border bg-muted text-muted-foreground">
                            <ImageIcon className="h-4 w-4" aria-hidden />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal font-medium">
                        <Link href={`/backoffice/panduan-display/${b.id}`} className="hover:underline">
                          {b.judul}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">
                        {b.termsType ? td(`jenisToko.${b.termsType}`) : t("jenisToko.SEMUA")}
                        <span className="block text-xs text-muted-foreground">{b.area ?? t("semuaArea")}</span>
                      </TableCell>
                      <TableCell className="whitespace-normal text-sm">{periode(b)}</TableCell>
                      <TableCell>
                        <Badge variant={b.berlakuSekarang ? "default" : "outline"}>
                          {b.berlakuSekarang ? t("statusBerlaku") : b.isActive ? t("statusDiLuarPeriode") : t("statusNonaktif")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{b.jumlahFoto}</TableCell>
                      <TableCell>
                        <Switch checked={b.isActive} disabled={!bolehKelola || sibuk} onCheckedChange={(v) => aturAktif(b.id, v)} aria-label={t("kolAktif")} />
                      </TableCell>
                      {bolehKelola ? (
                        <TableCell>
                          {b.jumlahFoto === 0 ? (
                            <Button variant="ghost" size="icon" aria-label={t("hapus")} disabled={sibuk} onClick={() => setHapus(b)}>
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          ) : null}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={hapus !== null} onOpenChange={(o) => (!o ? setHapus(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hapusJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{t("hapusIsi", { judul: hapus?.judul ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction disabled={sibuk} onClick={hapusSekarang}>
              {t("hapus")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
