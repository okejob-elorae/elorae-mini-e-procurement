"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, LazyMotion, MotionConfig, useReducedMotion, type Transition } from "motion/react";
import * as m from "motion/react-m";
import {
  Bell,
  CircleCheck,
  CloudAlert,
  CloudUpload,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tampilan, type ButirTampilan, type JenisButir, type Tampilan } from "@/lib/pulau/keadaan";
import { ambilKeadaan, ambilKeadaanServer, langgan, tutupButir } from "@/lib/pulau/pulau";
import { teksButir, type PenerjemahPulau } from "@/lib/pulau/teks";

/*
 * Pulau status — satu kapsul di tengah atas (kantor dan HP) yang melebar dan
 * berubah bentuk sesuai keadaan: pesan aksi, tanpa sinyal, proses panjang,
 * notifikasi baru. Keadaannya di `lib/pulau/*`; komponen ini hanya menggambar.
 *
 * Diam = tidak ada kapsul sama sekali. Posisinya `fixed`, jadi tidak pernah
 * menggeser tata letak. Gerak memakai `motion` (hanya di sini), fiturnya
 * dimuat belakangan, dan dimatikan bila pengguna memilih "kurangi gerakan".
 */

/*
 * Fitur gerak dimuat sesudah halaman tenang — bukan bagian dari muatan awal.
 *
 * Sebelum fiturnya termuat, komponen `m.*` hanya menggambar nilai `initial`
 * TANPA menganimasikannya. Karena itu kapsul baru boleh memakai `initial`
 * yang tersembunyi (opacity 0) sesudah fiturnya siap; sebelumnya ia tampil
 * langsung tanpa gerak. Bila potongannya gagal dimuat (mis. HP dibuka tanpa
 * sinyal dan potongan itu belum tersimpan), kapsulnya tetap tampil — diam.
 */
let fiturSiap = false;
const pendengarFitur = new Set<() => void>();
const langganFitur = (p: () => void) => {
  pendengarFitur.add(p);
  return () => {
    pendengarFitur.delete(p);
  };
};
const muatFitur = () =>
  new Promise<void>((selesai) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(() => selesai(), { timeout: 2000 });
    } else {
      setTimeout(selesai, 200);
    }
  })
    .then(() => import("./fitur-gerak"))
    .then(
      (modul) => {
        // Ditandai siap SESUDAH LazyMotion memasang fiturnya (rantai `then`-nya
        // berjalan setelah ini), supaya tidak ada kapsul yang terpasang dengan
        // `initial` tersembunyi tepat sebelum fiturnya ada.
        setTimeout(() => {
          fiturSiap = true;
          for (const p of [...pendengarFitur]) p();
        }, 0);
        return modul.default;
      },
      // LazyMotion tidak menangani penolakan; biarkan menunggu selamanya, tanpa galat.
      () => new Promise<never>(() => {}),
    );

const PEGAS: Transition = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 };
const DIAM: Transition = { duration: 0 };

const IKON: Record<JenisButir, LucideIcon> = {
  galat: OctagonX,
  proses: Loader2,
  luring: WifiOff,
  mengirim: CloudUpload,
  terkirim: CircleCheck,
  sisa: CloudAlert,
  notifikasi: Bell,
  sukses: CircleCheck,
  info: Info,
  peringatan: TriangleAlert,
  memuat: Loader2,
  biasa: Info,
  tertunda: CloudUpload,
};

// Kapsulnya terbalik terhadap tema (gelap di tema terang, terang di tema
// gelap), jadi warna ikonnya juga dipasangkan per tema.
const WARNA: Partial<Record<JenisButir, string>> = {
  galat: "text-red-400 dark:text-red-600",
  sukses: "text-emerald-400 dark:text-emerald-600",
  terkirim: "text-emerald-400 dark:text-emerald-600",
  peringatan: "text-amber-300 dark:text-amber-600",
  sisa: "text-amber-300 dark:text-amber-600",
  luring: "text-amber-300 dark:text-amber-600",
  info: "text-sky-300 dark:text-sky-700",
  notifikasi: "text-sky-300 dark:text-sky-700",
};

