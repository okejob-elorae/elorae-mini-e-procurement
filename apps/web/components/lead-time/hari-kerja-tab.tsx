"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, CalendarX, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ambilHariKerjaAction, simpanHariKerjaAction, simpanTanggalMerahAction } from "@/app/actions/jadwal-produksi";
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
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import { liburTetapTahun, type TanggalMerah } from "@/lib/production/hari-kerja";
import { NAMA_LIBUR_MAKS } from "@/lib/production/jadwal-jejak";
import { hariIniWib } from "@/lib/tanggal-isian";
import { cn } from "@/lib/utils";
import { gabungLibur, samaHari, samaLibur, SEMUA_HARI } from "@/app/backoffice/lead-time/hari-kerja-aturan";

type Muatan =
  | { keadaan: "memuat" }
  | { keadaan: "gagal" }
  | { keadaan: "siap"; hariKerja: number[]; tanggalMerah: TanggalMerah[] };

/**
 * Lead Time → Hari kerja & libur: kalender kerja produksi yang dipakai setiap
 * jadwal tahap (lama proses dihitung dalam hari kerja, tanggal merah dilewati).
 * Perubahan disimpan per bagian; menyimpan menyusun ulang tanggal semua tahap
 * yang masih punya langkah belum selesai, jadi selalu lewat konfirmasi.
 */
export function HariKerjaTab({ bolehUbah }: { bolehUbah: boolean }) {
  const t = useTranslations("jadwalProduksi");
  const locale = useLocale();
  const [muatan, setMuatan] = useState<Muatan>({ keadaan: "memuat" });
  const [coba, setCoba] = useState(0);

  useEffect(() => {
    let batal = false;
    ambilHariKerjaAction()
      .then((hasil) => {
        if (batal) return;
        setMuatan(hasil.ok ? { keadaan: "siap", ...hasil.data } : { keadaan: "gagal" });
      })
      .catch(() => {
        if (!batal) setMuatan({ keadaan: "gagal" });
      });
    return () => {
      batal = true;
    };
  }, [coba]);

  if (muatan.keadaan === "memuat") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t("hariKerja.memuat")}
      </div>
    );
  }
  if (muatan.keadaan === "gagal") {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={CalendarX}
            title={t("hariKerja.gagalMuat")}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setMuatan({ keadaan: "memuat" });
                  setCoba((n) => n + 1);
                }}
              >
                {t("hariKerja.coba")}
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {!bolehUbah ? <p className="text-sm text-muted-foreground">{t("hariKerja.hanyaLihat")}</p> : null}
      <KartuHariKerja
        tersimpan={muatan.hariKerja}
        bolehUbah={bolehUbah}
        locale={locale}
        onTersimpan={(hariKerja) => setMuatan((m) => (m.keadaan === "siap" ? { ...m, hariKerja } : m))}
      />
      <KartuTanggalMerah
        tersimpan={muatan.tanggalMerah}
        bolehUbah={bolehUbah}
        locale={locale}
        onTersimpan={(tanggalMerah) => setMuatan((m) => (m.keadaan === "siap" ? { ...m, tanggalMerah } : m))}
      />
    </div>
  );
}

