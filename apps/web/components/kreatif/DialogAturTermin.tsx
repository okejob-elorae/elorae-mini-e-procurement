"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { aturTerminAction } from "@/app/actions/kreatif-termin";
import { angkaTitik, rupiahTeks } from "@/lib/creative/angka-konten";
import { bacaAngka } from "@/lib/creative/angka-masuk";
import type { ModePajak, SubjekPajak, TarifPajakKreatif } from "@/lib/creative/pph";
import { rencanakanTermin, SEMUA_PEMICU, type DasarRencana, type PemicuTermin, type RencanaTermin } from "@/lib/creative/termin-aturan";

export type TerminAwal = { label: string; jumlah: number; pemicu: PemicuTermin; hariSesudah: number; tanggal: string | null };

type Baris = { kunci: number; label: string; nilai: string; pemicu: PemicuTermin; hari: string; tanggal: string };

type Props = {
  open: boolean;
  onOpenChange: (buka: boolean) => void;
  kolaborasiId: string;
  fee: number;
  mode: ModePajak;
  subjek: SubjekPajak;
  tarif: TarifPajakKreatif;
  /** Jumlah (basis fee) termin yang sudah dibayar — terkunci. */
  dibayar: number[];
  /** Termin belum dibayar sekarang (isian awal). */
  awal: TerminAwal[];
  jatuhTempoBawaan: number;
  onSelesai: () => void;
};

let kunciBerikut = 1;

/**
 * Atur termin yang BELUM dibayar: pecah (DP + pelunasan), ubah pemicu dan
 * jatuh tempo. Pratinjau memakai aturan yang sama dengan penulisnya
 * (`rencanakanTermin`), jadi angka bruto/PPh/neto di sini adalah angka yang
 * akan tersimpan. Termin yang sudah dibayar terkunci; rencana membagi sisanya.
 */