const BERPUTAR: ReadonlySet<JenisButir> = new Set(["proses", "memuat", "mengirim"]);

/*
 * Keadaan yang bisa bertahan lama (tanpa sinyal, proses panjang, antrean
 * tertunda) menyusut menjadi kapsul ringkas — ikon dan angka saja — sesudah
 * beberapa detik, supaya tidak terus menutupi judul halaman. Diketuk = melebar lagi.
 */
const BISA_RINGKAS: ReadonlySet<JenisButir> = new Set(["luring", "proses", "tertunda"]);
const RINGKAS_SESUDAH_MS = 4000;

/*
 * Pesan dari tindakan (bekas toast) dibaca utuh: banyak yang berupa kalimat
 * panjang berisi langkah perbaikan (mis. jurnal pembayaran pemasok), jadi
 * teksnya membungkus ke baris berikutnya, tidak dipotong "…". Keadaan sinyal,
 * proses, dan notifikasi tetap satu baris.
 */
const BUNGKUS: ReadonlySet<JenisButir> = new Set(["sukses", "galat", "info", "peringatan", "memuat", "biasa"]);

function IkonButir({ jenis, className }: { jenis: JenisButir; className?: string }) {
  const Ikon = IKON[jenis];
  return (
    <Ikon
      aria-hidden
      className={cn(
        "size-[18px] shrink-0",
        WARNA[jenis],
        BERPUTAR.has(jenis) && jenis !== "mengirim" && "motion-safe:animate-spin",
        jenis === "mengirim" && "motion-safe:animate-pulse",
        className,
      )}
    />
  );
}

/*
 * Ketukan pada kapsul bukan "klik di luar" dialog atau menu yang sedang
 * terbuka. Radix mendengarkan `pointerdown` di `document` (sesudah React, yang
 * akarnya juga `document`) dan menutup dialog/lembar yang terbuka — isian
 * formulirnya hilang hanya karena pesan galat di kapsul diketuk. Hentikan
 * peristiwanya di sini supaya pendengar itu tidak pernah menerimanya.
 */
function bukanKlikLuar(e: PointerEvent<HTMLElement>) {
  e.nativeEvent.stopImmediatePropagation();
}

function bisaDiketuk(b: ButirTampilan): boolean {
  return Boolean(b.diketuk || b.tautan || b.bisaDitutup);
}

