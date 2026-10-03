"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarRange, ChevronLeft, ChevronRight, Copy, Loader2, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { salinMingguLaluAction, ubahJadwalAction, type HasilAksiJadwal } from "@/app/actions/jadwal-kunjungan";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { geserHari, hariKeMinggu, MAKS_CATATAN_JADWAL, MAKS_TOKO_PER_HARI, type RingkasJadwal, type StatusJadwal } from "@/lib/salesman/jadwal";
import type { BarisJadwalTampil, HariJadwal } from "@/lib/salesman/jadwal-queries";
import { cn } from "@/lib/utils";
import { CatatanJadwalDialog } from "./CatatanJadwalDialog";
import { TambahTokoJadwalDialog } from "./TambahTokoJadwalDialog";

const ALAMAT = "/backoffice/jadwal-kunjungan";

const NADA_STATUS: Record<StatusJadwal, StatusTone> = {
  DIKUNJUNGI: "settled",
  TERLEWAT: "attention",
  MENUNGGU: "waiting",
  IZIN: "inactive",
};

export type Props = {
  sales: { id: string; nama: string }[];
  salesmanId: string | null;
  senin: string;
  hariIni: string;
  mingguIni: string;
  sebelum: string;
  sesudah: string;
  hari: HariJadwal[];
  ringkas: RingkasJadwal | null;
  area: { id: string; kode: string; nama: string }[];
  bolehAtur: boolean;
  terkunci: boolean;
};

/** Pesan galat aksi — satu tempat, dipakai simpan, hapus, catatan dan dialog tambah. */
export function useTeksGalat() {
  const t = useTranslations("jadwalKunjungan");
  const td = dinamis(t);
  return (r: Extract<HasilAksiJadwal, { ok: false }>) =>
    td(`err.${r.code}`, {
      maks: r.code === "CATATAN_TERLALU_PANJANG" ? MAKS_CATATAN_JADWAL : MAKS_TOKO_PER_HARI,
      toko: (r.toko ?? []).join(", "),
    });
}

/**
 * Layar kantor jadwal kunjungan: satu sales, satu minggu. Setiap hari satu
 * kartu berisi tabel toko; hari ini dan sesudahnya bisa diubah, hari lalu
 * hanya dibaca beserta status kepatuhannya. Setiap simpan langsung ke server
 * (satu transaksi + satu jejak) lalu halaman dimuat ulang — tidak ada draf.
 */
