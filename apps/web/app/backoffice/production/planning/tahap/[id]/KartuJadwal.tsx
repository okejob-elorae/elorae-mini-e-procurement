"use client";

import { Fragment, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, CalendarClock, Download, GripVertical, MessageCircle, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { KalenderKerja } from "@/lib/production/hari-kerja";
import type { StatusLangkah } from "@/lib/production/jadwal";
import type { LangkahRuangKerja, RuangKerjaTahap } from "@/lib/production/jadwal-queries";
import { hapusLangkahAction, pindahLangkahKeAction, pindahUrutanLangkahAction } from "@/app/actions/jadwal-produksi";
import { HantuSeret } from "@/components/gerak/HantuSeret";
import { ATRIBUT_BUTIR, atributDaftar, garisSisipDi, useSeretUrut } from "@/components/gerak/useSeretUrut";
import { formatDisplayDate } from "@/lib/date-only";
import { celahDiam, indeksTujuan } from "@/lib/gerak/seret-urut";
import { cn } from "@/lib/utils";
import { DialogLangkah, type SasaranLangkah } from "./DialogLangkah";
import { DialogStatusLangkah } from "./DialogStatusLangkah";
import { DialogTarikJadwal } from "./DialogTarikJadwal";
import {
  hariTerlambat,
  labelPendek,
  labelTahapRuang,
  pesanWaLangkah,
  pratinjauPindah,
  tautanWaDenganPesan,
} from "./ruang-kerja";
import type { HasilAksi } from "./pakai-aksi";
import type { PemasokPilihan } from "./RuangKerjaClient";

/** `data-seret-daftar` tabel jadwal — satu daftar per halaman. */
const DAFTAR_JADWAL = "jadwal";

const NADA_STATUS: Record<StatusLangkah, StatusTone> = {
  BELUM: "inactive",
  PROSES: "progress",
  SELESAI: "settled",
};

type Props = {
  data: RuangKerjaTahap;
  kal: KalenderKerja;
  pemasok: PemasokPilihan[];
  bolehUbah: boolean;
  sibuk: boolean;
  jalankan: (aksi: () => Promise<HasilAksi>, pesanBerhasil: string) => Promise<boolean>;
};

export function KartuJadwal({ data, kal, pemasok, bolehUbah, sibuk, jalankan }: Props) {
  const t = useTranslations("jadwalProduksi.ruang");
  const locale = useLocale();
  const [ubahStatus, setUbahStatus] = useState<LangkahRuangKerja | null>(null);
  const [sasaranLangkah, setSasaranLangkah] = useState<SasaranLangkah | null>(null);
  const [akanDihapus, setAkanDihapus] = useState<LangkahRuangKerja | null>(null);
  const [tarikBuka, setTarikBuka] = useState(false);

  const { tahap, langkah, hariIni } = data;

  // Urutan hasil seret tampil seketika (dengan tanggal pratinjaunya) sampai data
  // segar dari server tiba; bila ditolak, kembali ke urutan server.
  const kunciData = langkah.map((l) => `${l.id}:${l.targetDate}:${l.status}`).join("|");
  const [sementara, setSementara] = useState<{ kunci: string; urutan: string[]; target: Record<string, string> } | null>(
    null,
  );
  const baris: LangkahRuangKerja[] =
    sementara && sementara.kunci === kunciData
      ? sementara.urutan
          .map((id) => langkah.find((l) => l.id === id))
          .filter((l): l is LangkahRuangKerja => !!l)
          .map((l) => ({ ...l, targetDate: sementara.target[l.id] ?? l.targetDate }))
      : langkah;
  const judulTahap = labelTahapRuang(tahap);
  const mulai = tahap.scheduleStart ?? hariIni;

  const tombolTarik = (
    <Button type="button" onClick={() => setTarikBuka(true)}>
      <Download className="mr-2 h-4 w-4" />
      {t("tarik")}
    </Button>
  );

  const pindah = (l: LangkahRuangKerja, arah: "NAIK" | "TURUN") =>
    void jalankan(() => pindahUrutanLangkahAction({ stepId: l.id, arah }), t("berhasilDipindah"));

  // Seret-lepas (mouse dan jari); panah ↑/↓ tetap jalan papan ketik.
  const seret = useSeretUrut<string>({
    nonaktif: !bolehUbah || sibuk,
    bolehLepas: (_, daftar) => daftar === DAFTAR_JADWAL,
    onLepas: (stepId, { celah }) => {
      const dari = baris.findIndex((l) => l.id === stepId);
      if (dari < 0 || celahDiam(dari, celah)) return;
      const posisi = indeksTujuan(dari, celah);
      const hasil = pratinjauPindah({ langkah: baris, dari, ke: posisi, mulai, kal });
      setSementara({ kunci: kunciData, urutan: hasil.urutan, target: hasil.target });
      void jalankan(() => pindahLangkahKeAction({ stepId, posisi }), t("berhasilDipindah")).then((ok) => {
        if (!ok) setSementara(null);
      });
    },
  });
  const dariSeret = seret.sesi ? baris.findIndex((l) => l.id === seret.sesi?.data) : -1;
  const celahSeret = seret.sesi?.sasaran?.celah ?? null;
  const pratinjau =
    dariSeret >= 0 && celahSeret !== null && !celahDiam(dariSeret, celahSeret)
      ? {
          posisi: indeksTujuan(dariSeret, celahSeret),
          ...pratinjauPindah({ langkah: baris, dari: dariSeret, ke: indeksTujuan(dariSeret, celahSeret), mulai, kal }),
        }
      : null;
  const langkahDiseret = dariSeret >= 0 ? baris[dariSeret] : null;
  const keteranganSeret = pratinjau
    ? t("seretPosisi", { posisi: pratinjau.posisi + 1, jumlah: baris.length })
    : seret.sesi
      ? t("seretTetap")
      : null;
  const kolomTabel = bolehUbah ? 7 : 6;
  const garisSisip = (i: number) =>
    garisSisipDi(seret.sesi, DAFTAR_JADWAL, i, dariSeret >= 0 ? dariSeret : null) ? (
      <TableRow aria-hidden className="border-0 hover:bg-transparent">
        <TableCell colSpan={kolomTabel} className="p-0">
          <div className="h-0.5 rounded-full bg-primary" />
        </TableCell>
      </TableRow>
    ) : null;

  const hapus = async (l: LangkahRuangKerja) => {
    await jalankan(() => hapusLangkahAction({ stepId: l.id }), t("berhasilDihapus"));
    setAkanDihapus(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          {t("jadwalJudul")}
        </CardTitle>
        {bolehUbah && langkah.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setSasaranLangkah({ jenis: "tambah" })}>
              <Plus className="mr-2 h-4 w-4" />
              {t("tambahLangkah")}
            </Button>
            {tombolTarik}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {langkah.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={t("jadwalKosongJudul")}
            description={bolehUbah ? t("jadwalKosongIsi") : undefined}
            action={
              bolehUbah ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {tombolTarik}
                  <Button type="button" variant="outline" onClick={() => setSasaranLangkah({ jenis: "tambah" })}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("tambahLangkah")}
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-2">
          {pratinjau ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {pratinjau.selesaiPadaBaru === pratinjau.selesaiPadaLama
                ? t("perkiraanTetap", { tanggal: labelPendek(pratinjau.selesaiPadaBaru, hariIni, locale) })
                : t("perkiraanBerubah", {
                    lama: labelPendek(pratinjau.selesaiPadaLama, hariIni, locale),
                    baru: labelPendek(pratinjau.selesaiPadaBaru, hariIni, locale),
                  })}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">{t("kolNo")}</TableHead>
                  <TableHead className="min-w-[160px]">{t("kolLangkah")}</TableHead>
                  <TableHead className="min-w-[140px]">{t("kolPemasok")}</TableHead>
                  <TableHead className="text-right">{t("kolLama")}</TableHead>
                  <TableHead>{t("kolTarget")}</TableHead>
                  <TableHead>{t("kolStatus")}</TableHead>
                  {bolehUbah ? (
                    <TableHead className="w-[148px] text-right">
                      <span className="sr-only">{t("kolAksi")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody {...atributDaftar(DAFTAR_JADWAL)}>
                {baris.map((l, i) => {
                  const pil = (
                    <StatusPill
                      tone={NADA_STATUS[l.status]}
                      detail={
                        l.status === "SELESAI" && l.doneDate
                          ? t("selesaiPada", { tanggal: formatDisplayDate(l.doneDate, locale) })
                          : undefined
                      }
                    >
                      {t(`status${l.status}`)}
                    </StatusPill>
                  );
                  const waPesan =
                    l.pemasok?.wa && l.status !== "SELESAI"
                      ? tautanWaDenganPesan(
                          l.pemasok.wa,
                          pesanWaLangkah({
                            pemasok: l.pemasok.name,
                            langkah: l.name,
                            tahap: judulTahap,
                            targetDate: l.targetDate,
                          }),
                        )
                      : null;
                  const diangkat = seret.sesi?.data === l.id;
                  const targetBaru = pratinjau && pratinjau.target[l.id] !== l.targetDate ? pratinjau.target[l.id] : null;
                  return (
                    <Fragment key={l.id}>
                    {garisSisip(i)}
                    <TableRow
                      {...ATRIBUT_BUTIR}
                      className={cn(
                        diangkat && "bg-primary/10 shadow-md motion-safe:transition-colors",
                      )}
                    >
                      <TableCell className="tabular-nums text-muted-foreground">
                        <span className="flex items-center gap-1">
                          {bolehUbah ? (
                            <span
                              {...seret.pegangan(l.id)}
                              aria-hidden
                              title={t("seretUrut")}
                              className={cn(
                                "-ml-1 inline-flex h-8 w-6 shrink-0 touch-none items-center justify-center rounded text-muted-foreground",
                                sibuk ? "cursor-not-allowed opacity-40" : "cursor-grab hover:bg-muted active:cursor-grabbing",
                              )}
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                          ) : null}
                          {i + 1}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{l.name}</p>
                        {l.note ? <p className="text-xs text-muted-foreground">{l.note}</p> : null}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {l.pemasok ? (
                          <div className="flex items-center gap-1">
                            <span>{l.pemasok.name}</span>
                            {waPesan ? (
                              <Button asChild variant="ghost" size="icon-sm">
                                <a
                                  href={waPesan}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={t("tanyaWa", { pemasok: l.pemasok.name })}
                                  title={t("tanyaWa", { pemasok: l.pemasok.name })}
                                >
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{t("tanpaPemasok")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{t("hariKerja", { n: l.durationDays })}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <span>{formatDisplayDate(l.targetDate, locale)}</span>
                          {targetBaru ? (
                            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                              {t("seretTargetBaru", { tanggal: labelPendek(targetBaru, hariIni, locale) })}
                            </span>
                          ) : null}
                          {l.keadaan === "TELAT" ? (
                            <StatusPill tone="attention">
                              {t("telatHari", { n: hariTerlambat(l.targetDate, hariIni) })}
                            </StatusPill>
                          ) : l.keadaan === "HARI_INI" ? (
                            <StatusPill tone="waiting">{t("hariIni")}</StatusPill>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {bolehUbah ? (
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-auto rounded-md px-1 py-1 font-normal"
                            disabled={sibuk}
                            aria-label={t("ubahStatusOleh", { nama: l.name })}
                            title={t("ubahStatusOleh", { nama: l.name })}
                            onClick={() => setUbahStatus(l)}
                          >
                            {pil}
                          </Button>
                        ) : (
                          pil
                        )}
                      </TableCell>
                      {bolehUbah ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={sibuk || i === 0}
                              aria-label={t("naik", { nama: l.name })}
                              title={t("naik", { nama: l.name })}
                              onClick={() => pindah(l, "NAIK")}
                            >
                              <ArrowUp className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={sibuk || i === baris.length - 1}
                              aria-label={t("turun", { nama: l.name })}
                              title={t("turun", { nama: l.name })}
                              onClick={() => pindah(l, "TURUN")}
                            >
                              <ArrowDown className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={sibuk}
                              aria-label={t("ubah", { nama: l.name })}
                              title={t("ubah", { nama: l.name })}
                              onClick={() => setSasaranLangkah({ jenis: "ubah", langkah: l })}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={sibuk}
                              aria-label={t("hapus", { nama: l.name })}
                              title={t("hapus", { nama: l.name })}
                              onClick={() => setAkanDihapus(l)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                    </Fragment>
                  );
                })}
                {garisSisip(baris.length)}
              </TableBody>
            </Table>
          </div>
          </div>
        )}
      </CardContent>

      <HantuSeret sesi={seret.sesi} label={langkahDiseret?.name ?? ""} keterangan={keteranganSeret} />

      {bolehUbah ? (
        <>
          <DialogStatusLangkah
            langkah={ubahStatus}
            semuaLangkah={langkah}
            mulai={mulai}
            hariIni={hariIni}
            kal={kal}
            sibuk={sibuk}
            jalankan={jalankan}
            onOpenChange={(buka) => !buka && setUbahStatus(null)}
          />
          <DialogLangkah
            sasaran={sasaranLangkah}
            planStageId={tahap.id}
            pemasok={pemasok}
            sibuk={sibuk}
            jalankan={jalankan}
            onOpenChange={(buka) => !buka && setSasaranLangkah(null)}
          />
          <DialogTarikJadwal
            buka={tarikBuka}
            data={data}
            kal={kal}
            sibuk={sibuk}
            jalankan={jalankan}
            onOpenChange={setTarikBuka}
          />
          <AlertDialog open={!!akanDihapus} onOpenChange={(buka) => !buka && setAkanDihapus(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("hapusJudul", { nama: akanDihapus?.name ?? "" })}</AlertDialogTitle>
                <AlertDialogDescription>{t("hapusIsi")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  disabled={sibuk}
                  onClick={(e) => {
                    e.preventDefault();
                    if (akanDihapus) void hapus(akanDihapus);
                  }}
                >
                  {t("hapusYa")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : null}
    </Card>
  );
}
