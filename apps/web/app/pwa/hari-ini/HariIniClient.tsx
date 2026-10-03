"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Building2,
  CalendarCheck,
  CalendarRange,
  ChevronRight,
  CircleCheck,
  Clock,
  MapPin,
  Store,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/sales-orders/format";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
import type { AlasanRencana, KodeJanggal, MetrikLapangan } from "@/lib/salesman/metrik-lapangan";
import type { KodeRingkasan } from "@/lib/salesman/hasil-kunjungan";
import type { StatusJadwal } from "@/lib/salesman/jadwal";

import { TautanKembali } from "@/app/pwa/TautanKembali";
export type DataHariIni = {
  tanggal: string;
  hariIni: boolean;
  /** Sudah diformat di server. */
  tanggalPanjang: string;
  pilihan: { kunci: string; hariPendek: string; tanggalAngka: string; hariIni: boolean; href: string }[];
  angka: {
    kunjungan: number;
    tokoDikunjungi: number;
    efektif: number;
    persenEfektif: number | null;
    berlangsung: number;
    janggal: number;
    rencana: { direncanakan: number; dikunjungi: number } | null;
    pesanan: MetrikLapangan["pesanan"];
    van: MetrikLapangan["van"];
    pelunasan: MetrikLapangan["pelunasan"];
    retur: number;
    tokoBaru: number;
    /** Jam sudah diformat di server. */
    lapangan: { menit: number; mulai: string | null; selesai: string | null; masihDiLapangan: boolean };
  };
  hasil: { kode: KodeRingkasan; jumlah: number }[];
  perTanda: { kode: KodeJanggal; jumlah: number }[];
  kunjungan: {
    id: string;
    storeId: string;
    toko: string;
    jamMasuk: string;
    jamKeluar: string | null;
    durasiMenit: number | null;
    kodeHasil: KodeRingkasan;
    catatan: string | null;
    efektif: boolean;
    pesanan: number;
    pesananDitolak: number;
    nilaiPutus: number;
    konsi: number;
    klaim: number;
    retur: number;
    van: number;
    tanda: KodeJanggal[];
  }[];
  belumDidatangi: { storeId: string; nama: string; alasan: AlasanRencana[] }[];
  tokoBaru: { storeId: string; nama: string }[];
  /** Jadwal dari kantor untuk hari itu; null = kantor tidak menjadwalkan apa pun. */
  jadwal: {
    dikunjungi: number;
    direncanakan: number;
    href: string;
    toko: { storeId: string; nama: string; catatan: string | null; status: StatusJadwal }[];
  } | null;
};

const NADA_JADWAL: Record<StatusJadwal, string> = {
  DIKUNJUNGI: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  TERLEWAT: "bg-destructive/10 text-destructive",
  MENUNGGU: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  IZIN: "bg-muted text-muted-foreground",
};

/** Hijau = jadi transaksi, kuning = tanpa transaksi dengan alasan, abu = tanpa keterangan. */
function nadaHasil(kode: KodeRingkasan): string {
  if (kode === "TRANSAKSI" || kode === "TRANSAKSI_TERTUNDA") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (kode === "KOSONG") return "bg-muted text-muted-foreground";
  return "bg-amber-500/15 text-amber-800 dark:text-amber-300";
}

/** Batas tampil daftar "belum didatangi" — sisanya cukup disebut jumlahnya. */
const BATAS_BELUM = 8;

