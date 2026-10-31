"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  eksporKinerjaSales,
  type KolomKunjungan,
  type KolomRingkasan,
  type LabelEkspor,
} from "@/app/actions/sales-lapangan-export";
import { KODE_HASIL } from "@/lib/salesman/hasil-kunjungan";
import { KODE_JANGGAL } from "@/lib/salesman/metrik-lapangan";
import { dinamis } from "@/lib/i18n/dinamis";
import type { FilterRentangData } from "./bentuk";

/*
 * Daftar id kolom ditulis sebagai objek `satisfies Record<…, true>`: kolom
 * yang ditambah di aksi tanpa ditambah di sini (atau sebaliknya) menjadi galat
 * tipe, bukan judul kolom yang diam-diam berupa id mentah.
 */
const KOLOM_RINGKASAN = {
  sales: true,
  kunjungan: true,
  toko: true,
  efektif: true,
  persenEfektif: true,
  rencana: true,
  rencanaDidatangi: true,
  pesanan: true,
  putus: true,
  nilaiPutus: true,
  konsi: true,
  ditolak: true,
  jarakJauh: true,
  van: true,
  nilaiVan: true,
  pelunasanDilaporkan: true,
  nilaiDilaporkan: true,
  pelunasanTerverifikasi: true,
  nilaiTerverifikasi: true,
  retur: true,
  tokoBaru: true,
  janggal: true,
  tokoMenurun: true,
  menitLapangan: true,
  target: true,
  capaiTarget: true,
  persenTarget: true,
} satisfies Record<KolomRingkasan, true>;

const KOLOM_KUNJUNGAN = {
  sales: true,
  tanggal: true,
  masuk: true,
  keluar: true,
  durasi: true,
  kodeToko: true,
  toko: true,
  hasil: true,
  catatan: true,
  efektif: true,
  pesanan: true,
  nilaiPutus: true,
  konsi: true,
  pelunasan: true,
  retur: true,
  van: true,
  jarakMeter: true,
  luarRadius: true,
  tanda: true,
  lat: true,
  lng: true,
  peta: true,
} satisfies Record<KolomKunjungan, true>;

export function TombolEkspor({ filter }: { filter: FilterRentangData }) {
  const t = useTranslations("salesLapangan");
  const td = dinamis(t);
  const [sibuk, setSibuk] = useState(false);

  function label(): LabelEkspor {
    const peta = <K extends string>(kunci: Record<K, true>, awalan: string) =>
      Object.fromEntries(Object.keys(kunci).map((k) => [k, td(`${awalan}.${k}`)])) as Record<K, string>;
    return {
      namaBerkas: t("export.fileName"),
      judul: t("pageTitle"),
      total: t("table.total"),
      ya: t("export.yes"),
      tidak: t("export.no"),
      lembar: { ringkasan: t("export.sheetSummary"), kunjungan: t("export.sheetVisits"), hasil: t("export.sheetOutcomes") },
      ringkasan: peta(KOLOM_RINGKASAN, "export.colSummary"),
      kunjungan: peta(KOLOM_KUNJUNGAN, "export.colVisits"),
      hasilKolom: { hasil: t("export.colOutcome"), jumlah: t("export.colCount") },
      kode: Object.fromEntries([
        ...[...KODE_HASIL, "KOSONG"].map((k) => [k, td(`outcome.${k}`)]),
        ...KODE_JANGGAL.map((k) => [k, td(`flag.${k}`)]),
      ]),
    };
  }

  async function unduh() {
    setSibuk(true);
    try {
      const hasil = await eksporKinerjaSales({
        rentang: filter.preset,
        dari: filter.dari,
        sampai: filter.sampai,
        label: label(),
      });
      if (!hasil.ok) {
        toast.error(td(`export.error.${hasil.code}`));
        return;
      }
      const biner = atob(hasil.base64);
      const bait = new Uint8Array(biner.length);
      for (let i = 0; i < biner.length; i++) bait[i] = biner.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([bait], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = hasil.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("export.started"));
    } catch {
      toast.error(t("export.error.GAGAL"));
    } finally {
      setSibuk(false);
    }
  }

  return (
    <Button variant="outline" onClick={unduh} disabled={sibuk}>
      <Download className="mr-2 h-4 w-4" aria-hidden />
      {sibuk ? t("export.working") : t("export.excel")}
    </Button>
  );
}
