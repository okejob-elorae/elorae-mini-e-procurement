'use client';

import { useRef, useState } from 'react';
import { useFlip } from '@/lib/ui/use-flip';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ImagePlus, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
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
/**
 * Jenis data seretan internal.
 *
 * Harus huruf kecil semua: sebagian peramban menormalkan `dataTransfer.types`
 * jadi huruf kecil, jadi mencocokkannya dengan huruf besar akan meleset diam-
 * diam — seretan ubin lalu terbaca sebagai unggah berkas.
 */
const SERET_UBIN = 'application/x-elorae-konten';

export function GridFeed({
  konten,
  bolehMengelola,
  onUnggah,
  onSunting,
  onHapus,
  onTukar,
  terpilih,
  onPilih,
}: {
  konten: BarisKonten[];
  bolehMengelola: boolean;
  /** `konten` null berarti slot baru — pemanggil yang membuat barisnya. */
  onUnggah: (konten: BarisKonten | null, file: File) => Promise<void>;
  onSunting: (konten: BarisKonten) => void;
  onHapus: (konten: BarisKonten) => void;
  /** Menukar posisi dua ubin — yang berarti menukar jadwalnya. */
  onTukar: (idSeret: string, idTujuan: string) => Promise<void>;
  /** Non-null berarti mode pilih menyala. */
  terpilih: Set<string> | null;
  onPilih: (id: string) => void;
}) {
  const t = useTranslations('creative');
  const locale = useLocale();
  const baris = susunFeed(konten);
  const [sibuk, setSibuk] = useState<string | null>(null);
  const [sedangSeret, setSedangSeret] = useState<string | null>(null);
  const wadah = useRef<HTMLDivElement>(null);

  /*
   * Kuncinya adalah urutan id-nya. Ia berubah tepat saat susunan grid berubah —
   * tidak lebih sering (yang akan menganimasikan hal yang tidak bergerak), dan
   * tidak lebih jarang (yang akan melewatkan perpindahan).
   */
  useFlip(wadah, baris.flatMap((b) => b.sel.map((s) => s.konten.id)).join('|'));

  const terima = async (k: BarisKonten | null, file: File | undefined) => {
    if (!file || !bolehMengelola) return;
    setSibuk(k?.id ?? 'baru');
    try {
      await onUnggah(k, file);
    } finally {
      setSibuk(null);
    }
  };

  /*
   * Ubin tambah, selalu di kiri atas — ADA BAHKAN saat feednya masih kosong.
   * Itu inti perbaikannya: kalender yang belum berisi dulu menampilkan kartu
   * "belum ada konten", jadi tidak ada kanvas untuk mulai menempel sama sekali.
   */
  const semuaSel = [
    ...(bolehMengelola ? [{ tambah: true as const, sel: undefined }] : []),
    ...baris.flatMap((b) => b.sel.map((s) => ({ tambah: false as const, sel: s }))),
  ];

  return (
    /*
     * SATU wadah grid, bukan satu baris flex per baris feed.
     *
     * Bentuknya sama di layar, tapi bedanya menentukan: dengan pembungkus per
     * baris, ubin yang berpindah baris masuk ke induk React yang berbeda, jadi
     * ia DIBONGKAR lalu dibuat ulang — gambarnya berkedip dan animasi FLIP
     * kehilangan simpul yang mau digerakkan. Dalam satu wadah datar, kuncinya
     * tetap di induk yang sama, jadi React MEMINDAHKAN simpulnya.
     *
     * Kolom pertama `auto` untuk nomor baris; tiga sisanya sama lebar.
     */
    <div
      ref={wadah}
      className="grid gap-x-2 gap-y-0.5"
      style={{ gridTemplateColumns: 'auto repeat(3, minmax(0, 1fr))' }}
    >
      {Array.from({ length: Math.ceil(semuaSel.length / KOLOM_FEED) }).flatMap((_, r) => {
        const potong = semuaSel.slice(r * KOLOM_FEED, (r + 1) * KOLOM_FEED);
        return [
          // Nomor baris feed — disengaja, meniru lembar kerja tim (lihat komentar di atas).
          <div
            key={`nomor-${r}`}
            className="w-6 pt-9 text-right text-sm font-medium tabular-nums text-muted-foreground"
            title={t('rowNumber', { n: r + 1 })}
          >
            <span aria-hidden>{r + 1}</span>
            <span className="sr-only">{t('rowNumber', { n: r + 1 })}</span>
          </div>,
          ...potong.map((c) =>
            c.tambah ? (
              <SlotUnggah
                key="tambah"
                label={t('addTile')}
                sibuk={sibuk === 'baru'}
                onFile={(f) => terima(null, f)}
                ikon={Plus}
              />
            ) : (
              <Ubin
                key={c.sel.konten.id}
                konten={c.sel.konten}
                tanggal={labelTanggal(c.sel.konten.scheduledAt, locale)}
                bolehMengelola={bolehMengelola}
                sibuk={sibuk === c.sel.konten.id}
                onFile={(f) => terima(c.sel.konten, f)}
                onSunting={() => onSunting(c.sel.konten)}
                onHapus={() => onHapus(c.sel.konten)}
                onTukar={onTukar}
                sedangSeret={sedangSeret}
                setSedangSeret={setSedangSeret}
                terpilih={terpilih}
                onPilih={onPilih}
              />
            ),
          ),
          /* Baris terakhir yang belum penuh dibiarkan berlubang, bukan
             direntangkan — supaya lebar ubinnya sama di semua baris. */
          ...Array.from({ length: KOLOM_FEED - potong.length }, (_, n) => (
            <div key={`sisa-${r}-${n}`} aria-hidden />
          )),
        ];
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
  onHapus,
  onTukar,
  sedangSeret,
  setSedangSeret,
  terpilih,
  onPilih,
}: {
  konten: BarisKonten;
  tanggal: string | null;
  bolehMengelola: boolean;
  sibuk: boolean;
  onFile: (f: File | undefined) => void;
  onSunting: () => void;
  onHapus: () => void;
  onTukar: (idSeret: string, idTujuan: string) => Promise<void>;
  sedangSeret: string | null;
  setSedangSeret: (id: string | null) => void;
  terpilih: Set<string> | null;
  onPilih: (id: string) => void;
}) {
  const t = useTranslations('creative');
  // Gambar yang gagal dimuat (mis. fotonya sudah tidak ada: 404 dari /api/foto)
  // diperlakukan seperti slot kosong — judul terbaca dan bisa langsung diunggah
  // ulang — bukan kotak pucat dengan sisa teks alt.
  const [gambarGagal, setGambarGagal] = useState<string | null>(null);
  const adaGambar = Boolean(konten.imageUrl) && gambarGagal !== konten.imageUrl;
  const [tujuanSeret, setTujuanSeret] = useState(false);

  /*
   * Satu ubin menerima DUA macam seretan: berkas gambar dari luar, dan ubin
   * lain dari grid ini sendiri. Dibedakan lewat `dataTransfer.types` — seretan
   * internal membawa `SERET_UBIN`, seretan berkas membawa `Files`. Tanpa
   * pembedaan itu, menyeret satu ubin ke ubin lain akan terbaca sebagai unggah
   * berkas kosong.
   */
  const seretUbin = (e: React.DragEvent) => e.dataTransfer.types.includes(SERET_UBIN);

  const modePilih = terpilih !== null;
  const dipilih = terpilih?.has(konten.id) ?? false;

  /* Seret dimatikan saat memilih: satu gerakan tidak boleh berarti dua hal. */
  const dnd = bolehMengelola && !modePilih
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData(SERET_UBIN, konten.id);
          e.dataTransfer.effectAllowed = 'move';
          setSedangSeret(konten.id);
        },
        onDragEnd: () => {
          setSedangSeret(null);
          setTujuanSeret(false);
        },
        onDragOver: (e: React.DragEvent) => {
          if (!seretUbin(e)) return;
          e.preventDefault();
          setTujuanSeret(true);
        },
        onDragLeave: () => setTujuanSeret(false),
        onDrop: (e: React.DragEvent) => {
          if (!seretUbin(e)) return;
          e.preventDefault();
          setTujuanSeret(false);
          setSedangSeret(null);
          const asal = e.dataTransfer.getData(SERET_UBIN);
          if (asal && asal !== konten.id) void onTukar(asal, konten.id);
        },
      }
    : {};

  return (
    <div
      {...dnd}
      data-flip={konten.id}
      className={cn(
        'ubin-masuk min-w-0 transition-[transform,opacity,box-shadow] duration-200 ease-out',
        // Yang sedang diangkat mengecil dan memudar: tangan Anda memegangnya,
        // jadi ia harus terlihat lepas dari kisi.
        sedangSeret === konten.id && 'scale-[0.94] opacity-40',
        dipilih && 'ring-2 ring-primary ring-offset-2',
        // Yang akan ditukari sedikit membesar — memberi tahu ke mana ubinnya
        // akan mendarat SEBELUM dilepas, bukan sesudahnya.
        tujuanSeret && 'z-10 scale-[1.04] shadow-lg ring-2 ring-primary ring-offset-2',
        bolehMengelola && 'cursor-grab active:cursor-grabbing',
      )}
    >
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
          {modePilih && (
            <button
              type="button"
              onClick={() => onPilih(konten.id)}
              aria-pressed={dipilih}
              aria-label={konten.title}
              className={cn(
                'absolute inset-0 z-20 flex items-start justify-end p-1.5 transition-colors',
                dipilih ? 'bg-primary/25' : 'hover:bg-foreground/10',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
                  dipilih
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-white/90 bg-black/25',
                )}
              >
                {dipilih && <Check className="h-3 w-3" />}
              </span>
            </button>
          )}
          <Image
            src={konten.imageUrl!}
            alt={konten.title}
            fill
            sizes="(max-width: 768px) 33vw, 220px"
            className="object-cover"
            onError={() => setGambarGagal(konten.imageUrl)}
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
          {bolehMengelola && !modePilih && (
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
              <button
                type="button"
                onClick={onHapus}
                title={t('deleteContent')}
                className="rounded bg-background/90 p-1.5 text-destructive shadow-sm hover:bg-destructive hover:text-destructive-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Slot tanpa gambar TETAP terlihat dan langsung bisa diisi: ia bagian
           dari komposisi yang sedang dinilai, bukan baris yang boleh dirapatkan. */
        <div className="relative">
          <SlotUnggah
            label={konten.title}
            keterangan={konten.imageUrl ? t('gambarHilang') : undefined}
            sibuk={sibuk}
            onFile={onFile}
            ikon={ImagePlus}
            onSunting={bolehMengelola && !modePilih ? onSunting : undefined}
            onHapus={bolehMengelola && !modePilih ? onHapus : undefined}
            mati={!bolehMengelola || modePilih}
          />
          {konten.terlambat && (
            <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground">
              {t('late')}
            </span>
          )}
        </div>
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
  keterangan,
  sibuk,
  onFile,
  ikon: Ikon,
  kecil = false,
  mati = false,
  onSunting,
  onHapus,
}: {
  label: string;
  /** Baris kedua yang terlihat, mis. "Gambar hilang — unggah ulang". */
  keterangan?: string;
  sibuk: boolean;
  onFile: (f: File | undefined) => void;
  ikon: typeof Plus;
  kecil?: boolean;
  mati?: boolean;
  onSunting?: () => void;
  onHapus?: () => void;
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
        // Seretan ubin ditangani pembungkusnya; kalau ikut ditangkap di sini,
        // ia terbaca sebagai unggah berkas kosong.
        if (mati || e.dataTransfer.types.includes(SERET_UBIN)) return;
        e.preventDefault();
        setDiatas(true);
      }}
      onDragLeave={() => setDiatas(false)}
      onDrop={(e) => {
        if (mati || e.dataTransfer.types.includes(SERET_UBIN)) return;
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
      <span
        className={cn(
          'pointer-events-none line-clamp-2 px-1 text-[11px] leading-tight',
          keterangan ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {sibuk ? t('uploading') : label}
      </span>
      {!sibuk && keterangan ? (
        <span className="pointer-events-none text-[10px] text-destructive">{keterangan}</span>
      ) : null}
      {!sibuk && !mati && (
        <span className="pointer-events-none hidden text-[10px] text-muted-foreground/70 sm:block">
          {t('dropHint')}
        </span>
      )}
      {!sibuk && (onSunting || onHapus) && (
        <div className="absolute right-1 top-1 flex gap-1">
          {onSunting && (
            <button
              type="button"
              onClick={onSunting}
              title={t('editContent')}
              className="rounded bg-background/90 p-1 shadow-sm hover:bg-background"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {onHapus && (
            <button
              type="button"
              onClick={onHapus}
              title={t('deleteContent')}
              className="rounded bg-background/90 p-1 text-destructive shadow-sm hover:bg-destructive hover:text-destructive-foreground"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
      {berkas}
    </div>
  );
}
