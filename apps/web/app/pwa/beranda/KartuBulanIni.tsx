"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { AngkaNaik } from "@/components/dashboard/AngkaNaik";
import { bandingkanPeriode, kalimatBanding } from "@/lib/dashboard/tren";
import { formatIDR } from "@/lib/sales-orders/format";
import type { Kemajuan } from "@/lib/salesman/dasbor";
import type { JumlahHp, TitikTrenHp } from "@/lib/salesman/penjualan-hp";

/**
 * Penjualan bulan ini, kemajuannya ke target, dan arah 30 hari terakhir.
 *
 * Putus, konsinyasi, dan van ditampilkan TERPISAH atas permintaan pemilik:
 * salesman harus tahu mana omzet yang sudah pasti (putus, van) dan mana barang
 * titipan yang belum tentu laku (konsi). Aturan mutlak: rupiah konsinyasi tidak
 * pernah sampai ke HP — jadi rupiah di kartu ini (total, capaian target, grafik)
 * hanya putus + van, dan konsinyasi tampil sebagai pcs. Kantor tetap menghitung
 * konsinyasi ke target; kalimat di bawah capaian mengatakannya.
 *
 * Grafik 30 hari dulu kartu sendiri di dasar beranda — di luar layar pertama,
 * jadi jarang terlihat. Di sini ia garis kecil di bawah angka yang sama-sama
 * menjawab "sejauh apa penjualan saya", dan beranda jadi satu kartu lebih pendek.
 */

// Nada dari warna tulisan-di-atas-tema: di kartu limau, warna data
// (hijau, biru, kuning) saling bertabrakan dengan latarnya.
const nada = (persen: number) => `color-mix(in oklab, var(--primary-foreground) ${persen}%, transparent)`;
const KANAL = [
  { kunci: "putus", label: "channelPutus", warna: nada(90) },
  { kunci: "van", label: "channelVan", warna: nada(40) },
] as const;

