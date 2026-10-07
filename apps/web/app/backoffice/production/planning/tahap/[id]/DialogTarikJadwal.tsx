"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import type { KalenderKerja } from "@/lib/production/hari-kerja";
import type { RuangKerjaTahap } from "@/lib/production/jadwal-queries";
import { tarikJadwalAction } from "@/app/actions/jadwal-produksi";
import { cn } from "@/lib/utils";
import {
  angkaTampil,
  bolehGanti,
  centangLangkah,
  geserPemasok,
  hapusPemasok,
  hariLangkahUntukQty,
  isianAwalTarik,
  labelPendek,
  langkahTerpilih,
  peringatanJadwal,
  pratinjauTarik,
  tambahPemasok,
  type CaraTarik,
  type ModeJadwal,
  type PilihanPemasok,
} from "./ruang-kerja";
import type { HasilAksi } from "./pakai-aksi";
import { PilihMode } from "./PilihMode";
import { PeringatanMulaiLewat } from "./PeringatanMulaiLewat";

type Props = {
  buka: boolean;
  data: RuangKerjaTahap;
  kal: KalenderKerja;
  sibuk: boolean;
  jalankan: (aksi: () => Promise<HasilAksi>, pesanBerhasil: string) => Promise<boolean>;
  onOpenChange: (buka: boolean) => void;
};

/**
 * Tarik langkah dari rantai Lead Time beberapa pemasok berurutan (pabrik kain →
 * penjahit → sablon). Pratinjau tanggal dihitung di sini dengan pustaka yang
 * sama dengan penulis, jadi yang tampil = yang tersimpan.
 */
