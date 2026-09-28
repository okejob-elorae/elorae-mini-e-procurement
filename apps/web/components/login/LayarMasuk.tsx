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
 * berganti. Story-nya menumpang di atas dan tidak menggeser wordmark.
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
  petunjuk: string;
};

type Props = {
  tahap: TahapMasuk;
  /**
   * Warna wordmark. Di halaman masuk diisi langsung; di halaman tujuan datang
   * dari `--masuk-merek` yang dipasang skrip `<head>` di `<html>`.
   */
  warna?: string;
  /** `datang`: titik tengah tombol Masuk, pusat ledakannya (piksel layar). */
  asal?: { x: number; y: number } | null;
  /** Wordmark sudah menembus kamera — ia tidak boleh kembali. */
  lewat?: boolean;
  /** Jari sedang menahan layar: semua gerak berhenti. */
  jeda?: boolean;
  cerita?: IsiCerita | null;
  className?: string;
};

/** Reaksi yang melayang: emoji, posisi awal, arah melayang, putaran. */
const REAKSI = [
  { e: "💀", x: "8px", geser: "-18px", putar: "-14deg" },
  { e: "😭", x: "30px", geser: "10px", putar: "12deg" },
  { e: "🤣", x: "2px", geser: "22px", putar: "-8deg" },
  { e: "💀", x: "36px", geser: "-26px", putar: "18deg" },
  { e: "🫠", x: "16px", geser: "6px", putar: "-20deg" },
] as const;

export function LayarMasuk({ tahap, warna, asal, lewat, jeda, cerita, className }: Props) {
  const gayaAkar: Record<string, string> = {};
  if (warna) gayaAkar["--masuk-merek"] = warna;
  if (asal) {
    gayaAkar["--x"] = `${asal.x}px`;
    gayaAkar["--y"] = `${asal.y}px`;
  }

  return (
    <div
      className={cn(gaya.layar, className)}
      data-tahap={tahap}
      data-lewat={lewat ? "" : undefined}
      data-jeda={jeda ? "" : undefined}
      style={gayaAkar as CSSProperties}
      aria-hidden
    >
      {tahap === "datang" ? (
        <>
          <div className={gaya.ledakan} data-lapis="1" />
          <div className={gaya.ledakan} data-lapis="2" />
        </>
      ) : null}

      <p className={gaya.judul}>ELORAÉ</p>

      {cerita && lewat ? <Cerita {...cerita} /> : null}
    </div>
  );
}

function Cerita({ pembuka, punchline, langkah, durasi, label, petunjuk }: IsiCerita) {
  const kata = pembuka.trim().split(/\s+/);
  return (
    <div className={gaya.cerita}>
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
        <span className={gaya.avatar}>E</span>
        <span className={gaya.akun}>elorae</span>
        <span className={gaya.keterangan}>{label}</span>
        <span className={gaya.tutup} data-tutup>
          ✕
        </span>
      </div>

      <div className={gaya.isi}>
        <p className={gaya.pembuka}>
          {kata.map((k, i) => (
            <span key={i} className={gaya.kata} style={{ "--i": i } as CSSProperties}>
              {i < kata.length - 1 ? `${k} ` : k}
            </span>
          ))}
        </p>

        {langkah >= 1 ? (
          <p className={gaya.stiker}>
            {punchline}
            <span className={gaya.tengkorak}>💀</span>
          </p>
        ) : null}
      </div>

      {langkah >= 1 ? (
        <div className={gaya.reaksi}>
          {REAKSI.map((r, i) => (
            <span
              key={i}
              style={{ "--i": i, "--x": r.x, "--geser": r.geser, "--putar": r.putar } as CSSProperties}
            >
              {r.e}
            </span>
          ))}
        </div>
      ) : null}

      <p className={gaya.petunjuk}>{petunjuk}</p>
    </div>
  );
}
