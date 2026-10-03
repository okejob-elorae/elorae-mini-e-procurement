"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeftRight, ClipboardCheck, ShoppingBag, Sparkles, Tag, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PERISTIWA_ANTREAN } from "@/lib/pwa/offline/hitung";
import { kirimTandaFotoPanduan } from "./checklist/tanda-foto-panduan";

/**
 * Semua yang dikerjakan salesman SELAMA kunjungan, di satu tempat dan
 * berurutan: pesan dulu (tombol utama), lalu pekerjaan lain di toko sebagai
 * ubin. Sebelumnya tombol-tombol ini tercecer di antara kartu informasi dan
 * tombol check-out berada di tengahnya — mudah check-out sebelum selesai.
 *
 * Ubin, bukan tombol sebaris: label boleh dua baris, jadi "Pesanan cepat" dan
 * "Daftar periksa" tidak pernah terpotong di HP sempit.
 *
 * Aturan tampil (server menilai ulang semuanya saat dokumen dibuat):
 * - Rencana kirim (dulu "pesanan cepat") untuk toko PUTUS dan KONSI — draf
 *   konsinyasi tanpa harga, dan tetap lewat penulis pesanan biasa.
 * - Tukar barang hanya toko PUTUS — konsinyasi punya jalur kirim + retur sendiri.
 * - Daftar periksa dan harga pesaing untuk semua toko.
 * - SPG tidak mengambil pesanan, tidak menukar barang, tidak menagih: ia
 *   menjual dari layarnya sendiri. Untuknya hanya pekerjaan display —
 *   daftar periksa (dengan panduan display) dan harga pesaing.
 */
export function AksiKunjungan({
  storeId,
  termsType,
  preorder,
  spg = false,
}: {
  storeId: string;
  termsType: "PUTUS" | "KONSI";
  /** Tombol pre-order bila ada jendela yang buka (dirakit di server). */
  preorder?: ReactNode;
  /** SPG di toko tetapnya (dinilai di server dari `ambilTokoTetap`). */
  spg?: boolean;
}) {
  const t = useTranslations("pwa.kunjunganBerjalan");
  const tRencana = useTranslations("pwa.rencanaKirim");

  // Tanda "foto ini hasil panduan display" yang belum sampai ke server dikirim
  // ulang dari sini setiap antrean HP selesai dicoba — halaman toko adalah
  // tempat salesman berada sesudah memotret display.
  useEffect(() => {
    const coba = () => void kirimTandaFotoPanduan();
    coba();
    window.addEventListener(PERISTIWA_ANTREAN, coba);
    return () => window.removeEventListener(PERISTIWA_ANTREAN, coba);
  }, []);

  const putus = termsType === "PUTUS" && !spg;
  const ubin: Array<{ href: string; label: string; ikon: LucideIcon }> = [
    ...(!spg ? [{ href: `/pwa/stores/${storeId}/smart-request`, label: tRencana("ubin"), ikon: Sparkles }] : []),
    ...(putus ? [{ href: `/pwa/stores/${storeId}/tukar`, label: t("tukar"), ikon: ArrowLeftRight }] : []),
    { href: `/pwa/stores/${storeId}/checklist`, label: t("checklist"), ikon: ClipboardCheck },
    { href: `/pwa/stores/${storeId}/harga-pesaing`, label: t("hargaPesaing"), ikon: Tag },
  ];

  return (
    <div className="space-y-2">
      {spg ? null : (
        <>
          <Button asChild size="lg" className="w-full">
            <Link href={`/pwa/stores/${storeId}/catalog`}>
              <ShoppingBag className="h-5 w-5" aria-hidden />
              {t("buatPesanan")}
            </Link>
          </Button>
          {preorder}
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        {ubin.map(({ href, label, ikon: Ikon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-16 items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm font-medium leading-tight transition-colors hover:bg-muted active:bg-muted"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Ikon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
