"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import gaya from "./layar-masuk.module.css";

/**
 * Layar antara halaman masuk dan aplikasi (lihat `layar-masuk.module.css`).
 *
 * Satu markup untuk semua tahap, karena bingkai terakhir di halaman masuk dan
 * bingkai pertama di halaman tujuan harus sama persis sampai ke pikselnya —
 * dua markup yang "kira-kira sama" akan terlihat melompat saat dokumennya
 * berganti. Leluconnya menumpang di atas dan tidak menggeser wordmark.
 */

export type TahapMasuk = "datang" | "tahan" | "cerita" | "buka";

export type IsiCerita = {
  pembuka: string;
  punchline: string;
  /** 0 = pembuka, 1 = punchline. */
  langkah: 0 | 1;
  /** Lama tiap langkah, untuk bilah progres. */
  durasi: [number, number];
  label: string;
  /** Petunjuk untuk layar sentuh: "Ketuk untuk lanjut · …". */
  petunjuk: string;
  /** Label tombol keyboard untuk layar dengan penunjuk. */
  tombol: { spasi: string; lanjut: string; tahan: string; tutup: string };
};

type Props = {
  tahap: TahapMasuk;
  /**
   * Warna wordmark. Di halaman masuk diisi langsung; di halaman tujuan datang
   * dari `--masuk-merek` yang dipasang skrip `<head>` di `<html>`.
   */
  warna?: string;
  /** Wordmark sudah lewat — ia tidak boleh kembali. */
  lewat?: boolean;
  /** Jari atau klik sedang menahan layar: semua gerak berhenti. */
  jeda?: boolean;
  cerita?: IsiCerita | null;
  className?: string;
};

export function LayarMasuk({ tahap, warna, lewat, jeda, cerita, className }: Props) {
  return (
    <div
      className={cn(gaya.layar, className)}
      data-tahap={tahap}
      data-lewat={lewat ? "" : undefined}
      data-jeda={jeda ? "" : undefined}
      style={warna ? ({ "--masuk-merek": warna } as CSSProperties) : undefined}
      aria-hidden
    >
      <div className={gaya.butir} />
      <p className={gaya.judul}>ELORAÉ</p>
      {cerita && lewat ? <Cerita {...cerita} /> : null}
    </div>
  );
}

function Cerita({ pembuka, punchline, langkah, durasi, label, petunjuk, tombol }: IsiCerita) {
  return (
    <div className={gaya.cerita}>
      <div className={gaya.atas}>
        <div className={gaya.progres}>
          {durasi.map((ms, i) => (
            <span
              key={i}
              className={gaya.segmen}
              data-status={i < langkah ? "penuh" : i === langkah ? "jalan" : "kosong"}
              style={{ "--durasi": `${ms}ms` } as CSSProperties}
            >
              <i />
            </span>
          ))}
        </div>
        <div className={gaya.kepala}>
          <span className={gaya.label}>{label}</span>
          <span className={gaya.tutup} data-tutup>
            ✕
          </span>
        </div>
      </div>

      <div className={gaya.isi}>
        <p className={gaya.pembuka}>{pembuka}</p>
        {langkah >= 1 ? <p className={gaya.punchline}>{punchline}</p> : null}
      </div>

      <div>
        <p className={cn(gaya.petunjuk, gaya.hanyaPenunjuk)}>
          <span>
            <kbd>{tombol.spasi}</kbd>
            {tombol.lanjut}
          </span>
          <span>{tombol.tahan}</span>
          <span>
            <kbd>Esc</kbd>
            {tombol.tutup}
          </span>
        </p>
        <p className={cn(gaya.petunjuk, gaya.hanyaSentuh)}>{petunjuk}</p>
      </div>
    </div>
  );
}
