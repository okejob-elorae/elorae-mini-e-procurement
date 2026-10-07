"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Copy, LayoutGrid, Loader2, PieChart, Target, Trash2 } from "lucide-react";
import { salinTargetSalesAction, simpanTargetSalesAction } from "@/app/actions/target-sales";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import { namaBulan } from "@/lib/salesman/komisi";
import {
  capaianUntuk,
  kemajuanRinci,
  MAKS_BARIS_TARGET,
  TANPA_KATEGORI,
  type Capaian,
  type LajuTarget,
  type LingkupTarget,
  type UkuranTarget,
} from "@/lib/salesman/target-rinci";
import type { PilihanAcuan } from "@/lib/salesman/target-rinci-queries";
import { cn } from "@/lib/utils";

export type DataTargetSales = {
  bulan: string;
  pilihanBulan: string[];
  bulanBerjalan: string;
  hariIni: string;
  /** Sales dan SPG. SPG: capaian dari nota penjualannya, bersih dari retur pembeli. */
  salesman: { id: string; nama: string; spg: boolean; toko: string | null }[];
  dipilih: string | null;
  bolehUbah: boolean;
  ringkasan: {
    kategori: { id: string; nama: string }[];
    baris: {
      id: string;
      nama: string;
      spg: boolean;
      toko: string | null;
      jumlahTarget: number;
      omzet: number;
      /** Target total rupiah bulan ini (Pengaturan → Salesman); null = belum diatur. */
      targetTotal: number | null;
      sel: Record<string, { measure: UkuranTarget; target: number; capai: number }>;
      barang: { jumlah: number; tercapai: number };
    }[];
  };
  rinci: {
    baris: { scope: LingkupTarget; refId: string; measure: UkuranTarget; value: number; nama: string; sku: string | null; aktif: boolean }[];
    capaian: { kategori: Record<string, Capaian>; barang: Record<string, Capaian>; total: number };
    penjualanKategori: { id: string; nama: string | null; nilai: number; pcs: number }[];
    jumlahBulanLalu: number;
  } | null;
  pilihan: PilihanAcuan | null;
};

const SEMUA = "__semua__";

const NADA_LAJU: Record<LajuTarget, string> = {
  TERCAPAI: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  SESUAI: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  TERTINGGAL: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  TIDAK_TERCAPAI: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  BELUM_MULAI: "bg-muted text-muted-foreground",
};

export function TargetSalesClient({ data }: { data: DataTargetSales }) {
  const t = useTranslations("targetSales");
  const tBulan = dinamis(useTranslations("komisiSalesman"));
  const router = useRouter();
  const [, mulai] = useTransition();

  const alamat = (bulan: string, salesman: string | null) =>
    `/backoffice/target-sales?bulan=${bulan}${salesman ? `&salesman=${encodeURIComponent(salesman)}` : ""}`;
  const pergi = (href: string) => mulai(() => router.push(href));
  const namaSales = data.salesman.find((s) => s.id === data.dipilih)?.nama ?? "";
  const labelBulan = (k: string) =>
    `${namaBulan(tBulan, k, "panjang")}${k === data.bulanBerjalan ? ` · ${t("bulanIni")}` : ""}`;

  return (
    <div className="space-y-6">
      <PageHeader title={t("judul")} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="ts-bulan">{t("bulan")}</Label>
          <Select value={data.bulan} onValueChange={(v) => pergi(alamat(v, data.dipilih))}>
            <SelectTrigger id="ts-bulan" className="w-full sm:w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {data.pilihanBulan.map((k) => (
                <SelectItem key={k} value={k}>
                  {labelBulan(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ts-sales">{t("sales")}</Label>
          <Select
            value={data.dipilih ?? SEMUA}
            onValueChange={(v) => pergi(alamat(data.bulan, v === SEMUA ? null : v))}
          >
            <SelectTrigger id="ts-sales" className="w-full sm:w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEMUA}>{t("semuaSales")}</SelectItem>
              {data.salesman.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.spg ? t("namaSpg", { nama: s.nama, toko: s.toko ?? "—" }) : s.nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!data.bolehUbah ? <p className="text-sm text-amber-700 dark:text-amber-400">{t("hanyaLihat")}</p> : null}

      {data.salesman.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState icon={Target} title={t("tanpaSalesJudul")} description={t("tanpaSalesIsi")} />
          </CardContent>
        </Card>
      ) : data.dipilih && data.rinci ? (
        <>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={alamat(data.bulan, null)}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {t("kembaliRingkasan")}
            </Link>
          </Button>
          <EditorTarget
            // Data baru dari server (sesudah simpan/salin) = draf baru.
            key={`${data.dipilih}:${data.bulan}:${JSON.stringify(data.rinci.baris)}`}
            data={data}
            salesmanId={data.dipilih}
            namaSales={namaSales}
            judulBulan={labelBulan(data.bulan)}
            bulanLalu={data.rinci.jumlahBulanLalu}
          />
          <PenjualanKategori rinci={data.rinci} judulBulan={labelBulan(data.bulan)} />
        </>
      ) : (
        <Ringkasan data={data} alamat={alamat} judulBulan={labelBulan(data.bulan)} />
      )}
    </div>
  );
}

// ─── Angka ──────────────────────────────────────────────────────────────────

function useAngka() {
  const locale = useLocale();
  const t = useTranslations("targetSales");
  const pcs = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 2 });
  return (n: number, ukuran: UkuranTarget) => (ukuran === "NILAI" ? formatIDR(n) : t("pcs", { n: pcs.format(n) }));
}

