"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CategoryBadge } from "@/components/ui/category-badge";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import type { RuangKerjaTahap } from "@/lib/production/jadwal-queries";
import { formatDisplayDate } from "@/lib/date-only";
import { DialogAturMulai } from "./DialogAturMulai";
import { KartuDokumen } from "./KartuDokumen";
import { KartuJadwal } from "./KartuJadwal";
import { KartuKebutuhanBahan } from "./KartuKebutuhanBahan";
import { useAksiRuang } from "./pakai-aksi";
import { angkaTampil, hariTerlambat, kalenderDariData, labelPendek, namaBulanTahun } from "./ruang-kerja";

/** Pemasok yang bisa dipilih untuk langkah manual. */
export type PemasokPilihan = { id: string; name: string; jenis: string | null };

export type IzinRuang = {
  /** `production_planning:manage` — mengubah jadwal. */
  ubah: boolean;
  /** `production_planning:manage` + `work_orders:create`. */
  buatWo: boolean;
  lihatSpk: boolean;
  lihatPo: boolean;
  buatPo: boolean;
};

type Props = {
  data: RuangKerjaTahap;
  pemasok: PemasokPilihan[];
  izin: IzinRuang;
};

export function RuangKerjaClient({ data, pemasok, izin }: Props) {
  const t = useTranslations("jadwalProduksi.ruang");
  const locale = useLocale();
  const { jalankan, sibuk } = useAksiRuang();
  const [aturMulaiBuka, setAturMulaiBuka] = useState(false);
  const kal = useMemo(() => kalenderDariData(data), [data]);

  const { tahap, ringkasan, hariIni } = data;
  const pendek = (teks: string | null) => labelPendek(teks, hariIni, locale);
  const bulan = namaBulanTahun(tahap.targetMonth, tahap.planYear, locale);
  const kembali = `/backoffice/production/planning?tahun=${tahap.planYear}`;

  const bagianRingkasan: string[] = [];
  if (ringkasan.jumlah === 0) {
    bagianRingkasan.push(t("ringkasanKosong"));
  } else {
    bagianRingkasan.push(t("ringkasanSelesai", { selesai: ringkasan.selesai, jumlah: ringkasan.jumlah }));
    if (ringkasan.telat > 0) bagianRingkasan.push(t("ringkasanTerlambat", { n: ringkasan.telat }));
    if (ringkasan.selesaiPada) {
      bagianRingkasan.push(
        ringkasan.selesai === ringkasan.jumlah
          ? t("ringkasanTuntas", { tanggal: pendek(ringkasan.selesaiPada) })
          : t("ringkasanPerkiraan", { tanggal: pendek(ringkasan.selesaiPada) }),
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={tahap.name}
        meta={`${tahap.kategori.code} · ${tahap.kategori.name} · ${bagianRingkasan.join(" · ")}`}
        actions={
          <Button asChild variant="outline">
            <Link href={kembali}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("kembali")}
            </Link>
          </Button>
        }
      />

      <Card className="py-0">
        <CardContent className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Isian label={t("jenis")}>
            <span className="flex flex-wrap items-center gap-2">
              <CategoryBadge label={tahap.kategori.name}>{tahap.kategori.code}</CategoryBadge>
              <span>{tahap.kategori.name}</span>
            </span>
          </Isian>
          <Isian label={t("barang")}>
            {tahap.barang ? (
              <>
                <span className="block">{tahap.barang.nama}</span>
                <span className="block text-xs text-muted-foreground">
                  {tahap.variantSku ? t("varian", { sku: tahap.variantSku }) : t("tanpaVarian")}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">{t("tanpaBarang")}</span>
            )}
          </Isian>
          <Isian label={t("qty")}>{t("qtyPcs", { qty: angkaTampil(tahap.targetQty, locale) })}</Isian>
          <Isian label={t("bulan")}>
            {bulan ?? <span className="text-muted-foreground">{t("belumDipilih")}</span>}
          </Isian>
          <Isian label={t("penjahit")}>
            {tahap.penjahit?.name ?? <span className="text-muted-foreground">{t("belumDipilih")}</span>}
          </Isian>
          <Isian label={t("statusPlan")}>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusPill tone={tahap.statusPlan === "ACTIVE" ? "settled" : "inactive"}>
                {tahap.statusPlan === "ACTIVE" ? t("planAktif") : t("planDraf")}
              </StatusPill>
              {tahap.planTerkunci ? <StatusPill tone="inactive">{t("planTerkunci")}</StatusPill> : null}
            </span>
          </Isian>
          <Isian label={t("berikutnya")}>
            {ringkasan.berikutnya ? (
              <span className="flex flex-col items-start gap-1">
                <span>
                  {ringkasan.berikutnya.name} · {formatDisplayDate(ringkasan.berikutnya.targetDate, locale)}
                </span>
                {ringkasan.berikutnya.keadaan === "TELAT" ? (
                  <StatusPill tone="attention">
                    {t("terlambatHari", { n: hariTerlambat(ringkasan.berikutnya.targetDate, hariIni) })}
                  </StatusPill>
                ) : ringkasan.berikutnya.keadaan === "HARI_INI" ? (
                  <StatusPill tone="waiting">{t("hariIni")}</StatusPill>
                ) : null}
              </span>
            ) : ringkasan.jumlah > 0 ? (
              <StatusPill tone="settled">{t("semuaSelesai")}</StatusPill>
            ) : (
              <span className="text-muted-foreground">{t("ringkasanKosong")}</span>
            )}
          </Isian>
          <Isian label={t("mulaiTenggat")}>
            <span className="block">
              {t("mulai")}: {tahap.scheduleStart ? formatDisplayDate(tahap.scheduleStart, locale) : "—"}
            </span>
            <span className="block">
              {t("tenggat")}: {tahap.deadline ? formatDisplayDate(tahap.deadline, locale) : "—"}
            </span>
            {izin.ubah ? (
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setAturMulaiBuka(true)}>
                <CalendarRange className="mr-2 h-4 w-4" />
                {t("aturMulai")}
              </Button>
            ) : null}
          </Isian>
        </CardContent>
      </Card>

      <KartuJadwal data={data} kal={kal} pemasok={pemasok} bolehUbah={izin.ubah} sibuk={sibuk} jalankan={jalankan} />
      <KartuDokumen data={data} izin={izin} />
      <KartuKebutuhanBahan data={data} lihatPo={izin.lihatPo} buatPo={izin.buatPo} />

      {izin.ubah ? (
        <DialogAturMulai
          buka={aturMulaiBuka}
          planStageId={tahap.id}
          scheduleStart={tahap.scheduleStart}
          deadline={tahap.deadline}
          langkah={data.langkah}
          hariIni={hariIni}
          kal={kal}
          sibuk={sibuk}
          jalankan={jalankan}
          onOpenChange={setAturMulaiBuka}
        />
      ) : null}
    </div>
  );
}

function Isian({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}
