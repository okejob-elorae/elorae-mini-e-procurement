"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { BadgeCheck, BellRing, ChevronRight, Heart, MessageCircle, Moon, Pencil, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { formatIDR } from "@/lib/sales-orders/format";
import type { RincianPelangganHp } from "@/lib/spg/pelanggan-queries";
import { cn } from "@/lib/utils";
import { nadaKelompokTitip } from "../../titip/tampilan";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
import { TombolDaftarMember } from "./TombolDaftarMember";

/** Satu baris "label ...... nilai" di kartu; nilai tidak pernah dipotong. */
function BarisInfo({ label, nilai }: { label: string; nilai: string }) {
  return (
    <p className="flex justify-between gap-3">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className="shrink-0 text-right tabular-nums">{nilai}</span>
    </p>
  );
}

/**
 * Satu pelanggan toko: nomor (ketuk → WhatsApp), status belanjanya, member
 * Elorae (tingkat, belanja periode, tingkat berikutnya — atau tombol mendaftar),
 * barang favorit, catatan, persetujuan, titip pesan, dan riwayat belanjanya DI
 * TOKO INI. Total nota = sesudah potongan dan sesudah barang yang dikembalikan
 * pembeli.
 */
export function RincianPelangganClient({ rincian }: { rincian: RincianPelangganHp | null }) {
  const t = useTranslations("spgPelanggan");
  const tm = useTranslations("spgPelanggan.hpMember");
  const tmd = dinamis(tm);
  const tt = useTranslations("spgTitip");
  const ttd = dinamis(tt);
  const bahasa = useLocale() === "en" ? "en" : "id";

  const kembali = (
    <Button variant="ghost" size="sm" asChild className="-ml-2">
      <TautanKembali cadangan="/pwa/spg/pelanggan" />
    </Button>
  );

  if (!rincian) {
    return (
      <div className="space-y-4 p-4">
        {kembali}
        <section className="beranda-kartu space-y-3">
          <h1 className="text-lg font-semibold leading-tight">{t("rincian.tidakAdaJudul")}</h1>
          <p className="text-sm text-muted-foreground">{t("rincian.tidakAdaIsi")}</p>
          <Button asChild className="w-full">
            <Link href="/pwa/spg/pelanggan">{t("rincian.keDaftar")}</Link>
          </Button>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {kembali}
      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="min-w-0 break-words text-2xl font-bold">{rincian.nama}</h1>
          <TombolBantuanHp judul={rincian.nama} />
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">{rincian.hp}</p>
        <p className="flex flex-wrap items-center gap-1.5 pt-1 text-sm">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              rincian.status === "TIDUR" ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground",
            )}
          >
            {rincian.status === "TIDUR" ? <Moon className="h-3 w-3" aria-hidden /> : null}
            {tmd(`status.${rincian.status}`)}
          </span>
          {rincian.hariSejakBelanja !== null ? (
            <span className="text-xs text-muted-foreground">{tm("terakhirBelanja", { hari: rincian.hariSejakBelanja })}</span>
          ) : null}
        </p>
        {rincian.status === "TIDUR" ? (
          <p className="text-xs text-muted-foreground">
            {rincian.tautanWa ? tm("tidurSapa", { hari: rincian.hariTidur }) : tm("tidurTanpaWa", { hari: rincian.hariTidur })}
          </p>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-2">
        {rincian.tautanWa ? (
          <Button asChild className="h-auto min-h-12 whitespace-normal py-2">
            <a href={rincian.tautanWa} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
              {t("rincian.wa")}
            </a>
          </Button>
        ) : (
          <p className="rounded-lg bg-muted p-2 text-xs text-muted-foreground">{t("rincian.waTidakSah")}</p>
        )}
        <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal py-2">
          <Link href={`/pwa/spg/pelanggan/${rincian.id}/ubah`}>
            <Pencil className="h-4 w-4 shrink-0" aria-hidden />
            {t("rincian.ubah")}
          </Link>
        </Button>
      </div>

      <section className="beranda-kartu space-y-3" aria-labelledby="pelanggan-member">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <BadgeCheck className="h-4 w-4" aria-hidden />
          </span>
          <h2 id="pelanggan-member" className="beranda-judul">
            {tm("judul")}
          </h2>
        </div>
        {rincian.member?.aktif ? (
          <div className="space-y-2 text-sm">
            <p className="text-2xl font-bold leading-tight">{rincian.member.tingkat}</p>
            <BarisInfo
              label={tm("diskonLabel")}
              nilai={
                rincian.member.diskonPersen > 0
                  ? tm("diskonPersen", { persen: rincian.member.diskonPersen })
                  : rincian.member.diskonDinyalakan
                    ? tm("diskonNol")
                    : tm("diskonMati")
              }
            />
            <BarisInfo label={tm("belanjaPeriode", { bulan: rincian.member.periodeBulan })} nilai={formatIDR(rincian.member.belanjaPeriode)} />
            {rincian.member.berikut ? (
              <BarisInfo label={tm("naikKe", { tingkat: rincian.member.berikut.nama })} nilai={tm("kurang", { amount: formatIDR(rincian.member.berikut.kurang) })} />
            ) : (
              <p className="text-muted-foreground">{tm("tertinggi")}</p>
            )}
            <BarisInfo label={tm("sejak")} nilai={rincian.member.sejak[bahasa]} />
            <p className="text-xs text-muted-foreground">{tm("semuaToko")}</p>
          </div>
        ) : rincian.member ? (
          <p className="text-sm text-muted-foreground">{tm("nonaktif")}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{tm("belumMember")}</p>
            <TombolDaftarMember customerId={rincian.id} nama={rincian.nama} daftar={rincian.daftarMember} />
          </div>
        )}
      </section>

      {rincian.favorit.length > 0 ? (
        <section className="beranda-kartu space-y-2" aria-labelledby="pelanggan-favorit">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <h2 id="pelanggan-favorit" className="beranda-judul">
              {tm("favoritJudul")}
            </h2>
          </div>
          <ol className="space-y-1.5 text-sm">
            {rincian.favorit.map((b) => (
              <li key={b.itemId} className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1 break-words">{b.nama}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{tm("favoritPcs", { qty: b.qty })}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="beranda-kartu space-y-2 text-sm">
        {rincian.catatan ? (
          <div className="space-y-0.5">
            <p className="text-muted-foreground">{t("rincian.catatan")}</p>
            <p className="whitespace-pre-line break-words">{rincian.catatan}</p>
          </div>
        ) : null}
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">{t("rincian.setujuPada")}</span>
          <span className="text-right">{rincian.setujuPada[bahasa]}</span>
        </p>
        <p className="flex justify-between gap-3">
          <span className="text-muted-foreground">{t("rincian.dicatatPada")}</span>
          <span className="text-right">{rincian.dicatatPada[bahasa]}</span>
        </p>
      </section>

      <section className="space-y-2" aria-labelledby="pelanggan-titip">
        <div className="flex items-center justify-between gap-2 px-1">
          <h2 id="pelanggan-titip" className="beranda-judul">
            {t("rincian.titipJudul")}
          </h2>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link href={`/pwa/spg/titip/baru?pelanggan=${rincian.id}`}>
            <BellRing className="h-4 w-4" aria-hidden />
            {t("rincian.titipBaru")}
          </Link>
        </Button>
        {rincian.titip.length === 0 ? (
          <p className="beranda-kartu text-sm text-muted-foreground">{t("rincian.titipKosong")}</p>
        ) : (
          <div className="beranda-kartu beranda-kartu-daftar">
            <ul className="divide-y">
              {rincian.titip.map((r) => (
                <li key={r.id}>
                  <Link href={`/pwa/spg/titip/${r.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block break-words font-medium leading-tight">{r.keterangan}</span>
                      <span className="block text-xs text-muted-foreground">{tt("qtyTanggal", { qty: r.qty, tanggal: r.dibuat[bahasa] })}</span>
                      <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", nadaKelompokTitip(r.kelompok, r.status))}>
                        {r.kelompok === "tutup" ? ttd(`status.${r.status}`) : ttd(`kelompok.${r.kelompok}`)}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-2" aria-labelledby="pelanggan-riwayat">
        <h2 id="pelanggan-riwayat" className="beranda-judul px-1">
          {t("rincian.riwayatJudul")}
        </h2>
        {rincian.jumlahNota > 0 ? (
          <div className="beranda-kartu space-y-1">
            <p className="text-sm text-muted-foreground">{t("rincian.totalBelanja", { n: rincian.jumlahNota })}</p>
            <p className="text-2xl font-bold tabular-nums">{formatIDR(rincian.totalBelanja)}</p>
          </div>
        ) : null}
        {rincian.riwayat.length === 0 ? (
          <p className="beranda-kartu text-sm text-muted-foreground">{t("rincian.riwayatKosong")}</p>
        ) : (
          <div className="beranda-kartu beranda-kartu-daftar">
            <ul className="divide-y">
              {rincian.riwayat.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Receipt className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="break-all text-sm font-medium leading-tight">{n.docNo}</p>
                    <p className="text-xs text-muted-foreground">{n.waktu[bahasa]}</p>
                    <ul className="space-y-0.5 text-sm">
                      {n.barang.map((b, i) => (
                        <li key={i} className="break-words">
                          {t("rincian.barisBarang", { nama: b.nama, qty: b.qty })}
                          {b.kembali > 0 ? <span className="text-muted-foreground"> · {t("rincian.dikembalikan", { qty: b.kembali })}</span> : null}
                        </li>
                      ))}
                    </ul>
                    <p className="font-semibold tabular-nums">{formatIDR(n.totalBersih)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
