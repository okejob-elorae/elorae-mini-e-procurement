"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, ShoppingBag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatIDR } from "@/lib/sales-orders/format";
import { cn } from "@/lib/utils";
import type { KeadaanPesanan, TabPesanan } from "@/lib/field-sales/pwa-queries";
import { LencanaJarakJauh } from "./[id]/LencanaJarakJauh";

import { TautanKembali } from "@/app/pwa/TautanKembali";
import { TombolBantuanHp } from "@/app/pwa/TombolBantuanHp";
export type BarisDaftarPesanan = {
  id: string;
  orderNo: string;
  storeName: string;
  orderType: "PUTUS" | "KONSI";
  keadaan: KeadaanPesanan;
  /** null = nilai konsinyasi yang belum disetujui. */
  total: number | null;
  /** Sudah diformat di server. */
  tanggal: string;
  jumlahBaris: number;
  jumlahPcs: number;
  adaBanding: boolean;
  /** Saluran pesanan jarak jauh (WA/telepon), atau null untuk pesanan kunjungan. */
  remoteChannel: string | null;
  /** Pre-order: nama jendelanya ("" bila tidak diketahui); null = pesanan stok siap. */
  indenNama?: string | null;
  kreditDitahan: boolean;
  ditolak: boolean;
  rejectReason: string | null;
  /** Dibatalkan salesman sendiri (status REJECTED, bukan ditolak kantor). */
  dibatalkan?: boolean;
  /** Nomor pesanan lama yang digantikan pesanan ini. */
  menggantikanNo?: string | null;
  /** Nomor pesanan baru yang menggantikan pesanan ini. */
  digantiDenganNo?: string | null;
};

/** Warna lencana keadaan: kuning = menunggu orang, merah = ditolak, hijau = selesai. */
export const NADA_KEADAAN: Record<KeadaanPesanan, string> = {
  MENUNGGU: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  DITOLAK: "bg-destructive/10 text-red-800 dark:text-red-300",
  BELUM_DIKIRIM: "bg-primary/15 text-foreground",
  DIKIRIM_SEBAGIAN: "bg-primary/15 text-foreground",
  TERKIRIM: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  DITUTUP: "bg-muted text-muted-foreground",
  KONSI_DISETUJUI: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

export function PesananSayaClient({
  tab,
  tabs,
  lebihHref,
  baris,
}: {
  tab: TabPesanan;
  tabs: Array<{ kunci: TabPesanan; jumlah: number; href: string }>;
  /** Alamat "tampilkan lebih banyak"; null bila semua sudah tampil. */
  lebihHref: string | null;
  baris: BarisDaftarPesanan[];
}) {
  const t = useTranslations("pwa.pesananSaya");
  const tUbah = useTranslations("pwa.ubahPesanan");

  return (
    <div className="space-y-4 p-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <TautanKembali cadangan="/pwa" />
      </Button>

      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <TombolBantuanHp judul={t("title")} />
        </div>
      </header>

      {/* Tab sebagai tautan, bukan keadaan klien: alamatnya bisa dibagikan dan
          angka di beranda menaut langsung ke sini. Lima kolom muat di HP karena
          angkanya di atas dan labelnya kecil di bawah — seperti kartu beranda. */}
      <nav aria-label={t("tabsLabel")}>
        <ul className="grid grid-cols-5 gap-1.5">
          {tabs.map(({ kunci: k, jumlah, href }) => {
            const aktif = k === tab;
            return (
              <li key={k}>
                <Link
                  href={href}
                  replace
                  aria-current={aktif ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center rounded-lg border px-1 py-1.5 text-center transition-colors",
                    aktif
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card hover:bg-muted/60",
                  )}
                >
                  <span className="text-lg font-semibold leading-tight tabular-nums">{jumlah}</span>
                  <span className={cn("text-[11px] leading-tight", !aktif && "text-muted-foreground")}>{t(`tab.${k}`)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {baris.length === 0 ? (
        <section className="beranda-kartu text-center text-sm text-muted-foreground">
          <ShoppingBag className="mx-auto mb-2 h-6 w-6 opacity-60" aria-hidden />
          {t("empty")}
        </section>
      ) : (
        <section className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {baris.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/pwa/orders/${b.id}`}
                  className="flex min-h-14 items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate font-medium leading-tight">{b.storeName}</span>
                    <span className="block text-xs text-muted-foreground">
                      <span className="font-mono">{b.orderNo}</span> · {b.tanggal}
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant="outline"
                        className={cn("border-transparent", b.dibatalkan ? "bg-muted text-muted-foreground" : NADA_KEADAAN[b.keadaan])}
                      >
                        {b.dibatalkan ? tUbah("lencanaDibatalkan") : t(`keadaan.${b.keadaan}`)}
                      </Badge>
                      <Badge variant="outline">{t(`type.${b.orderType}`)}</Badge>
                      {b.adaBanding ? <Badge variant="secondary">{t("rowAppeal")}</Badge> : null}
                      <LencanaJarakJauh saluran={b.remoteChannel} />
                      {b.indenNama != null ? (
                        // Nama jendela bisa panjang: dipotong di ujung (span sendiri), bukan di kedua sisi oleh justify-center lencana.
                        <Badge variant="outline" className="max-w-[14rem] justify-start border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300">
                          <span className="min-w-0 truncate">
                            {b.indenNama ? t("rowInden", { nama: b.indenNama }) : t("rowIndenTanpaNama")}
                          </span>
                        </Badge>
                      ) : null}
                      {b.kreditDitahan ? (
                        <Badge variant="outline" className="border-transparent bg-amber-500/15 text-amber-800 dark:text-amber-300">
                          {t("rowCreditHeld")}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("rowItems", { lines: b.jumlahBaris, pcs: b.jumlahPcs })}
                    </span>
                    {/* Baris ini sudah tautan ke detail; nomor pasangannya ditulis sebagai teks, tautannya di detail. */}
                    {b.menggantikanNo ? (
                      <span className="block text-xs text-muted-foreground">{tUbah("barisMenggantikan", { orderNo: b.menggantikanNo })}</span>
                    ) : null}
                    {b.dibatalkan ? (
                      <span className="block rounded-md bg-muted px-2 py-1 text-xs leading-snug text-muted-foreground">
                        {b.digantiDenganNo
                          ? tUbah("barisDiganti", { orderNo: b.digantiDenganNo })
                          : b.rejectReason?.trim()
                            ? tUbah("alasanDibatalkan", { alasan: b.rejectReason.trim() })
                            : tUbah("keteranganDibatalkan")}
                      </span>
                    ) : b.ditolak ? (
                      <span className="block rounded-md bg-destructive/10 px-2 py-1 text-xs leading-snug text-red-800 dark:text-red-300">
                        {b.rejectReason?.trim() ? t("rowRejectReason", { reason: b.rejectReason.trim() }) : t("rowRejectNoReason")}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 self-center">
                    <span
                      className={cn(
                        "text-right text-sm tabular-nums",
                        b.total === null ? "text-xs text-muted-foreground" : "font-semibold",
                        b.ditolak && "text-muted-foreground line-through",
                      )}
                    >
                      {/* Konsi ditolak tidak akan pernah bernilai — "menyusul" di sana keliru. */}
                      {b.total !== null ? formatIDR(b.total) : b.ditolak ? "—" : t("priceHidden")}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lebihHref ? (
        <Button asChild variant="outline" className="w-full">
          <Link href={lebihHref} scroll={false} replace>
            {t("loadMore")}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
