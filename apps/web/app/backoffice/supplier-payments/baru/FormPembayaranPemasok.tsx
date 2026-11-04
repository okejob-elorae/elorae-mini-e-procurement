"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeft, BadgeCheck, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { bacaJenisPotongPemasok, INFO_POTONG_PEMASOK, SEMUA_JENIS_POTONG_PEMASOK, tentukanPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import {
  batasDasarPotongSen,
  CARA_BAYAR,
  dasarPotongBawaanSen,
  hitungPembayaran,
  kunciDokumenHutang,
  porsiPotongEfektif,
  type AlokasiSah,
  type SisaDokumen,
} from "@/lib/purchasing/pembayaran-aturan";
import type { TarifPajakKreatif } from "@/lib/creative/pph";
import type { HutangPemasok } from "@/lib/purchasing/pembayaran-hutang-queries";
import type { RekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { catatPembayaranPemasokAction, hutangPemasokAction } from "@/app/actions/pembayaran-pemasok";
import { invoiceUntukBayarAction } from "@/app/actions/supplier-payment-invoice";
import type { DataBayarInvoice } from "@/lib/vendor-billing/invoice-bayar-queries";
import { catatanDariInvoice, isiDariInvoice, ringkasInvoiceTerpilih, terapkanPilihanInvoice } from "@/lib/purchasing/bayar-dari-invoice";
import { PilihInvoiceCard } from "./PilihInvoiceCard";
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
  /** "Bayar per invoice" pemasok awal; null = tanpa kartu (basis data tanpa tagihan vendor, atau gagal dibaca). */
  invoiceAwal: DataBayarInvoice | null;
  /** `?invoice=` — tagihan terbuka pemasok itu yang dicentang di awal. */
  invoicePilihAwal: string | null;
  /** `?invoice=` menunjuk tagihan yang sudah lunas: nomor invoicenya, untuk "Invoice ini sudah lunas". */
  invoiceLunasDariUrl: string | null;
  /** `vendor_bills:view` — tautan ke tagihan di kartu invoice. */
  bolehBukaTagihan: boolean;
};

/** Isian bayar + isian pemilih dari invoice yang dicentang (dipakai saat awal dan setiap centang berubah). */
function terapkanInvoice(data: DataBayarInvoice | null, dipilih: Set<string>, bayar: Record<string, string>, isiSebelum: Record<string, string>) {
  const isi = data ? isiDariInvoice(data, dipilih) : new Map();
  const r = terapkanPilihanInvoice({ bayar, isiSebelum, isiBaru: new Map([...isi].map(([k, v]) => [k, v.isiSen])) });
  return { ...r, rinci: isi };
}

const TANPA = "__tanpa__";

/** Kunci penerimaan yang selisih harga invoicenya masih menunggu keputusan (P50): tidak pernah diisi otomatis. */
function kunciKoreksiMenunggu(data: DataBayarInvoice | null): Set<string> {
  return new Set((data?.penerimaan ?? []).filter((p) => p.koreksiMenunggu.length > 0).map((p) => p.kunci));
}

/** `?po=`: penerimaan PO itu diisi sebesar sisanya — kecuali yang menunggu keputusan selisih harga. */
function isiAwalBayar(h: HutangPemasok | null, poId: string | null, menunggu: ReadonlySet<string>): Record<string, string> {
  if (!h || !poId) return {};
  const isi: Record<string, string> = {};
  for (const d of h.dokumen) {
    const k = kunciDokumenHutang(d.jenis, d.id);
    if (d.poId === poId && d.sisaSen > 0 && !menunggu.has(k)) isi[k] = String(d.sisaSen / 100);
  }
  return isi;
}

