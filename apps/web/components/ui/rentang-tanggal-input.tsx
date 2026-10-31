"use client";

import * as React from "react";
import { ArrowRight, CalendarRange, Check, Pointer, Zap } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { DateRange, DayButton } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GAYA_PEMICU, useLayarSempit } from "@/components/ui/tanggal-input";
import {
  PILIHAN_RENTANG,
  type PilihanRentang,
  type Rentang,
  dariDateLokal,
  geserHari,
  hariIniWib,
  jumlahHari,
  keDateLokal,
  labelRentang,
  labelTanggal,
  pangkasRentang,
  rentangCepat,
  urutkanRentang,
} from "@/lib/tanggal-isian";

/**
 * Satu isian untuk rentang tanggal — pengganti sepasang "Dari tanggal" /
 * "Sampai tanggal". Tiga cara memilih, semuanya dalam satu kalender:
 *
 *  - tekan tanggal awal lalu TARIK sampai tanggal akhir (mouse atau jari);
 *  - ketuk tanggal awal, lalu ketuk tanggal akhir;
 *  - satu ketukan pada pilihan cepat (7 hari terakhir, bulan ini, …).
 *
 * Rentang yang selesai langsung dipakai dan kalendernya menutup — tidak ada
 * tombol "Terapkan" yang harus diingat. Nilainya teks "YYYY-MM-DD" yang sama
 * dengan isian tunggal, dan urutannya selalu awal ≤ akhir, ke arah mana pun
 * orang menariknya.
 */

export type RentangTanggalInputProps = {
  dari: string;
  sampai: string;
  onChange: (rentang: Rentang) => void;
  /** Tanggal paling awal / paling akhir yang boleh dipilih (inklusif). */
  min?: string;
  max?: string;
  placeholder?: string;
  /**
   * Pilihan cepat yang melihat ke belakang (7 hari terakhir, bulan lalu, …).
   * Cocok untuk filter; formulir yang menatap ke depan (masa promo, izin)
   * mematikannya.
   */
  pilihanCepat?: boolean;
  /** Rentang wajib diisi: tombol Hapus tidak ditampilkan. */
  required?: boolean;
  /**
   * Rentang boleh tanpa tanggal akhir (promo yang berlaku terus): sesudah
   * tanggal awal dipilih muncul tombol "Tanpa tanggal akhir".
   */
  bolehTerbuka?: boolean;
  /** Panjang rentang paling banyak sekian hari (awal dan akhir ikut dihitung). */
  maksHari?: number;
  id?: string;
  /** Kirim lewat formulir biasa, seperti dua input bawaan. */
  nameDari?: string;
  nameSampai?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
};

/** Tombol hari yang membawa tanggalnya sendiri, supaya tarikan bisa membaca hari di bawah jari. */
function TombolHari(props: React.ComponentProps<typeof DayButton>) {
  return <CalendarDayButton {...props} data-tanggal={dariDateLokal(props.day.date)} />;
}

/** Tanggal pada tombol hari di titik itu; kosong di luar hari atau pada hari yang dimatikan. */
function tanggalDi(x: number, y: number): string {
  const el = document.elementFromPoint(x, y)?.closest<HTMLButtonElement>("[data-tanggal]");
  return el && !el.disabled ? (el.dataset.tanggal ?? "") : "";
}

function useDuaBulan(sempit: boolean): boolean {
  const [lebar, setLebar] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const ubah = () => setLebar(mq.matches);
    ubah();
    mq.addEventListener("change", ubah);
    return () => mq.removeEventListener("change", ubah);
  }, []);
  return lebar && !sempit;
}

const TAHUN_AWAL = 2015;

