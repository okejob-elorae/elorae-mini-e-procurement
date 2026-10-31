"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERIODE_BAWAAN_HARI, PILIHAN_PERIODE_HARI, type RingkasLacak, type StatusPelanggan } from "@/lib/spg/pelanggan-lacak";
import type { StatusTone } from "@/components/ui/status-pill";
import { denganParam } from "../piutang/_daftar/halaman";

/** Nada status pelanggan — satu definisi untuk tabel, tombol saring, dan ubin. */
export const NADA_STATUS_PELANGGAN: Record<StatusPelanggan, StatusTone> = {
  BARU: "progress",
  AKTIF: "settled",
  TIDUR: "waiting",
  BELUM_BELANJA: "inactive",
};

/**
 * Pilih periode ringkasan (`?periode=`, bawaan 90 hari tidak ditulis). Ganti
 * periode = halaman daftar kembali ke 1.
 */
export function PilihPeriode({ periodeHari }: { periodeHari: number }) {
  const t = useTranslations("spgPelanggan.kantor");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [menunggu, mulai] = useTransition();
  return (
    <Select
      value={String(periodeHari)}
      disabled={menunggu}
      onValueChange={(v) =>
        mulai(() =>
          router.replace(denganParam(pathname, searchParams, { periode: Number(v) === PERIODE_BAWAAN_HARI ? null : v, halaman: null }), { scroll: false }),
        )
      }
    >
      <SelectTrigger className="w-full sm:w-56" aria-label={t("periode")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PILIHAN_PERIODE_HARI.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {t("periodeOpsi", { n })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Ubin ringkasan pelacakan: pelanggan tercatat, member aktif, nota dengan
 * pembeli tercatat, pelanggan kembali, belanja pertama, dan tidur. Persen
 * kosong ("—") bila penyebutnya nol — bukan 0%.
 */
export function UbinLacak({ r, hariTidur }: { r: RingkasLacak; hariTidur: number }) {
  const t = useTranslations("spgPelanggan.kantor.ubin");
  const locale = useLocale();
  const angka = new Intl.NumberFormat(locale === "en" ? "en-US" : "id-ID", { maximumFractionDigits: 1 });
  const persen = (n: number | null) => (n === null ? "—" : `${angka.format(n)}%`);
  const ubin: { label: string; nilai: string; catatan: string }[] = [
    { label: t("pelanggan"), nilai: angka.format(r.pelanggan), catatan: t("pelangganCatatan", { n: angka.format(r.belumBelanja) }) },
    { label: t("member"), nilai: angka.format(r.member), catatan: t("memberCatatan") },
    {
      label: t("cakupan"),
      nilai: persen(r.cakupanPersen),
      catatan: t("cakupanCatatan", { ada: angka.format(r.notaBerpembeli), nota: angka.format(r.notaPeriode) }),
    },
    {
      label: t("kembali"),
      nilai: persen(r.kembaliPersen),
      catatan: t("kembaliCatatan", { kembali: angka.format(r.kembali), pembeli: angka.format(r.pembeliPeriode) }),
    },
    { label: t("baru"), nilai: angka.format(r.baru), catatan: t("baruCatatan") },
    { label: t("tidur"), nilai: angka.format(r.tidur), catatan: t("tidurCatatan", { hari: hariTidur }) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {ubin.map((u) => (
        <div key={u.label} className="rounded-lg border px-3 py-2">
          <p className="text-xs text-muted-foreground">{u.label}</p>
          <p className="text-lg font-semibold tabular-nums">{u.nilai}</p>
          <p className="text-xs text-muted-foreground">{u.catatan}</p>
        </div>
      ))}
    </div>
  );
}
