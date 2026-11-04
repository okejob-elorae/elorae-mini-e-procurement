"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { BadgeCheck, Loader2 } from "lucide-react";
import { aturAktifMemberAction } from "@/app/actions/spg-member-kantor";
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
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import type { DataMemberKantor } from "@/lib/spg/pelanggan-kantor";
import type { BarisMemberKantor, SaringStatusMember } from "@/lib/spg/pelanggan-lacak";
import { cn } from "@/lib/utils";
import { denganParam } from "../piutang/_daftar/halaman";
import { HalamanDaftar } from "../piutang/_daftar/HalamanDaftar";
import { KotakCari } from "../piutang/_daftar/KotakCari";

const JALUR = "/backoffice/spg-pelanggan";
const TOKO_TAMPIL = 3;

/**
 * Member Elorae di semua toko. Kantor menonaktifkan member (alasan wajib) —
 * ia tidak lagi mendapat diskon member dan SPG tidak bisa mendaftarkannya
 * ulang — atau mengaktifkannya kembali. Nomor HP disamarkan.
 */
export function DaftarMemberKantor({
  data,
  cari,
  status,
  bolehAtur,
}: {
  data: DataMemberKantor;
  cari: string;
  status: SaringStatusMember | null;
  /** `promos:manage`; tanpa itu tombol nonaktifkan/aktifkan tidak tampil. */
  bolehAtur: boolean;
}) {
  const t = useTranslations("spgPelanggan.kantor.member");
  const tk = useTranslations("spgPelanggan.kantor");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [sibuk, mulai] = useTransition();
  // Baris yang dipilih tetap dipegang sesudah dialog ditutup, supaya judulnya tidak berganti selama animasi tutup.
  const [pilih, setPilih] = useState<BarisMemberKantor | null>(null);
  const [terbuka, setTerbuka] = useState(false);
  const [alasan, setAlasan] = useState("");
  const tgl = (iso: string | null) => (iso ? formatDisplayDate(iso, locale) : "—");
  const h = data.halaman;
  const href = (s: SaringStatusMember | null) => denganParam(JALUR, { tab: "member", cari: cari || undefined }, { status: s, halaman: null });

  const buka = (m: BarisMemberKantor) => {
    setAlasan("");
    setPilih(m);
    setTerbuka(true);
  };
  const kirim = () => {
    if (!pilih) return;
    const aktif = !pilih.aktif;
    if (!aktif && !alasan.trim()) return;
    mulai(async () => {
      try {
        const r = await aturAktifMemberAction({ memberId: pilih.id, aktif, alasan: aktif ? null : alasan });
        if (!r.ok) {
          toast.error(td(`err.${r.code}`));
          return;
        }
        toast.success(aktif ? t("tersimpanAktif") : t("tersimpanNonaktif"));
        setTerbuka(false);
        router.refresh();
      } catch {
        toast.error(t("err.GAGAL"));
      }
    });
  };

  const tombol = (kunci: string, aktif: boolean, tujuan: string, label: string, n: number) => (
    <Link
      key={kunci}
      href={tujuan}
      replace
      scroll={false}
      aria-current={aktif ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
        aktif ? "border-primary ring-1 ring-primary/40" : "border-border hover:bg-muted/60",
      )}
    >
      {label}
      <span className="font-semibold tabular-nums">{n}</span>
    </Link>
  );

  const menonaktifkan = pilih?.aktif === true;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <KotakCari nilai={cari} placeholder={t("cari")} label={t("cari")} />
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("saringLabel")}>
          {tombol("semua", !status, href(null), tk("saring.semua"), data.hitung.semua)}
          {tombol("aktif", status === "aktif", href(status === "aktif" ? null : "aktif"), t("saring.aktif"), data.hitung.aktif)}
          {tombol("nonaktif", status === "nonaktif", href(status === "nonaktif" ? null : "nonaktif"), t("saring.nonaktif"), data.hitung.nonaktif)}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BadgeCheck className="h-5 w-5" />
            {t("judul")}
          </CardTitle>
        </CardHeader>
        <CardContent className={h.baris.length === 0 ? undefined : "px-0"}>
          {h.baris.length === 0 ? (
            cari || status ? (
              <EmptyState
                icon={BadgeCheck}
                title={t("kosongSaringJudul")}
                action={
                  <Button variant="outline" size="sm" asChild>
                    <Link href={denganParam(JALUR, {}, { tab: "member" })} replace>
                      {tk("hapusSaring")}
                    </Link>
                  </Button>
                }
              />
            ) : (
              <EmptyState icon={BadgeCheck} title={t("kosongJudul")} description={t("kosongIsi")} />
            )
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="[&_th]:whitespace-normal">
                  <TableRow>
                    <TableHead>{t("kolom.nama")}</TableHead>
                    <TableHead>{t("kolom.tingkat")}</TableHead>
                    <TableHead className="text-right">{t("kolom.belanjaPeriode", { bulan: data.periodeBulan })}</TableHead>
                    <TableHead>{t("kolom.toko")}</TableHead>
                    <TableHead>{t("kolom.bergabung")}</TableHead>
                    <TableHead>{t("kolom.status")}</TableHead>
                    {bolehAtur ? (
                      <TableHead className="text-right">
                        <span className="sr-only">{t("kolom.aksi")}</span>
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {h.baris.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="min-w-[10rem] whitespace-normal">
                        <span className="font-medium">{m.nama}</span>
                        <span className="block text-xs tabular-nums text-muted-foreground">{m.hpSamar}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{m.tingkat}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatIDR(m.belanjaPeriode)}</TableCell>
                      <TableCell className="min-w-[10rem] whitespace-normal">
                        {m.toko.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {m.toko
                              .slice(0, TOKO_TAMPIL)
                              .map((x) => x.nama)
                              .join(", ")}
                            {m.toko.length > TOKO_TAMPIL ? (
                              <span className="block text-xs text-muted-foreground">{t("tokoLain", { n: m.toko.length - TOKO_TAMPIL })}</span>
                            ) : null}
                          </>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[9rem] whitespace-normal">
                        {tgl(m.bergabung)}
                        <span className="block text-xs text-muted-foreground">{m.tokoBergabung}</span>
                      </TableCell>
                      <TableCell>
                        {m.aktif ? (
                          <StatusPill tone="settled">{t("status.aktif")}</StatusPill>
                        ) : (
                          <StatusPill tone="inactive" detail={t("status.nonaktifSejak", { tanggal: tgl(m.nonaktifSejak) })}>
                            {t("status.nonaktif")}
                          </StatusPill>
                        )}
                      </TableCell>
                      {bolehAtur ? (
                        <TableCell className="text-right">
                          <Button variant={m.aktif ? "outline" : "secondary"} size="sm" disabled={sibuk} onClick={() => buka(m)}>
                            {m.aktif ? t("nonaktifkan") : t("aktifkan")}
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {h.baris.length > 0 ? <HalamanDaftar halaman={h.halaman} totalHalaman={h.totalHalaman} total={h.total} ukuran={h.ukuran} /> : null}
        </CardContent>
      </Card>

      <AlertDialog open={terbuka} onOpenChange={(v) => (!v && !sibuk ? setTerbuka(false) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{menonaktifkan ? t("dialog.nonaktifJudul", { nama: pilih?.nama ?? "" }) : t("dialog.aktifJudul", { nama: pilih?.nama ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{menonaktifkan ? t("dialog.nonaktifIsi") : t("dialog.aktifIsi")}</AlertDialogDescription>
          </AlertDialogHeader>
          {menonaktifkan ? (
            <div className="space-y-1.5">
              <Label htmlFor="alasan-nonaktif-member">{t("dialog.alasan")}</Label>
              <Textarea id="alasan-nonaktif-member" value={alasan} maxLength={500} rows={3} disabled={sibuk} onChange={(e) => setAlasan(e.target.value)} />
              {!alasan.trim() ? <p className="text-xs text-muted-foreground">{t("dialog.alasanWajib")}</p> : null}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("dialog.batal")}</AlertDialogCancel>
            <AlertDialogAction
              variant={menonaktifkan ? "destructive" : "default"}
              disabled={sibuk || (menonaktifkan && !alasan.trim())}
              onClick={(e) => {
                // Dialog ditutup sesudah tersimpan, bukan saat tombol ditekan.
                e.preventDefault();
                kirim();
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" /> : menonaktifkan ? t("nonaktifkan") : t("aktifkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
