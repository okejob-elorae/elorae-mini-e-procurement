"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowLeft, CheckCheck, Megaphone, Pencil, Pin, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TombolBantuan } from "@/components/bantuan/TombolBantuan";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { dinamis } from "@/lib/i18n/dinamis";
import type { RincianPengumumanKantor, StatusBaca } from "@/lib/pengumuman/queries";
import { arsipkanPengumumanAction, hapusPengumumanAction, pulihkanPengumumanAction, type HasilAksiPengumuman } from "@/app/actions/pengumuman";
import { cn } from "@/lib/utils";
import { LencanaAudiens, LencanaKeadaan } from "../Lencana";

const NADA_STATUS: Record<StatusBaca, string> = {
  BELUM: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DIBACA: "bg-primary/10 text-primary",
  DIKONFIRMASI: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
};

type Saring = "SEMUA" | "BELUM" | "BELUM_KONFIRMASI";

export function RincianPengumumanClient({ rincian: r, canManage }: { rincian: RincianPengumumanKantor; canManage: boolean }) {
  const t = useTranslations("pengumuman");
  const td = dinamis(t);
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  const [tanya, setTanya] = useState<"arsip" | "hapus" | null>(null);
  const [saring, setSaring] = useState<Saring>("SEMUA");

  const diarsipkan = r.keadaan === "DIARSIPKAN";
  const baris = r.laporan.baris.filter((b) =>
    saring === "BELUM" ? b.status === "BELUM" : saring === "BELUM_KONFIRMASI" ? b.status !== "DIKONFIRMASI" : true,
  );

  /** `pindahKe` = halaman ini tidak ada lagi sesudahnya (hapus): pindah, jangan segarkan. */
  function jalankan(kerja: () => Promise<HasilAksiPengumuman>, berhasil: string, pindahKe?: string) {
    mulai(async () => {
      let h: HasilAksiPengumuman;
      try {
        h = await kerja();
      } catch {
        toast.error(t("form.err.JARINGAN"));
        return;
      }
      if (h.ok) {
        toast.success(berhasil);
        setTanya(null);
        if (pindahKe) router.push(pindahKe);
        else router.refresh();
      } else {
        toast.error(td(`form.err.${h.kode}`));
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/backoffice/pengumuman">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-start gap-1">
            <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight">{r.title}</h1>
            <TombolBantuan judul={r.title} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LencanaKeadaan keadaan={r.keadaan} />
            <LencanaAudiens audience={r.audience} />
            {r.pinned ? (
              <Badge variant="outline" className="gap-1">
                <Pin className="h-3 w-3" aria-hidden />
                {t("disematkan")}
              </Badge>
            ) : null}
            {r.requireAck ? <Badge variant="outline">{t("wajibKonfirmasi")}</Badge> : null}
          </div>
        </div>
        {canManage ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!diarsipkan ? (
              <Button asChild variant="outline">
                <Link href={`/backoffice/pengumuman/${r.id}/ubah`}>
                  <Pencil className="mr-2 h-4 w-4" aria-hidden />
                  {t("ubah")}
                </Link>
              </Button>
            ) : null}
            {diarsipkan ? (
              <Button variant="outline" disabled={sibuk} onClick={() => jalankan(() => pulihkanPengumumanAction(r.id), t("okPulihkan"))}>
                <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden />
                {t("pulihkan")}
              </Button>
            ) : (
              <Button variant="outline" disabled={sibuk} onClick={() => setTanya("arsip")}>
                <Archive className="mr-2 h-4 w-4" aria-hidden />
                {t("arsipkan")}
              </Button>
            )}
            {r.bolehHapus ? (
              <Button variant="outline" className="text-destructive" disabled={sibuk} onClick={() => setTanya("hapus")}>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                {t("hapus")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {r.keadaan === "TERJADWAL" ? (
        <p className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">{t("catatanTerjadwal", { waktu: r.terbit })}</p>
      ) : null}
      {diarsipkan ? (
        <p className="rounded-lg border bg-muted px-4 py-3 text-sm">{t("catatanArsip", { waktu: r.diarsipkan ?? "—" })}</p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Megaphone className="h-5 w-5" aria-hidden />
              {t("isi")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{r.body}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("info")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Info label={t("kolom.terbit")} nilai={r.terbit} />
              <Info label={t("kolom.berakhir")} nilai={r.kedaluwarsa ?? t("tanpaBatas")} />
              <Info label={t("kolom.pembuat")} nilai={r.pembuat} />
              <Info label={t("dibuat")} nilai={r.dibuat} />
              <Info label={t("diubah")} nilai={r.diubah} />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" aria-hidden />
            {t("laporan.judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Angka label={t("laporan.penerima")} nilai={r.laporan.penerima} />
            <Angka label={t("laporan.dibaca")} nilai={r.laporan.dibaca} />
            <Angka label={t("laporan.belum")} nilai={r.laporan.penerima - r.laporan.dibaca} nada={r.laporan.penerima - r.laporan.dibaca > 0 ? "tunggu" : null} />
            {r.requireAck ? <Angka label={t("laporan.dikonfirmasi")} nilai={r.laporan.dikonfirmasi} /> : null}
          </div>

          {r.laporan.baris.length === 0 ? (
            <EmptyState icon={Users} title={t("laporan.kosongJudul")} description={t("laporan.kosongIsi")} />
          ) : (
            <>
              <Tabs value={saring} onValueChange={(v) => setSaring(v as Saring)}>
                <TabsList aria-label={t("laporan.saring")}>
                  <TabsTrigger value="SEMUA">{t("laporan.saringSemua")}</TabsTrigger>
                  <TabsTrigger value="BELUM">{t("laporan.saringBelum")}</TabsTrigger>
                  {r.requireAck ? <TabsTrigger value="BELUM_KONFIRMASI">{t("laporan.saringBelumKonfirmasi")}</TabsTrigger> : null}
                </TabsList>
              </Tabs>
              {baris.length === 0 ? (
                <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <CheckCheck className="h-4 w-4" aria-hidden />
                  {t("laporan.semuaSudah")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("laporan.nama")}</TableHead>
                        <TableHead>{t("laporan.peran")}</TableHead>
                        <TableHead>{t("laporan.status")}</TableHead>
                        <TableHead>{t("laporan.dibacaPada")}</TableHead>
                        {r.requireAck ? <TableHead>{t("laporan.dikonfirmasiPada")}</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {baris.map((b) => (
                        <TableRow key={b.userId}>
                          <TableCell className="font-medium">
                            {b.nama}
                            {b.bukanPenerima ? <div className="text-xs font-normal text-muted-foreground">{t("laporan.bukanPenerima")}</div> : null}
                          </TableCell>
                          <TableCell className="whitespace-normal text-sm">
                            {b.peran ? t(`laporan.peranNilai.${b.peran}`) : "—"}
                            {b.tokoNama ? <span className="text-muted-foreground"> · {b.tokoNama}</span> : null}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("border-transparent", NADA_STATUS[b.status])}>
                              {t(`laporan.statusNilai.${b.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm tabular-nums">{b.dibacaPada ?? "—"}</TableCell>
                          {r.requireAck ? <TableCell className="text-sm tabular-nums">{b.dikonfirmasiPada ?? "—"}</TableCell> : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={tanya !== null} onOpenChange={(o) => !o && !sibuk && setTanya(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tanya === "hapus" ? t("hapusJudul") : t("arsipJudul")}</AlertDialogTitle>
            <AlertDialogDescription>{tanya === "hapus" ? t("hapusIsi") : t("arsipIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              className={tanya === "hapus" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
              onClick={(e) => {
                e.preventDefault();
                if (tanya === "hapus") {
                  jalankan(() => hapusPengumumanAction(r.id), t("okHapus"), "/backoffice/pengumuman");
                } else {
                  jalankan(() => arsipkanPengumumanAction(r.id), t("okArsip"));
                }
              }}
            >
              {tanya === "hapus" ? t("hapus") : t("arsipkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Info({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{nilai}</dd>
    </div>
  );
}

function Angka({ label, nilai, nada }: { label: string; nilai: number; nada?: "tunggu" | null }) {
  return (
    <div className="rounded-lg border p-3">
      <p className={cn("text-2xl font-semibold tabular-nums", nada === "tunggu" && "text-amber-700 dark:text-amber-400")}>{nilai}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