function LencanaLaju({ laju }: { laju: LajuTarget }) {
  const t = dinamis(useTranslations("targetSales"));
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", NADA_LAJU[laju])}>
      {t(`laju.${laju}`)}
    </span>
  );
}

// ─── Ringkasan semua sales ──────────────────────────────────────────────────

function Ringkasan({
  data,
  alamat,
  judulBulan,
}: {
  data: DataTargetSales;
  alamat: (bulan: string, salesman: string | null) => string;
  judulBulan: string;
}) {
  const t = useTranslations("targetSales");
  const angka = useAngka();
  const hariIni = useMemo(() => new Date(data.hariIni), [data.hariIni]);
  const { kategori, baris } = data.ringkasan;
  const adaTarget = baris.some((b) => b.jumlahTarget > 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5" aria-hidden />
            {t("ringkasanJudul", { bulan: judulBulan })}
          </CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link href="/backoffice/settings/salesman">{t("aturTargetTotal")}</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!adaTarget ? <p className="text-sm text-muted-foreground">{t("ringkasanKosong")}</p> : null}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("kolomSales")}</TableHead>
                <TableHead className="text-right">{t("kolomOmzet")}</TableHead>
                <TableHead className="min-w-32">{t("kolomTargetTotal")}</TableHead>
                {kategori.map((k) => (
                  <TableHead key={k.id} className="min-w-36 whitespace-normal">
                    {k.nama}
                  </TableHead>
                ))}
                <TableHead>{t("kolomTargetBarang")}</TableHead>
                <TableHead className="w-24">
                  <span className="sr-only">{t("atur")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {baris.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="whitespace-normal font-medium">
                    {b.nama}
                    {b.spg ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {t("labelSpg", { toko: b.toko ?? "—" })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatIDR(b.omzet)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {b.targetTotal === null ? (
                      <span className="text-sm text-muted-foreground">{t("targetTotalBelum")}</span>
                    ) : (
                      (() => {
                        const km = kemajuanRinci(b.targetTotal, b.omzet, data.bulan, hariIni);
                        return (
                          <>
                            <div className="text-sm tabular-nums">{formatIDR(b.targetTotal)}</div>
                            <div className="mt-1 flex items-center gap-2">
                              <Progress value={Math.min(100, km.persen)} className="h-1.5 w-16" aria-label={`${t("kolomTargetTotal")} ${km.persen}%`} />
                              <span className="text-xs tabular-nums text-muted-foreground">{km.persen}%</span>
                            </div>
                          </>
                        );
                      })()
                    )}
                  </TableCell>
                  {kategori.map((k) => {
                    const sel = b.sel[k.id];
                    if (!sel) {
                      return (
                        <TableCell key={k.id} className="text-muted-foreground">
                          —
                        </TableCell>
                      );
                    }
                    const km = kemajuanRinci(sel.target, sel.capai, data.bulan, hariIni);
                    return (
                      <TableCell key={k.id} className="whitespace-normal">
                        <div className="text-sm tabular-nums">
                          {angka(sel.capai, sel.measure)}
                          <span className="text-muted-foreground"> / {angka(sel.target, sel.measure)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <Progress value={Math.min(100, km.persen)} className="h-1.5 w-16" aria-label={`${k.nama} ${km.persen}%`} />
                          <span className="text-xs tabular-nums text-muted-foreground">{km.persen}%</span>
                        </div>
                      </TableCell>
                    );
                  })}
                  <TableCell className="whitespace-normal text-sm">
                    {b.barang.jumlah > 0 ? (
                      t("barangTercapai", { tercapai: b.barang.tercapai, jumlah: b.barang.jumlah })
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={alamat(data.bulan, b.id)}>{data.bolehUbah ? t("atur") : t("lihat")}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Editor satu sales ──────────────────────────────────────────────────────

type BarisDraf = {
  scope: LingkupTarget;
  refId: string;
  nama: string;
  sku: string | null;
  aktif: boolean;
  measure: UkuranTarget;
  /** Angka saja, tanpa pemisah ribuan. */
  nilai: string;
};

const angkaSaja = (s: string) => s.replace(/\D/g, "");
const kunci = (b: { scope: string; refId: string }) => `${b.scope}:${b.refId}`;

function EditorTarget({
  data,
  salesmanId,
  namaSales,
  judulBulan,
  bulanLalu,
}: {
  data: DataTargetSales;
  salesmanId: string;
  namaSales: string;
  judulBulan: string;
  bulanLalu: number;
}) {
  const t = useTranslations("targetSales");
  const tDinamis = dinamis(t);
  const tToasts = useTranslations("toasts");
  const locale = useLocale();
  const router = useRouter();
  const angka = useAngka();
  const [sibuk, mulai] = useTransition();
  const rinci = data.rinci!;
  const hariIni = useMemo(() => new Date(data.hariIni), [data.hariIni]);
  const kelompok = useMemo(() => new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID"), [locale]);

  const awal: BarisDraf[] = useMemo(
    () =>
      rinci.baris.map((b) => ({
        scope: b.scope,
        refId: b.refId,
        nama: b.nama,
        sku: b.sku,
        aktif: b.aktif,
        measure: b.measure,
        nilai: String(Math.round(b.value)),
      })),
    [rinci.baris],
  );
  const [baris, setBaris] = useState<BarisDraf[]>(awal);
  const [salah, setSalah] = useState<number | null>(null);
  const [konfirmasiSalin, setKonfirmasiSalin] = useState(false);

  const isi = (b: BarisDraf[]) => JSON.stringify(b.map((x) => [x.scope, x.refId, x.measure, x.nilai]));
  const berubah = isi(baris) !== isi(awal);
  const terpakai = useMemo(() => new Set(baris.map(kunci)), [baris]);

  const opsi = useMemo(() => {
    const p = data.pilihan;
    if (!p) return [];
    return [
      ...p.kategori.map((k) => ({
        value: `KATEGORI:${k.id}`,
        label: `${t("lingkup.KATEGORI")} · ${k.nama}`,
        disabled: terpakai.has(`KATEGORI:${k.id}`),
      })),
      ...p.barang.map((b) => ({
        value: `BARANG:${b.id}`,
        label: `${b.sku} — ${b.nama}${b.kategori ? ` (${b.kategori})` : ""}`,
        disabled: terpakai.has(`BARANG:${b.id}`),
      })),
    ];
  }, [data.pilihan, terpakai, t]);

  const tambah = (value: string) => {
    if (!value || terpakai.has(value) || baris.length >= MAKS_BARIS_TARGET) return;
    const [scope, refId] = value.split(":") as [LingkupTarget, string];
    const p = data.pilihan;
    const kat = scope === "KATEGORI" ? p?.kategori.find((k) => k.id === refId) : undefined;
    const brg = scope === "BARANG" ? p?.barang.find((b) => b.id === refId) : undefined;
    if (!kat && !brg) return;
    setBaris((x) => [
      ...x,
      {
        scope,
        refId,
        nama: kat?.nama ?? brg?.nama ?? "—",
        sku: brg?.sku ?? null,
        aktif: true,
        // Kategori biasanya dijual per nilai, satu barang per pcs.
        measure: scope === "KATEGORI" ? "NILAI" : "PCS",
        nilai: "",
      },
    ]);
    setSalah(null);
  };

  const ubah = (i: number, ganti: Partial<BarisDraf>) => {
    setBaris((x) => x.map((b, j) => (j === i ? { ...b, ...ganti } : b)));
    if (salah === i) setSalah(null);
  };
  const hapus = (i: number) => {
    setBaris((x) => x.filter((_, j) => j !== i));
    setSalah(null);
  };

  const simpan = () => {
    const kosong = baris.findIndex((b) => !b.nilai || Number(b.nilai) <= 0);
    if (kosong >= 0) {
      setSalah(kosong);
      toast.error(t("errBaris", { baris: kosong + 1, pesan: t("err.NILAI_TIDAK_SAH") }));
      return;
    }
    mulai(async () => {
      const r = await simpanTargetSalesAction({
        salesmanId,
        bulan: data.bulan,
        baris: baris.map((b) => ({ scope: b.scope, refId: b.refId, measure: b.measure, value: Number(b.nilai) })),
      });
      if (!r.ok) {
        const pesan = tDinamis(`err.${r.code}`);
        if ("indeks" in r && typeof r.indeks === "number") {
          setSalah(r.indeks);
          toast.error(t("errBaris", { baris: r.indeks + 1, pesan }));
        } else toast.error(pesan);
        return;
      }
      toast.success(r.berubah ? tToasts("saved") : t("tidakBerubah"));
      router.refresh();
    });
  };

  const salin = (timpa: boolean) =>
    mulai(async () => {
      const r = await salinTargetSalesAction({ salesmanId, bulan: data.bulan, timpa });
      if (!r.ok) {
        if (r.code === "SUDAH_ADA") setKonfirmasiSalin(true);
        else toast.error(tDinamis(`err.${r.code}`));
        return;
      }
      setKonfirmasiSalin(false);
      toast.success(r.dibuang > 0 ? t("salinBerhasilSebagian", { jumlah: r.jumlah, dibuang: r.dibuang }) : t("salinBerhasil", { jumlah: r.jumlah }));
      router.refresh();
    });

  const mintaSalin = () => {
    if (rinci.baris.length > 0 || berubah) setKonfirmasiSalin(true);
    else salin(false);
  };

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" aria-hidden />
          {t("editorJudul", { nama: namaSales, bulan: judulBulan })}
        </CardTitle>
        {data.bolehUbah ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={mintaSalin} disabled={sibuk || bulanLalu === 0} title={bulanLalu === 0 ? t("salinTidakAda") : undefined}>
              <Copy className="mr-2 h-4 w-4" aria-hidden />
              {t("salinBulanLalu")}
            </Button>
            <Button onClick={simpan} disabled={sibuk || !berubah}>
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("simpan")}
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {data.bolehUbah ? (
          <div className="max-w-xl">
            <Label className="mb-1.5 block">{t("tambah")}</Label>
            <SearchableCombobox
              options={opsi}
              value=""
              onValueChange={tambah}
              placeholder={baris.length >= MAKS_BARIS_TARGET ? t("penuh", { maks: MAKS_BARIS_TARGET }) : t("tambahPlaceholder")}
              searchPlaceholder={t("cari")}
              emptyMessage={t("tidakDitemukan")}
              disabled={sibuk || baris.length >= MAKS_BARIS_TARGET}
              triggerClassName="w-full"
            />
          </div>
        ) : null}

        {baris.length === 0 ? (
          <EmptyState
            icon={Target}
            title={t("kosongJudul")}
            description={data.bolehUbah ? (bulanLalu > 0 ? t("kosongIsiSalin", { jumlah: bulanLalu }) : t("kosongIsi")) : t("kosongIsiLihat")}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">{t("kolomJenis")}</TableHead>
                  <TableHead>{t("kolomAcuan")}</TableHead>
                  <TableHead className="w-32">{t("kolomUkuran")}</TableHead>
                  <TableHead className="w-48">{t("kolomTarget")}</TableHead>
                  <TableHead className="text-right">{t("kolomCapai")}</TableHead>
                  <TableHead className="w-44">{t("kolomKemajuan")}</TableHead>
                  {data.bolehUbah ? (
                    <TableHead className="w-12">
                      <span className="sr-only">{t("hapus")}</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {baris.map((b, i) => {
                  const target = Number(b.nilai);
                  const capai = capaianUntuk(rinci.capaian, b);
                  const km = target > 0 ? kemajuanRinci(target, capai, data.bulan, hariIni) : null;
                  return (
                    <TableRow key={kunci(b)} className={cn(salah === i && "bg-destructive/5")}>
                      <TableCell>
                        <Badge variant={b.scope === "KATEGORI" ? "secondary" : "outline"}>{tDinamis(`lingkup.${b.scope}`)}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="font-medium">{b.nama}</div>
                        {b.sku ? <div className="font-mono text-xs text-muted-foreground">{b.sku}</div> : null}
                        {!b.aktif ? <div className="text-xs text-amber-700 dark:text-amber-400">{t("nonaktif")}</div> : null}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={b.measure}
                          onValueChange={(v) => ubah(i, { measure: v as UkuranTarget })}
                          disabled={!data.bolehUbah || sibuk}
                        >
                          <SelectTrigger aria-label={`${t("kolomUkuran")} ${b.nama}`} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NILAI">{t("ukuran.NILAI")}</SelectItem>
                            <SelectItem value="PCS">{t("ukuran.PCS")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="relative">
                          {b.measure === "NILAI" ? (
                            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                              Rp
                            </span>
                          ) : null}
                          <Input
                            type="text"
                            inputMode="numeric"
                            aria-label={`${t("kolomTarget")} ${b.nama}`}
                            aria-invalid={salah === i || undefined}
                            className={cn("text-right tabular-nums", b.measure === "NILAI" ? "pl-9" : "pr-11")}
                            value={b.nilai ? kelompok.format(Number(b.nilai)) : ""}
                            placeholder="0"
                            onChange={(e) => ubah(i, { nilai: angkaSaja(e.target.value).slice(0, 13) })}
                            disabled={!data.bolehUbah || sibuk}
                          />
                          {b.measure === "PCS" ? (
                            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                              pcs
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{angka(capai, b.measure)}</TableCell>
                      <TableCell>
                        {km ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Progress value={Math.min(100, km.persen)} className="h-1.5 w-16" aria-label={`${b.nama} ${km.persen}%`} />
                              <span className="text-xs tabular-nums">{km.persen}%</span>
                            </div>
                            <LencanaLaju laju={km.laju} />
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {data.bolehUbah ? (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => hapus(i)}
                            disabled={sibuk}
                            aria-label={t("hapusBaris", { nama: b.nama })}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
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

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("jumlahBaris", { jumlah: baris.length, maks: MAKS_BARIS_TARGET })}</span>
          {berubah ? <span className="font-medium text-amber-700 dark:text-amber-400">{t("belumDisimpan")}</span> : null}
        </div>
      </CardContent>

      <AlertDialog open={konfirmasiSalin} onOpenChange={setKonfirmasiSalin}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("salinJudul")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("salinIsi", { jumlah: bulanLalu })}
              {berubah ? ` ${t("salinDrafHilang")}` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sibuk}>{t("batal")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={sibuk}
              onClick={(e) => {
                e.preventDefault();
                salin(true);
              }}
            >
              {sibuk ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : t("salinTimpa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ─── Penjualan per kategori ─────────────────────────────────────────────────

function PenjualanKategori({ rinci, judulBulan }: { rinci: NonNullable<DataTargetSales["rinci"]>; judulBulan: string }) {
  const t = useTranslations("targetSales");
  const locale = useLocale();
  const pcs = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 2 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PieChart className="h-5 w-5" aria-hidden />
          {t("penjualanJudul", { bulan: judulBulan })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rinci.penjualanKategori.length === 0 ? (
          <EmptyState icon={PieChart} title={t("penjualanKosong")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("kolomKategori")}</TableHead>
                  <TableHead className="text-right">{t("kolomNilai")}</TableHead>
                  <TableHead className="text-right">{t("kolomPcs")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rinci.penjualanKategori.map((k) => (
                  <TableRow key={k.id || TANPA_KATEGORI}>
                    <TableCell className={cn("whitespace-normal", !k.nama && "text-muted-foreground")}>
                      {k.id === TANPA_KATEGORI ? t("tanpaKategori") : (k.nama ?? "—")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatIDR(k.nilai)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pcs.format(k.pcs)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>{t("total")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatIDR(rinci.capaian.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {pcs.format(rinci.penjualanKategori.reduce((n, k) => n + k.pcs, 0))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
