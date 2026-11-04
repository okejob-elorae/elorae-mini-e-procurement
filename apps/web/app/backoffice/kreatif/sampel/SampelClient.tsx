"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Download, Loader2, PackageCheck, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DaftarKurir } from "@/components/kreatif/pengiriman/DaftarKurir";
import { eksporAlamatKirimAction } from "@/app/actions/kreatif-sampel";
import { TAB_SAMPEL, type TabSampel } from "@/lib/creative/sampel-aturan";
import type { DaftarSampel } from "@/lib/creative/sampel-queries";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
import { BarisPaket } from "./BarisPaket";
import { BarisPerlu } from "./BarisPerlu";
import { alamatSampel, type ParamSampel } from "./param";

/** Nilai pilihan "semua campaign" (bukan id sungguhan). */
const SEMUA = "__semua__";
const JEDA_CARI_MS = 400;

type Props = {
  param: ParamSampel;
  data: DaftarSampel;
  campaign: { id: string; nama: string }[];
  bolehMengelola: boolean;
};

/**
 * Antrean kirim sampel. Semua pekerjaan langsung di baris — kurir + resi + ✓
 * memberangkatkan paket (stok keluar saat itu), tanggal terima + ✓ menandai
 * sampai — dan daftarnya menyusut saat dikerjakan. Keadaan layar ada di
 * alamat; ganti tab memakai `router.replace` supaya "Kembali" tidak berjalan
 * mundur melewati setiap tab.
 */