function KonfirmasiSusunUlang({
  buka,
  onBatal,
  onYa,
}: {
  buka: boolean;
  onBatal: () => void;
  onYa: () => void;
}) {
  const t = useTranslations("jadwalProduksi");
  return (
    <AlertDialog open={buka} onOpenChange={(b) => !b && onBatal()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("hariKerja.konfirmasiJudul")}</AlertDialogTitle>
          <AlertDialogDescription>{t("hariKerja.konfirmasiIsi")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("hariKerja.konfirmasiBatal")}</AlertDialogCancel>
          <AlertDialogAction onClick={onYa}>{t("hariKerja.konfirmasiYa")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function KartuHariKerja({
  tersimpan,
  bolehUbah,
  locale,
  onTersimpan,
}: {
  tersimpan: number[];
  bolehUbah: boolean;
  locale: string;
  onTersimpan: (hariKerja: number[]) => void;
}) {
  const t = useTranslations("jadwalProduksi");
  const td = dinamis(t);
  const [pilihan, setPilihan] = useState<ReadonlySet<number>>(() => new Set(tersimpan));
  const [tanya, setTanya] = useState(false);
  const [menyimpan, mulai] = useTransition();

  const namaHari = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { weekday: "long", timeZone: "UTC" });
    // 4 Okt 2026 = Minggu.
    return SEMUA_HARI.map((h) => f.format(new Date(Date.UTC(2026, 9, 4 + h))));
  }, [locale]);

  const berubah = !samaHari(tersimpan, pilihan);
  const alasan = pilihan.size === 0 ? t("hariKerja.hariMinimal") : !berubah ? t("hariKerja.belumBerubah") : null;

  const ganti = (hari: number, centang: boolean) =>
    setPilihan((lama) => {
      const baru = new Set(lama);
      if (centang) baru.add(hari);
      else baru.delete(hari);
      return baru;
    });

  const simpan = () =>
    mulai(async () => {
      setTanya(false);
      const hasil = await simpanHariKerjaAction({ hariKerja: [...pilihan].sort((a, b) => a - b) });
      if (!hasil.ok) {
        toast.error(td(`server.err${hasil.code}`));
        return;
      }
      setPilihan(new Set(hasil.hariKerja));
      onTersimpan(hasil.hariKerja);
      toast.success(t("hariKerja.hariDisimpan"));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="h-5 w-5" aria-hidden />
          {t("hariKerja.hariJudul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="group" aria-label={t("hariKerja.hariJudul")} className="flex flex-wrap gap-x-6 gap-y-3">
          {SEMUA_HARI.map((h) => (
            <div key={h} className="flex items-center gap-2">
              <Checkbox
                id={`hari-kerja-${h}`}
                checked={pilihan.has(h)}
                disabled={!bolehUbah || menyimpan}
                onCheckedChange={(v) => ganti(h, v === true)}
              />
              <Label htmlFor={`hari-kerja-${h}`} className="font-normal capitalize">
                {namaHari[h]}
              </Label>
            </div>
          ))}
        </div>
        {bolehUbah ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" onClick={() => setTanya(true)} disabled={menyimpan || alasan !== null}>
              {menyimpan ? t("hariKerja.menyimpan") : t("hariKerja.simpanHari")}
            </Button>
            {alasan && pilihan.size === 0 ? (
              <p className="text-sm text-destructive">{alasan}</p>
            ) : berubah ? (
              <p className="text-sm text-muted-foreground">{t("hariKerja.belumDisimpan")}</p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <KonfirmasiSusunUlang buka={tanya} onBatal={() => setTanya(false)} onYa={simpan} />
    </Card>
  );
}

function KartuTanggalMerah({
  tersimpan,
  bolehUbah,
  locale,
  onTersimpan,
}: {
  tersimpan: TanggalMerah[];
  bolehUbah: boolean;
  locale: string;
  onTersimpan: (tanggalMerah: TanggalMerah[]) => void;
}) {
  const t = useTranslations("jadwalProduksi");
  const td = dinamis(t);
  const [daftar, setDaftar] = useState<TanggalMerah[]>(tersimpan);
  const [tanggalBaru, setTanggalBaru] = useState("");
  const [namaBaru, setNamaBaru] = useState("");
  const [tampilLalu, setTampilLalu] = useState(false);
  const [tanya, setTanya] = useState(false);
  const [menyimpan, mulai] = useTransition();
  const [hariIni] = useState(() => hariIniWib());
  const tahunIni = Number(hariIni.slice(0, 4));

  const berubah = !samaLibur(tersimpan, daftar);
  const sudahAda = tanggalBaru !== "" && daftar.some((l) => l.tanggal === tanggalBaru);
  const namaPanjang = namaBaru.trim().length > NAMA_LIBUR_MAKS;
  const lalu = daftar.filter((l) => l.tanggal < hariIni);
  const tampil = tampilLalu ? daftar : daftar.filter((l) => l.tanggal >= hariIni);

  const tambah = () => {
    if (!tanggalBaru || sudahAda || namaPanjang) return;
    setDaftar((lama) => gabungLibur(lama, [{ tanggal: tanggalBaru, nama: namaBaru.trim() }]));
    if (tanggalBaru < hariIni) setTampilLalu(true);
    setTanggalBaru("");
    setNamaBaru("");
  };

  const isiTetap = (tahun: number) => {
    const baru = gabungLibur(daftar, liburTetapTahun(tahun));
    const n = baru.length - daftar.length;
    if (n === 0) {
      toast.info(t("hariKerja.isiTetapNol", { tahun }));
      return;
    }
    setDaftar(baru);
    toast.success(t("hariKerja.isiTetapHasil", { n }));
  };

  const simpan = () =>
    mulai(async () => {
      setTanya(false);
      const hasil = await simpanTanggalMerahAction({ daftar });
      if (!hasil.ok) {
        toast.error(td(`server.err${hasil.code}`));
        return;
      }
      setDaftar(hasil.tanggalMerah);
      onTersimpan(hasil.tanggalMerah);
      toast.success(t("hariKerja.merahDisimpan"));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarX className="h-5 w-5" aria-hidden />
          {t("hariKerja.merahJudul")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {bolehUbah ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="libur-tanggal">{t("hariKerja.tanggalLabel")}</Label>
                <TanggalInput
                  id="libur-tanggal"
                  value={tanggalBaru}
                  onChange={(e) => setTanggalBaru(e.target.value)}
                  aria-invalid={sudahAda || undefined}
                  disabled={menyimpan}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="libur-nama">{t("hariKerja.namaLabel")}</Label>
                <Input
                  id="libur-nama"
                  value={namaBaru}
                  maxLength={NAMA_LIBUR_MAKS}
                  placeholder={t("hariKerja.namaContoh")}
                  onChange={(e) => setNamaBaru(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      tambah();
                    }
                  }}
                  disabled={menyimpan}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={tambah}
                disabled={menyimpan || !tanggalBaru || sudahAda || namaPanjang}
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t("hariKerja.tambah")}
              </Button>
            </div>
            {sudahAda ? <p className="text-sm text-destructive">{t("hariKerja.sudahAda")}</p> : null}
            {namaPanjang ? (
              <p className="text-sm text-destructive">{t("hariKerja.namaTerlaluPanjang", { n: NAMA_LIBUR_MAKS })}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {[tahunIni, tahunIni + 1].map((tahun) => (
                <Button key={tahun} type="button" variant="secondary" size="sm" onClick={() => isiTetap(tahun)} disabled={menyimpan}>
                  {t("hariKerja.isiTetap", { tahun })}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {tampil.length === 0 ? (
          <EmptyState icon={CalendarX} title={t("hariKerja.kosong")} className="py-8" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("hariKerja.kolomTanggal")}</TableHead>
                  <TableHead>{t("hariKerja.kolomNama")}</TableHead>
                  {bolehUbah ? (
                    <TableHead className="w-12">
                      <span className="sr-only">{t("hariKerja.kolomAksi")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tampil.map((l) => {
                  const label = formatDisplayDate(l.tanggal, locale);
                  return (
                    <TableRow key={l.tanggal} className={cn(l.tanggal < hariIni && "text-muted-foreground")}>
                      <TableCell className="whitespace-nowrap tabular-nums">{label}</TableCell>
                      <TableCell className="whitespace-normal">
                        {l.nama || <span className="text-muted-foreground">{t("hariKerja.tanpaNama")}</span>}
                      </TableCell>
                      {bolehUbah ? (
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive"
                            disabled={menyimpan}
                            onClick={() => setDaftar((lama) => lama.filter((x) => x.tanggal !== l.tanggal))}
                            aria-label={t("hariKerja.hapus", { tanggal: label })}
                            title={t("hariKerja.hapus", { tanggal: label })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {lalu.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setTampilLalu((v) => !v)}>
            {tampilLalu ? t("hariKerja.sembunyiLalu") : t("hariKerja.tampilLalu", { n: lalu.length })}
          </Button>
        ) : null}

        {bolehUbah ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button type="button" onClick={() => setTanya(true)} disabled={menyimpan || !berubah}>
              {menyimpan ? t("hariKerja.menyimpan") : t("hariKerja.simpanMerah")}
            </Button>
            <p className="text-sm text-muted-foreground">
              {berubah ? t("hariKerja.belumDisimpan") : t("hariKerja.belumBerubah")}
            </p>
          </div>
        ) : null}
      </CardContent>
      <KonfirmasiSusunUlang buka={tanya} onBatal={() => setTanya(false)} onYa={simpan} />
    </Card>
  );
}
