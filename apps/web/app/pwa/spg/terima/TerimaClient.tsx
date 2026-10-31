"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, CloudOff, PackageCheck, PackageX, Truck, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TautanKembali } from "@/app/pwa/TautanKembali";
import { dinamis } from "@/lib/i18n/dinamis";
import type { JenisKiriman } from "@/lib/spg/kiriman";
import type { StatusRusak } from "@/lib/spg/rusak";
import { cn } from "@/lib/utils";
import { pwaDb } from "@/lib/pwa/offline/db";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { kunjunganLokalSah } from "@/lib/pwa/offline/luring-kunjungan";
import { useKunjunganLokal } from "@/lib/pwa/offline/luring-kunjungan-hook";
import { PerluCheckIn } from "./PerluCheckIn";
import { BagianRusakPembeli, type RusakPembeliRingkas } from "./BagianRusakPembeli";
import { BagianPesananMenuju } from "./BagianPesananMenuju";
import type { PesananMenujuHp } from "@/lib/spg/pesanan-menuju-toko";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";

export type KirimanRingkas = {
  sourceType: JenisKiriman;
  sourceId: string;
  docNo: string;
  tanggalLabel: string;
  jumlahBaris: number;
  totalQty: number;
};

/** Barang rusak dari kiriman yang sudah diterima toko ini — tanpa harga. */
export type RusakRingkas = {
  id: string;
  sourceType: string;
  docNo: string;
  tanggalLabel: string;
  /** Barang katalog — hanya itu yang bisa dikirim balik lewat nota retur SPG. */
  katalog: boolean;
  productName: string;
  variantSku: string;
  qty: number;
  keterangan: string | null;
  status: StatusRusak;
  catatanKeputusan: string | null;
  /** KEMBALI_GUDANG: yang masih harus dikirim balik. */
  sisa: number;
  notaRetur: string[];
};

/** Kiriman yang tanda terimanya sudah dicatat di HP tanpa sinyal: menunggu sinyal, atau ditolak server. */
type KeadaanTertahan = "antre" | "ditolak";

/** Murni: kiriman yang tertahan di HP, per `jenis:id`. */
export function petaTertahan(baris: readonly { sourceType: string; sourceId: string; syncState: string }[]): Map<string, KeadaanTertahan> {
  return new Map(baris.map((r) => [`${r.sourceType}:${r.sourceId}`, r.syncState === "failed" ? ("ditolak" as const) : ("antre" as const)]));
}

/** Tanda terima yang masih di antrean HP, dibaca ulang setiap antrean berubah. */
function useTerimaTertahan(): Map<string, KeadaanTertahan> {
  const [peta, setPeta] = useState<Map<string, KeadaanTertahan>>(() => new Map());
  useEffect(() => {
    let hidup = true;
    const muat = () => {
      pwaDb.pendingStoreReceipts.toArray().then(
        (baris) => {
          if (hidup) setPeta(petaTertahan(baris));
        },
        () => undefined,
      );
    };
    muat();
    window.addEventListener(PERISTIWA_ANTREAN, muat);
    return () => {
      hidup = false;
      window.removeEventListener(PERISTIWA_ANTREAN, muat);
    };
  }, []);
  return peta;
}

/**
 * Daftar kiriman yang menunggu diterima. Tanpa check-in daftarnya tetap
 * terlihat (SPG perlu tahu apa yang akan datang), tapi tidak bisa dibuka —
 * menghitung dan menerima adalah pekerjaan di toko. Check-in yang dicatat
 * tanpa sinyal (masih di HP) juga membuka daftarnya.
 *
 * Kiriman yang tanda terimanya sudah dicatat di HP tanpa sinyal ditandai dan
 * diletakkan paling bawah: menghitungnya lagi hanya kerja dua kali (servernya
 * tetap mencatat satu tanda terima per kiriman).
 */
