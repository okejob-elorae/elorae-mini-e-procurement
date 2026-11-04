"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dinamis } from "@/lib/i18n/dinamis";
import { bacaTabKolaborasi, TAB_KOLABORASI, type TabKolaborasiKunci } from "./tab-kolaborasi";


/**
 * Tab rincian kolaborasi. Isinya panel server yang sudah dirender di halaman;
 * tab yang dipilih ditulis ke alamat (`?tab=`) tanpa memuat ulang, supaya
 * tautan dan muat ulang membuka tab yang sama.
 */
export function TabKolaborasi({
  awal,
  isi,
  jumlah,
}: {
  awal: TabKolaborasiKunci;
  isi: Record<TabKolaborasiKunci, ReactNode>;
  jumlah: Partial<Record<TabKolaborasiKunci, number>>;
}) {
  const t = dinamis(useTranslations("kreatifRuang.kolaborasi.detail"));
  const [tab, setTab] = useState<TabKolaborasiKunci>(awal);
  const ganti = (v: string) => {
    const baru = bacaTabKolaborasi(v);
    setTab(baru);
    try {
      const url = new URL(window.location.href);
      if (baru === "pengiriman") url.searchParams.delete("tab");
      else url.searchParams.set("tab", baru);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // Alamat hanya kenyamanan.
    }
  };
  return (
    <Tabs value={tab} onValueChange={ganti}>
      <div className="-mx-1 overflow-x-auto px-1">
        <TabsList className="h-auto w-max">
          {TAB_KOLABORASI.map((k) => (
            <TabsTrigger key={k} value={k}>
              {jumlah[k] !== undefined ? t("tabJumlah", { label: t(`tab.${k}`), n: jumlah[k]! }) : t(`tab.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {TAB_KOLABORASI.map((k) => (
        <TabsContent key={k} value={k} className="mt-2">
          {isi[k]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
