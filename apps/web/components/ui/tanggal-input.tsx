"use client";

import * as React from "react";
import { CalendarDays, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  bacaJam,
  dalamBatas,
  dariDateLokal,
  gabungWaktu,
  hariIniWib,
  keDateLokal,
  labelTanggal,
  pisahWaktu,
  teksJam,
} from "@/lib/tanggal-isian";

/**
 * Pengganti `<input type="date">`, `type="time"`, dan `type="datetime-local"`.
 *
 * Kalender bawaan peramban berbeda di tiap peramban (Safari menampilkan kotak
 * kecil abu-abu yang tidak cocok dengan aplikasi) — ini satu tampilan untuk
 * semuanya, dengan kalender aplikasi sendiri, pilihan bulan/tahun, "Hari ini",
 * dan "Hapus".
 *
 * Isian dan keluarannya SAMA dengan input bawaan: `value` berupa teks
 * "YYYY-MM-DD" (atau "HH:mm" / "YYYY-MM-DDTHH:mm"), dan `onChange` menerima
 * `{ target: { value } }`. Formulir yang sudah ada cukup mengganti nama
 * komponennya.
 */

/** Bentuk peristiwa yang dibaca handler lama: `(e) => setX(e.target.value)`. */
export type PeristiwaIsian = { target: { value: string }; currentTarget: { value: string } };
const peristiwa = (value: string): PeristiwaIsian => ({ target: { value }, currentTarget: { value } });

type Bersama = {
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
};

export const GAYA_PEMICU =
  "border-input dark:bg-input/30 flex h-9 w-full min-w-0 items-center justify-start gap-2 rounded-md border bg-transparent px-3 py-1 text-left text-base font-normal shadow-xs transition-[color,box-shadow] outline-none hover:bg-transparent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm";

const TAHUN_AWAL = 2015;

/**
 * Layar sempit (HP): kalender dibuka sebagai lembar dari bawah, bukan melayang.
 * Di HP kalender dengan sasaran sentuh 44 px lebih tinggi dari ruang di atas
 * atau di bawah isiannya, dan versi melayangnya terpotong di tepi layar.
 */
export function useLayarSempit(): boolean {
  const [sempit, setSempit] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const ubah = () => setSempit(mq.matches);
    ubah();
    mq.addEventListener("change", ubah);
    return () => mq.removeEventListener("change", ubah);
  }, []);
  return sempit;
}

export type TanggalInputProps = Bersama & {
  value: string;
  onChange?: (e: PeristiwaIsian) => void;
  /** Teks tanggal paling awal / paling akhir yang boleh dipilih (inklusif). */
  min?: string;
  max?: string;
  placeholder?: string;
};

export function TanggalInput({
  value,
  onChange,
  min,
  max,
  placeholder,
  id,
  name,
  disabled,
  required,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: TanggalInputProps) {
  const t = useTranslations("tanggalInput");
  const locale = useLocale();
  const [buka, setBuka] = React.useState(false);
  const terpilih = keDateLokal(value);
  const awal = keDateLokal(min);
  const akhir = keDateLokal(max);
  const hariIni = hariIniWib();
  const tahunIni = Number(hariIni.slice(0, 4));

  const pilih = (teks: string) => {
    onChange?.(peristiwa(teks));
    setBuka(false);
  };

  const sempit = useLayarSempit();

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
      data-kosong={!terpilih}
      onClick={sempit ? () => !disabled && setBuka(true) : undefined}
      className={cn(GAYA_PEMICU, "data-[kosong=true]:text-muted-foreground", className)}
    >
      <CalendarDays className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
      <span className="truncate">{terpilih ? labelTanggal(value, locale) : (placeholder ?? t("pilih"))}</span>
    </Button>
  );

  const isi = (
    <>
      <Calendar
        mode="single"
        captionLayout="dropdown"
        selected={terpilih}
        defaultMonth={terpilih ?? keDateLokal(dalamBatas(hariIni, min, max) ? hariIni : (min ?? max ?? hariIni))}
        startMonth={awal ?? new Date(TAHUN_AWAL, 0, 1)}
        endMonth={akhir ?? new Date(tahunIni + 5, 11, 31)}
        disabled={[...(awal ? [{ before: awal }] : []), ...(akhir ? [{ after: akhir }] : [])]}
        onSelect={(d) => d && pilih(dariDateLokal(d))}
        className={sempit ? "mx-auto" : undefined}
        autoFocus
      />
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
        <Button type="button" variant="ghost" size="sm" disabled={!dalamBatas(hariIni, min, max)} onClick={() => pilih(hariIni)}>
          {t("hariIni")}
        </Button>
        {/* Filter boleh dikosongkan; isian wajib tidak. */}
        {!required && value ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => pilih("")}>
            {t("hapus")}
          </Button>
        ) : null}
      </div>
    </>
  );

  // Kirim lewat formulir biasa (GET/POST) seperti input bawaan.
  const tersembunyi = name ? <input type="hidden" name={name} value={value} /> : null;

  if (sempit) {
    return (
      <>
        {pemicu}
        {tersembunyi}
        <Sheet open={buka} onOpenChange={setBuka}>
          <SheetContent side="bottom" className="gap-0 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),0.5rem)]">
            <SheetHeader className="pb-0">
              <SheetTitle>{ariaLabel ?? placeholder ?? t("pilih")}</SheetTitle>
            </SheetHeader>
            {isi}
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={buka} onOpenChange={(o) => !disabled && setBuka(o)}>
      <PopoverTrigger asChild>{pemicu}</PopoverTrigger>
      {tersembunyi}
      <PopoverContent className="w-auto p-0" align="start" collisionPadding={12}>
        {isi}
      </PopoverContent>
    </Popover>
  );
}