export function HariIniClient({ data }: { data: DataHariIni }) {
  const t = useTranslations("pwa.hariIni");
  const td = dinamis(t);
  const tJadwal = useTranslations("pwa.jadwal");
  const tdJadwal = dinamis(tJadwal);
  const a = data.angka;

  const durasi = (menit: number) =>
    menit >= 60 ? t("durationHours", { jam: Math.floor(menit / 60), menit: menit % 60 }) : t("durationMinutes", { menit });

  const puncakHasil = Math.max(1, ...data.hasil.map((h) => h.jumlah));

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{data.hariIni ? t("titleToday") : t("titlePast")}</h1>
        <p className="text-sm text-muted-foreground">{data.tanggalPanjang}</p>
      </header>

      {/* Tanggal sebagai tautan, bukan keadaan klien: alamatnya bisa dibagikan,
          dan kabar ringkasan membuka hari ini langsung. */}
      <nav aria-label={t("dayPicker")}>
        <ul className="grid grid-cols-7 gap-1">
          {data.pilihan.map((p) => {
            const aktif = p.kunci === data.tanggal;
            return (
              <li key={p.kunci}>
                <Link
                  href={p.href}
                  replace
                  aria-current={aktif ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center rounded-lg border px-0.5 py-1 text-center transition-colors",
                    aktif ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted/60",
                  )}
                >
                  <span className={cn("text-[11px] leading-tight", !aktif && "text-muted-foreground")}>
                    {p.hariIni ? t("todayShort") : p.hariPendek}
                  </span>
                  <span className="text-base font-semibold leading-tight tabular-nums">{p.tanggalAngka}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Kunjungan */}
      <section className="beranda-kartu space-y-3">
        <h2 className="beranda-judul">{t("visitsTitle")}</h2>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">{a.kunjungan}</span>
          <span className="text-sm text-muted-foreground">
            {t("visitsCount", { count: a.kunjungan, toko: a.tokoDikunjungi })}
          </span>
        </div>
        {a.kunjungan > 0 ? (
          <ul className="space-y-2 text-sm">
            <li className="flex items-start gap-2">
              <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                {t("effective", { efektif: a.efektif, kunjungan: a.kunjungan, persen: a.persenEfektif ?? 0 })}
                <span className="block text-xs text-muted-foreground">{t("effectiveHint")}</span>
              </span>
            </li>
            {a.lapangan.mulai ? (
              <li className="flex items-start gap-2">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span>
                  {a.lapangan.masihDiLapangan
                    ? t("fieldTimeOngoing", { mulai: a.lapangan.mulai, durasi: durasi(a.lapangan.menit) })
                    : t("fieldTime", {
                        mulai: a.lapangan.mulai,
                        selesai: a.lapangan.selesai ?? a.lapangan.mulai,
                        durasi: durasi(a.lapangan.menit),
                      })}
                </span>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{data.hariIni ? t("noVisitsToday") : t("noVisitsPast")}</p>
        )}
        {a.rencana && a.rencana.direncanakan > 0 ? (
          <p className="flex items-start gap-2 text-sm">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              {t("plan", { dikunjungi: a.rencana.dikunjungi, direncanakan: a.rencana.direncanakan })}
              <span className="block text-xs text-muted-foreground">
                {data.hariIni ? t("planHintToday") : t("planHintPast")}
              </span>
            </span>
          </p>
        ) : null}
        {data.jadwal ? (
          <p className="flex items-start gap-2 text-sm">
            <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span>
              {t("schedule", { dikunjungi: data.jadwal.dikunjungi, direncanakan: data.jadwal.direncanakan })}
              <span className="block text-xs text-muted-foreground">{t("scheduleHint")}</span>
            </span>
          </p>
        ) : null}
        {a.berlangsung > 0 ? (
          <p className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-800 dark:text-amber-300">
            {t("stillOpen", { count: a.berlangsung })}
          </p>
        ) : null}
        {a.kunjungan === 0 && data.hariIni ? (
          <Button asChild variant="outline" className="w-full">
            <Link href="/pwa/stores">{t("goToStores")}</Link>
          </Button>
        ) : null}
      </section>

      {/* Pesanan & uang */}
      <section className="beranda-kartu space-y-3">
        <h2 className="beranda-judul">{t("salesTitle")}</h2>
        <dl className="divide-y text-sm">
          <Baris
            label={t("ordersLabel", { count: a.pesanan.jumlah })}
            nilai={a.pesanan.nilaiPutus > 0 ? formatIDR(a.pesanan.nilaiPutus) : null}
            catatan={
              a.pesanan.jumlah > 0
                ? t("ordersDetail", { putus: a.pesanan.putus, konsi: a.pesanan.konsi })
                : null
            }
          />
          {a.pesanan.ditolak > 0 ? <Baris label={t("ordersRejected", { count: a.pesanan.ditolak })} nilai={null} /> : null}
          {a.pesanan.jarakJauh > 0 ? <Baris label={t("ordersRemote", { count: a.pesanan.jarakJauh })} nilai={null} /> : null}
          <Baris
            label={t("claimsReported", { count: a.pelunasan.dilaporkan })}
            nilai={a.pelunasan.dilaporkan > 0 ? formatIDR(a.pelunasan.nilaiDilaporkan) : null}
          />
          <Baris
            label={t("claimsVerified", { count: a.pelunasan.terverifikasi })}
            nilai={a.pelunasan.terverifikasi > 0 ? formatIDR(a.pelunasan.nilaiTerverifikasi) : null}
            catatan={t("claimsVerifiedHint")}
          />
          {a.van.jumlah > 0 ? <Baris label={t("vanSales", { count: a.van.jumlah })} nilai={formatIDR(a.van.nilai)} /> : null}
          {a.retur > 0 ? <Baris label={t("returns", { count: a.retur })} nilai={null} /> : null}
          {a.tokoBaru > 0 ? (
            <Baris
              label={t("newStores", { count: a.tokoBaru })}
              nilai={null}
              catatan={data.tokoBaru.map((x) => x.nama).join(", ")}
            />
          ) : null}
        </dl>
      </section>

      {/* Hasil kunjungan */}
      {data.hasil.length > 0 ? (
        <section className="beranda-kartu space-y-3">
          <h2 className="beranda-judul">{t("outcomesTitle")}</h2>
          <ul className="space-y-2">
            {data.hasil.map((h) => (
              <li key={h.kode} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{td(`outcome.${h.kode}`)}</span>
                  <span className="tabular-nums text-muted-foreground">{h.jumlah}</span>
                </div>
                {/* Batang perbandingan: yang dicari mata adalah alasan yang menonjol. */}
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "beranda-tumbuh h-full rounded-full",
                      h.kode === "TRANSAKSI" || h.kode === "TRANSAKSI_TERTUNDA" ? "bg-emerald-500" : "bg-primary",
                    )}
                    style={{ width: `${Math.max(4, (h.jumlah / puncakHasil) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Check-in janggal — sales melihat tandanya sendiri, sama dengan yang dilihat kantor. */}
      {a.janggal > 0 ? (
        <section className="beranda-kartu space-y-2">
          <h2 className="beranda-judul flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
            {t("flagsTitle", { count: a.janggal })}
          </h2>
          <p className="text-xs text-muted-foreground">{t("flagsHint")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {data.perTanda.map((x) => (
              <li key={x.kode}>
                <Badge variant="outline" className="border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300">
                  {td(`flag.${x.kode}`)} · {x.jumlah}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Daftar kunjungan */}
      {data.kunjungan.length > 0 ? (
        <section className="beranda-kartu beranda-kartu-daftar">
          <h2 className="beranda-judul px-4 pb-1 pt-3">{t("listTitle")}</h2>
          <ul className="divide-y">
            {data.kunjungan.map((k) => (
              <li key={k.id}>
                <Link
                  href={`/pwa/stores/${k.storeId}`}
                  className="flex min-h-14 items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Store className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate font-medium leading-tight">{k.toko}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {k.jamKeluar
                        ? t("visitTime", {
                            masuk: k.jamMasuk,
                            keluar: k.jamKeluar,
                            durasi: durasi(k.durasiMenit ?? 0),
                          })
                        : t("visitTimeOpen", { masuk: k.jamMasuk })}
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant="outline" className={cn("border-transparent", nadaHasil(k.kodeHasil))}>
                        {td(`outcome.${k.kodeHasil}`)}
                      </Badge>
                      {k.pesanan > 0 ? (
                        <Badge variant="outline">
                          {k.nilaiPutus > 0
                            ? t("chipOrdersValue", { count: k.pesanan, nilai: formatIDR(k.nilaiPutus) })
                            : t("chipOrders", { count: k.pesanan })}
                        </Badge>
                      ) : null}
                      {k.pesananDitolak > 0 ? <Badge variant="outline">{t("chipRejected", { count: k.pesananDitolak })}</Badge> : null}
                      {k.klaim > 0 ? <Badge variant="outline">{t("chipClaims", { count: k.klaim })}</Badge> : null}
                      {k.retur > 0 ? <Badge variant="outline">{t("chipReturns", { count: k.retur })}</Badge> : null}
                      {k.van > 0 ? <Badge variant="outline">{t("chipVan", { count: k.van })}</Badge> : null}
                      {k.tanda.map((x) => (
                        <Badge
                          key={x}
                          variant="outline"
                          className="border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300"
                        >
                          {td(`flag.${x}`)}
                        </Badge>
                      ))}
                    </span>
                    {k.catatan ? <span className="block text-xs leading-snug text-muted-foreground">{k.catatan}</span> : null}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Jadwal dari kantor hari itu, belum didatangi dulu. */}
      {data.jadwal ? (
        <section className="beranda-kartu beranda-kartu-daftar">
          <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-3">
            <h2 className="beranda-judul">{t("scheduleTitle", { count: data.jadwal.direncanakan })}</h2>
            <Link
              href={data.jadwal.href}
              className="text-xs font-medium underline decoration-primary decoration-2 underline-offset-4"
            >
              {t("scheduleOpen")}
            </Link>
          </div>
          <ul className="divide-y">
            {data.jadwal.toko.map((s) => (
              <li key={s.storeId}>
                <Link
                  href={`/pwa/stores/${s.storeId}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60"
                >
                  <span
                    className={cn(
                      "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                      s.status === "DIKUNJUNGI"
                        ? "bg-emerald-600 text-white dark:bg-emerald-500"
                        : "bg-primary text-primary-foreground",
                    )}
                  >
                    {s.status === "DIKUNJUNGI" ? (
                      <CircleCheck className="h-4 w-4" aria-hidden />
                    ) : (
                      <Building2 className="h-4 w-4" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate font-medium leading-tight">{s.nama}</span>
                    {s.catatan ? <span className="block text-xs leading-snug text-muted-foreground">{s.catatan}</span> : null}
                    <Badge variant="outline" className={cn("border-transparent", NADA_JADWAL[s.status])}>
                      {tdJadwal(`status.${s.status}`)}
                    </Badge>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Rencana yang belum didatangi */}
      {data.belumDidatangi.length > 0 ? (
        <section className="beranda-kartu beranda-kartu-daftar">
          <h2 className="beranda-judul px-4 pb-1 pt-3">{t("notVisitedTitle", { count: data.belumDidatangi.length })}</h2>
          <ul className="divide-y">
            {data.belumDidatangi.slice(0, BATAS_BELUM).map((s) => (
              <li key={s.storeId}>
                <Link
                  href={`/pwa/stores/${s.storeId}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <MapPin className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium leading-tight">{s.nama}</span>
                    <span className="block text-xs text-muted-foreground">
                      {s.alasan.map((x) => td(`reason.${x}`)).join(" · ")}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          {data.belumDidatangi.length > BATAS_BELUM ? (
            <p className="px-4 pb-3 pt-1 text-xs text-muted-foreground">
              {t("notVisitedMore", { count: data.belumDidatangi.length - BATAS_BELUM })}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Baris({ label, nilai, catatan }: { label: string; nilai: string | null; catatan?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <dt className="min-w-0">
        <span className="block">{label}</span>
        {catatan ? <span className="block text-xs text-muted-foreground">{catatan}</span> : null}
      </dt>
      <dd className="shrink-0 font-semibold tabular-nums">{nilai ?? ""}</dd>
    </div>
  );
}
