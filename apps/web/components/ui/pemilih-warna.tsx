"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { cariPantoneWarnaAction, pantoneFavoritSayaAction, spektrumPantoneAction } from "@/app/actions/warna-pantone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RONA_PANTONE, type RonaPantone, type WarnaPantone } from "@/lib/tampilan/warna-pilihan";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";

type Spektrum = { kunci: RonaPantone; warna: WarnaPantone[] }[];

/**
 * Pemilih warna dari katalog Pantone TCX (pemilik 2026-10-09: "kenapa tidak menggunakan warna
 * pantone saja"). Tanpa saringan: Pantone favorit dari Palet Warna, lalu spektrum (satu baris per
 * rona, terang ke gelap). Dengan rona saja: yang paling jelas warnanya dulu. Dengan cari nama/kode:
 * hasil katalog. Keduanya per 32 warna.
 * `nilai` = Pantone terpilih atau null (= otomatis); `bawaan` = nilai CSS yang tampil saat otomatis,
 * supaya kotaknya selalu menunjukkan warna yang sungguh dipakai. Hex yang disimpan diambil ulang
 * server dari katalog.
 */
export function PemilihWarna({
  nilai,
  bawaan,
  label,
  onPilih,
  disabled,
  labelOtomatis,
  lama,
}: {
  nilai: WarnaPantone | null;
  bawaan: string;
  /** Nama yang dibacakan pembaca layar, mis. "1–30 hari". */
  label: string;
  onPilih: (warna: WarnaPantone | null) => void;
  disabled?: boolean;
  /** Teks pilihan otomatis; bawaan "Otomatis". */
  labelOtomatis?: string;
  /** Hex tersimpan sebelum warna dipilih dari Pantone; tampil apa adanya sampai diganti. */
  lama?: string | null;
}) {
  const t = useTranslations("warnaPilihan");
  const td = dinamis(t);
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState("");
  const [cariTunda, setCariTunda] = useState("");
  const [rona, setRona] = useState<RonaPantone | null>(null);
  const [spektrum, setSpektrum] = useState<Spektrum | null>(null);
  const [favorit, setFavorit] = useState<WarnaPantone[] | null>(null);
  const [warna, setWarna] = useState<WarnaPantone[]>([]);
  const [halaman, setHalaman] = useState(1);
  const [adaLagi, setAdaLagi] = useState(false);
  // Kunci saringan yang hasilnya sedang tampil; memuat = hasil belum sesuai saringan sekarang.
  const [hasilUntuk, setHasilUntuk] = useState<string | null>(null);
  const [memuatLagi, setMemuatLagi] = useState(false);
  const [sorot, setSorot] = useState<WarnaPantone | null>(null);
  const permintaan = useRef(0);

  const tanpaSaringan = !cariTunda && !rona;
  const kunci = `${cariTunda}|${rona ?? ""}`;
  const memuat = buka && (tanpaSaringan ? spektrum === null : hasilUntuk !== kunci || memuatLagi);

  useEffect(() => {
    const t0 = setTimeout(() => setCariTunda(cari.trim()), 300);
    return () => clearTimeout(t0);
  }, [cari]);

  // Spektrum dan favorit dimuat sekali, saat kotak pertama kali dibuka.
  useEffect(() => {
    if (!buka || spektrum !== null) return;
    spektrumPantoneAction()
      .then(setSpektrum)
      .catch(() => setSpektrum([]));
  }, [buka, spektrum]);

  useEffect(() => {
    if (!buka || favorit !== null) return;
    pantoneFavoritSayaAction()
      .then(setFavorit)
      .catch(() => setFavorit([]));
  }, [buka, favorit]);

  // Halaman pertama hasil cari/rona setiap kali saringan berubah.
  useEffect(() => {
    if (!buka || (!cariTunda && !rona)) return;
    const ke = ++permintaan.current;
    const untuk = `${cariTunda}|${rona ?? ""}`;
    cariPantoneWarnaAction({ cari: cariTunda, rona, halaman: 1 })
      .then((r) => {
        if (ke !== permintaan.current) return;
        setWarna(r.warna);
        setHalaman(1);
        setAdaLagi(r.adaLagi);
      })
      .catch(() => {
        if (ke !== permintaan.current) return;
        setWarna([]);
        setAdaLagi(false);
      })
      .finally(() => {
        if (ke === permintaan.current) setHasilUntuk(untuk);
      });
  }, [buka, cariTunda, rona]);

  const muatLagi = () => {
    const ke = ++permintaan.current;
    setMemuatLagi(true);
    cariPantoneWarnaAction({ cari: cariTunda, rona, halaman: halaman + 1 })
      .then((r) => {
        if (ke !== permintaan.current) return;
        setWarna((w) => [...w, ...r.warna]);
        setHalaman(r.halaman);
        setAdaLagi(r.adaLagi);
      })
      .finally(() => setMemuatLagi(false));
  };

  const pilih = (w: WarnaPantone | null) => {
    onPilih(w);
    setBuka(false);
  };

  const kotak = (w: WarnaPantone) => {
    const aktif = nilai?.tcx === w.tcx;
    return (
      <button
        key={w.tcx}
        type="button"
        title={`${w.nama} · ${w.tcx} TCX`}
        aria-label={`${w.nama} ${w.tcx}`}
        aria-pressed={aktif}
        onClick={() => pilih(w)}
        onMouseEnter={() => setSorot(w)}
        onFocus={() => setSorot(w)}
        className={cn(
          "flex aspect-square w-full items-center justify-center rounded-md border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          aktif && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
        )}
        style={{ background: w.hex }}
      >
        {aktif ? <Check className="h-4 w-4 text-white mix-blend-difference" aria-hidden /> : null}
      </button>
    );
  };

  const judulBagian = (teks: string) => (
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{teks}</p>
  );

  const info = sorot ?? nilai;
  const adaFavorit = Boolean(favorit && favorit.length > 0);

  return (
    <Popover
      open={buka}
      onOpenChange={(o) => {
        setBuka(o);
        if (o) setSorot(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("pilihWarna", { label })}
          className="inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs transition-colors hover:bg-muted/60 disabled:opacity-50"
        >
          <span className="h-5 w-8 shrink-0 rounded-sm border" style={{ background: nilai?.hex ?? lama ?? bawaan }} aria-hidden />
          {nilai ? (
            <span className="min-w-0">
              <span className="block truncate font-medium">{nilai.nama || nilai.tcx}</span>
              <span className="block font-mono text-[10px] text-muted-foreground">{nilai.tcx} TCX</span>
            </span>
          ) : lama ? (
            <span className="min-w-0">
              <span className="block font-mono">{lama}</span>
              <span className="block text-[10px] text-muted-foreground">{t("bukanPantone")}</span>
            </span>
          ) : (
            <span className="font-mono text-muted-foreground">{labelOtomatis ?? t("otomatis")}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        className="flex max-h-[min(34rem,var(--radix-popover-content-available-height))] w-80 flex-col gap-3"
      >
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder={t("cariPantone")}
            className="h-8 pl-8 text-sm"
            aria-label={t("cariPantone")}
          />
        </div>
        <div className="flex shrink-0 flex-wrap gap-1">
          {RONA_PANTONE.map((r) => (
            <button
              key={r.kunci}
              type="button"
              aria-pressed={rona === r.kunci}
              onClick={() => setRona((x) => (x === r.kunci ? null : r.kunci))}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                rona === r.kunci ? "border-foreground bg-foreground text-background" : "hover:bg-muted/60",
              )}
            >
              {td(`rona.${r.kunci}`)}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {tanpaSaringan ? (
            <>
              {adaFavorit ? (
                <section className="space-y-1.5">
                  {judulBagian(t("favorit"))}
                  <div className="grid grid-cols-8 gap-1.5">{favorit!.map(kotak)}</div>
                </section>
              ) : null}
              {spektrum?.length ? (
                <section className="space-y-1.5">
                  {adaFavorit ? judulBagian(t("semuaPantone")) : null}
                  {/* Satu baris per rona — urutannya sama dengan tombol rona di atas. */}
                  <div className="grid grid-cols-8 gap-1.5">{spektrum.flatMap((b) => b.warna.map(kotak))}</div>
                </section>
              ) : null}
            </>
          ) : warna.length && hasilUntuk === kunci ? (
            <div className="grid grid-cols-8 gap-1.5">{warna.map(kotak)}</div>
          ) : !memuat ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{t("tidakDitemukan")}</p>
          ) : null}
          {memuat ? (
            <p className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              {t("memuat")}
            </p>
          ) : !tanpaSaringan && adaLagi ? (
            <Button type="button" variant="ghost" size="sm" className="w-full" onClick={muatLagi}>
              {t("muatLagi")}
            </Button>
          ) : null}
        </div>

        {/* Nama dan kode warna yang disorot (atau yang terpilih) — kotak warna saja tidak terbaca. */}
        {info ? (
          <div className="flex shrink-0 items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs" aria-live="polite">
            <span className="h-5 w-5 shrink-0 rounded-sm border" style={{ background: info.hex }} aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{info.nama}</span>
            <span className="shrink-0 font-mono text-muted-foreground">{info.tcx} TCX</span>
          </div>
        ) : null}

        <Button type="button" variant="ghost" size="sm" className="w-full shrink-0 justify-start gap-2" onClick={() => pilih(null)}>
          <span className="h-4 w-6 rounded-sm border" style={{ background: bawaan }} aria-hidden />
          {labelOtomatis ?? t("otomatis")}
          {nilai === null && !lama ? <Check className="ml-auto h-4 w-4" aria-hidden /> : null}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
