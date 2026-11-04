"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dinamis } from "@/lib/i18n/dinamis";
import type { StatusPermintaan } from "@/lib/spg/kantor-queries";
import type { PermintaanToko } from "@/lib/spg/permintaan-queries";
import { cn } from "@/lib/utils";

export type PermintaanTampil = PermintaanToko & { dibuatLabel: string; ditanganiLabel: string | null };

/** Baris barang yang langsung terlihat; sisanya di balik "lihat semua". */
const BARIS_RINGKAS = 3;

const WARNA_STATUS: Record<StatusPermintaan, string> = {
  BARU: "border-border bg-transparent text-foreground",
  DIPROSES: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  SELESAI: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  DITOLAK: "bg-destructive/15 text-destructive",
};

/**
 * Permintaan kiriman toko ini beserta nasibnya. Alasan penolakan (kantor atau
 * salesman pemegang toko) ditampilkan menonjol — tanpa itu SPG hanya tahu
 * "ditolak" dan meminta barang yang sama lagi besoknya. Pesanan yang
 * dibuatkan salesman tampil sebagai nomornya saja, tanpa nilai.
 */
export function DaftarPermintaan({ permintaan }: { permintaan: PermintaanTampil[] }) {
  const t = useTranslations("pwa.spgStok.requests");
  const td = dinamis(t);
  const tAlasan = dinamis(useTranslations("alasanPermintaanSpg"));
  const [terbuka, setTerbuka] = useState<Set<string>>(new Set());

  const alih = (id: string) =>
    setTerbuka((lama) => {
      const baru = new Set(lama);
      if (baru.has(id)) baru.delete(id);
      else baru.add(id);
      return baru;
    });

  return (
    <section className="space-y-2" aria-labelledby="judul-permintaan">
      <h2 id="judul-permintaan" className="beranda-judul px-1">
        {t("title")}
      </h2>
      {permintaan.length === 0 ? (
        <p className="beranda-kartu text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="beranda-kartu beranda-kartu-daftar">
          <ul className="divide-y">
            {permintaan.map((p) => {
              const semua = terbuka.has(p.id);
              const baris = semua ? p.baris : p.baris.slice(0, BARIS_RINGKAS);
              const sisa = p.baris.length - BARIS_RINGKAS;
              return (
                <li key={p.id} className="space-y-2 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{p.dibuatLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("meta", { count: p.baris.length, pcs: p.totalQty, name: p.peminta })}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0", WARNA_STATUS[p.status])}>
                      {td(`status.${p.status}`)}
                    </Badge>
                  </div>

                  <ul className="space-y-1 text-sm">
                    {baris.map((l, i) => (
                      <li key={`${l.productName}-${l.variantSku}-${i}`}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="min-w-0 truncate">{l.productName}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">×{l.qty}</span>
                        </div>
                        {/* Alasan dari saran/analisa; "dipilih sendiri" tidak perlu disebut di layar SPG sendiri. */}
                        {l.alasan && l.alasan !== "MANUAL" ? (
                          <p className="text-xs text-muted-foreground">{tAlasan(l.alasan)}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {sisa > 0 ? (
                    <Button type="button" variant="link" size="sm" className="-ml-3 px-3" onClick={() => alih(p.id)}>
                      {semua ? t("showLess") : t("showMore", { count: sisa })}
                    </Button>
                  ) : null}

                  {p.catatan ? <p className="text-xs text-muted-foreground">{t("yourNote", { note: p.catatan })}</p> : null}

                  {p.pesanan ? (
                    <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
                      {t("orderMade", { orderNo: p.pesanan.orderNo })}
                    </p>
                  ) : null}

                  {p.status === "DITOLAK" ? (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {p.ditanganiOleh
                        ? t("rejectReasonBy", { name: p.ditanganiOleh, note: p.catatanKantor ?? "—" })
                        : t("rejectReason", { note: p.catatanKantor ?? "—" })}
                    </p>
                  ) : p.catatanKantor && !(p.pesanan && p.catatanKantor === `Dibuatkan pesanan ${p.pesanan.orderNo}`) ? (
                    // Catatan otomatis "Dibuatkan pesanan …" sudah tampil sebagai baris pesanan di atas.
                    <p className="rounded-md bg-muted px-3 py-2 text-sm">
                      {p.ditanganiOleh ? t("noteBy", { name: p.ditanganiOleh, note: p.catatanKantor }) : t("officeNote", { note: p.catatanKantor })}
                    </p>
                  ) : null}

                  {p.ditanganiLabel && p.status !== "BARU" ? (
                    <p className="text-xs text-muted-foreground">
                      {p.ditanganiOleh
                        ? t("handledBy", { name: p.ditanganiOleh, when: p.ditanganiLabel })
                        : t("handledAt", { when: p.ditanganiLabel })}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
