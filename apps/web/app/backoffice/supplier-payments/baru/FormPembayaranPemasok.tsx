"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TanggalInput } from "@/components/ui/tanggal-input";
import { Textarea } from "@/components/ui/textarea";
import { formatRupiah } from "@/lib/format/rupiah";
import { labelTanggal } from "@/lib/tanggal-isian";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { labelPemasok } from "@/lib/suppliers/label-pemasok";
import { bacaRupiahSen } from "@/lib/finance/kas/aturan";
import { bacaJenisPotongPemasok, INFO_POTONG_PEMASOK, SEMUA_JENIS_POTONG_PEMASOK, type JenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { CARA_BAYAR, dasarPotongBawaanSen, hitungPembayaran, kunciDokumenHutang, type AlokasiSah, type SisaDokumen } from "@/lib/purchasing/pembayaran-aturan";
import type { TarifPajakKreatif } from "@/lib/creative/pph";
import type { HutangPemasok } from "@/lib/purchasing/pembayaran-hutang-queries";
import type { RekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { catatPembayaranPemasokAction, hutangPemasokAction } from "@/app/actions/pembayaran-pemasok";
import { UnggahBukti } from "@/app/backoffice/finance/kas/_bersama/UnggahBukti";
import { pesanGalatPembayaran } from "../pesan-pembayaran";

type Props = {
  pemasok: Array<{ id: string; kode: string; nama: string; disetujui: boolean }>;
  rekening: RekeningKasBank[];
  tarif: TarifPajakKreatif;
  hariIni: string;
  awal: HutangPemasok | null;
  apBelumDipetakanAwal: boolean;
  poAwal: string | null;
};

const TANPA = "__tanpa__";

function isiAwalBayar(h: HutangPemasok | null, poId: string | null): Record<string, string> {
  if (!h || !poId) return {};
  const isi: Record<string, string> = {};
  for (const d of h.dokumen) if (d.poId === poId && d.sisaSen > 0) isi[kunciDokumenHutang(d.jenis, d.id)] = String(d.sisaSen / 100);
  return isi;
}

export function FormPembayaranPemasok({ pemasok, rekening, tarif, hariIni, awal, apBelumDipetakanAwal, poAwal }: Props) {
  const t = useTranslations("supplierPayments.dokumen");
  const tSp = useTranslations("supplierPayments");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [memuat, setMemuat] = useState(false);
  const [hutang, setHutang] = useState<HutangPemasok | null>(awal);
  const [apBelum, setApBelum] = useState(apBelumDipetakanAwal);
  const [pemasokId, setPemasokId] = useState(awal?.supplierId ?? "");
  const [bayar, setBayar] = useState<Record<string, string>>(() => isiAwalBayar(awal, poAwal));
  const [uangMuka, setUangMuka] = useState("");
  const [tanggal, setTanggal] = useState(hariIni);
  const [cara, setCara] = useState<(typeof CARA_BAYAR)[number]>("TRANSFER");
  const [rekeningId, setRekeningId] = useState(rekening[0]?.id ?? "");
  const [referensi, setReferensi] = useState("");
  const [jatuhTempoGiro, setJatuhTempoGiro] = useState("");
  const [catatan, setCatatan] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [potong, setPotong] = useState<string>(() => bacaJenisPotongPemasok(awal?.jenisPotong) ?? TANPA);
  const [dasarKetik, setDasarKetik] = useState("");
  const [kunci, setKunci] = useState(() => newLocalId());

  const dokumen = useMemo(() => (hutang?.dokumen ?? []).filter((d) => d.sisaSen > 0), [hutang]);
  const sisa = useMemo(() => {
    const m = new Map<string, SisaDokumen>();
    for (const d of hutang?.dokumen ?? []) m.set(kunciDokumenHutang(d.jenis, d.id), { sisaSen: d.sisaSen, porsiDasarPotong: d.porsiDasarPotong });
    return m;
  }, [hutang]);

  const alokasi: AlokasiSah[] = [];
  const salahBaris = new Set<string>();
  for (const d of dokumen) {
    const k = kunciDokumenHutang(d.jenis, d.id);
    const teks = bayar[k]?.trim();
    if (!teks) continue;
    const s = bacaRupiahSen(teks);
    if (s == null || s > d.sisaSen) {
      salahBaris.add(k);
      continue;
    }
    if (s > 0) alokasi.push({ jenis: d.jenis, id: d.id, sen: s });
  }
  const uangMukaSen = uangMuka.trim() ? bacaRupiahSen(uangMuka) : 0;
  const brutoSen = alokasi.reduce((s, a) => s + a.sen, 0) + (uangMukaSen ?? 0);
  const jenisPotong: JenisPotongPemasok | null = potong === TANPA ? null : bacaJenisPotongPemasok(potong);
  const dasarBawaan = dasarPotongBawaanSen(jenisPotong, alokasi, sisa, brutoSen);
  const dasarSen = dasarKetik.trim() ? bacaRupiahSen(dasarKetik) : dasarBawaan;
  const hitung = hitungPembayaran(brutoSen, jenisPotong, dasarSen ?? 0, hutang?.adaNpwp ?? true, tarif);

  const alasanTidakBisa = !pemasokId
    ? t("alasan.pemasok")
    : !rekeningId
      ? t("alasan.rekening")
      : salahBaris.size > 0
        ? t("alasan.melebihiSisa")
        : uangMukaSen == null
          ? t("alasan.uangMuka")
          : dasarSen == null || dasarSen > brutoSen
            ? t("alasan.dasarPotong")
            : brutoSen <= 0
              ? t("alasan.kosong")
              : null;

  const muatPemasok = async (id: string) => {
    setPemasokId(id);
    setBayar({});
    setUangMuka("");
    setDasarKetik("");
    if (!id) {
      setHutang(null);
      return;
    }
    setMemuat(true);
    try {
      const r = await hutangPemasokAction({ pemasokId: id });
      if (!r.ok) {
        toast.error(t("gagalMemuat"));
        return;
      }
      setHutang(r.hutang);
      setApBelum(r.apBelumDipetakan);
      setPotong(bacaJenisPotongPemasok(r.hutang?.jenisPotong) ?? TANPA);
    } catch {
      toast.error(t("gagalMemuat"));
    } finally {
      setMemuat(false);
    }
  };

  const simpan = () =>
    mulai(async () => {
      const r = await catatPembayaranPemasokAction({
        pemasokId,
        tanggal,
        cara,
        rekeningId,
        referensi: referensi || null,
        jatuhTempoGiro: cara === "GIRO" ? jatuhTempoGiro || null : null,
        catatan: catatan || null,
        fotoUrl: foto,
        alokasi: alokasi.map((a) => ({ jenis: a.jenis, id: a.id, jumlah: a.sen / 100 })),
        uangMuka: uangMukaSen ? uangMukaSen / 100 : null,
        jenisPotong: potong === TANPA ? "" : potong,
        dasarPotong: dasarKetik.trim() ? dasarKetik : null,
        idempotencyKey: kunci,
      });
      if (!r.ok) {
        toast.error(pesanGalatPembayaran(t as unknown as Parameters<typeof pesanGalatPembayaran>[0], r));
        return;
      }
      toast.success(r.ulang ? t("sudahTercatat", { nomor: r.nomor }) : t("tersimpan", { nomor: r.nomor }));
      setKunci(newLocalId());
      router.push(`/backoffice/supplier-payments/${r.id}`);
    });

  const opsiPemasok = pemasok.map((p) => ({ value: p.id, label: `${labelPemasok({ code: p.kode, name: p.nama })}${p.disetujui ? "" : ` · ${tSp("belumDisetujui")}`}` }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("judulBaru")}
        actions={
          <Link href="/backoffice/supplier-payments">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("kembali")}
            </Button>
          </Link>
        }
      />

      <Card className="py-0">
        <CardContent className="grid gap-4 py-6 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label>{tSp("supplierLabel")}</Label>
            <SearchableCombobox options={opsiPemasok} value={pemasokId} onValueChange={(v) => void muatPemasok(v)} placeholder={t("pilihPemasok")} searchPlaceholder={tSp("cariPemasok")} triggerClassName="w-full" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tanggal-bayar">{t("tanggal")}</Label>
            <TanggalInput id="tanggal-bayar" value={tanggal} max={hariIni} required onChange={(e) => setTanggal(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t("caraLabel")}</Label>
            <Select value={cara} onValueChange={(v) => setCara(v as (typeof CARA_BAYAR)[number])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARA_BAYAR.map((c) => (
                  <SelectItem key={c} value={c}>
                    {t(`cara.${c}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("rekening")}</Label>
            <Select value={rekeningId} onValueChange={setRekeningId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("pilihRekening")} />
              </SelectTrigger>
              <SelectContent>
                {rekening.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.nama} ({r.kode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {rekening.length === 0 && <p className="text-xs text-destructive">{t("tanpaRekening")}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="referensi">{t("referensi")}</Label>
            <Input id="referensi" value={referensi} onChange={(e) => setReferensi(e.target.value)} maxLength={191} />
          </div>
          {cara === "GIRO" && (
            <div className="space-y-2">
              <Label htmlFor="jatuh-tempo-giro">{t("jatuhTempoGiro")}</Label>
              <TanggalInput id="jatuh-tempo-giro" value={jatuhTempoGiro} onChange={(e) => setJatuhTempoGiro(e.target.value)} />
            </div>
          )}
        </CardContent>
      </Card>

      {apBelum && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{t("apBelumDipetakan")}</p>
        </div>
      )}
      {hutang && hutang.grnBelumBerjurnal > 0 && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{t("grnBelumBerjurnal", { count: hutang.grnBelumBerjurnal })}</p>
        </div>
      )}

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {t("dokumenTerbuka")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pb-6">
          {memuat ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !pemasokId ? (
            <EmptyState icon={Wallet} title={t("pilihPemasokDulu")} />
          ) : dokumen.length === 0 ? (
            <EmptyState icon={Wallet} title={t("tanpaHutang")} description={t("tanpaHutangIsi")} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <span className="sr-only">{t("lunasi")}</span>
                    </TableHead>
                    <TableHead>{t("kolomDokumenHutang")}</TableHead>
                    <TableHead className="hidden xl:table-cell">{t("kolomTanggal")}</TableHead>
                    <TableHead className="hidden text-right 2xl:table-cell">{t("kolomHutang")}</TableHead>
                    <TableHead className="text-right">{t("kolomSisa")}</TableHead>
                    <TableHead className="w-[170px]">{t("kolomBayar")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dokumen.map((d) => {
                    const k = kunciDokumenHutang(d.jenis, d.id);
                    const penuh = bayar[k]?.trim() && bacaRupiahSen(bayar[k]) === d.sisaSen;
                    return (
                      <TableRow key={k}>
                        <TableCell className="align-top">
                          <Checkbox
                            checked={Boolean(penuh)}
                            aria-label={t("lunasiDokumen", { nomor: d.nomor })}
                            onCheckedChange={(v) => setBayar((b) => ({ ...b, [k]: v === true ? String(d.sisaSen / 100) : "" }))}
                          />
                        </TableCell>
                        <TableCell className="align-top whitespace-normal">
                          <p className="font-medium">{d.jenis === "OTHER" ? t("hutangSaldoAwal") : d.nomor}</p>
                          <p className="text-xs text-muted-foreground">
                            {t(`jenisDokumen.${d.jenis}`)}
                            {d.poNomor ? ` · ${d.poNomor}` : ""}
                            {d.keterangan ? ` · ${d.keterangan}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground xl:hidden">{labelTanggal(d.tanggal, locale)}</p>
                        </TableCell>
                        <TableCell className="hidden align-top xl:table-cell">{labelTanggal(d.tanggal, locale)}</TableCell>
                        <TableCell className="hidden align-top text-right tabular-nums 2xl:table-cell">{formatRupiah(d.hutangSen / 100)}</TableCell>
                        <TableCell className="align-top text-right tabular-nums">{formatRupiah(d.sisaSen / 100)}</TableCell>
                        <TableCell className="align-top">
                          <Input
                            inputMode="decimal"
                            value={bayar[k] ?? ""}
                            onChange={(e) => setBayar((b) => ({ ...b, [k]: e.target.value }))}
                            aria-label={t("bayarDokumen", { nomor: d.nomor })}
                            aria-invalid={salahBaris.has(k)}
                            className="text-right tabular-nums"
                          />
                          {salahBaris.has(k) && <p className="mt-1 text-xs text-destructive">{t("melebihiSisaBaris")}</p>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {pemasokId && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="outline" size="sm" disabled={dokumen.length === 0} onClick={() => setBayar(Object.fromEntries(dokumen.map((d) => [kunciDokumenHutang(d.jenis, d.id), String(d.sisaSen / 100)])))}>
                {t("lunasiSemua")}
              </Button>
              <div className="flex items-center gap-2">
                <Label htmlFor="uang-muka" className="whitespace-nowrap">
                  {t("uangMuka")}
                </Label>
                <Input id="uang-muka" inputMode="decimal" value={uangMuka} onChange={(e) => setUangMuka(e.target.value)} className="w-[170px] text-right tabular-nums" aria-invalid={uangMukaSen == null} />
              </div>
            </div>
          )}
          {hutang && hutang.uangMukaSen > 0 && <p className="text-sm text-muted-foreground">{t("adaUangMuka", { nilai: formatRupiah(hutang.uangMukaSen / 100) })}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>{t("potongJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pb-6">
            <div className="space-y-2">
              <Label>{t("jenisPotong")}</Label>
              <Select value={potong} onValueChange={(v) => setPotong(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TANPA}>{t("tanpaPotong")}</SelectItem>
                  {SEMUA_JENIS_POTONG_PEMASOK.map((j) => (
                    <SelectItem key={j} value={j}>
                      {INFO_POTONG_PEMASOK[j].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {jenisPotong && <p className="text-xs text-muted-foreground">{INFO_POTONG_PEMASOK[jenisPotong].keterangan}</p>}
              {hutang && !hutang.adaNpwp && jenisPotong && <p className="text-xs text-amber-700 dark:text-amber-400">{t("tanpaNpwp")}</p>}
            </div>
            {jenisPotong && (
              <div className="space-y-2">
                <Label htmlFor="dasar-potong">{t("dasarPotong")}</Label>
                <Input id="dasar-potong" inputMode="decimal" value={dasarKetik} placeholder={String(dasarBawaan / 100)} onChange={(e) => setDasarKetik(e.target.value)} className="text-right tabular-nums" />
                <p className="text-xs text-muted-foreground">{t("dasarPotongBawaan", { nilai: formatRupiah(dasarBawaan / 100) })}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardHeader className="pt-6">
            <CardTitle>{t("ringkasanJudul")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-6 text-sm">
            <Baris label={t("ringkasBruto")} nilai={formatRupiah(hitung.brutoSen / 100)} />
            <Baris label={t("ringkasPotongBaris", { jenis: jenisPotong ? INFO_POTONG_PEMASOK[jenisPotong].label : "–" })} nilai={hitung.potongSen > 0 ? `− ${formatRupiah(hitung.potongSen / 100)}` : "–"} />
            <Baris label={t("ringkasNeto")} nilai={formatRupiah(hitung.netoSen / 100)} tebal />
            <div className="space-y-2 pt-3">
              <Label htmlFor="catatan">{t("catatan")}</Label>
              <Textarea id="catatan" value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={1000} rows={2} />
            </div>
            <div className="space-y-2 pt-1">
              <Label>{t("bukti")}</Label>
              <UnggahBukti value={foto} onChange={setFoto} disabled={pending} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col items-end gap-1">
        <Button onClick={simpan} disabled={pending || alasanTidakBisa != null}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t("simpan")}
        </Button>
        {alasanTidakBisa && <p className="text-xs text-muted-foreground">{alasanTidakBisa}</p>}
      </div>
    </div>
  );
}

function Baris({ label, nilai, tebal }: { label: string; nilai: string; tebal?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${tebal ? "border-t pt-2 font-semibold" : ""}`}>
      <span className={tebal ? "" : "text-muted-foreground"}>{label}</span>
      <span className="tabular-nums">{nilai}</span>
    </div>
  );
}
