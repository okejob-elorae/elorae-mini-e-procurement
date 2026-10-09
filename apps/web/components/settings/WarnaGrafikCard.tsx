"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { bacaWarnaGrafikSayaAction, simpanWarnaGrafikAction } from "@/app/actions/settings/warna-grafik";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PemilihWarna } from "@/components/ui/pemilih-warna";
import {
  BAWAAN_GRAFIK,
  SLOT_GRAFIK,
  tulisWarnaGrafik,
  varCssGrafik,
  warnaSlot,
  type GrupGrafik,
  type SlotGrafik,
  type WarnaGrafik,
} from "@/lib/tampilan/warna-pilihan";
import { dinamis } from "@/lib/i18n/dinamis";

const GRUP: GrupGrafik[] = ["umur", "stok", "tren"];

/** Contoh batang per grup: bagian dengan lebar tetap, supaya warna pilihan terlihat berdampingan. */
const CONTOH: Partial<Record<GrupGrafik, { slot: SlotGrafik; lebar: number }[]>> = {
  umur: [
    { slot: "umur.belum", lebar: 10 },
    { slot: "umur.h1_30", lebar: 45 },
    { slot: "umur.h31_60", lebar: 20 },
    { slot: "umur.lebih60", lebar: 25 },
  ],
  stok: [
    { slot: "stok.bahan", lebar: 80 },
    { slot: "stok.jadi", lebar: 20 },
  ],
};

/**
 * Pengaturan → Warna grafik beranda: warna pilihan PRIBADI untuk batang umur piutang, komposisi
 * nilai stok, dan garis tren penjualan. Slot yang tidak dipilih memakai bawaannya (skala tema /
 * palet kategoris). Contoh di kartu ini memakai warna yang sama persis dengan beranda.
 */
export function WarnaGrafikCard() {
  const t = useTranslations("warnaPilihan");
  const td = dinamis(t);
  const [tersimpan, setTersimpan] = useState<WarnaGrafik | null>(null);
  const [draf, setDraf] = useState<WarnaGrafik>({});
  const [menyimpan, mulai] = useTransition();

  useEffect(() => {
    let batal = false;
    bacaWarnaGrafikSayaAction()
      .then((w) => {
        if (batal) return;
        setTersimpan(w);
        setDraf(w);
      })
      .catch(() => {
        if (!batal) setTersimpan({});
      });
    return () => {
      batal = true;
    };
  }, []);

  const berubah = tersimpan !== null && tulisWarnaGrafik(draf) !== tulisWarnaGrafik(tersimpan);
  const adaPilihan = Object.keys(draf).length > 0;

  const simpan = (warna: WarnaGrafik) =>
    mulai(async () => {
      const r = await simpanWarnaGrafikAction(warna);
      if (!r.ok) {
        toast.error(t("gagal"));
        return;
      }
      setTersimpan(r.warna);
      setDraf(r.warna);
      toast.success(t("tersimpan"));
    });

  const ubahSlot = (slot: SlotGrafik, hex: string | null) =>
    setDraf((d) => {
      const baru = { ...d };
      if (hex) baru[slot] = hex;
      else delete baru[slot];
      return baru;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          {t("grafik.judul")}
        </CardTitle>
      </CardHeader>
      {/* `viz` supaya bawaan (skala tema, palet kategoris) terbaca sama dengan di beranda. */}
      <CardContent className="viz space-y-6" style={varCssGrafik(draf) as CSSProperties}>
        {tersimpan === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("memuat")}
          </p>
        ) : (
          GRUP.map((grup) => (
            <section key={grup} className="space-y-3">
              <h3 className="text-sm font-medium">{td(`grafik.grup.${grup}`)}</h3>
              {CONTOH[grup] ? (
                <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden>
                  {CONTOH[grup].map((b) => (
                    <span key={b.slot} style={{ width: `${b.lebar}%`, background: warnaSlot(b.slot) }} />
                  ))}
                </div>
              ) : null}
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {SLOT_GRAFIK.filter((s) => s.grup === grup).map(({ kunci }) => (
                  <div key={kunci} className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: warnaSlot(kunci) }} aria-hidden />
                      <span className="truncate">{td(`grafik.slot.${kunci}`)}</span>
                    </span>
                    <PemilihWarna
                      nilai={draf[kunci] ?? null}
                      bawaan={BAWAAN_GRAFIK[kunci]}
                      label={td(`grafik.slot.${kunci}`)}
                      labelOtomatis={grup === "tren" ? t("otomatis") : t("ikutTema")}
                      disabled={menyimpan}
                      onPilih={(hex) => ubahSlot(kunci, hex)}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => simpan(draf)} disabled={menyimpan || !berubah}>
            {menyimpan ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("simpan")}
          </Button>
          <Button type="button" variant="outline" onClick={() => simpan({})} disabled={menyimpan || (!adaPilihan && !Object.keys(tersimpan ?? {}).length)}>
            {t("kembalikan")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