function Kapsul({
  isi,
  t,
  gerak,
  ketuk,
}: {
  isi: Tampilan;
  t: PenerjemahPulau;
  gerak: boolean;
  ketuk: (b: ButirTampilan) => void;
}) {
  const { utama, kedua } = isi;
  const teks = teksButir(utama, t);
  const isiRef = useRef<HTMLDivElement>(null);
  const [ukuran, setUkuran] = useState<{ w: number; h: number } | null>(null);

  // Ringkas berlaku untuk tampilan yang sama; jumlah yang berubah (3 → 4 belum
  // terkirim) melebarkannya lagi supaya perubahan itu terbaca.
  const kunciTampil = `${utama.kunci}|${utama.jenis}|${utama.jumlah ?? ""}`;
  const bisaRingkas = BISA_RINGKAS.has(utama.jenis);
  const [ringkasUntuk, setRingkasUntuk] = useState<string | null>(null);
  const [bangun, setBangun] = useState(0);
  const ringkas = bisaRingkas && ringkasUntuk === kunciTampil;
  useEffect(() => {
    if (!bisaRingkas) return;
    const pengatur = setTimeout(() => setRingkasUntuk(kunciTampil), RINGKAS_SESUDAH_MS);
    return () => clearTimeout(pengatur);
  }, [bisaRingkas, kunciTampil, bangun]);
  const lebarkan = () => {
    setRingkasUntuk(null);
    setBangun((n) => n + 1);
  };
  const bungkus = BUNGKUS.has(utama.jenis);
  const angkaRingkas =
    typeof teks.persen === "number" ? `${teks.persen}%` : utama.jumlah ? String(utama.jumlah) : "";

  // Ukuran isi diukur, lalu kapsulnya menyusul dengan pegas — itu yang membuat
  // kapsul "melebar dan menyusut" mengikuti isinya.
  useEffect(() => {
    const el = isiRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const pengamat = new ResizeObserver(([entri]) => {
      // Ukuran tata letak, BUKAN getBoundingClientRect: kapsulnya sedang
      // diskala (0,86 → 1) saat muncul, dan ukuran yang ikut terskala membuat
      // kapsulnya berhenti 14% lebih sempit dari isinya — teksnya terpotong.
      const kotak = entri?.borderBoxSize?.[0];
      const w = kotak ? kotak.inlineSize : el.offsetWidth;
      const h = kotak ? kotak.blockSize : el.offsetHeight;
      setUkuran((lama) => (lama && lama.w === w && lama.h === h ? lama : { w, h }));
    });
    pengamat.observe(el);
    return () => pengamat.disconnect();
  }, []);

  const aksi = utama.aksi;
  const jalankanAksi = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    aksi?.jalankan(e);
    if (!e.defaultPrevented) tutupButir(utama);
  };

  // `span`, bukan `div`: barisnya bisa berada di dalam tombol.
  const baris = (
    <m.span
      key={`${utama.kunci}|${utama.jenis}`}
      initial={gerak ? { opacity: 0, y: 4 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={gerak ? { duration: 0.18, ease: "easeOut" } : DIAM}
      className="flex min-h-11 items-center gap-2.5 py-2 pl-3.5 pr-3"
    >
      <IkonButir jenis={utama.jenis} />
      {ringkas ? (
        angkaRingkas ? <span className="shrink-0 text-sm font-semibold tabular-nums">{angkaRingkas}</span> : null
      ) : (
        <>
          <span className="min-w-0 flex-1 text-left">
            <span className={cn("block text-sm font-medium leading-5", bungkus ? "break-words" : "truncate")}>
              {teks.judul}
            </span>
            {teks.keterangan ? (
              <span className={cn("block text-xs leading-4 opacity-75", bungkus ? "break-words" : "truncate")}>
                {teks.keterangan}
              </span>
            ) : null}
          </span>
          {typeof teks.persen === "number" ? (
            <span className="shrink-0 text-xs font-semibold tabular-nums opacity-85">{teks.persen}%</span>
          ) : null}
          {utama.tambahan > 0 ? (
            <span
              className="shrink-0 rounded-full bg-background/15 px-1.5 text-[11px] font-semibold leading-5 tabular-nums"
              aria-label={t("lainnya", { count: utama.tambahan })}
            >
              +{utama.tambahan}
            </span>
          ) : null}
          {teks.tombol ? (
            <span className="shrink-0 rounded-full bg-background/15 px-2.5 text-xs font-semibold leading-6">{teks.tombol}</span>
          ) : null}
        </>
      )}
    </m.span>
  );

  return (
    <div className="flex items-start">
      <m.div
        initial={gerak ? { opacity: 0, scale: 0.86, y: -8 } : false}
        animate={{ opacity: 1, scale: 1, y: 0, ...(ukuran ? { width: ukuran.w, height: ukuran.h } : {}) }}
        exit={gerak ? { opacity: 0, scale: 0.86, y: -8 } : { opacity: 0 }}
        transition={gerak ? PEGAS : DIAM}
        onPointerDown={bukanKlikLuar}
        className={cn(
          "pointer-events-auto relative overflow-hidden rounded-[22px] bg-foreground text-background shadow-lg shadow-black/15",
          utama.jenis === "galat" && "ring-2 ring-destructive",
        )}
      >
        {/* Dengan gelembung di sampingnya, isi kapsul diberi ruang lebih sempit
            supaya teksnya terpotong rapi (…) dan gelembungnya tidak keluar layar. */}
        <div
          ref={isiRef}
          className={cn(
            "flex w-max items-center",
            kedua ? "max-w-[min(calc(100vw-4.5rem),420px)]" : "max-w-[min(92vw,420px)]",
          )}
        >
          {ringkas || bisaDiketuk(utama) ? (
            <m.button
              type="button"
              onClick={() => (ringkas ? lebarkan() : ketuk(utama))}
              aria-label={ringkas ? teks.diumumkan : undefined}
              whileTap={gerak ? { scale: 0.97 } : undefined}
              className="min-w-0 flex-1 rounded-[22px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
            >
              {baris}
            </m.button>
          ) : (
            <div className="min-w-0 flex-1">{baris}</div>
          )}
          {aksi ? (
            <button
              type="button"
              onClick={jalankanAksi}
              className="mr-2 shrink-0 rounded-full bg-background px-3 py-1 text-xs font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {aksi.label}
            </button>
          ) : null}
        </div>
        {typeof teks.persen === "number" ? (
          <span aria-hidden className="absolute inset-x-4 bottom-1 h-0.5 overflow-hidden rounded-full bg-background/20">
            <span
              className="block h-full rounded-full bg-background transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${teks.persen}%` }}
            />
          </span>
        ) : null}
      </m.div>
      {/* Gelembung tingkat berikutnya. Lebarnya ikut dianimasikan dari nol, jadi
          kapsul utama bergeser pelan ke kiri alih-alih melompat. */}
      <AnimatePresence initial={false}>
        {kedua ? (
          <m.span
            key={kedua.jenis}
            role="img"
            aria-label={teksButir(kedua, t).diumumkan}
            initial={gerak ? { opacity: 0, scale: 0.4, width: 0, marginLeft: 0 } : false}
            animate={{ opacity: 1, scale: 1, width: 44, marginLeft: 6 }}
            exit={gerak ? { opacity: 0, scale: 0.4, width: 0, marginLeft: 0 } : { opacity: 0 }}
            transition={gerak ? PEGAS : DIAM}
            className="pointer-events-none grid h-11 shrink-0 place-items-center overflow-hidden rounded-full bg-foreground text-background shadow-lg shadow-black/15"
          >
            <IkonButir jenis={kedua.jenis} className="size-4" />
          </m.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function PulauStatus() {
  const t = useTranslations("pulau");
  const router = useRouter();
  const kurangiGerak = useReducedMotion();
  const siap = useSyncExternalStore(
    langganFitur,
    () => fiturSiap,
    () => false,
  );
  const gerak = siap && !kurangiGerak;
  const keadaan = useSyncExternalStore(langgan, ambilKeadaan, ambilKeadaanServer);
  const isi = tampilan(keadaan);
  const penerjemah: PenerjemahPulau = (kunci, nilai) => t(kunci as never, nilai as never);
  const umum = isi ? teksButir(isi.utama, penerjemah).diumumkan : "";
  const galat = isi?.utama.peran === "alert";

  const ketuk = (b: ButirTampilan) => {
    if (b.diketuk) {
      b.diketuk();
    } else if (b.tautan) {
      router.push(b.tautan);
    }
    if (b.bisaDitutup) tutupButir(b);
  };

  return (
    <LazyMotion features={muatFitur} strict>
      <MotionConfig reducedMotion="user">
        <div
          data-pulau-status
          className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center px-2 print:hidden"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
        >
          <AnimatePresence>
            {isi ? <Kapsul key="pulau" isi={isi} t={penerjemah} gerak={gerak} ketuk={ketuk} /> : null}
          </AnimatePresence>
        </div>
      </MotionConfig>
      {/* Wilayah siar selalu terpasang supaya pembaca layar mengumumkan perubahannya. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {galat ? "" : umum}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true">
        {galat ? umum : ""}
      </div>
    </LazyMotion>
  );
}
