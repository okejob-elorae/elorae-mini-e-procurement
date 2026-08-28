'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { ImagePlus, Loader2, Pencil, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KOLOM_FEED, labelTanggal, susunFeed } from '@/lib/creative/feed';
import type { BarisKonten } from '@/lib/creative/queries';

/**
 * Pratinjau feed Instagram, sekaligus tempat mengunggahnya.
 *
 * Bentuknya meniru yang dipakai tim hari ini di spreadsheet: tiga kolom,
 * tanggal di bilah hitam di ATAS ubinnya, nomor baris di kiri, terbaru di kiri
 * atas. Kemiripan itu disengaja — art director sudah membaca susunan ini setiap
 * hari, dan layar yang menuntut cara membaca baru akan ditinggalkan demi
 * spreadsheet yang sudah ia hafal.
 *
 * UBINNYA SENDIRI ADALAH TEMPAT UNGGAH. Sempat unggahnya hanya lewat dialog,
 * dan itu salah bentuk: menyusun feed adalah pekerjaan menempel gambar berkali-
 * kali sampai komposisinya enak, bukan mengisi formulir. Satu klik atau satu
 * seret, gambarnya masuk ke slot yang dituju.
 */
export function GridFeed({
  konten,
  bolehMengelola,
  onUnggah,
  onSunting,
}: {
  konten: BarisKonten[];
  bolehMengelola: boolean;
  /** `konten` null berarti slot baru — pemanggil yang membuat barisnya. */
  onUnggah: (konten: BarisKonten | null, file: File) => Promise<void>;
  onSunting: (konten: BarisKonten) => void;
}) {
  const t = useTranslations('creative');
  const locale = useLocale();
  const baris = susunFeed(konten);
  const [sibuk, setSibuk] = useState<string | null>(null);

  const terima = async (k: BarisKonten | null, file: File | undefined) => {
    if (!file || !bolehMengelola) return;
    setSibuk(k?.id ?? 'baru');
    try {
      await onUnggah(k, file);
    } finally {
      setSibuk(null);
    }
  };

  /**
   * Ubin tambah, selalu ada di kiri atas.
   *
   * Ada BAHKAN saat feednya masih kosong — dan itu inti perbaikannya. Kalender
   * yang belum berisi dulu menampilkan kartu "belum ada konten", jadi tidak ada
   * kanvas untuk mulai menempel sama sekali.
   */
  const ubinTambah = bolehMengelola ? (
    <SlotUnggah
      key="tambah"
      label={t('addTile')}
      sibuk={sibuk === 'baru'}
      onFile={(f) => terima(null, f)}
      ikon={Plus}
    />
  ) : null;

  const semuaSel = [
    ...(ubinTambah ? [{ tambah: true as const }] : []),
    ...baris.flatMap((b) => b.sel.map((s) => ({ tambah: false as const, sel: s }))),
  ];

  return (
    <div className="space-y-0.5">
      {Array.from({ length: Math.ceil(semuaSel.length / KOLOM_FEED) }).map((_, r) => {
        const potong = semuaSel.slice(r * KOLOM_FEED, (r + 1) * KOLOM_FEED);
        return (
          <div key={r} className="flex gap-2">
            {/* Nomor baris, sama seperti kolom paling kiri di spreadsheet-nya. */}
            <div className="w-6 shrink-0 pt-9 text-right text-sm font-medium tabular-nums text-muted-foreground">
              {r + 1}
            </div>
            <div className="grid min-w-0 flex-1 grid-cols-3 gap-0.5">
              {potong.map((c) =>
                c.tambah ? (
                  ubinTambah
                ) : (
                  <Ubin
                    key={c.sel.konten.id}
                    konten={c.sel.konten}
                    tanggal={labelTanggal(c.sel.konten.scheduledAt, locale)}
                    bolehMengelola={bolehMengelola}
                    sibuk={sibuk === c.sel.konten.id}
                    onFile={(f) => terima(c.sel.konten, f)}
                    onSunting={() => onSunting(c.sel.konten)}
                  />
                ),
              )}
              {/* Baris terakhir yang belum penuh dibiarkan berlubang, bukan
                  direntangkan — supaya lebar ubinnya sama di semua baris. */}
              {Array.from({ length: KOLOM_FEED - potong.length }).map((_, n) => (
                <div key={`sisa-${n}`} aria-hidden />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Ubin({
  konten,
  tanggal,
  bolehMengelola,
  sibuk,
  onFile,
  onSunting,
}: {
  konten: BarisKonten;
  tanggal: string | null;
  bolehMengelola: boolean;
  sibuk: boolean;
  onFile: (f: File | undefined) => void;
  onSunting: () => void;
}) {
  const t = useTranslations('creative');
  const adaGambar = Boolean(konten.imageUrl);

  return (
    <div className="min-w-0">
      {/* Bilah tanggal di ATAS ubinnya, persis seperti sheet-nya. */}
      <div
        className={cn(
          'truncate px-2 py-1 text-center text-xs font-medium',
          tanggal ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
        )}
      >
        {tanggal ?? t('unscheduled')}
      </div>

      {adaGambar ? (
        <div className="group relative aspect-square w-full overflow-hidden bg-muted">
          <Image
            src={konten.imageUrl!}
            alt={konten.title}
            fill
            sizes="(max-width: 768px) 33vw, 220px"
            className="object-cover"
          />
          {konten.terlambat && (
            <span className="absolute left-1 top-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
              {t('late')}
            </span>
          )}
          {/* Judul dan tombolnya muncul saat disentuh, supaya komposisi warnanya
              tidak tertutup apa pun saat sedang dinilai. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <p className="line-clamp-1 text-[11px] text-white">{konten.title}</p>
          </div>
          {bolehMengelola && (
            <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <SlotUnggah kecil label={t('replaceImage')} sibuk={sibuk} onFile={onFile} ikon={ImagePlus} />
              <button
                type="button"
                onClick={onSunting}
                title={t('editContent')}
                className="rounded bg-background/90 p-1.5 shadow-sm hover:bg-background"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Slot tanpa gambar TETAP terlihat dan langsung bisa diisi: ia bagian
           dari komposisi yang sedang dinilai, bukan baris yang boleh dirapatkan. */
        <SlotUnggah
          label={konten.title}
          sibuk={sibuk}
          onFile={onFile}
          ikon={ImagePlus}
          onSunting={bolehMengelola ? onSunting : undefined}
          mati={!bolehMengelola}
        />
      )}
    </div>
  );
}

/**
 * Satu kotak yang menerima berkas — dari klik maupun dari seretan.
 *
 * Seretan ikut ditangani karena art director menyusun feed dari folder gambar
 * yang sudah terbuka di sebelahnya; memaksanya lewat dialog berkas untuk setiap
 * ubin membuat pekerjaan yang seharusnya cepat jadi berulang-ulang.
 */
function SlotUnggah({
  label,
  sibuk,
  onFile,
  ikon: Ikon,
  kecil = false,
  mati = false,
  onSunting,
}: {
  label: string;
  sibuk: boolean;
  onFile: (f: File | undefined) => void;
  ikon: typeof Plus;
  kecil?: boolean;
  mati?: boolean;
  onSunting?: () => void;
}) {
  const t = useTranslations('creative');
  const input = useRef<HTMLInputElement>(null);
  const [diatas, setDiatas] = useState(false);

  const berkas = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        onFile(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  if (kecil) {
    return (
      <>
        <button
          type="button"
          disabled={sibuk}
          title={label}
          onClick={() => input.current?.click()}
          className="rounded bg-background/90 p-1.5 shadow-sm hover:bg-background disabled:opacity-60"
        >
          {sibuk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ikon className="h-3.5 w-3.5" />}
        </button>
        {berkas}
      </>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        if (mati) return;
        e.preventDefault();
        setDiatas(true);
      }}
      onDragLeave={() => setDiatas(false)}
      onDrop={(e) => {
        if (mati) return;
        e.preventDefault();
        setDiatas(false);
        onFile(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        'relative flex aspect-square w-full flex-col items-center justify-center gap-1.5 border border-dashed p-2 text-center transition-colors',
        diatas ? 'border-primary bg-primary/10' : 'bg-muted/40',
        !mati && 'hover:bg-muted',
      )}
    >
      <button
        type="button"
        disabled={sibuk || mati}
        onClick={() => input.current?.click()}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary disabled:cursor-default"
        aria-label={label}
      />
      {sibuk ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <Ikon className="h-5 w-5 text-muted-foreground" />
      )}
      <span className="pointer-events-none line-clamp-2 px-1 text-[11px] leading-tight text-muted-foreground">
        {sibuk ? t('uploading') : label}
      </span>
      {!sibuk && !mati && (
        <span className="pointer-events-none hidden text-[10px] text-muted-foreground/70 sm:block">
          {t('dropHint')}
        </span>
      )}
      {onSunting && !sibuk && (
        <button
          type="button"
          onClick={onSunting}
          title={t('editContent')}
          className="absolute right-1 top-1 rounded bg-background/90 p-1 shadow-sm hover:bg-background"
        >
          <Pencil className="h-3 w-3" />
        </button>
      )}
      {berkas}
    </div>
  );
}
