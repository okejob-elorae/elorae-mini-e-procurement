"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Building2, ChevronRight, CircleCheck, MapPin, Pin, Route, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { haversineMeters } from "@/lib/geo/haversine";
import { formatDistance } from "@/lib/pwa/nearest-stores";
import { gabungRencanaJadwal } from "@/lib/salesman/jadwal";
// Hanya TIPE dari berkas kueri — Prisma tidak boleh ikut ke bundel HP.
import type { JadwalHariIni } from "@/lib/salesman/jadwal-queries";
import { titikSah } from "@/lib/salesman/rute";
import type { TokoRencana } from "@/lib/salesman/dasbor";
import { persenTurun, type TokoMenurun } from "@/lib/salesman/toko-menurun";
import { susunRencanaPerKelas, type TokoRencanaKelas } from "@/lib/stores/kelas-toko";
import { formatIDR } from "@/lib/sales-orders/format";

/**
 * Kelas dan jarak kunjungan opsional: data lama (atau pemanggil yang belum
 * menyertakannya) tetap jalan, tokonya dinilai dengan batas hari umum.
 */
export type TokoRencanaJson = Omit<TokoRencana, "kunjunganTerakhir"> & {
  kunjunganTerakhir: string | null;
} & Partial<Pick<TokoRencanaKelas, "kelas" | "kelasOtomatis" | "jarakHari">>;

/** Toko yang dijadwalkan kantor untuk hari ini (`jadwalHariIniSales`), aman dikirim ke klien. */
export type JadwalBerandaJson = Pick<JadwalHariIni, "storeId" | "nama" | "catatan" | "lat" | "lng" | "dikunjungi">;

const TAMPIL_AWAL = 3;
/** Bawaan tetap (bukan `[]` baru tiap render) supaya `useMemo` di bawah tidak dihitung ulang terus. */
const TANPA_JADWAL: JadwalBerandaJson[] = [];
const TANPA_CATATAN: Record<string, string> = {};

/**
 * Toko yang perlu didatangi hari ini, dan KENAPA — satu kalimat per toko.
 * Urutan dan alasannya dihitung `susunRencanaDenganMenurun` (dites): tagihan,
 * lalu toko yang mulai jarang pesan, lalu kunjungan yang lewat batas hari —
 * batas hari PER TOKO sesuai kelasnya (`susunRencanaPerKelas`, dites).
 *
 * Toko yang DIJADWALKAN KANTOR untuk hari ini (`jadwal`, opsional) tampil
 * paling atas dengan tanda "Dari kantor" dan catatan kantornya; yang sudah
 * didatangi turun ke paling bawah bertanda centang (`gabungRencanaJadwal`,
 * dites). Rencana otomatis tetap di antaranya, tanpa toko yang sudah terjadwal.
 */