export function DialogTarikJadwal({ buka, onOpenChange, ...isi }: Props) {
  return (
    <Dialog open={buka} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        {buka ? <IsiTarik onOpenChange={onOpenChange} {...isi} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function IsiTarik({ data, kal, sibuk, jalankan, onOpenChange }: Omit<Props, "buka">) {
  const t = useTranslations("jadwalProduksi.ruang");
  const tServer = useTranslations("jadwalProduksi.server");
  const locale = useLocale();
  const awal = isianAwalTarik(data);
  const [pilihan, setPilihan] = useState<PilihanPemasok[]>(awal.pilihan);
  const [mode, setMode] = useState<ModeJadwal>(awal.mode);
  const [tanggal, setTanggal] = useState(awal.tanggal);
  const [cara, setCara] = useState<CaraTarik>(awal.cara);

  const { tahap, langkah, sumberLeadTime: sumber, hariIni } = data;
  const adaLangkah = langkah.length > 0;
  const gantiBoleh = bolehGanti(langkah);
  const pendek = (teks: string | null) => labelPendek(teks, hariIni, locale);

  const pratinjau = pratinjauTarik({
    langkahLama: langkah,
    scheduleStart: tahap.scheduleStart,
    deadline: tahap.deadline,
    targetQty: tahap.targetQty,
    sumber,
    pilihan,
    mode,
    tanggal,
    cara,
    kal,
  });
  const menyambung = mode === "MAJU" && cara === "TAMBAH" && adaLangkah && !!tahap.scheduleStart;
  const belumDipilih = sumber.filter((s) => !pilihan.some((p) => p.supplierId === s.supplierId));

  const simpan = async () => {
    if (!pratinjau.ok) return;
    const ok = await jalankan(
      () =>
        tarikJadwalAction({
          planStageId: tahap.id,
          langkah: langkahTerpilih(pilihan, sumber),
          mode,
          tanggal: pratinjau.tanggalKirim,
          cara,
        }),
      t("berhasilTarik", { n: pratinjau.jumlahBaru }),
    );
    if (ok) onOpenChange(false);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("tarikJudul")}</DialogTitle>
      </DialogHeader>

      {/* 1. Pemasok berurutan dan langkahnya */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("tarikPemasok")}</h3>
        {sumber.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            <p>{t("sumberKosong")}</p>
            <Link href="/backoffice/lead-time" className="mt-1 inline-block font-medium text-tautan underline underline-offset-4">
              {t("bukaLeadTime")}
            </Link>
          </div>
        ) : (
          <>
            {pilihan.length === 0 ? <p className="text-sm text-muted-foreground">{t("pilihPemasokDulu")}</p> : null}
            <ol className="space-y-2">
              {pilihan.map((p, i) => {
                const s = sumber.find((x) => x.supplierId === p.supplierId);
                if (!s) return null;
                return (
                  <li key={p.supplierId} className="rounded-md border">
                    <div className="flex items-center gap-2 border-b px-3 py-2">
                      <span className="text-sm font-medium tabular-nums text-muted-foreground">{i + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.supplierName}</p>
                        {s.jenis ? <p className="truncate text-xs text-muted-foreground">{s.jenis}</p> : null}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={i === 0}
                        aria-label={t("geserAtas", { nama: s.supplierName })}
                        title={t("geserAtas", { nama: s.supplierName })}
                        onClick={() => setPilihan((x) => geserPemasok(x, p.supplierId, -1))}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={i === pilihan.length - 1}
                        aria-label={t("geserBawah", { nama: s.supplierName })}
                        title={t("geserBawah", { nama: s.supplierName })}
                        onClick={() => setPilihan((x) => geserPemasok(x, p.supplierId, 1))}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("lepasPemasok", { nama: s.supplierName })}
                        title={t("lepasPemasok", { nama: s.supplierName })}
                        onClick={() => setPilihan((x) => hapusPemasok(x, p.supplierId))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <ul className="space-y-1 px-3 py-2">
                      {s.langkah.map((l) => {
                        const idCentang = `tarik-${p.supplierId}-${l.sequence}`;
                        return (
                          <li key={l.sequence} className="flex items-center gap-3 py-0.5">
                            <Checkbox
                              id={idCentang}
                              checked={p.sequences.includes(l.sequence)}
                              onCheckedChange={(v) =>
                                setPilihan((x) => centangLangkah(x, p.supplierId, l.sequence, v === true))
                              }
                            />
                            <Label htmlFor={idCentang} className="flex-1 cursor-pointer font-normal">
                              {l.name}
                            </Label>
                            <span className="text-right text-sm text-muted-foreground">
                              {t("hariKerja", { n: hariLangkahUntukQty(l, tahap.targetQty) })}
                              {l.type === "PER_QTY" && l.rateQty ? (
                                <span className="block text-xs">
                                  {t("perQty", { hari: l.days, qty: angkaTampil(l.rateQty, locale) })}
                                </span>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ol>
            {belumDipilih.length > 0 ? (
              <SearchableCombobox
                className="sm:w-80"
                options={belumDipilih.map((s) => ({
                  value: s.supplierId,
                  label: s.jenis ? `${s.supplierName} · ${s.jenis}` : s.supplierName,
                }))}
                value=""
                onValueChange={(id) => setPilihan((x) => tambahPemasok(x, sumber, id))}
                placeholder={t("tambahPemasok")}
                searchPlaceholder={t("cariPemasok")}
                emptyMessage={t("pemasokTidakAda")}
              />
            ) : null}
          </>
        )}
      </section>

      {/* 2. Susun maju / mundur */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("susun")}</h3>
        <PilihMode mode={mode} onChange={setMode} />
        <div className="space-y-2">
          <Label htmlFor="tarik-tanggal">{mode === "MAJU" ? t("tanggalMulai") : t("tanggalTenggat")}</Label>
          <TanggalInput
            id="tarik-tanggal"
            className="sm:w-60"
            value={menyambung ? (tahap.scheduleStart ?? tanggal) : tanggal}
            disabled={menyambung}
            required
            onChange={(e) => setTanggal(e.target.value)}
          />
          {menyambung ? (
            <p className="text-sm text-muted-foreground">{t("menyambung", { tanggal: pendek(tahap.scheduleStart) })}</p>
          ) : null}
        </div>
      </section>

      {/* 3. Langkah lama */}
      {adaLangkah ? (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("caraJudul", { n: langkah.length })}</h3>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("caraJudul", { n: langkah.length })}>
            {(["TAMBAH", "GANTI"] as const).map((c) => (
              <Button
                key={c}
                type="button"
                role="radio"
                aria-checked={cara === c}
                variant={cara === c ? "default" : "outline"}
                disabled={c === "GANTI" && !gantiBoleh}
                className="h-auto whitespace-normal py-2"
                onClick={() => setCara(c)}
              >
                {c === "TAMBAH" ? t("caraTambah") : t("caraGanti")}
              </Button>
            ))}
          </div>
          {!gantiBoleh ? <p className="text-sm text-muted-foreground">{t("gantiTidakBisa")}</p> : null}
        </section>
      ) : null}

      {/* 4. Pratinjau */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("pratinjau")}</h3>
        {pratinjau.ok ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t("pratinjauRingkas", {
                mulai: pendek(pratinjau.mulai),
                selesai: pendek(pratinjau.selesaiPada),
                n: pratinjau.totalHari,
              })}
            </p>
            {mode === "MUNDUR" ? (
              <PeringatanMulaiLewat
                pendek={pendek}
                peringatan={peringatanJadwal({
                  langkah: pratinjau.baris,
                  mulai: pratinjau.mulai,
                  tenggat: pratinjau.tenggat,
                  hariIni,
                  kal,
                })}
              />
            ) : null}
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">{t("kolNo")}</TableHead>
                    <TableHead>{t("kolLangkah")}</TableHead>
                    <TableHead>{t("kolPemasok")}</TableHead>
                    <TableHead className="text-right">{t("kolLama")}</TableHead>
                    <TableHead>{t("kolTarget")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pratinjau.baris.map((b, i) => (
                    <TableRow key={b.kunci} className={cn(!b.baru && "text-muted-foreground")}>
                      <TableCell className="tabular-nums">{i + 1}</TableCell>
                      <TableCell className="whitespace-normal">
                        <span className="mr-2">{b.name}</span>
                        {b.baru ? <Badge variant="secondary">{t("baru")}</Badge> : null}
                      </TableCell>
                      <TableCell className="whitespace-normal">{b.pemasok ?? "—"}</TableCell>
                      <TableCell className="text-right">{t("hariKerja", { n: b.durationDays })}</TableCell>
                      <TableCell>{pendek(b.targetDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{tServer(`err${pratinjau.code}`)}</p>
        )}
      </section>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          {t("batal")}
        </Button>
        <Button type="button" disabled={sibuk || !pratinjau.ok} onClick={() => void simpan()}>
          {sibuk ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {pratinjau.ok ? t("tarikTombol", { n: pratinjau.jumlahBaru }) : t("tarikTombolKosong")}
        </Button>
      </DialogFooter>
    </>
  );
}