export function TerimaClient({
  namaToko,
  storeId,
  sudahCheckIn: sudahCheckInServer,
  kiriman,
  rusak = [],
  rusakPembeli = [],
  pesanan = [],
}: {
  namaToko: string;
  storeId: string;
  sudahCheckIn: boolean;
  kiriman: KirimanRingkas[];
  /** Pesanan untuk toko ini yang belum sampai (menunggu, disetujui, dikirim sebagian, di jalan) — tanpa harga. */
  pesanan?: PesananMenujuHp[];
  rusak?: RusakRingkas[];
  /** Barang rusak dari pembeli di konter yang belum dikirim balik ke gudang barang rusak. */
  rusakPembeli?: RusakPembeliRingkas[];
}) {
  const t = useTranslations("pwa.spgTerima");
  const td = dinamis(t);
  const { kunjungan: lokal } = useKunjunganLokal(storeId, { segarkanSaatTerkirim: true });
  const sudahCheckIn = sudahCheckInServer || kunjunganLokalSah(lokal);
  const tertahan = useTerimaTertahan();
  const urut = [...kiriman].sort((a, b) => Number(tertahan.has(`${a.sourceType}:${a.sourceId}`)) - Number(tertahan.has(`${b.sourceType}:${b.sourceId}`)));

  return (
    <div className="space-y-4 p-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
        <p className="truncate text-sm text-muted-foreground">{namaToko}</p>
      </header>

      {!sudahCheckIn ? (
        <PerluCheckIn judul={t("checkIn.title")} isi={t("checkIn.body")} tombol={t("checkIn.cta")} />
      ) : null}

      {kiriman.length === 0 ? (
        <section className="beranda-kartu flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
            <PackageCheck className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold leading-tight">{t("empty.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("empty.body")}</p>
          </div>
        </section>
      ) : (
        <section className="space-y-2" aria-labelledby="judul-kiriman">
          <h2 id="judul-kiriman" className="beranda-judul px-1">
            {t("listTitle", { count: kiriman.length })}
          </h2>
          <div className="beranda-kartu beranda-kartu-daftar">
            <ul className="divide-y">
              {urut.map((k) => {
                const ditahan = tertahan.get(`${k.sourceType}:${k.sourceId}`);
                const isi = (
                  <>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Truck className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium leading-tight">{k.docNo}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {k.tanggalLabel} · {td(`source.${k.sourceType}`)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t("lines", { count: k.jumlahBaris, pcs: k.totalQty })}
                      </span>
                      {ditahan ? (
                        <span
                          className={cn(
                            "mt-1 inline-flex items-start gap-1 rounded-md px-2 py-0.5 text-xs",
                            ditahan === "ditolak"
                              ? "bg-destructive/10 text-destructive"
                              : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
                          )}
                        >
                          {ditahan === "ditolak" ? (
                            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                          ) : (
                            <CloudOff className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                          )}
                          {ditahan === "ditolak" ? t("tertahanDitolak") : t("tertahanAntre")}
                        </span>
                      ) : null}
                    </span>
                    {sudahCheckIn ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
                  </>
                );
                return (
                  <li key={`${k.sourceType}:${k.sourceId}`}>
                    {sudahCheckIn ? (
                      <Link
                        href={`/pwa/spg/terima/${k.sourceType}/${k.sourceId}`}
                        className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-muted/60"
                      >
                        {isi}
                      </Link>
                    ) : (
                      <div className="flex min-h-14 items-center gap-3 px-4 py-2 opacity-70">{isi}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <BagianPesananMenuju pesanan={pesanan} />
      <BagianRusak rusak={rusak} />
      <BagianRusakPembeli rusak={rusakPembeli} />
    </div>
  );
}

const NADA_RUSAK: Record<StatusRusak, string> = {
  TERBUKA: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  LAYAK_JUAL: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  KEMBALI_GUDANG: "bg-primary/15 text-foreground",
  DIHAPUSKAN: "bg-muted text-muted-foreground",
};

/**
 * Barang rusak yang dicatat saat menerima: yang menunggu keputusan gudang,
 * yang harus dikirim balik (tombol ke formulir nota retur yang sudah terisi),
 * dan keputusan 30 hari terakhir.
 */
function BagianRusak({ rusak }: { rusak: RusakRingkas[] }) {
  const tr = useTranslations("spgRusak");
  const trd = dinamis(tr);
  if (rusak.length === 0) return null;
  const bisaKirimBalik = rusak.filter((r) => r.status === "KEMBALI_GUDANG" && r.sisa > 0 && r.katalog);
  return (
    <section className="space-y-2" aria-labelledby="judul-rusak">
      <h2 id="judul-rusak" className="beranda-judul px-1">
        {tr("hp.judul", { count: rusak.length })}
      </h2>
      <div className="beranda-kartu beranda-kartu-daftar">
        <ul className="divide-y">
          {rusak.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <PackageX className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium leading-tight">{r.productName}</p>
                  {r.variantSku ? <p className="truncate text-xs text-muted-foreground">{r.variantSku}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    {r.docNo} · {r.tanggalLabel}
                  </p>
                  <p className="text-sm font-semibold">{tr("hp.potongRusak", { n: r.qty })}</p>
                  {r.keterangan ? <p className="text-xs text-muted-foreground">{r.keterangan}</p> : null}
                </div>
              </div>
              <p className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", NADA_RUSAK[r.status])}>
                {r.status === "KEMBALI_GUDANG" && r.sisa === 0 ? tr("hp.sudahKembali") : trd(`hp.status.${r.status}`)}
              </p>
              {r.catatanKeputusan ? <p className="text-xs text-muted-foreground">{tr("hp.catatanGudang", { catatan: r.catatanKeputusan })}</p> : null}
              {r.notaRetur.length > 0 ? <p className="text-xs text-muted-foreground">{tr("hp.notaRetur", { nota: r.notaRetur.join(", ") })}</p> : null}
              {r.status === "KEMBALI_GUDANG" && r.sisa > 0 ? (
                r.katalog ? (
                  <Button asChild variant="outline" className="w-full">
                    <Link href={`/pwa/retur/baru?dariRusak=${encodeURIComponent(r.id)}`}>
                      <Undo2 className="h-4 w-4" aria-hidden />
                      {tr("hp.kirimBalik", { n: r.sisa })}
                    </Link>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">{tr("hp.bukanKatalog")}</p>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {bisaKirimBalik.length > 1 ? (
        <Button asChild className="w-full">
          <Link href={`/pwa/retur/baru?dariRusak=${bisaKirimBalik.map((r) => encodeURIComponent(r.id)).join(",")}`}>
            <Undo2 className="h-4 w-4" aria-hidden />
            {tr("hp.kirimBalikSemua", { count: bisaKirimBalik.length })}
          </Link>
        </Button>
      ) : null}
    </section>
  );
}