const langgananGerak = (cb: () => void) => {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function KartuBulanIni({
  bulanIni,
  kemajuan,
  tren,
  adaTargetRinci = false,
}: {
  bulanIni: JumlahHp;
  kemajuan: Kemajuan | null;
  tren: TitikTrenHp[];
  /** Kantor mengatur target per kategori/barang bulan ini → tautan ke rinciannya. */
  adaTargetRinci?: boolean;
}) {
  const t = useTranslations("pwa.beranda");
  const tRiwayat = useTranslations("pwaPenjualan");
  const locale = useLocale();
  const lebar = kemajuan ? Math.min(100, kemajuan.persen) : 0;
  // Van tetap dihitung ke omzet (dan karena itu ke target total), tapi hampir
  // tidak pernah jalan — kolom "Van Rp 0" setiap bulan hanya mengisi tempat.
  const kanal = KANAL.filter((k) => k.kunci !== "van" || bulanIni.van > 0);
  const kurangiGerak = useSyncExternalStore(
    langgananGerak,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );

  // bandingkanPeriode bekerja pada dua kanal; di sini semua (putus + van) di satu.
  const dilipat = useMemo(() => tren.map((x) => ({ tanggal: x.tanggal, marketplace: 0, lapangan: x.nilai })), [tren]);
  const banding = bandingkanPeriode(dilipat, 30);
  // "Rp 0 · ▼ 100%" tidak menyebut dari berapa turunnya — kalimatnya dari
  // `kalimatBanding`, sama dengan kartu tren dasbor kantor.
  const kalimat = kalimatBanding(banding);
  const garis = dilipat.slice(-30);
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 0 });
  const labelTanggal = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return (
    <section className="beranda-kartu beranda-kartu-utama">
      <h2 className="beranda-judul">{t("targetTitle")}</h2>
      <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
        <AngkaNaik nilai={bulanIni.total} format={formatIDR} />
      </p>
      <p className="text-xs opacity-80">{t("totalPutusVan")}</p>

      {kemajuan ? (
        <>
          <p className="text-xs tabular-nums opacity-80">
            {t("targetOf", { target: formatIDR(kemajuan.target), pct: kemajuan.persen })}
          </p>
          <div
            className="mt-2 h-2.5 overflow-hidden rounded-full"
            style={{ background: nada(15) }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={lebar}
            aria-label={t("targetTitle")}
          >
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${lebar}%`, background: "var(--primary-foreground)" }} />
          </div>
          <p className="mt-1.5 text-xs font-medium tabular-nums">
            {kemajuan.tercapai
              ? t("targetReached")
              : t("targetPerDay", { amount: formatIDR(kemajuan.perHari ?? 0), days: kemajuan.sisaHari })}
          </p>
          {/* Jujur soal dasar persennya: konsi ikut target di kantor, tapi tidak dihitung di sini. */}
          {bulanIni.pcsKonsi > 0 ? <p className="mt-1 text-[11px] opacity-80">{t("targetKonsiNote")}</p> : null}
        </>
      ) : (
        // Salesman tidak bisa mengatur targetnya sendiri — kalimatnya menyebut
        // siapa yang bisa, supaya ia tahu harus bertanya ke mana.
        <p className="text-xs opacity-80">{t("targetNotSet")}</p>
      )}

      {adaTargetRinci ? (
        <Link href="/pwa/target" className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-medium underline-offset-4 hover:underline">
          {t("targetRinci")}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : null}

      {/* Rincian per kanal: batang bagian (rupiah putus + van) + angka masing-masing; konsi dalam pcs. */}
      {bulanIni.total > 0 && kanal.length > 1 ? (
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full" style={{ background: nada(15) }} aria-hidden>
          {kanal.filter((k) => bulanIni[k.kunci] > 0).map((k) => (
            <span key={k.kunci} style={{ width: `${(bulanIni[k.kunci] / bulanIni.total) * 100}%`, background: k.warna }} />
          ))}
        </div>
      ) : null}
      <dl className={kanal.length === 2 ? "mt-2 grid grid-cols-3 gap-2" : "mt-2 grid grid-cols-2 gap-2"}>
        {kanal.map((k) => (
          <div key={k.kunci} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[11px] opacity-80">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ background: k.warna }} />
              {t(k.label)}
            </dt>
            <dd className="truncate text-sm font-semibold tabular-nums">{formatIDR(bulanIni[k.kunci])}</dd>
          </div>
        ))}
        {/* Konsinyasi: pcs saja, tidak masuk batang rupiah di atas. */}
        <div className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[11px] opacity-80">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm border" style={{ borderColor: nada(55) }} />
            {t("channelKonsi")}
          </dt>
          <dd className="truncate text-sm font-semibold tabular-nums">{t("konsiPcs", { n: angka.format(bulanIni.pcsKonsi) })}</dd>
        </div>
      </dl>

      {/* Arah 30 hari terakhir. */}
      <div className="mt-3 border-t pt-2.5" style={{ borderColor: nada(18) }}>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="opacity-80">{t("trendTitlePutusVan")}</span>
          <span className="font-medium tabular-nums">
            {formatIDR(banding.sekarang)}
            {kalimat.jenis === "persen" && banding.sekarang > 0
              ? ` · ${kalimat.arah === "naik" ? "▲" : kalimat.arah === "turun" ? "▼" : "="} ${kalimat.persen}%`
              : ""}
          </span>
        </div>
        {banding.sekarang > 0 ? (
          <div className="mt-1 h-12" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={garis} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="tren-bulan" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary-foreground)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--primary-foreground)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Tooltip
                  cursor={{ stroke: nada(30) }}
                  content={({ active, payload }) =>
                    active && payload?.length ? (
                      <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                        <p className="font-medium">
                          {labelTanggal.format(new Date(`${String(payload[0].payload.tanggal)}T00:00:00Z`))}
                        </p>
                        <p className="tabular-nums">{formatIDR(Number(payload[0].value ?? 0))}</p>
                      </div>
                    ) : null
                  }
                />
                <Area
                  type="monotone"
                  dataKey="lapangan"
                  stroke="var(--primary-foreground)"
                  strokeWidth={1.75}
                  fill="url(#tren-bulan)"
                  isAnimationActive={!kurangiGerak}
                  animationDuration={900}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-1 text-xs opacity-80">
            {kalimat.jenis === "persen"
              ? t("trendEmptyDari", { amount: formatIDR(kalimat.sebelumnya) })
              : t("trendEmpty")}
          </p>
        )}
      </div>

      {/* Bulan-bulan sebelumnya, toko dan barang teratas: halaman riwayat. */}
      <Link href="/pwa/penjualan" className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-medium underline-offset-4 hover:underline">
        {tRiwayat("homeLink")}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  );
}