export function SampelClient({ param, data, campaign, bolehMengelola }: Props) {
  const t = useTranslations("kreatifRuang");
  const td = dinamis(t);
  const router = useRouter();
  const [berpindah, mulaiPindah] = useTransition();
  const [mengunduh, mulaiUnduh] = useTransition();
  const [cari, setCari] = useState(param.cari);
  const pewaktu = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pergi = (ubah: Partial<ParamSampel>) =>
    mulaiPindah(() => router.replace(alamatSampel({ ...param, ...ubah }), { scroll: false }));

  const ketik = (nilai: string) => {
    setCari(nilai);
    if (pewaktu.current) clearTimeout(pewaktu.current);
    pewaktu.current = setTimeout(() => pergi({ cari: nilai, halaman: 1 }), JEDA_CARI_MS);
  };

  const segarkan = () => mulaiPindah(() => router.refresh());

  const unduh = () =>
    mulaiUnduh(async () => {
      const r = await eksporAlamatKirimAction({ cari: param.cari, campaignId: param.campaign });
      if (!r.ok) {
        toast.error(t("sampel.unduhGagal"));
        return;
      }
      if (r.jumlah === 0) {
        toast.info(t("sampel.unduhKosong"));
        return;
      }
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.namaBerkas;
      a.click();
      URL.revokeObjectURL(url);
      if (r.terpotong) toast.warning(t("sampel.unduhTerpotong", { n: r.jumlah }));
    });

  const adaSaringan = Boolean(param.cari || param.campaign || param.kolaborasi);
  const opsiCampaign = [{ value: SEMUA, label: t("sampel.semuaCampaign") }, ...campaign.map((c) => ({ value: c.id, label: c.nama }))];
  const kolom = param.tab === "perlu-dikirim" ? 7 : 8;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("halaman.sampel")}
        meta={t("sampel.meta", {
          perlu: data.jumlah["perlu-dikirim"],
          jalan: data.jumlah["dalam-perjalanan"],
          sampai: data.jumlah["sudah-sampai"],
        })}
        actions={
          param.tab === "perlu-dikirim" ? (
            <Button variant="outline" onClick={unduh} disabled={mengunduh}>
              {mengunduh ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
              {t("sampel.unduhAlamat")}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={cari}
            onChange={(e) => ketik(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (pewaktu.current) clearTimeout(pewaktu.current);
                pergi({ cari, halaman: 1 });
              }
            }}
            placeholder={t("sampel.cari")}
            aria-label={t("sampel.cari")}
            className="pl-9"
          />
        </div>
        <SearchableCombobox
          options={opsiCampaign}
          value={param.campaign ?? SEMUA}
          onValueChange={(v) => pergi({ campaign: v && v !== SEMUA ? v : null, halaman: 1 })}
          placeholder={t("sampel.semuaCampaign")}
          searchPlaceholder={t("sampel.cariCampaign")}
          emptyMessage={t("sampel.campaignTidakAda")}
          className="w-full sm:w-64"
        />
        {data.kolaborasiDisaring ? (
          <Button variant="secondary" size="sm" onClick={() => pergi({ kolaborasi: null, halaman: 1 })}>
            {t("sampel.hanyaKolaborasi", { doc: data.kolaborasiDisaring.docNo })}
            <X className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : null}
      </div>

      <Tabs value={param.tab} onValueChange={(v) => pergi({ tab: v as TabSampel, halaman: 1 })}>
        <TabsList className="h-auto flex-wrap">
          {TAB_SAMPEL.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t("sampel.tabJumlah", { label: td(`sampel.tab.${tab}`), n: data.jumlah[tab] })}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DaftarKurir />

      <Card>
        <CardHeader className="gap-1">
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" aria-hidden />
            {td(`sampel.tab.${param.tab}`)}
          </CardTitle>
          {param.tab === "perlu-dikirim" && bolehMengelola && data.total > 0 ? (
            <p className="text-sm text-muted-foreground">{t("sampel.stokKeluar")}</p>
          ) : null}
        </CardHeader>
        <CardContent className={cn(berpindah && "opacity-60 transition-opacity")}>
          {data.total === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title={adaSaringan ? t("sampel.kosong.saringan") : td(`sampel.kosong.${param.tab}.judul`)}
              description={adaSaringan ? undefined : td(`sampel.kosong.${param.tab}.isi`)}
              action={
                adaSaringan ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCari("");
                      pergi({ cari: "", campaign: null, kolaborasi: null, halaman: 1 });
                    }}
                  >
                    {t("sampel.hapusSaringan")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[150px]">{t("sampel.kolom.kol")}</TableHead>
                      <TableHead className="hidden min-w-[130px] 2xl:table-cell">{t("sampel.kolom.campaign")}</TableHead>
                      <TableHead className="min-w-[170px]">{t("sampel.kolom.alamat")}</TableHead>
                      <TableHead className="min-w-[140px]">{t("sampel.kolom.barang")}</TableHead>
                      {param.tab === "perlu-dikirim" ? (
                        <>
                          <TableHead className="text-right">{t("sampel.kolom.umur")}</TableHead>
                          <TableHead className="min-w-[240px]">{t("sampel.kolom.kirim")}</TableHead>
                        </>
                      ) : param.tab === "dalam-perjalanan" ? (
                        <>
                          <TableHead className="min-w-[140px]">{t("sampel.kolom.resi")}</TableHead>
                          <TableHead className="text-right">{t("sampel.kolom.umur")}</TableHead>
                          <TableHead className="min-w-[200px]">{t("sampel.kolom.terima")}</TableHead>
                        </>
                      ) : (
                        <>
                          <TableHead className="min-w-[140px]">{t("sampel.kolom.resi")}</TableHead>
                          <TableHead>{t("sampel.kolom.diterima")}</TableHead>
                          <TableHead className="text-right">{t("sampel.kolom.sejak")}</TableHead>
                        </>
                      )}
                      <TableHead className="text-right">
                        <span className="sr-only">{t("sampel.kolom.aksi")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {param.tab === "perlu-dikirim"
                      ? data.perlu.map((b) => (
                          <BarisPerlu
                            key={b.kolaborasiId}
                            b={b}
                            varianAwal={data.varianBarang}
                            ambangHari={data.ambang.dealKeKirimHari}
                            kolom={kolom}
                            bolehMengelola={bolehMengelola}
                            onSelesai={segarkan}
                          />
                        ))
                      : data.pengiriman.map((b) => (
                          <BarisPaket
                            key={b.pengirimanId}
                            b={b}
                            tab={param.tab === "sudah-sampai" ? "sudah-sampai" : "dalam-perjalanan"}
                            ambangHari={param.tab === "sudah-sampai" ? data.ambang.terimaKeTayangHari : data.ambang.kirimKeTerimaHari}
                            hariIni={data.hariIni}
                            bolehMengelola={bolehMengelola}
                            onSelesai={segarkan}
                          />
                        ))}
                  </TableBody>
                </Table>
              </div>
              {data.jumlahHalaman > 1 ? (
                <Pagination
                  page={data.halaman}
                  totalPages={data.jumlahHalaman}
                  onPageChange={(halaman) => pergi({ halaman })}
                  totalCount={data.total}
                  pageSize={data.ukuranHalaman}
                />
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