export function JadwalKunjunganClient(props: Props) {
  const t = useTranslations("jadwalKunjungan");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const teksGalat = useTeksGalat();
  const [menyalin, mulaiSalin] = useTransition();
  const [menyimpan, mulaiSimpan] = useTransition();
  const [tambahUntuk, setTambahUntuk] = useState<HariJadwal | null>(null);
  const [catatanUntuk, setCatatanUntuk] = useState<BarisJadwalTampil | null>(null);
  const [kosongkanUntuk, setKosongkanUntuk] = useState<HariJadwal | null>(null);

  const alamat = (minggu: string, sales = props.salesmanId) =>
    `${ALAMAT}?${new URLSearchParams({ ...(sales ? { sales } : {}), minggu }).toString()}`;
  const tanggal = (dayKey: string) => formatDisplayDate(new Date(`${dayKey}T00:00:00+07:00`), locale);
  const labelHari = (dayKey: string) => `${td(`hari.${hariKeMinggu(dayKey)}`)}, ${tanggal(dayKey)}`;
  const bisaUbah = (dayKey: string) => props.bolehAtur && dayKey >= props.hariIni;
  const akhirMinggu = geserHari(props.senin, 6);
  const mingguBisaDiubah = props.bolehAtur && akhirMinggu >= props.hariIni;
  const namaSales = props.sales.find((s) => s.id === props.salesmanId)?.nama ?? "";

  const simpan = (perubahan: Parameters<typeof ubahJadwalAction>[0]["perubahan"], selesai?: () => void) => {
    if (!props.salesmanId) return;
    const salesmanId = props.salesmanId;
    mulaiSimpan(async () => {
      const r = await ubahJadwalAction({ salesmanId, perubahan });
      if (!r.ok) {
        toast.error(teksGalat(r));
        return;
      }
      if (r.hariBerubah.length) toast.success(t("tersimpan"));
      selesai?.();
      router.refresh();
    });
  };

  const salin = () => {
    if (!props.salesmanId) return;
    const salesmanId = props.salesmanId;
    mulaiSalin(async () => {
      const r = await salinMingguLaluAction({ salesmanId, minggu: props.senin });
      if (!r.ok) {
        toast.error(td(`err.${r.code}`, { maks: MAKS_TOKO_PER_HARI, toko: "" }));
        return;
      }
      const rincian = (Object.entries(r.dilewati) as [keyof typeof r.dilewati, number][])
        .filter(([, n]) => n > 0)
        .map(([k, n]) => td(`lewati.${k}`, { count: n }))
        .join(", ");
      const kepala = r.disalin > 0 ? t("salinHasil", { count: r.disalin }) : t("salinKosong");
      (r.disalin > 0 ? toast.success : toast.info)(rincian ? `${kepala} ${t("salinDilewati", { rincian })}` : kepala);
      if (r.disalin > 0) router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul")}
        description={t("deskripsi")}
        actions={
          mingguBisaDiubah && props.salesmanId ? (
            <Button variant="outline" onClick={salin} disabled={menyalin}>
              {menyalin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
              {t("salinMingguLalu")}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select
          value={props.salesmanId ?? undefined}
          onValueChange={(id) => router.push(alamat(props.senin, id))}
          disabled={props.sales.length === 0}
        >
          <SelectTrigger className="w-full sm:w-[260px]" aria-label={t("pilihSales")}>
            <SelectValue placeholder={t("pilihSales")} />
          </SelectTrigger>
          <SelectContent>
            {props.sales.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label={t("mingguSebelum")}>
            <Link href={alamat(props.sebelum)}>
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <span className="min-w-[11rem] text-center text-sm font-medium tabular-nums">
            {t("rentangMinggu", { dari: tanggal(props.senin), sampai: tanggal(akhirMinggu) })}
          </span>
          <Button asChild variant="outline" size="icon" aria-label={t("mingguSesudah")}>
            <Link href={alamat(props.sesudah)}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
          {props.senin !== props.mingguIni ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={alamat(props.mingguIni)}>{t("mingguIni")}</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {props.terkunci && props.bolehAtur ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          {t("terkunci")}
        </p>
      ) : null}
      {!props.bolehAtur ? <p className="text-sm text-muted-foreground">{t("hanyaLihat")}</p> : null}

      {!props.salesmanId ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState icon={Users} title={t("kosongSalesJudul")} description={t("kosongSalesIsi")} />
          </CardContent>
        </Card>
      ) : (
        <>
          {props.ringkas && props.ringkas.direncanakan > 0 ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {t("ringkasMinggu", { count: props.ringkas.direncanakan, nama: namaSales })}
              </span>{" "}
              · {t("ringkasKepatuhan", props.ringkas)}
            </p>
          ) : null}

          <div className="space-y-4">
            {props.hari.map((h) => {
              const lewat = h.dayKey < props.hariIni;
              const hariIni = h.dayKey === props.hariIni;
              const ubah = bisaUbah(h.dayKey);
              const r = h.ringkas;
              const nadaHari: StatusTone =
                r.direncanakan === 0 ? "inactive" : r.terlewat > 0 ? "attention" : r.menunggu > 0 ? "waiting" : "settled";
              return (
                <Card key={h.dayKey} className={cn(hariIni && "border-primary")}>
                  <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      <CalendarRange className="h-5 w-5" aria-hidden />
                      {labelHari(h.dayKey)}
                      {hariIni ? <Badge>{t("hariIniLencana")}</Badge> : null}
                      {lewat && r.direncanakan === 0 ? (
                        <span className="text-xs font-normal text-muted-foreground">{t("hariLewat")}</span>
                      ) : null}
                      {r.direncanakan > 0 ? (
                        <span className="text-sm font-normal text-muted-foreground">
                          {t("jumlahToko", { count: r.direncanakan })}
                        </span>
                      ) : null}
                      {(lewat || hariIni) && r.direncanakan > 0 ? (
                        <StatusPill tone={nadaHari}>
                          {t("kepatuhanHari", { dikunjungi: r.dikunjungi, direncanakan: r.direncanakan })}
                        </StatusPill>
                      ) : null}
                    </CardTitle>
                    {ubah ? (
                      <div className="flex items-center gap-2">
                        {h.toko.length > 0 ? (
                          <Button variant="ghost" size="sm" onClick={() => setKosongkanUntuk(h)} disabled={menyimpan}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t("kosongkan")}
                          </Button>
                        ) : null}
                        <Button size="sm" onClick={() => setTambahUntuk(h)} disabled={menyimpan || h.toko.length >= MAKS_TOKO_PER_HARI}>
                          <Plus className="mr-2 h-4 w-4" />
                          {t("tambahToko")}
                        </Button>
                      </div>
                    ) : null}
                  </CardHeader>
                  <CardContent className="pt-0">
                    {h.toko.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("kosongHari")}</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-[180px]">{t("kolom.toko")}</TableHead>
                              <TableHead>{t("kolom.area")}</TableHead>
                              <TableHead className="min-w-[200px]">{t("kolom.catatan")}</TableHead>
                              <TableHead>{t("kolom.status")}</TableHead>
                              {ubah ? (
                                <TableHead className="w-24 text-right">
                                  <span className="sr-only">{t("kolom.aksi")}</span>
                                </TableHead>
                              ) : null}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {h.toko.map((b) => (
                              <TableRow key={b.id}>
                                <TableCell className="whitespace-normal">
                                  <p className="font-medium">{b.nama}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {b.kode}
                                    {!b.aktif ? (
                                      <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[10px]">
                                        {t("tokoNonaktif")}
                                      </Badge>
                                    ) : null}
                                  </p>
                                </TableCell>
                                <TableCell className="text-sm">{b.area ?? "—"}</TableCell>
                                <TableCell className="whitespace-normal text-sm">
                                  {b.catatan ?? <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell>
                                  {lewat || hariIni ? (
                                    <StatusPill tone={NADA_STATUS[b.status]}>{td(`status.${b.status}`)}</StatusPill>
                                  ) : (
                                    <StatusPill tone="inactive">{t("status.TERJADWAL")}</StatusPill>
                                  )}
                                </TableCell>
                                {ubah ? (
                                  <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setCatatanUntuk(b)}
                                        disabled={menyimpan}
                                        aria-label={t("ubahCatatan", { toko: b.nama })}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-destructive"
                                        onClick={() => simpan({ hapus: [{ dayKey: b.dayKey, storeId: b.storeId }] })}
                                        disabled={menyimpan}
                                        aria-label={t("hapusToko", { toko: b.nama })}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
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
              );
            })}
          </div>
        </>
      )}

      {props.salesmanId && tambahUntuk ? (
        <TambahTokoJadwalDialog
          key={tambahUntuk.dayKey}
          open
          onOpenChange={(o) => !o && setTambahUntuk(null)}
          salesmanId={props.salesmanId}
          labelHari={labelHari(tambahUntuk.dayKey)}
          sudah={tambahUntuk.toko.map((b) => b.storeId)}
          area={props.area}
          menyimpan={menyimpan}
          onTambah={(storeIds, note) =>
            simpan({ tambah: storeIds.map((storeId) => ({ dayKey: tambahUntuk.dayKey, storeId, note })) }, () =>
              setTambahUntuk(null),
            )
          }
        />
      ) : null}

      {catatanUntuk ? (
        <CatatanJadwalDialog
          key={catatanUntuk.id}
          open
          onOpenChange={(o) => !o && setCatatanUntuk(null)}
          toko={catatanUntuk.nama}
          labelHari={labelHari(catatanUntuk.dayKey)}
          awal={catatanUntuk.catatan ?? ""}
          menyimpan={menyimpan}
          onSimpan={(note) =>
            simpan({ catatan: [{ dayKey: catatanUntuk.dayKey, storeId: catatanUntuk.storeId, note }] }, () =>
              setCatatanUntuk(null),
            )
          }
        />
      ) : null}

      <AlertDialog open={kosongkanUntuk !== null} onOpenChange={(o) => !o && setKosongkanUntuk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {kosongkanUntuk ? t("kosongkanJudul", { tanggal: labelHari(kosongkanUntuk.dayKey) }) : null}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("kosongkanIsi", { count: kosongkanUntuk?.toko.length ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const h = kosongkanUntuk;
                if (h) simpan({ ganti: [{ dayKey: h.dayKey, toko: [] }] }, () => setKosongkanUntuk(null));
              }}
            >
              {t("kosongkan")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