export function DialogAturTermin({ open, onOpenChange, kolaborasiId, fee, mode, subjek, tarif, dibayar, awal, jatuhTempoBawaan, onSelesai }: Props) {
  const t = useTranslations("kreatifRuang.termin");
  const tk = useTranslations("kreatifRuang");
  const sisa = Math.max(0, fee - dibayar.reduce((s, n) => s + n, 0));
  const keBaris = (a: TerminAwal): Baris => ({
    kunci: kunciBerikut++,
    label: a.label,
    nilai: sisa > 0 ? String(Math.round((a.jumlah / sisa) * 10_000) / 100).replace(".", ",") : "",
    pemicu: a.pemicu,
    hari: String(a.hariSesudah),
    tanggal: a.tanggal ?? "",
  });
  const [dasar, setDasar] = useState<DasarRencana>("PERSEN");
  const [baris, setBaris] = useState<Baris[]>(() => (awal.length ? awal.map(keBaris) : [keBaris({ label: "Pelunasan", jumlah: sisa, pemicu: "TAYANG", hariSesudah: jatuhTempoBawaan, tanggal: null })]));
  const [menyimpan, mulai] = useTransition();

  const rencana: RencanaTermin[] = baris.map((b) => ({
    label: b.label,
    persen: dasar === "PERSEN" ? bacaAngka(b.nilai) : null,
    jumlah: dasar === "JUMLAH" ? bacaAngka(b.nilai) : null,
    pemicu: b.pemicu,
    hariSesudah: /^\d+$/.test(b.hari.trim()) ? Number(b.hari.trim()) : -1,
    tanggal: b.pemicu === "TANGGAL" ? b.tanggal || null : null,
  }));
  const hasil = rencanakanTermin({ fee, mode, subjek, tarif, dibayar, rencana, dasar });

  const ubah = (kunci: number, isi: Partial<Baris>) => setBaris((xs) => xs.map((x) => (x.kunci === kunci ? { ...x, ...isi } : x)));

  const gantiDasar = (d: DasarRencana) => {
    if (d === dasar) return;
    // Pertahankan pembagian yang sedang tampil saat berganti dasar.
    if (hasil.ok) {
      setBaris((xs) =>
        xs.map((x, i) => ({
          ...x,
          nilai: d === "JUMLAH" ? angkaTitik(hasil.baris[i].jumlah) : String(Math.round((hasil.baris[i].jumlah / (sisa || 1)) * 10_000) / 100).replace(".", ","),
        })),
      );
    }
    setDasar(d);
  };

  const preset = (jenis: "sekali" | "dp") => {
    setDasar("PERSEN");
    setBaris(
      jenis === "sekali"
        ? [{ kunci: kunciBerikut++, label: "Pelunasan", nilai: "100", pemicu: "TAYANG", hari: String(jatuhTempoBawaan), tanggal: "" }]
        : [
            { kunci: kunciBerikut++, label: "DP", nilai: "50", pemicu: "DEAL", hari: "0", tanggal: "" },
            { kunci: kunciBerikut++, label: "Pelunasan", nilai: "50", pemicu: "TAYANG", hari: String(jatuhTempoBawaan), tanggal: "" },
          ],
    );
  };

  const simpan = () =>
    mulai(async () => {
      const r = await aturTerminAction({ kolaborasiId, rencana, dasar });
      if (!r.ok) {
        toast.error(t(`err.${r.kode}`));
        return;
      }
      toast.success(r.berubah ? t("aturOk") : t("aturTanpa"));
      onSelesai();
    });

  const galat = hasil.ok ? null : hasil;

  return (
    <Dialog open={open} onOpenChange={(v) => !menyimpan && onOpenChange(v)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("atur.judul")}</DialogTitle>
          <DialogDescription>
            {dibayar.length > 0
              ? t("atur.deskSisa", { sisa: rupiahTeks(sisa), fee: rupiahTeks(fee) })
              : t(mode === "GROSS_UP" ? "atur.deskNeto" : "atur.deskBruto", { fee: rupiahTeks(fee) })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("atur.dasar")} className="flex gap-1">
              {(["PERSEN", "JUMLAH"] as const).map((d) => (
                <Button key={d} type="button" size="sm" variant={dasar === d ? "secondary" : "outline"} aria-pressed={dasar === d} onClick={() => gantiDasar(d)}>
                  {t(`atur.dasar${d}`)}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{t("atur.preset")}</span>
            <Button type="button" size="sm" variant="ghost" onClick={() => preset("sekali")}>
              {t("atur.presetSekali")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => preset("dp")}>
              {t("atur.presetDp")}
            </Button>
          </div>

          <ol className="space-y-3">
            {baris.map((b, i) => {
              const h = hasil.ok ? hasil.baris[i] : null;
              const salah = galat && "indeks" in galat && galat.indeks === i;
              return (
                <li key={b.kunci} className={`rounded-md border p-3 ${salah ? "border-destructive" : ""}`}>
                  <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1.2fr_1fr_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <Label htmlFor={`termin-label-${b.kunci}`}>{t("atur.label")}</Label>
                      <Input id={`termin-label-${b.kunci}`} value={b.label} maxLength={60} onChange={(e) => ubah(b.kunci, { label: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`termin-nilai-${b.kunci}`}>{dasar === "PERSEN" ? t("atur.persen") : t("atur.jumlah")}</Label>
                      <Input
                        id={`termin-nilai-${b.kunci}`}
                        inputMode="decimal"
                        className="tabular-nums"
                        value={b.nilai}
                        onChange={(e) => ubah(b.kunci, { nilai: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`termin-pemicu-${b.kunci}`}>{t("atur.pemicu")}</Label>
                      <Select value={b.pemicu} onValueChange={(v) => ubah(b.kunci, { pemicu: v as PemicuTermin })}>
                        <SelectTrigger id={`termin-pemicu-${b.kunci}`} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SEMUA_PEMICU.map((p) => (
                            <SelectItem key={p} value={p}>
                              {t(`atur.pemicuPilihan.${p}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {b.pemicu === "TANGGAL" ? (
                      <div className="space-y-1.5">
                        <Label htmlFor={`termin-tanggal-${b.kunci}`}>{t("atur.tanggal")}</Label>
                        <TanggalInput id={`termin-tanggal-${b.kunci}`} value={b.tanggal} onChange={(e) => ubah(b.kunci, { tanggal: e.target.value })} />
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label htmlFor={`termin-hari-${b.kunci}`}>{t("atur.hari")}</Label>
                        <Input
                          id={`termin-hari-${b.kunci}`}
                          inputMode="numeric"
                          className="tabular-nums"
                          value={b.hari}
                          onChange={(e) => ubah(b.kunci, { hari: e.target.value })}
                        />
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("atur.hapus", { label: b.label || String(i + 1) })}
                      disabled={baris.length === 1}
                      onClick={() => setBaris((xs) => xs.filter((x) => x.kunci !== b.kunci))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  {h ? (
                    <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                      {t("atur.pratinjau", {
                        bruto: rupiahTeks(h.rincian.bruto),
                        pph: rupiahTeks(h.rincian.pph),
                        neto: rupiahTeks(h.rincian.neto),
                        persen: String(h.persenFee).replace(".", ","),
                      })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={baris.length >= 12}
            onClick={() => setBaris((xs) => [...xs, { kunci: kunciBerikut++, label: "", nilai: "", pemicu: "TAYANG", hari: String(jatuhTempoBawaan), tanggal: "" }])}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t("atur.tambah")}
          </Button>

          {hasil.ok ? (
            <p className="text-sm tabular-nums">
              {t("atur.total", {
                bruto: rupiahTeks(hasil.baris.reduce((s, b) => s + b.rincian.bruto, 0)),
                pph: rupiahTeks(hasil.baris.reduce((s, b) => s + b.rincian.pph, 0)),
                neto: rupiahTeks(hasil.baris.reduce((s, b) => s + b.rincian.neto, 0)),
              })}
            </p>
          ) : (
            <p className="text-sm text-destructive" role="alert">
              {t(`err.${hasil.kode}`)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={menyimpan}>
            {tk("termin.dialog.batal")}
          </Button>
          <Button onClick={simpan} disabled={menyimpan || !hasil.ok}>
            {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("atur.simpan")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