export function FormPembayaranPemasok({
  pemasok,
  rekening,
  tarif,
  hariIni,
  awal,
  apBelumDipetakanAwal,
  poAwal,
  invoiceAwal,
  invoicePilihAwal,
  invoiceLunasDariUrl,
  bolehBukaTagihan,
}: Props) {
  const t = useTranslations("supplierPayments.dokumen");
  const tSp = useTranslations("supplierPayments");
  const locale = useLocale();
  const router = useRouter();
  const [pending, mulai] = useTransition();
  const [memuat, setMemuat] = useState(false);
  const [hutang, setHutang] = useState<HutangPemasok | null>(awal);
  const [apBelum, setApBelum] = useState(apBelumDipetakanAwal);
  const [pemasokId, setPemasokId] = useState(awal?.supplierId ?? "");
  const [dataInvoice, setDataInvoice] = useState<DataBayarInvoice | null>(invoiceAwal);
  const [dipilih, setDipilih] = useState<Set<string>>(() =>
    invoicePilihAwal && invoiceAwal?.invoice.some((i) => i.id === invoicePilihAwal) ? new Set([invoicePilihAwal]) : new Set(),
  );
  const awalInvoice = useMemo(() => terapkanInvoice(invoiceAwal, dipilih, isiAwalBayar(awal, poAwal, kunciKoreksiMenunggu(invoiceAwal)), {}), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [isiPicker, setIsiPicker] = useState<Record<string, string>>(awalInvoice.isi);
  const [bayar, setBayar] = useState<Record<string, string>>(awalInvoice.bayar);
  const [uangMuka, setUangMuka] = useState("");
  const [tanggal, setTanggal] = useState(hariIni);
  const [cara, setCara] = useState<(typeof CARA_BAYAR)[number]>("TRANSFER");
  const [rekeningId, setRekeningId] = useState(rekening[0]?.id ?? "");
  const [referensi, setReferensi] = useState("");
  const [jatuhTempoGiro, setJatuhTempoGiro] = useState("");
  const [catatan, setCatatan] = useState(() => (invoiceAwal && dipilih.size > 0 ? catatanDariInvoice(invoiceAwal, dipilih) : ""));
  const [foto, setFoto] = useState<string | null>(null);
  const [potong, setPotong] = useState<string>(() => bacaJenisPotongPemasok(awal?.jenisPotong) ?? TANPA);
  const [dasarKetik, setDasarKetik] = useState("");
  const [kunci, setKunci] = useState(() => newLocalId());

  const dokumen = useMemo(() => (hutang?.dokumen ?? []).filter((d) => d.sisaSen > 0), [hutang]);
  // Penerimaan yang selisih harga invoicenya menunggu keputusan (P50) dan yang belum ada invoice-nya (P19).
  const penerimaanInvoice = useMemo(() => new Map((dataInvoice?.penerimaan ?? []).map((p) => [p.kunci, p])), [dataInvoice]);
  const rinciInvoice = useMemo(() => (dataInvoice ? isiDariInvoice(dataInvoice, dipilih) : new Map()), [dataInvoice, dipilih]);
  const ringkasInvoice = useMemo(() => (dataInvoice ? ringkasInvoiceTerpilih(dataInvoice, dipilih, bayar) : null), [dataInvoice, dipilih, bayar]);
  const tanpaInvoice = dokumen.filter((d) => (penerimaanInvoice.get(kunciDokumenHutang(d.jenis, d.id))?.qtyBelumDitagih ?? 0) > 0.005).length;

  const ubahInvoice = (next: Set<string>) => {
    const r = terapkanInvoice(dataInvoice, next, bayar, isiPicker);
    setDipilih(next);
    setBayar(r.bayar);
    setIsiPicker(r.isi);
    if (!catatan.trim() && dataInvoice) setCatatan(catatanDariInvoice(dataInvoice, next));
  };
  const sisa = useMemo(() => {
    const m = new Map<string, SisaDokumen>();
    for (const d of hutang?.dokumen ?? []) {
      m.set(kunciDokumenHutang(d.jenis, d.id), { sisaSen: d.sisaSen, porsiDasarPotong: d.porsiDasarPotong, uangMukaBelumDipotongSen: d.uangMukaBelumDipotongSen });
    }
    return m;
  }, [hutang]);

  const alokasi: AlokasiSah[] = [];
  const salahBaris = new Set<string>();
  let adaMenunggu = false;
  for (const d of dokumen) {
    const k = kunciDokumenHutang(d.jenis, d.id);
    const teks = bayar[k]?.trim();
    if (!teks) continue;
    if ((penerimaanInvoice.get(k)?.koreksiMenunggu.length ?? 0) > 0 && (bacaRupiahSen(teks) ?? 0) > 0) adaMenunggu = true;
    const s = bacaRupiahSen(teks);
    if (s == null || s > d.sisaSen) {
      salahBaris.add(k);
      continue;
    }
    if (s > 0) alokasi.push({ jenis: d.jenis, id: d.id, sen: s });
  }
  const uangMukaSen = uangMuka.trim() ? bacaRupiahSen(uangMuka) : 0;
  const brutoSen = alokasi.reduce((s, a) => s + a.sen, 0) + (uangMukaSen ?? 0);
  // Penentu yang sama dengan penulisnya: SKB yang berlaku pada tanggal bayar membebaskan potongan.
  const keputusan = tentukanPotongPemasok({ jenis: potong === TANPA ? null : bacaJenisPotongPemasok(potong), skb: hutang?.skb, tanggal });
  const jenisPotong = keputusan.jenis;
  const dasarBawaan = dasarPotongBawaanSen(jenisPotong, alokasi, sisa, brutoSen);
  const dasarSen = dasarKetik.trim() ? bacaRupiahSen(dasarKetik) : dasarBawaan;
  const hitung = hitungPembayaran(brutoSen, jenisPotong, dasarSen ?? 0, hutang?.adaNpwp ?? true, tarif);

  const alasanTidakBisa = !pemasokId
    ? t("alasan.pemasok")
    : !rekeningId
      ? t("alasan.rekening")
      : salahBaris.size > 0
        ? t("alasan.melebihiSisa")
        : adaMenunggu
          ? t("alasan.koreksiMenunggu")
        : uangMukaSen == null
          ? t("alasan.uangMuka")
          : dasarSen == null || dasarSen > batasDasarPotongSen(alokasi, sisa, brutoSen)
            ? t("alasan.dasarPotong")
            : brutoSen <= 0
              ? t("alasan.kosong")
              : null;

  const muatPemasok = async (id: string) => {
    setPemasokId(id);
    setBayar({});
    setUangMuka("");
    setDasarKetik("");
    setDipilih(new Set());
    setIsiPicker({});
    setDataInvoice(null);
    if (!id) {
      setHutang(null);
      return;
    }
    setMemuat(true);
    try {
      const [r, inv] = await Promise.all([
        hutangPemasokAction({ pemasokId: id }),
        invoiceUntukBayarAction({ pemasokId: id }).catch(() => ({ ok: false as const, kode: "GAGAL" as const })),
      ]);
      if (inv.ok) setDataInvoice(inv.data);
      else if (inv.kode !== "TANPA_AKSES") toast.error(t("invoice.gagalMemuat"));
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

      {dataInvoice && pemasokId && ringkasInvoice && (
        <PilihInvoiceCard
          data={dataInvoice}
          dipilih={dipilih}
          onUbah={ubahInvoice}
          isi={rinciInvoice}
          ringkas={ringkasInvoice}
          invoiceLunasDariUrl={pemasokId === awal?.supplierId ? invoiceLunasDariUrl : null}
          bolehBukaTagihan={bolehBukaTagihan}
        />
      )}

      <Card className="py-0">
        <CardHeader className="pt-6">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            {t("dokumenTerbuka")}
            {tanpaInvoice > 0 && <span className="text-sm font-normal text-muted-foreground">· {t("invoice.jumlahBelumDiterima", { count: tanpaInvoice })}</span>}
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
                    const pi = penerimaanInvoice.get(k);
                    const menunggu = pi?.koreksiMenunggu ?? [];
                    // Menunggu keputusan selisih harga (P50): tidak bisa diisi, tetapi isian yang sudah ada selalu bisa dikosongkan.
                    const terkunci = menunggu.length > 0 && !bayar[k]?.trim();
                    return (
                      <TableRow key={k}>
                        <TableCell className="align-top">
                          <Checkbox
                            disabled={terkunci}
                            checked={Boolean(penuh)}
                            aria-label={t("lunasiDokumen", { nomor: d.nomor })}
                            onCheckedChange={(v) =>
                              setBayar((b) => ({ ...b, [k]: v === true && menunggu.length === 0 ? String(d.sisaSen / 100) : "" }))
                            }
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
                          {menunggu.length > 0 && (
                            <p className="text-xs text-amber-700 dark:text-amber-400">
                              {t("invoice.menungguKeputusan", { invoice: menunggu.map((m) => m.vendorInvoiceNo).join(", ") })}
                            </p>
                          )}
                          {(pi?.qtyBelumDitagih ?? 0) > 0.005 && (
                            <Badge variant="outline" className="mt-1">
                              {t("invoice.belumDiterima")}
                            </Badge>
                          )}
                          {d.uangMukaBelumDipotongSen > 0 && porsiPotongEfektif(jenisPotong, sisa.get(k)) > 0 && (
                            <p className="text-xs text-muted-foreground">{t("uangMukaBelumDipotong", { nilai: formatRupiah(d.uangMukaBelumDipotongSen / 100) })}</p>
                          )}
                        </TableCell>
                        <TableCell className="hidden align-top xl:table-cell">{labelTanggal(d.tanggal, locale)}</TableCell>
                        <TableCell className="hidden align-top text-right tabular-nums 2xl:table-cell">{formatRupiah(d.hutangSen / 100)}</TableCell>
                        <TableCell className="align-top text-right tabular-nums">{formatRupiah(d.sisaSen / 100)}</TableCell>
                        <TableCell className="align-top">
                          <Input
                            inputMode="decimal"
                            disabled={terkunci}
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={dokumen.length === 0}
                onClick={() => {
                  // Penerimaan yang menunggu keputusan selisih harga (P50) tidak ikut dilunasi.
                  const menunggu = kunciKoreksiMenunggu(dataInvoice);
                  setBayar(
                    Object.fromEntries(
                      dokumen.map((d) => {
                        const k = kunciDokumenHutang(d.jenis, d.id);
                        return [k, menunggu.has(k) ? "" : String(d.sisaSen / 100)];
                      }),
                    ),
                  );
                }}
              >
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
              {keputusan.dibebaskanSkb && (
                <p className="flex items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400" role="status">
                  <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t("skbBebas", { nomor: keputusan.dibebaskanSkb.nomor, tanggal: labelTanggal(keputusan.dibebaskanSkb.berlakuSampai, locale) })}
                </p>
              )}
              {keputusan.skbHabis && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400" role="status">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {t("skbHabis", { nomor: keputusan.skbHabis.nomor, tanggal: labelTanggal(keputusan.skbHabis.berlakuSampai, locale) })}
                </p>
              )}
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
