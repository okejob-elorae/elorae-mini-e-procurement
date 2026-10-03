"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarRange, Copy, Loader2, Save, Undo2, Wand2 } from "lucide-react";
import { simpanJadwalSpgAction, type HasilSimpanJadwalAksi } from "@/app/actions/spg-shift";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDisplayDate } from "@/lib/date-only";
import { dinamis } from "@/lib/i18n/dinamis";
import {
  bedaDraf,
  hariKeMinggu,
  isiHariKerjaKeDraf,
  kunciSel,
  salinMingguKeDraf,
  type DrafJadwal,
  type IsiSel,
  type Kenyataan,
} from "@/lib/spg/shift";
import type { DataJadwalSpgKantor, SelKantor } from "@/lib/spg/shift-queries";
import { cn } from "@/lib/utils";

const KOSONG = "__kosong__";
const LIBUR = "LIBUR";
const nilaiDari = (isi: IsiSel) => (!isi ? KOSONG : isi.jenis === "LIBUR" ? LIBUR : `K:${isi.kode}`);
const isiDari = (v: string): IsiSel => (v === KOSONG ? null : v === LIBUR ? { jenis: "LIBUR" } : { jenis: "KERJA", kode: v.slice(2) });

function drafAwal(sel: Record<string, SelKantor>): DrafJadwal {
  const d: DrafJadwal = {};
  for (const [k, s] of Object.entries(sel)) {
    if (s.kind === "LIBUR") d[k] = { jenis: "LIBUR" };
    else if (s.shiftCode) d[k] = { jenis: "KERJA", kode: s.shiftCode };
  }
  return d;
}

const NADA: Record<Kenyataan["status"], StatusTone> = {
  HADIR: "settled",
  TERLAMBAT: "attention",
  MASUK_SAAT_LIBUR: "progress",
  TIDAK_MASUK: "attention",
  BELUM_MASUK: "waiting",
  IZIN: "inactive",
};

/** Versi isi kisi — kunci remount: sesudah simpan + muat ulang, draf mulai dari data baru. */
export function versiKisi(data: DataJadwalSpgKantor): string {
  return `${data.storeId}|${data.senin}|${Object.entries(data.sel)
    .map(([k, s]) => `${k}=${s.kind}:${s.shiftCode ?? ""}:${s.mulai ?? ""}`)
    .sort()
    .join(",")}`;
}

/**
 * Kisi SPG × 7 hari. Sel hari ini dan sesudahnya dipilih dari daftar shift
 * (atau Libur, atau kosong) sebagai DRAF; "Simpan" mengirim hanya sel yang
 * berubah, dalam satu transaksi dan satu jejak. Hari lalu hanya dibaca,
 * dengan kenyataannya (jam masuk, terlambat, tidak masuk, izin).
 */
