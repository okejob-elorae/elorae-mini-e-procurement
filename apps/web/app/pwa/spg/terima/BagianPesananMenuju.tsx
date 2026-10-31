"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import { cn } from "@/lib/utils";
// HANYA tipe: modulnya menarik Prisma.
import type { PesananMenujuHp, StatusPesananMenuju } from "@/lib/spg/pesanan-menuju-toko";

const NADA: Record<StatusPesananMenuju, string> = {
  DALAM_PERJALANAN: "bg-primary/15 text-foreground",
  DIKIRIM_SEBAGIAN: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  DISETUJUI: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  MENUNGGU_PERSETUJUAN: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
};

/** Barang per pesanan yang langsung terlihat; sisanya di balik "Lihat semua". */
const TAMPIL_AWAL = 4;

/**
 * Pesanan sales untuk toko ini yang belum sampai — supaya SPG tahu barang apa
 * yang sedang diproses kantor sebelum dusnya tiba. Hanya jumlah potong: tidak
 * ada rupiah di HP SPG. Kosong = tidak tampil.
 */
export function BagianPesananMenuju({ pesanan }: { pesanan: PesananMenujuHp[] }) {
  const t = useTranslations("pwa.spgTerima.pesanan");
  if (pesanan.length === 0) return null;
  return (
    <section id="pesanan-toko" className="scroll-mt-4 space-y-2" aria-labelledby="judul-pesanan-toko">
      <h2 id="judul-pesanan-toko" className="beranda-judul px-1">
        {t("judul", { count: pesanan.length })}
      </h2>
      <div className="beranda-kartu beranda-kartu-daftar">
        <ul className="divide-y">
          {pesanan.map((p) => (
            <BarisPesanan key={p.id} p={p} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function BarisPesanan({ p }: { p: PesananMenujuHp }) {
  const t = useTranslations("pwa.spgTerima.pesanan");
  const td = dinamis(t);
  const [semua, setSemua] = useState(false);
  const tampil = semua ? p.barang : p.barang.slice(0, TAMPIL_AWAL);
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
          <ClipboardList className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate font-medium leading-tight">{p.orderNo}</p>
          <p className="text-xs text-muted-foreground">{t("dipesan", { tanggal: p.tanggalLabel })}</p>
          <p className="text-sm font-semibold">
            {t(p.status === "DIKIRIM_SEBAGIAN" ? "ringkasSisa" : "ringkas", { count: p.barang.length, pcs: p.jumlahPcs })}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", NADA[p.status])}>{td(`status.${p.status}`)}</span>
        {p.inden ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t("inden")}</span> : null}
      </div>
      <ul className="space-y-1.5">
        {tampil.map((b) => (
          <li key={b.kunci} className="flex items-baseline gap-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{b.nama}</span>
              {b.varian ? <span className="block truncate text-xs text-muted-foreground">{b.varian}</span> : null}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{t("pcs", { count: b.pcs })}</span>
          </li>
        ))}
      </ul>
      {p.barang.length > TAMPIL_AWAL ? (
        <Button type="button" variant="link" className="h-auto px-0" aria-expanded={semua} onClick={() => setSemua((x) => !x)}>
          {semua ? t("lebihSedikit") : t("lihatSemua", { count: p.barang.length })}
        </Button>
      ) : null}
    </li>
  );
}
