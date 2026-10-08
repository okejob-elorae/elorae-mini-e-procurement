"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2, Save, Target, Undo2 } from "lucide-react";
import type { AccountType } from "@/lib/constants/enums";
import type { AkunAnggaran } from "@/lib/finance/anggaran/queries";
import {
  BULAN,
  bacaAngkaIsian,
  ratakanTahunan,
  salinDenganPersen,
  totalBaris,
  tulisAngkaIsian,
} from "@/lib/finance/anggaran/aturan";
import { rupiahLaporan } from "@/lib/finance/reports/format-laporan";
import { bahanSalinAnggaranAction, simpanAnggaranAction } from "@/app/actions/finance-laporan";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Props = {
  tahun: number;
  tahunPilihan: number[];
  akun: AkunAnggaran[];
  anggaran: Record<string, (number | null)[]>;
  bolehUbah: boolean;
  bolehLaporan: boolean;
};

const BAGIAN: { type: AccountType; kunci: string }[] = [
  { type: "PENDAPATAN", kunci: "bagianPendapatan" },
  { type: "HPP", kunci: "bagianHpp" },
  { type: "BEBAN", kunci: "bagianBeban" },
];

const kosong12 = () => new Array<string>(12).fill("");

export function AnggaranClient({ tahun, tahunPilihan, akun, anggaran, bolehUbah, bolehLaporan }: Props) {
  const t = useTranslations("anggaran");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const daun = useMemo(() => akun.filter((a) => !a.adaAnak), [akun]);
  const awal = useMemo(() => {
    const o: Record<string, string[]> = {};
    for (const a of daun) o[a.accountId] = (anggaran[a.accountId] ?? new Array(12).fill(null)).map(tulisAngkaIsian);
    return o;
  }, [daun, anggaran]);
  const [isi, setIsi] = useState<Record<string, string[]>>(awal);
  const [salinBuka, setSalinBuka] = useState(false);
  const [salinSumber, setSalinSumber] = useState<"anggaran" | "realisasi">("realisasi");
  const [salinPersen, setSalinPersen] = useState("0");
  const [menyalin, setMenyalin] = useState(false);

  const nilai = (id: string): (number | null)[] =>
    (isi[id] ?? kosong12()).map((s) => {
      const v = bacaAngkaIsian(s);
      return v === "rusak" ? null : v;
    });
  const rusak = (s: string) => bacaAngkaIsian(s) === "rusak";
  const berubah = (id: string) => (isi[id] ?? kosong12()).some((s, i) => {
    const a = bacaAngkaIsian(s);
    const b = bacaAngkaIsian((awal[id] ?? kosong12())[i]);
    return a !== b;
  });
  const akunBerubah = daun.filter((a) => berubah(a.accountId));
  const adaRusak = daun.some((a) => (isi[a.accountId] ?? []).some(rusak));

  useEffect(() => {
    if (akunBerubah.length === 0) return;
    const tahan = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", tahan);
    return () => window.removeEventListener("beforeunload", tahan);
  }, [akunBerubah.length]);

  function ubahSel(id: string, i: number, teks: string) {
    setIsi((lama) => {
      const baris = [...(lama[id] ?? kosong12())];
      baris[i] = teks;
      return { ...lama, [id]: baris };
    });
  }

  function rapikanSel(id: string, i: number) {
    const s = (isi[id] ?? kosong12())[i];
    const v = bacaAngkaIsian(s);
    if (v !== "rusak") ubahSel(id, i, tulisAngkaIsian(v));
  }

  /** Mengetik total setahun membaginya rata ke 12 bulan (sisa pembulatan di Desember). */
  function isiTotal(id: string, teks: string) {
    const v = bacaAngkaIsian(teks);
    if (v === "rusak") {
      toast.error(t("galat.angkaRusak"));
      return;
    }
    setIsi((lama) => ({ ...lama, [id]: v === null ? kosong12() : ratakanTahunan(v).map(tulisAngkaIsian) }));
  }

  async function terapkanSalin() {
    const persen = Number(salinPersen.replace(",", "."));
    if (!Number.isFinite(persen)) {
      toast.error(t("galat.persenRusak"));
      return;
    }
    setMenyalin(true);
    try {
      const r = await bahanSalinAnggaranAction({ tahun, sumber: salinSumber });
      if (!r.ok) {
        toast.error(t(`galat.${r.kode}`));
        return;
      }
      // Dihitung di luar pembaru state: jumlahnya dipakai untuk pesan, dan pembaru dijalankan React belakangan.
      const salinan: Record<string, string[]> = {};
      for (const a of daun) {
        const sumber = r.nilai[a.accountId];
        if (!sumber || sumber.every((v) => v === null || v === 0)) continue;
        salinan[a.accountId] = salinDenganPersen(sumber, persen).map(tulisAngkaIsian);
      }
      const n = Object.keys(salinan).length;
      setIsi((lama) => ({ ...lama, ...salinan }));
      setSalinBuka(false);
      toast.success(n > 0 ? t("salin.diterapkan", { jumlah: n }) : t("salin.tidakAdaData"));
    } finally {
      setMenyalin(false);
    }
  }

  function simpan() {
    if (adaRusak) {
      toast.error(t("galat.angkaRusak"));
      return;
    }
    startTransition(async () => {
      const r = await simpanAnggaranAction({
        tahun,
        baris: akunBerubah.map((a) => ({ chartAccountId: a.accountId, bulan: nilai(a.accountId) })),
      });
      if (!r.ok) {
        toast.error(t(`galat.${r.kode}`));
        return;
      }
      toast.success(t("tersimpan", { jumlah: r.diubah }));
      router.refresh();
    });
  }

  const totalBagian = (type: AccountType): (number | null)[] =>
    BULAN.map((_, i) => {
      const isiBulan = daun.filter((a) => a.type === type).map((a) => nilai(a.accountId)[i]).filter((v): v is number => v !== null);
      return isiBulan.length ? isiBulan.reduce((s, v) => s + Math.round(v * 100), 0) / 100 : null;
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judul", { tahun })}
        meta={akunBerubah.length > 0 ? t("belumTersimpan", { jumlah: akunBerubah.length }) : t("jumlahAkun", { jumlah: daun.length })}
        actions={
          <>
            <Select
              value={String(tahun)}
              disabled={akunBerubah.length > 0 || isPending}
              onValueChange={(v) => startTransition(() => router.push(`/backoffice/finance/anggaran?tahun=${v}`))}
            >
              <SelectTrigger className="w-28" aria-label={t("pilihTahun")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tahunPilihan.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {bolehLaporan ? (
              <Button variant="outline" asChild>
                <Link href={`/backoffice/finance/anggaran/realisasi?tahun=${tahun}`}>
                  <Target className="mr-2 h-4 w-4" />
                  {t("lihatRealisasi")}
                </Link>
              </Button>
            ) : null}
            {bolehUbah ? (
              <>
                <Button variant="outline" onClick={() => setSalinBuka(true)} disabled={isPending}>
                  <Copy className="mr-2 h-4 w-4" />
                  {t("salin.tombol")}
                </Button>
                {akunBerubah.length > 0 ? (
                  <Button variant="outline" onClick={() => setIsi(awal)} disabled={isPending}>
                    <Undo2 className="mr-2 h-4 w-4" />
                    {t("batalkan")}
                  </Button>
                ) : null}
                <Button onClick={simpan} disabled={isPending || akunBerubah.length === 0}>
                  {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  {t("simpan")}
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {daun.length === 0 ? (
        <Card className="py-0">
          <CardContent className="py-12 text-center text-muted-foreground">{t("tanpaAkun")}</CardContent>
        </Card>
      ) : (
        BAGIAN.map(({ type, kunci }) => {
          const daftar = akun.filter((a) => a.type === type);
          if (daftar.length === 0) return null;
          const dasar = Math.min(...daftar.map((a) => a.depth));
          const total = totalBagian(type);
          return (
            <Card key={type}>
              <CardHeader>
                <CardTitle>{t(kunci)}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table className="min-w-[1500px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 z-10 min-w-[240px] bg-card">{t("kolomAkun")}</TableHead>
                        {BULAN.map((b) => (
                          <TableHead key={b} className="min-w-[110px] text-right">
                            {t(`bulan.${b}`)}
                          </TableHead>
                        ))}
                        <TableHead className="min-w-[140px] text-right">{t("kolomTotal")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {daftar.map((a) => {
                        const indent = { paddingLeft: `${(a.depth - dasar) * 16 + 12}px` };
                        if (a.adaAnak) {
                          return (
                            <TableRow key={a.accountId}>
                              <TableCell colSpan={14} className="sticky left-0 bg-card font-medium" style={indent}>
                                <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                                {a.name}
                              </TableCell>
                            </TableRow>
                          );
                        }
                        const sel = isi[a.accountId] ?? kosong12();
                        const jumlah = totalBaris(nilai(a.accountId));
                        return (
                          <TableRow key={a.accountId} className={berubah(a.accountId) ? "bg-amber-500/5" : undefined}>
                            <TableCell className="sticky left-0 z-10 bg-card whitespace-normal" style={indent}>
                              <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                              {a.name}
                              {!a.isActive ? <span className="ml-1 text-xs text-muted-foreground">({t("nonaktif")})</span> : null}
                            </TableCell>
                            {BULAN.map((b, i) => (
                              <TableCell key={b} className="p-1">
                                <Input
                                  value={sel[i]}
                                  inputMode="decimal"
                                  disabled={!bolehUbah || isPending}
                                  aria-label={t("selAria", { akun: a.name, bulan: t(`bulan.${b}`) })}
                                  aria-invalid={rusak(sel[i]) || undefined}
                                  className={cn("h-8 text-right tabular-nums", rusak(sel[i]) && "border-destructive")}
                                  onChange={(e) => ubahSel(a.accountId, i, e.target.value)}
                                  onBlur={() => rapikanSel(a.accountId, i)}
                                />
                              </TableCell>
                            ))}
                            <TableCell className="p-1">
                              <Input
                                key={`${a.accountId}-${jumlah ?? "kosong"}`}
                                defaultValue={tulisAngkaIsian(jumlah)}
                                inputMode="decimal"
                                disabled={!bolehUbah || isPending}
                                aria-label={t("totalAria", { akun: a.name })}
                                title={t("totalJudul")}
                                className="h-8 text-right font-medium tabular-nums"
                                onBlur={(e) => {
                                  if (e.target.value !== tulisAngkaIsian(jumlah)) isiTotal(a.accountId, e.target.value);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                }}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow className="font-semibold">
                        <TableCell className="sticky left-0 z-10 bg-card">{t(`total.${type}`)}</TableCell>
                        {total.map((v, i) => (
                          <TableCell key={i} className="text-right tabular-nums">
                            {v === null ? "—" : rupiahLaporan(v)}
                          </TableCell>
                        ))}
                        <TableCell className="text-right tabular-nums">
                          {(() => {
                            const j = totalBaris(total);
                            return j === null ? "—" : rupiahLaporan(j);
                          })()}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <Dialog open={salinBuka} onOpenChange={setSalinBuka}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("salin.judul", { tahun: tahun - 1 })}</DialogTitle>
            <DialogDescription>{t("salin.keterangan")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="salin-sumber">{t("salin.sumber")}</Label>
              <Select value={salinSumber} onValueChange={(v) => setSalinSumber(v === "anggaran" ? "anggaran" : "realisasi")}>
                <SelectTrigger id="salin-sumber" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="realisasi">{t("salin.sumberRealisasi", { tahun: tahun - 1 })}</SelectItem>
                  <SelectItem value="anggaran">{t("salin.sumberAnggaran", { tahun: tahun - 1 })}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="salin-persen">{t("salin.persen")}</Label>
              <Input
                id="salin-persen"
                className="mt-1 w-32"
                inputMode="decimal"
                value={salinPersen}
                onChange={(e) => setSalinPersen(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSalinBuka(false)} disabled={menyalin}>
              {t("salin.batal")}
            </Button>
            <Button onClick={terapkanSalin} disabled={menyalin}>
              {menyalin ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("salin.terapkan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
