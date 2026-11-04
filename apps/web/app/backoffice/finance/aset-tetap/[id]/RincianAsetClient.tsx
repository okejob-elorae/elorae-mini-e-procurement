"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, BookText, CalendarRange, History, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import { formatRupiah } from "@/lib/format/rupiah";
import { auditActionLabel } from "@/lib/audit/action-label";
import { bacaKunciBulan, labelBulan } from "@/lib/finance/periode/periode";
import { bacaRupiahSen, barisPelepasan } from "@/lib/finance/aset/aturan";
import type { PilihanAkun, RincianAset } from "@/lib/finance/aset/queries";
import { batalkanAsetAction, batalkanPelepasanAction, lepasAsetAction } from "@/app/actions/finance-aset";
import { DialogPostingPenyusutan } from "../DialogPostingPenyusutan";
import { nadaKeadaanBulan, nadaStatusAset } from "../tampilan";
import { pesanGalatAset } from "../pesan";

type Props = {
  aset: RincianAset;
  rekening: PilihanAkun[];
  hariIni: string;
  bolehMengelola: boolean;
};

type Dialog = "lepas" | "batal" | "batalLepas" | null;

export function RincianAsetClient({ aset, rekening, hariIni, bolehMengelola }: Props) {
  const t = useTranslations("asetTetap");
  const tAudit = useTranslations("auditActions");
  const tJurnal = useTranslations("financeJournals");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tanggalLepas, setTanggalLepas] = useState(hariIni);
  const [hasilJual, setHasilJual] = useState("");
  const [akunTerima, setAkunTerima] = useState("");
  const [catatan, setCatatan] = useState("");
  const [alasan, setAlasan] = useState("");

  const aktif = aset.status === "ACTIVE";
  const bulan = (k: string | null) => {
    const tb = k ? bacaKunciBulan(k) : null;
    return tb ? labelBulan(tb, locale) : "—";
  };
  const opsiRekening = useMemo(() => rekening.map((a) => ({ value: a.id, label: `${a.kode} — ${a.nama}` })), [rekening]);

  const jualSen = hasilJual.trim() ? bacaRupiahSen(hasilJual) : 0;
  const perkiraan = jualSen == null ? null : barisPelepasan({ biaya: aset.biaya, akumulasi: aset.akumulasi, hasilJual: jualSen / 100 }).find((b) => b.peran === "LABA_RUGI");

  const tutup = () => {
    setDialog(null);
    setAlasan("");
  };

  const jalankan = (aksi: () => Promise<{ ok: boolean; kode?: string; peran?: string }>, sukses: string) =>
    mulai(async () => {
      const r = await aksi();
      if (!r.ok) {
        toast.error(pesanGalatAset(t, r.kode ?? "GAGAL", r.peran));
        return;
      }
      toast.success(sukses);
      tutup();
      router.refresh();
    });

  const alasanKurang = alasan.trim().length < 5;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/backoffice/finance/aset-tetap">
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("kembali")}
        </Link>
      </Button>
      <PageHeader
        title={`${aset.kode} · ${aset.nama}`}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusPill tone={nadaStatusAset(aset.status)}>{t(`statusAset.${aset.status}` as never)}</StatusPill>
            <span>{t(`kategori.${aset.kategori}` as never)}</span>
            {aset.lokasi ? <span>· {aset.lokasi}</span> : null}
          </span>
        }
        actions={
          bolehMengelola ? (
            <>
              {aktif && aset.umurBulan > 0 ? <DialogPostingPenyusutan bulanIni={hariIni.slice(0, 7)} asetIds={[aset.id]} variant="outline" /> : null}
              {aktif ? (
                <Button variant="outline" asChild>
                  <Link href={`/backoffice/finance/aset-tetap/${aset.id}/ubah`}>
                    <Pencil className="mr-2 h-4 w-4" />
                    {t("rinci.ubah")}
                  </Link>
                </Button>
              ) : null}
              {aktif ? <Button onClick={() => setDialog("lepas")}>{t("rinci.lepas")}</Button> : null}
              {aktif && !aset.sudahDisusutkan ? (
                <Button variant="destructive" onClick={() => setDialog("batal")}>
                  {t("rinci.batalkan")}
                </Button>
              ) : null}
              {aset.status === "DISPOSED" ? (
                <Button variant="outline" onClick={() => setDialog("batalLepas")}>
                  {t("rinci.batalLepas")}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Angka label={t("kartu.biaya")} nilai={formatRupiah(aset.biaya)} />
        <Angka label={t("kartu.akumulasi")} nilai={formatRupiah(aset.akumulasi)} />
        <Angka label={t("kartu.nilaiBuku")} nilai={formatRupiah(aset.nilaiBuku)} />
        <Angka label={t("rinci.nilaiSisa")} nilai={formatRupiah(aset.nilaiSisa)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("rinci.data")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Data label={t("form.tanggalPerolehan")} nilai={formatDisplayDate(aset.tanggalPerolehan, locale)} />
            <Data label={t("form.metode")} nilai={t(`metode.${aset.metode}` as never) + (aset.tarifSaldoMenurun ? ` (${aset.tarifSaldoMenurun}%)` : "")} />
            <Data label={t("form.umur")} nilai={aset.umurBulan > 0 ? t("form.umurTetap", { bulan: aset.umurBulan, tahun: Math.round((aset.umurBulan / 12) * 100) / 100 }) : t("form.tanahTidakDisusutkan")} />
            <Data label={t("rinci.masa")} nilai={aset.umurBulan > 0 ? `${bulan(aset.mulaiDisusutkan)} – ${bulan(aset.akhirMasaManfaat)}` : "—"} />
            <Data label={t("form.akumulasiAwal")} nilai={formatRupiah(aset.akumulasiAwal)} />
            <Data label={t("form.cara")} nilai={aset.cara ? t(`cara.${aset.cara}`) : "—"} />
            <Data label={t("form.pemasok")} nilai={aset.pemasok?.nama ?? "—"} />
            <Data label={t("form.akunAset")} nilai={aset.akunAset ? `${aset.akunAset.kode} ${aset.akunAset.nama}` : t("form.ikutPeran")} />
            <Data label={t("form.akunAkumulasi")} nilai={aset.akunAkumulasi ? `${aset.akunAkumulasi.kode} ${aset.akunAkumulasi.nama}` : t("form.ikutPeran")} />
            <Data label={t("form.akunBeban")} nilai={aset.akunBeban ? `${aset.akunBeban.kode} ${aset.akunBeban.nama}` : t("form.ikutPeran")} />
            <Data label={t("rinci.dibuat")} nilai={`${aset.dibuatOleh ?? "—"} · ${formatDisplayDateTime(aset.dibuatPada, locale)}`} />
            {aset.dilepas ? (
              <Data
                label={t("rinci.dilepasPada")}
                nilai={`${formatDisplayDate(aset.dilepas.tanggal, locale)} · ${formatRupiah(aset.dilepas.hasilJual)}${aset.dilepas.olehNama ? ` · ${aset.dilepas.olehNama}` : ""}`}
              />
            ) : null}
            {aset.catatan ? <Data label={t("form.catatan")} nilai={aset.catatan} /> : null}
          </dl>
        </CardContent>
      </Card>

      {aset.jadwal.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarRange className="h-5 w-5" />
              {t("rinci.jadwal")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card">
                  <TableRow>
                    <TableHead>{t("rinci.kolom.bulan")}</TableHead>
                    <TableHead className="text-right">{t("rinci.kolom.jadwal")}</TableHead>
                    <TableHead className="text-right">{t("rinci.kolom.diposting")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("rinci.kolom.akumulasiJadwal")}</TableHead>
                    <TableHead>{t("rinci.kolom.keadaan")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aset.jadwal.map((b) => (
                    <TableRow key={b.periode}>
                      <TableCell className="whitespace-nowrap">{bulan(b.periode)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(b.jadwal)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {b.diposting == null ? (
                          "—"
                        ) : b.journalId ? (
                          <Link href={`/backoffice/finance/journals/${b.journalId}`} className="underline underline-offset-4">
                            {formatRupiah(b.diposting)}
                          </Link>
                        ) : (
                          formatRupiah(b.diposting)
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums 2xl:table-cell">{formatRupiah(b.akumulasiJadwal)}</TableCell>
                      <TableCell>
                        <StatusPill tone={nadaKeadaanBulan(b.keadaan)}>{t(`keadaan.${b.keadaan}`)}</StatusPill>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookText className="h-5 w-5" />
            {t("rinci.jurnal")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {aset.jurnal.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("rinci.tanpaJurnal")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("rinci.kolom.tanggal")}</TableHead>
                    <TableHead>{t("rinci.kolom.jenis")}</TableHead>
                    <TableHead className="min-w-[200px]">{t("rinci.kolom.keterangan")}</TableHead>
                    <TableHead className="text-right">{t("rinci.kolom.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aset.jurnal.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell className="whitespace-nowrap">{formatDisplayDate(j.tanggal, locale)}</TableCell>
                      <TableCell>{tJurnal.has(`sourceTypes.${j.jenis}`) ? tJurnal(`sourceTypes.${j.jenis}` as never) : j.jenis}</TableCell>
                      <TableCell className="whitespace-normal">
                        <Link href={`/backoffice/finance/journals/${j.id}`} className="underline underline-offset-4">
                          {j.keterangan}
                        </Link>
                        {j.dibalikOleh ? <span className="ml-2 text-xs text-muted-foreground">{t("rinci.dibalik")}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatRupiah(j.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t("rinci.riwayat")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {aset.riwayat.map((r, i) => (
              <li key={i} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <span className="text-muted-foreground sm:w-44 sm:shrink-0">{formatDisplayDateTime(r.waktu, locale)}</span>
                <span>
                  {auditActionLabel(tAudit, r.aksi, "FixedAsset")}
                  {r.olehNama ? ` · ${r.olehNama}` : ""}
                  {r.alasan ? ` — ${r.alasan}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Dialog open={dialog === "lepas"} onOpenChange={(v) => !pending && !v && tutup()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("lepas.judul", { kode: aset.kode })}</DialogTitle>
            <DialogDescription>{t("lepas.isi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lepas-tanggal">{t("lepas.tanggal")}</Label>
              <TanggalInput id="lepas-tanggal" value={tanggalLepas} min={aset.tanggalPerolehan} max={hariIni} required onChange={(e) => setTanggalLepas(e.target.value)} disabled={pending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lepas-hasil">{t("lepas.hasilJual")}</Label>
              <Input id="lepas-hasil" inputMode="decimal" value={hasilJual} placeholder="0" onChange={(e) => setHasilJual(e.target.value)} disabled={pending} className="text-right" />
            </div>
            {jualSen != null && jualSen > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="lepas-akun">{t("lepas.akunTerima")}</Label>
                <SearchableCombobox id="lepas-akun" options={opsiRekening} value={akunTerima} onValueChange={setAkunTerima} placeholder={t("form.pilihAkun")} disabled={pending} triggerClassName="w-full" />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="lepas-catatan">{t("form.catatan")}</Label>
              <Textarea id="lepas-catatan" rows={2} value={catatan} maxLength={2000} onChange={(e) => setCatatan(e.target.value)} disabled={pending} />
            </div>
            {perkiraan ? (
              <p className="text-sm">
                {perkiraan.credit > 0 ? t("lepas.perkiraanLaba", { nilai: formatRupiah(perkiraan.credit) }) : t("lepas.perkiraanRugi", { nilai: formatRupiah(perkiraan.debit) })}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={tutup} disabled={pending}>
              {t("batal")}
            </Button>
            <Button
              disabled={pending || jualSen == null || (jualSen > 0 && !akunTerima) || !tanggalLepas}
              onClick={() =>
                jalankan(
                  () => lepasAsetAction({ id: aset.id, tanggal: tanggalLepas, hasilJual, akunPenerimaanId: jualSen && jualSen > 0 ? akunTerima : null, catatan }),
                  t("lepas.berhasil"),
                )
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("lepas.tombol")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "batal" || dialog === "batalLepas"} onOpenChange={(v) => !pending && !v && tutup()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "batal" ? t("batalAset.judul") : t("batalLepas.judul")}</DialogTitle>
            <DialogDescription>{dialog === "batal" ? t("batalAset.isi") : t("batalLepas.isi")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="alasan-aset">{t("alasan")}</Label>
            <Textarea id="alasan-aset" rows={3} value={alasan} maxLength={2000} onChange={(e) => setAlasan(e.target.value)} disabled={pending} />
            {alasanKurang ? <p className="text-xs text-muted-foreground">{t("err.ALASAN_WAJIB")}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={tutup} disabled={pending}>
              {t("batal")}
            </Button>
            <Button
              variant={dialog === "batal" ? "destructive" : "default"}
              disabled={pending || alasanKurang}
              onClick={() =>
                dialog === "batal"
                  ? jalankan(() => batalkanAsetAction({ id: aset.id, alasan }), t("batalAset.berhasil"))
                  : jalankan(() => batalkanPelepasanAction({ id: aset.id, alasan }), t("batalLepas.berhasil"))
              }
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dialog === "batal" ? t("batalAset.tombol") : t("batalLepas.tombol")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Angka({ label, nilai }: { label: string; nilai: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{nilai}</p>
    </Card>
  );
}

function Data({ label, nilai }: { label: string; nilai: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{nilai}</dd>
    </div>
  );
}
