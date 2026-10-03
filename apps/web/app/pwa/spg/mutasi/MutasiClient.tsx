"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, ChevronRight, Plus, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import { ikatanKunjungan } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import type { MutasiHp } from "@/lib/spg/mutasi-queries";
import { cn } from "@/lib/utils";
import { KartuAjuanDiHp, useMutasiDiHp } from "./MutasiDiHp";
import { nadaStatusMutasi } from "./tampilan";

export type TabMutasi = "keluar" | "masuk" | "jalan";

/**
 * Daftar mutasi toko SPG dalam tiga tab. Tab berpindah dengan `replace`,
 * supaya "Kembali" tidak berjalan mundur melewati setiap tab yang dibuka.
 *
 * Di atasnya, mutasi yang masih di HP (diajukan tanpa sinyal) — daftar dari
 * server belum memuatnya — dan tanda "sudah dikirim" yang masih di HP
 * ditunjukkan pada barisnya. Halaman dimuat ulang begitu antreannya sampai.
 */
export function MutasiClient({
  storeId,
  kunjunganServer,
  namaToko,
  tab,
  data,
  bolehAjukan,
}: {
  /** Toko tetap SPG — dari server. */
  storeId: string;
  /** Kunjungan berjalan di toko ini menurut server (halaman bisa dari cache). */
  kunjunganServer: { id: string; checkinAtMs: number } | null;
  namaToko: string;
  tab: TabMutasi;
  data: { keluar: MutasiHp[]; masuk: MutasiHp[]; diJalan: MutasiHp[] };
  bolehAjukan: boolean;
}) {
  const t = useTranslations("spgMutasi");
  const td = dinamis(t);
  const router = useRouter();
  const { data: diHp } = useMutasiDiHp(storeId, { segarkan: true });
  const { kunjungan: lokal } = useKunjunganLokal(storeId);
  const ikatan = ikatanKunjungan(kunjunganServer, lokal);
  // Tanda dikirim yang masih di HP, per mutasi server.
  const kirimDiHp = new Map(diHp.kirim.filter((k) => k.transferId).map((k) => [k.transferId as string, k]));

  const daftar = tab === "keluar" ? data.keluar : tab === "masuk" ? data.masuk : data.diJalan;
  const tabs: { kunci: TabMutasi; jumlah: number }[] = [
    { kunci: "keluar", jumlah: data.keluar.length },
    { kunci: "masuk", jumlah: data.masuk.length },
    { kunci: "jalan", jumlah: data.diJalan.length },
  ];

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <h1 className="text-2xl font-bold">{t("judul")}</h1>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      {bolehAjukan ? (
        <Button asChild className="w-full" size="lg">
          <Link href="/pwa/spg/mutasi/kirim">
            <Plus className="h-4 w-4" aria-hidden />
            {t("ajukanBaru")}
          </Link>
        </Button>
      ) : (
        <p className="beranda-kartu text-sm text-muted-foreground">{t("nonaktif")}</p>
      )}

      {diHp.ajuan.length > 0 ? (
        <section className="space-y-2" aria-labelledby="judul-mutasi-di-hp">
          <h2 id="judul-mutasi-di-hp" className="beranda-judul px-1">
            {t("luring.diHpJudul", { count: diHp.ajuan.length })}
          </h2>
          <ul className="space-y-2">
            {diHp.ajuan.map((a) => (
              <li key={a.localId}>
                <KartuAjuanDiHp ajuan={a} kirim={diHp.kirim.find((k) => k.ajuanLocalId === a.localId) ?? null} ikatan={ikatan} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label={t("judul")}>
        {tabs.map((x) => (
          <Button
            key={x.kunci}
            type="button"
            role="tab"
            aria-selected={tab === x.kunci}
            variant={tab === x.kunci ? "default" : "outline"}
            className="h-auto flex-col gap-0 whitespace-normal px-2 py-2"
            onClick={() => router.replace(`/pwa/spg/mutasi?tab=${x.kunci}`, { scroll: false })}
          >
            <span className="text-sm font-medium">{td(`tab.${x.kunci}`)}</span>
            <span className="text-xs tabular-nums opacity-80">{x.jumlah}</span>
          </Button>
        ))}
      </div>

      {daftar.length === 0 ? (
        <section className="beranda-kartu flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight">{td(`kosong.${tab}.judul`)}</h2>
            <p className="text-sm text-muted-foreground">{td(`kosong.${tab}.isi`)}</p>
          </div>
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {daftar.map((m) => {
              const Ikon = m.status === "DIKIRIM" ? Truck : m.arah === "KELUAR" ? ArrowUpFromLine : ArrowDownToLine;
              // Tanda dikirim untuk mutasi ini masih di HP: menggantikan "Perlu dikirim".
              const kirimHp = m.arah === "KELUAR" ? (kirimDiHp.get(m.id) ?? null) : null;
              return (
                <li key={`${m.arah}:${m.id}`}>
                  <Link href={`/pwa/spg/mutasi/${m.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Ikon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="block font-medium leading-tight">
                        {m.arah === "KELUAR" ? t("keToko", { toko: m.tokoLain }) : t("dariToko", { toko: m.tokoLain })}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {m.docNo} · {m.tanggal}
                      </span>
                      <span className="block text-xs text-muted-foreground">{t("isi", { baris: m.baris, pcs: m.pcs })}</span>
                      <span className="flex flex-wrap gap-1.5">
                        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", nadaStatusMutasi(m.status))}>
                          {td(`status.${m.status}`)}
                        </span>
                        {kirimHp ? (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-medium",
                              kirimHp.syncState === "failed" ? "bg-destructive/10 text-destructive" : "bg-sky-500/15 text-sky-800 dark:text-sky-300",
                            )}
                          >
                            {kirimHp.syncState === "failed" ? t("luring.badgeKirimDitolak") : t("luring.badgeKirim")}
                          </span>
                        ) : m.tindakan ? (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                            {td(`tindakan.${m.tindakan}`)}
                          </span>
                        ) : null}
                        {m.selisihStatus === "TERBUKA" ? (
                          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{t("selisihTerbuka")}</span>
                        ) : null}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <p className="px-1 text-xs text-muted-foreground">{t("petunjuk")}</p>
    </div>
  );
}