export function RentangTanggalInput({
  dari,
  sampai,
  onChange,
  min,
  max,
  placeholder,
  pilihanCepat = true,
  required,
  bolehTerbuka,
  maksHari,
  id,
  nameDari,
  nameSampai,
  disabled,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: RentangTanggalInputProps) {
  const t = useTranslations("tanggalInput");
  const locale = useLocale();
  const sempit = useLayarSempit();
  const duaBulan = useDuaBulan(sempit);
  const [buka, setBuka] = React.useState(false);

  // Tanggal awal yang sudah dipilih sementara tanggal akhirnya belum, dan
  // ujung pratinjaunya (tempat mouse/jari berada).
  const [jangkar, setJangkar] = React.useState("");
  const [ujung, setUjung] = React.useState("");
  const tekan = React.useRef<{ jangkar: string; terakhir: string; pindah: boolean } | null>(null);
  const abaikanKlik = React.useRef(false);

  const hariIni = hariIniWib();
  const tahunIni = Number(hariIni.slice(0, 4));
  const awal = keDateLokal(min);
  const akhir = keDateLokal(max);

  const ubahBuka = (o: boolean) => {
    if (disabled && o) return;
    setBuka(o);
    setJangkar("");
    setUjung("");
    tekan.current = null;
    if (o) abaikanKlik.current = false;
  };

  const terapkan = (r: Rentang) => {
    onChange(r);
    ubahBuka(false);
  };

  // Yang disorot di kalender: rentang yang sedang dibentuk, atau nilai sekarang.
  const sorot: DateRange | undefined = (() => {
    if (jangkar) {
      const r = urutkanRentang(jangkar, ujung || jangkar);
      return { from: keDateLokal(r.dari), to: keDateLokal(r.sampai) };
    }
    const a = keDateLokal(dari);
    const b = keDateLokal(sampai);
    if (!a && !b) return undefined;
    return { from: a ?? b, to: b ?? a };
  })();

  // Bulan pertama yang tampil. Dua bulan: ujung rentang di bulan kanan.
  // Formulir yang menatap ke depan mulai dari bulan ini.
  const bulanAwal = (() => {
    const kanan = keDateLokal(sampai || dari) ?? keDateLokal(hariIni)!;
    if (!duaBulan) return keDateLokal(dari) ?? kanan;
    if (!dari && !sampai && !pilihanCepat) return new Date(kanan.getFullYear(), kanan.getMonth(), 1);
    return new Date(kanan.getFullYear(), kanan.getMonth() - 1, 1);
  })();

  const klikHari = (d: Date) => {
    if (abaikanKlik.current) {
      abaikanKlik.current = false;
      return;
    }
    const tgl = dariDateLokal(d);
    if (!jangkar) {
      setJangkar(tgl);
      setUjung(tgl);
      return;
    }
    terapkan(urutkanRentang(jangkar, tgl));
  };

  const tarik = {
    onPointerDown: (e: React.PointerEvent) => {
      abaikanKlik.current = false;
      if (e.button !== 0) return;
      const tgl = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tanggal]");
      if (!tgl || tgl.disabled) return;
      const x = tgl.dataset.tanggal ?? "";
      tekan.current = { jangkar: x, terakhir: x, pindah: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const tgl = tanggalDi(e.clientX, e.clientY);
      const p = tekan.current;
      if (p) {
        if (!tgl || (!p.pindah && tgl === p.jangkar)) return;
        p.pindah = true;
        p.terakhir = tgl;
        setJangkar(p.jangkar);
        setUjung(tgl);
        return;
      }
      // Sesudah klik pertama, mouse yang melayang menunjukkan rentangnya.
      if (jangkar && tgl && e.pointerType === "mouse") setUjung(tgl);
    },
    onPointerUp: () => {
      const p = tekan.current;
      tekan.current = null;
      if (!p?.pindah) return;
      // Klik yang menyusul tarikan bukan klik pertama rentang baru.
      abaikanKlik.current = true;
      terapkan(urutkanRentang(p.jangkar, p.terakhir));
    },
    onPointerCancel: () => {
      tekan.current = null;
    },
  };

  const label =
    dari && sampai
      ? labelRentang(dari, sampai, locale)
      : dari
        ? t("sejak", { tanggal: labelTanggal(dari, locale) })
        : sampai
          ? t("hingga", { tanggal: labelTanggal(sampai, locale) })
          : (placeholder ?? t("pilihRentang"));

  const pemicu = (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={disabled}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={buka}
      data-kosong={!dari && !sampai}
      onClick={sempit ? () => ubahBuka(true) : undefined}
      className={cn(GAYA_PEMICU, "data-[kosong=true]:text-muted-foreground", className)}
    >
      <CalendarRange className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
      <span className="truncate">{label}</span>
    </Button>
  );

  // Pilihan cepat. Di layar lebar: daftar di panel samping, tiap baris
  // menyebut tanggalnya ("Bulan lalu · 1–30 Sep"); di HP: deretan chip.
  const daftarCepat = pilihanCepat
    ? PILIHAN_RENTANG.map((p: PilihanRentang) => {
        const r = pangkasRentang(rentangCepat(p, hariIni), min, max);
        const aktif = !!r && r.dari === dari && r.sampai === sampai;
        if (sempit) {
          return (
            <Button
              key={p}
              type="button"
              size="sm"
              variant="outline"
              disabled={!r}
              aria-pressed={aktif}
              onClick={() => r && terapkan(r)}
              className={cn(
                "shrink-0 rounded-full",
                aktif
                  ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground dark:bg-primary dark:hover:bg-primary/90"
                  : "border-primary/40 bg-primary/10 hover:bg-primary/20 dark:border-primary/40 dark:bg-primary/10 dark:hover:bg-primary/20",
              )}
            >
              {t(`cepat.${p}`)}
            </Button>
          );
        }
        return (
          <Button
            key={p}
            type="button"
            variant="ghost"
            disabled={!r}
            aria-pressed={aktif}
            onClick={() => r && terapkan(r)}
            className={cn(
              "h-auto w-full justify-between gap-3 px-2.5 py-1.5 font-normal",
              aktif
                ? "bg-primary font-medium text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground dark:hover:bg-primary/90"
                : "hover:bg-primary/20 hover:text-foreground dark:hover:bg-primary/20",
            )}
          >
            <span className="flex items-center gap-1.5">
              {aktif ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
              {t(`cepat.${p}`)}
            </span>
            {r ? (
              <span className={cn("text-xs tabular-nums", aktif ? "text-primary-foreground/75" : "text-muted-foreground")}>
                {labelRentang(r.dari, r.sampai, locale, { tahun: false })}
              </span>
            ) : null}
          </Button>
        );
      })
    : null;

  // Ringkasan di atas kalender: dua kotak Mulai → Selesai. Kotak yang akan
  // diisi ketukan berikutnya disorot warna merek; selama memilih, Selesai
  // mengikuti kursor/jari, dan di antaranya jumlah harinya.
  const ringkasan = (() => {
    const memilih = !!jangkar;
    const bergerak = memilih && !!ujung && ujung !== jangkar;
    const r = memilih ? urutkanRentang(jangkar, ujung || jangkar) : { dari, sampai };
    const awalTampil = memilih ? (bergerak ? r.dari : jangkar) : dari;
    const akhirTampil = memilih ? (bergerak ? r.sampai : "") : sampai;
    const n = jumlahHari(awalTampil, akhirTampil);
    const kotak = (label: string, nilai: string, aktif: boolean) => (
      <div
        className={cn(
          "min-w-0 flex-1 rounded-md border px-2.5 py-1.5 transition-colors",
          aktif ? "border-primary bg-primary/15" : "border-border bg-muted/40",
        )}
      >
        <p className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className={cn("truncate text-sm tabular-nums", nilai ? "font-semibold" : "text-muted-foreground")}>
          {nilai ? labelTanggal(nilai, locale) : t("belumDipilih")}
        </p>
      </div>
    );
    return (
      // `w-0 min-w-full`: mengikuti lebar kalender, tidak melebarkannya.
      <div className="flex w-0 min-w-full items-center gap-2 border-b px-3 py-2.5" aria-hidden>
        {kotak(t("mulai"), awalTampil, !memilih)}
        {n > 0 ? (
          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums">
            {t("jumlahHari", { n })}
          </span>
        ) : (
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        {kotak(t("selesai"), akhirTampil, memilih)}
      </div>
    );
  })();

  const kalender = (
    <div {...tarik} className="touch-none select-none">
      <Calendar
        mode="range"
        captionLayout="dropdown"
        numberOfMonths={duaBulan ? 2 : 1}
        // Dua bulan berdampingan: hari dari bulan sebelah tidak ditampilkan,
        // supaya satu tanggal tidak tersorot dua kali.
        showOutsideDays={!duaBulan}
        selected={sorot}
        // Pilihan dikendalikan di sini (klik, tarik, pilihan cepat); tanpa
        // onSelect kalender menyimpan pilihannya sendiri dan berhenti mengikuti `selected`.
        onSelect={() => {}}
        onDayClick={klikHari}
        onDayFocus={(d) => jangkar && setUjung(dariDateLokal(d))}
        defaultMonth={bulanAwal}
        startMonth={awal ?? new Date(TAHUN_AWAL, 0, 1)}
        endMonth={akhir ?? new Date(tahunIni + 5, 11, 31)}
        disabled={[
          ...(awal ? [{ before: awal }] : []),
          ...(akhir ? [{ after: akhir }] : []),
          // Sesudah tanggal awal dipilih, hari yang membuat rentang terlalu panjang dimatikan.
          ...(jangkar && maksHari
            ? [{ before: keDateLokal(geserHari(jangkar, -(maksHari - 1)))! }, { after: keDateLokal(geserHari(jangkar, maksHari - 1))! }]
            : []),
        ]}
        components={{ DayButton: TombolHari }}
        className={sempit ? "mx-auto" : undefined}
        autoFocus
      />
    </div>
  );

  const kaki = (
    // `w-0 min-w-full`: teks petunjuk mengikuti lebar kalender, tidak melebarkannya.
    <div className="flex w-0 min-w-full flex-wrap items-center gap-x-3 gap-y-2 border-t px-3 py-2">
      <p className="flex min-w-0 flex-1 basis-48 items-start gap-2 text-xs text-muted-foreground" aria-live="polite">
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
          <Pointer className="h-3 w-3" />
        </span>
        <span>
          {jangkar ? t("pilihAkhir", { tanggal: labelTanggal(jangkar, locale) }) : t("petunjuk")}
          {maksHari ? ` ${t("maksHari", { n: maksHari })}` : null}
        </span>
      </p>
      {jangkar && bolehTerbuka ? (
        <Button type="button" variant="outline" size="sm" onClick={() => terapkan({ dari: jangkar, sampai: "" })}>
          {t("tanpaAkhir")}
        </Button>
      ) : null}
      {jangkar ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => (setJangkar(""), setUjung(""))}>
          {t("ulangi")}
        </Button>
      ) : !required && (dari || sampai) ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => terapkan({ dari: "", sampai: "" })}>
          {t("hapus")}
        </Button>
      ) : null}
    </div>
  );

  const tersembunyi = (
    <>
      {nameDari ? <input type="hidden" name={nameDari} value={dari} /> : null}
      {nameSampai ? <input type="hidden" name={nameSampai} value={sampai} /> : null}
    </>
  );

  if (sempit) {
    return (
      <>
        {pemicu}
        {tersembunyi}
        <Sheet open={buka} onOpenChange={ubahBuka}>
          <SheetContent side="bottom" className="gap-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),0.5rem)]">
            <SheetHeader className="pb-2">
              <SheetTitle>{ariaLabel ?? placeholder ?? t("pilihRentang")}</SheetTitle>
            </SheetHeader>
            {daftarCepat ? (
              <div className="flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={t("cepatJudul")}>
                {daftarCepat}
              </div>
            ) : null}
            {ringkasan}
            {kalender}
            {kaki}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={buka} onOpenChange={ubahBuka}>
      <PopoverTrigger asChild>{pemicu}</PopoverTrigger>
      {tersembunyi}
      <PopoverContent
        className="w-auto max-w-[calc(100vw-1.5rem)] overflow-hidden border-primary/30 p-0"
        align="start"
        collisionPadding={12}
      >
        <div className="flex">
          {daftarCepat ? (
            <div
              className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-primary/25 bg-primary/15 p-2 dark:bg-primary/10"
              role="group"
              aria-label={t("cepatJudul")}
            >
              <p className="flex items-center gap-2 px-2.5 pt-1 pb-2 text-xs font-semibold">
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                  <Zap className="h-3 w-3" />
                </span>
                {t("cepatJudul")}
              </p>
              {daftarCepat}
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col">
            {ringkasan}
            {kalender}
            {kaki}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