export function RencanaKunjungan({
  toko,
  menurun,
  batas,
  hariIni,
  posisi,
  izinLokasi,
  mintaLokasi,
  jadwal = TANPA_JADWAL,
  catatanTersemat = TANPA_CATATAN,
}: {
  toko: TokoRencanaJson[];
  menurun: TokoMenurun[];
  batas: { hari: number; diatur: boolean };
  hariIni: string;
  posisi: { lat: number; lng: number } | null;
  izinLokasi: "prompt" | "granted" | "denied" | "unknown";
  mintaLokasi: () => void;
  /** Toko terjadwal kantor hari ini; kosong/tidak dikirim = kartu seperti sebelum ada jadwal. */
  jadwal?: JadwalBerandaJson[];
  /** storeId → catatan toko tersemat (mis. "pemilik hanya ada sore"), dibaca sebelum berangkat. */
  catatanTersemat?: Record<string, string>;
}) {
  const t = useTranslations("pwa.beranda");
  const tMenurun = useTranslations("pwa.tokoMenurun");
  const tKelas = useTranslations("kelasToko.rencana");
  const tRute = useTranslations("pwa.rute");
  const tJadwal = useTranslations("pwa.jadwal");
  const [semua, setSemua] = useState(false);

  // Setiap toko dinilai dengan jarak kunjungannya sendiri (jarak kelasnya,
  // atau batas umum bila tanpa kelas) — aturannya di `susunRencanaPerKelas`.
  const baris = useMemo(
    () =>
      susunRencanaPerKelas(
        toko.map((x) => ({ ...x, kunjunganTerakhir: x.kunjunganTerakhir ? new Date(x.kunjunganTerakhir) : null })),
        menurun,
        { batasHari: batas.hari, hariIni: new Date(hariIni), posisi },
      ),
    [toko, menurun, batas.hari, hariIni, posisi],
  );
  const adaKelas = toko.some((x) => x.kelas);
  const gabung = useMemo(() => gabungRencanaJadwal(jadwal, baris), [jadwal, baris]);
  const jadwalSelesai = jadwal.filter((j) => j.dikunjungi).length;
  const jarakJadwal = (j: JadwalBerandaJson) =>
    posisi && titikSah(j.lat, j.lng) ? haversineMeters(posisi, { lat: j.lat as number, lng: j.lng as number }) : null;

  /** Kalimat alasan toko menurun, dengan angka yang bisa salesman periksa sendiri. */
  const alasanMenurun = (m: TokoMenurun) => {
    if (m.alasan === "JARANG") return tMenurun("jarang", { usual: m.jarakBiasa, days: m.hariSejakTerakhir });
    const persen = persenTurun(m);
    return persen === null ? tMenurun("nilaiTurunTanpaAngka") : tMenurun("nilaiTurun", { pct: persen });
  };
  const tampil = semua ? gabung : gabung.slice(0, TAMPIL_AWAL);

  return (
    <section id="rencana" className="beranda-kartu scroll-mt-4">
      {/* Judul dan batasnya bertumpuk: sebaris, judul panjang ini terlipat
          dua dan batasnya terjepit di HP. */}
      <div className="space-y-0.5">
        <h2 className="beranda-judul">{t("planTitle")}</h2>
        {/* Batas bawaan diberi tanda supaya tidak dikira keputusan kantor. */}
        <span className="block text-xs text-muted-foreground">
          {adaKelas
            ? batas.diatur
              ? tKelas("batasCampur", { days: batas.hari })
              : tKelas("batasCampurBawaan", { days: batas.hari })
            : batas.diatur
              ? t("planInterval", { days: batas.hari })
              : t("planIntervalDefault", { days: batas.hari })}
        </span>
      </div>

      {jadwal.length > 0 ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{tJadwal("homeSummary", { dikunjungi: jadwalSelesai, count: jadwal.length })}</span>
          <Link href="/pwa/jadwal" className="font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4">
            {tJadwal("homeLink")}
          </Link>
        </p>
      ) : null}

      {izinLokasi === "prompt" && gabung.length > 1 ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {t("planNeedsLocation")}
          </span>
          <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={mintaLokasi}>
            {t("planEnableLocation")}
          </Button>
        </div>
      ) : null}

      {toko.length === 0 && jadwal.length === 0 ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t("planNoHistory")}</p>
          <Button asChild size="sm">
            <Link href="/pwa/stores">{t("shortcutStores")}</Link>
          </Button>
        </div>
      ) : gabung.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          {t("planEmpty")}
        </p>
      ) : (
        <ul className="-mx-1.5 mt-1.5">
          {tampil.map((g) => {
            const b = g.rencana;
            const j = g.jenis === "jadwal" ? g.jadwal : null;
            const storeId = g.jenis === "jadwal" ? g.jadwal.storeId : g.rencana.storeId;
            const nama = g.jenis === "jadwal" ? g.jadwal.nama : g.rencana.nama;
            const jarak = b ? b.jarakMeter : j ? jarakJadwal(j) : null;
            return (
              <li key={`${g.jenis}:${storeId}`}>
                <Link
                  href={`/pwa/stores/${storeId}`}
                  className="flex min-h-14 items-center gap-3 rounded-lg px-1.5 py-2 transition-colors hover:bg-background/60"
                >
                  <span
                    className={
                      j?.dikunjungi
                        ? "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white dark:bg-emerald-500"
                        : "grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                    }
                  >
                    {j?.dikunjungi ? (
                      <CircleCheck className="h-4 w-4" aria-hidden />
                    ) : j ? (
                      <Building2 className="h-4 w-4" aria-hidden />
                    ) : (
                      <Store className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{nama}</span>
                    {catatanTersemat[storeId] ? (
                      <span className="flex items-start gap-1 text-xs leading-snug text-amber-800 dark:text-amber-300">
                        <Pin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                        <span className="min-w-0">{catatanTersemat[storeId]}</span>
                      </span>
                    ) : null}
                    {j?.catatan ? (
                      <span className="block text-xs leading-snug text-foreground">
                        <span className="font-medium">{tJadwal("officeNote")}</span> {j.catatan}
                      </span>
                    ) : null}
                    <span className="flex flex-wrap gap-x-2 text-xs">
                      {j ? (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {tJadwal("fromOffice")}
                        </Badge>
                      ) : null}
                      {j?.dikunjungi ? (
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">{tJadwal("status.DIKUNJUNGI")}</span>
                      ) : null}
                      {b && b.alasan.includes("tagih") ? (
                        <span className="font-medium text-destructive">
                          {t("planReasonTagih", { amount: formatIDR(b.sisaTagihan) })}
                        </span>
                      ) : null}
                      {b?.menurun ? (
                        <span className="font-medium text-amber-800 dark:text-amber-300">{alasanMenurun(b.menurun)}</span>
                      ) : null}
                      {b && b.alasan.includes("lama") ? (
                        <span className="text-muted-foreground">
                          {b.hariSejak === null ? t("planReasonNever") : t("planReasonDays", { days: b.hariSejak })}
                        </span>
                      ) : null}
                      {b?.kelas ? (
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
                          {tKelas(b.kelasOtomatis ? "lencanaOtomatis" : "lencana", { kelas: b.kelas, days: b.jarakHari })}
                        </Badge>
                      ) : null}
                    </span>
                  </span>
                  {jarak !== null ? (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDistance(jarak)}</span>
                  ) : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {gabung.length > TAMPIL_AWAL ? (
        <Button
          type="button"
          variant="link"
          onClick={() => setSemua((x) => !x)}
          className="mt-1 h-auto min-h-11 px-0 text-sm font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4"
        >
          {semua ? t("planShowLess") : t("planShowAll", { count: gabung.length })}
        </Button>
      ) : null}

      {/* Rute hari ini: urutan terdekat melalui toko di atas, plus toko yang ditambah sendiri. */}
      {toko.length > 0 || jadwal.length > 0 ? (
        <Button asChild variant="outline" size="sm" className="mt-2 w-full">
          <Link href="/pwa/rute">
            <Route className="h-4 w-4" aria-hidden />
            {tRute("homeLink")}
          </Link>
        </Button>
      ) : null}
    </section>
  );
}