const JAM = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MENIT = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

export type JamInputProps = Bersama & {
  /** "HH:mm"; kosong kalau belum dipilih. */
  value: string;
  onChange?: (e: PeristiwaIsian) => void;
};

/** Pengganti `<input type="time">`: dua pilihan, jam dan menit, bergaya sama dengan isian lain. */
export function JamInput({
  value,
  onChange,
  id,
  name,
  disabled,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: JamInputProps) {
  const t = useTranslations("tanggalInput");
  const j = bacaJam(value);
  const ubah = (jam: number, menit: number) => onChange?.(peristiwa(teksJam(jam, menit)));
  return (
    <div
      className={cn("flex items-center gap-1", className)}
      role="group"
      aria-label={ariaLabel ?? t("jam")}
      aria-describedby={ariaDescribedBy}
    >
      <Clock className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
      <Select value={j ? JAM[j.jam] : undefined} onValueChange={(v) => ubah(Number(v), j?.menit ?? 0)} disabled={disabled}>
        <SelectTrigger id={id} className="w-[4.5rem] tabular-nums" aria-invalid={ariaInvalid} aria-label={t("jam")}>
          <SelectValue placeholder="--" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {JAM.map((x) => (
            <SelectItem key={x} value={x} className="tabular-nums">
              {x}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span aria-hidden>:</span>
      <Select value={j ? MENIT[j.menit] : undefined} onValueChange={(v) => ubah(j?.jam ?? 0, Number(v))} disabled={disabled}>
        <SelectTrigger className="w-[4.5rem] tabular-nums" aria-invalid={ariaInvalid} aria-label={t("menit")}>
          <SelectValue placeholder="--" />
        </SelectTrigger>
        <SelectContent className="max-h-64">
          {MENIT.map((x) => (
            <SelectItem key={x} value={x} className="tabular-nums">
              {x}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}

export type TanggalJamInputProps = Bersama & {
  /** "YYYY-MM-DDTHH:mm"; kosong kalau belum dipilih. */
  value: string;
  onChange?: (e: PeristiwaIsian) => void;
  min?: string;
  max?: string;
};

/**
 * Pengganti `<input type="datetime-local">`: pemilih tanggal + jam. Batas
 * `min`/`max` dipakai pada harinya; jam di hari batas diperiksa penulisnya,
 * sama seperti input bawaan yang tetap mengirim nilai di luar batas.
 */
export function TanggalJamInput({ value, onChange, min, max, id, name, disabled, required, className, ...aria }: TanggalJamInputProps) {
  const { tanggal, jam } = pisahWaktu(value);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <TanggalInput
        id={id}
        value={tanggal}
        min={pisahWaktu(min).tanggal || undefined}
        max={pisahWaktu(max).tanggal || undefined}
        disabled={disabled}
        required={required}
        className="min-w-0 flex-1 basis-40"
        aria-invalid={aria["aria-invalid"]}
        aria-describedby={aria["aria-describedby"]}
        aria-label={aria["aria-label"]}
        onChange={(e) => onChange?.(peristiwa(e.target.value ? gabungWaktu(e.target.value, jam) : ""))}
      />
      <JamInput
        value={jam}
        disabled={disabled || !tanggal}
        aria-invalid={aria["aria-invalid"]}
        onChange={(e) => onChange?.(peristiwa(gabungWaktu(tanggal, e.target.value)))}
      />
      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}