export function KisiJadwalSpg({
  data,
  bolehUbah,
  onBelumDisimpan,
}: {
  data: DataJadwalSpgKantor;
  bolehUbah: boolean;
  onBelumDisimpan: (n: number) => void;
}) {
  const t = useTranslations("jadwalSpg");
  const td = dinamis(t);
  const locale = useLocale();
  const router = useRouter();
  const [menyimpan, mulaiSimpan] = useTransition();
  const awal = useMemo(() => drafAwal(data.sel), [data.sel]);
  const [draf, setDraf] = useState<DrafJadwal>(awal);
  const [kodeIsi, setKodeIsi] = useState(data.aturan.daftar[0]?.kode ?? "");

  const perubahan = useMemo(() => bedaDraf(awal, draf), [awal, draf]);
  const berubah = new Set(perubahan.map((p) => kunciSel(p.userId, p.day)));
  const spgAktif = data.orang.filter((o) => o.diToko).map((o) => o.id);
  const mingguBisaDiubah = bolehUbah && data.hari[6] >= data.hariIni && spgAktif.length > 0;
  const bisaUbah = (diToko: boolean, day: string) => bolehUbah && diToko && day >= data.hariIni;

  const ubahDraf = (baru: DrafJadwal) => {
    setDraf(baru);
    onBelumDisimpan(bedaDraf(awal, baru).length);
  };
  const ubahSel = (userId: string, day: string, v: string) => {
    const baru = { ...draf };
    const isi = isiDari(v);
    if (isi) baru[kunciSel(userId, day)] = isi;
    else delete baru[kunciSel(userId, day)];
    ubahDraf(baru);
  };

  const tanggalPanjang = (day: string) => formatDisplayDate(new Date(`${day}T00:00:00+07:00`), locale);
  const kepalaHari = (day: string) => `${td(`hari.${hariKeMinggu(day)}`)} ${Number(day.slice(8))} ${td(`bulan.${Number(day.slice(5, 7))}`)}`;
  const labelShift = (kode: string) => {
    const s = data.aturan.daftar.find((x) => x.kode === kode);
    return s ? `${s.label} ${s.mulai}–${s.selesai}` : t("shiftDihapus", { kode });
  };

  const salin = () => {
    const r = salinMingguKeDraf({ sumber: data.mingguLalu, draf, seninTujuan: data.senin, hariIni: data.hariIni, spg: spgAktif, aturan: data.aturan });
    const rincian = (Object.entries(r.dilewati) as [string, number][])
      .filter(([, n]) => n > 0)
      .map(([k, n]) => td(`lewati.${k}`, { count: n }))
      .join(", ");
    if (r.disalin === 0) {
      toast.info(rincian ? `${t("salinKosong")} ${t("salinDilewati", { rincian })}` : t("salinKosong"));
      return;
    }
    ubahDraf(r.draf);
    const kepala = t("salinHasil", { count: r.disalin });
    toast.success(rincian ? `${kepala} ${t("salinDilewati", { rincian })}` : kepala);
  };

  const isiHariKerja = () => {
    if (!kodeIsi) return;
    const izin = Object.entries(data.izin).map(([k, type]) => {
      const i = k.lastIndexOf("|");
      return { userId: k.slice(0, i), type, startDay: k.slice(i + 1), endDay: k.slice(i + 1) };
    });
    const r = isiHariKerjaKeDraf({ draf, senin: data.senin, hariIni: data.hariIni, spg: spgAktif, hariKerja: data.hariKerja, kode: kodeIsi, izin });
    const rincian = [
      r.dilewati.sudahAda > 0 ? t("isiLewatAda", { count: r.dilewati.sudahAda }) : null,
      r.dilewati.izin > 0 ? t("isiLewatIzin", { count: r.dilewati.izin }) : null,
    ]
      .filter(Boolean)
      .join(", ");
    if (r.diisi === 0) {
      toast.info(rincian ? `${t("isiKosong")} ${t("salinDilewati", { rincian })}` : t("isiKosong"));
      return;
    }
    ubahDraf(r.draf);
    toast.success(rincian ? `${t("isiHasil", { count: r.diisi })} ${t("salinDilewati", { rincian })}` : t("isiHasil", { count: r.diisi }));
  };

  const teksGalat = (r: Extract<HasilSimpanJadwalAksi, { ok: false }>) =>
    td(`err.${r.code}`, { tanggal: r.day ? tanggalPanjang(r.day) : "", kode: r.shiftCode ?? "" });

  const simpan = () => {
    if (perubahan.length === 0) return;
    mulaiSimpan(async () => {
      const r = await simpanJadwalSpgAction({ storeId: data.storeId, isian: perubahan });
      if (!r.ok) {
        toast.error(teksGalat(r));
        return;
      }
      toast.success(r.berubah > 0 ? t("tersimpan", { count: r.berubah }) : t("tidakAdaPerubahan"));
      onBelumDisimpan(0);
      router.refresh();
    });
  };

  const pilKenyataan = (k: Kenyataan) => {
    switch (k.status) {
      case "HADIR":
        return t("kenyataan.HADIR", { jam: k.jamMasuk });
      case "TERLAMBAT":
        return t("kenyataan.TERLAMBAT", { menit: k.menit, jam: k.jamMasuk });
      case "MASUK_SAAT_LIBUR":
        return t("kenyataan.MASUK_SAAT_LIBUR", { jam: k.jamMasuk });
      case "IZIN":
        return t("kenyataan.IZIN", { jenis: td(`jenisIzin.${k.jenis}`) });
      default:
        return td(`kenyataan.${k.status}`);
    }
  };

  const teksSelBaca = (isi: IsiSel, s: SelKantor | undefined) => {
    if (!isi) return <span className="text-muted-foreground">—</span>;
    if (isi.jenis === "LIBUR") return <span className="text-muted-foreground">{t("libur")}</span>;
    return (
      <span className="font-medium">
        {s?.label ?? isi.kode} <span className="tabular-nums text-muted-foreground">{s?.mulai && s?.selesai ? `${s.mulai}–${s.selesai}` : ""}</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {mingguBisaDiubah ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={salin} disabled={menyimpan}>
              <Copy className="mr-2 h-4 w-4" aria-hidden />
              {t("salinMingguLalu")}
            </Button>
            <div className="flex items-center gap-2">
              <Select value={kodeIsi} onValueChange={setKodeIsi}>
                <SelectTrigger className="w-[200px]" aria-label={t("pilihShiftIsi")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.aturan.daftar.map((s) => (
                    <SelectItem key={s.kode} value={s.kode}>
                      {s.label} {s.mulai}–{s.selesai}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={isiHariKerja} disabled={menyimpan || !kodeIsi}>
                <Wand2 className="mr-2 h-4 w-4" aria-hidden />
                {t("isiHariKerja")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {perubahan.length > 0 ? (
              <Button variant="ghost" onClick={() => ubahDraf(awal)} disabled={menyimpan}>
                <Undo2 className="mr-2 h-4 w-4" aria-hidden />
                {t("batalkanPerubahan")}
              </Button>
            ) : null}
            <Button onClick={simpan} disabled={menyimpan || perubahan.length === 0}>
              {menyimpan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" aria-hidden />}
              {perubahan.length > 0 ? t("simpanN", { count: perubahan.length }) : t("simpan")}
            </Button>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5" aria-hidden />
            {t("kisiJudul")}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {data.orang.length === 0 ? (
            <p className="px-6 text-sm text-muted-foreground">{t("kosongSpg")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 min-w-[160px] bg-card">{t("kolomSpg")}</TableHead>
                    {data.hari.map((day) => {
                      const bukanKerja = !data.hariKerja.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
                      return (
                        <TableHead
                          key={day}
                          title={tanggalPanjang(day)}
                          className={cn("min-w-[170px] align-bottom", day === data.hariIni && "bg-primary/10 text-foreground")}
                        >
                          <span className="block">{kepalaHari(day)}</span>
                          {day === data.hariIni ? (
                            <Badge className="mt-0.5 px-1.5 py-0 text-[10px]">{t("hariIniLencana")}</Badge>
                          ) : bukanKerja ? (
                            <span className="block text-[11px] font-normal text-muted-foreground">{t("bukanHariKerja")}</span>
                          ) : null}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.orang.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="sticky left-0 z-10 whitespace-normal bg-card align-top">
                        <p className="font-medium">{o.nama}</p>
                        {!o.diToko ? (
                          <Badge variant="outline" className="mt-1 px-1.5 py-0 text-[10px]">
                            {t("sudahPindah")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      {data.hari.map((day) => {
                        const k = kunciSel(o.id, day);
                        const isi = draf[k] ?? null;
                        const s = data.sel[k];
                        const kenyataan = data.kenyataan[k];
                        const izin = data.izin[k];
                        const ubah = bisaUbah(o.diToko, day);
                        const kodeLama = isi?.jenis === "KERJA" && !data.aturan.daftar.some((x) => x.kode === isi.kode) ? isi.kode : null;
                        return (
                          <TableCell
                            key={day}
                            className={cn(
                              "space-y-1 whitespace-normal align-top",
                              day === data.hariIni && "bg-primary/5",
                              berubah.has(k) && "bg-amber-500/10",
                            )}
                          >
                            {ubah ? (
                              <Select value={nilaiDari(isi)} onValueChange={(v) => ubahSel(o.id, day, v)} disabled={menyimpan}>
                                <SelectTrigger
                                  className={cn("h-auto min-h-9 w-full whitespace-normal py-1.5 text-left", berubah.has(k) && "border-amber-500")}
                                  aria-label={t("selLabel", { nama: o.nama, tanggal: tanggalPanjang(day) })}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={KOSONG}>{t("kosong")}</SelectItem>
                                  {data.aturan.daftar.map((x) => (
                                    <SelectItem key={x.kode} value={`K:${x.kode}`}>
                                      {x.label} {x.mulai}–{x.selesai}
                                    </SelectItem>
                                  ))}
                                  {kodeLama ? <SelectItem value={`K:${kodeLama}`}>{labelShift(kodeLama)}</SelectItem> : null}
                                  <SelectItem value={LIBUR}>{t("libur")}</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <p className="text-sm">{teksSelBaca(isi, s)}</p>
                            )}
                            {s?.tokoLain ? (
                              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                {t("tokoLain")}
                              </Badge>
                            ) : null}
                            {kenyataan ? (
                              <StatusPill tone={NADA[kenyataan.status]}>{pilKenyataan(kenyataan)}</StatusPill>
                            ) : izin ? (
                              <StatusPill tone="inactive">{t("kenyataan.IZIN", { jenis: td(`jenisIzin.${izin}`) })}</StatusPill>
                            ) : null}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">{t("keterangan", { menit: data.aturan.toleransiTerlambatMenit })}</p>
    </div>
  );
}
