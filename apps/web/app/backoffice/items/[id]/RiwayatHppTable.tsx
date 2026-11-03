"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { getItemHppHistory } from "@/app/actions/item-price-history";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-only";
import type { HppTerbaru, RiwayatHpp } from "@/lib/items/riwayat-hpp";
import { formatRupiahSen } from "@/lib/items/rekomendasi-harga";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const angka = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
const rupiah = (n: number | null) => (n == null ? "—" : formatRupiahSen(n));

/**
 * Riwayat HPP barang: setiap penerimaan barang jadi dan pembelian dengan HPP
 * per satuan PERISTIWA ITU (keputusan pemilik 2026-11-01), terbaru dulu.
 * Angkanya dibaca dari dokumen dan buku stok tersimpan (`lib/items/riwayat-hpp.ts`).
 */
export function RiwayatHppTable({
  itemId,
  awal,
  terbaru,
  rataRataStok,
  satuan,
}: {
  itemId: string;
  awal: RiwayatHpp;
  terbaru: HppTerbaru | null;
  /** Rata-rata stok gudang sekarang (bila ada stok) — pembanding, bukan HPP terbaru. */
  rataRataStok: number | null;
  satuan: string | null;
}) {
  const t = useTranslations("items.riwayatHpp");
  const locale = useLocale();
  const [riwayat, setRiwayat] = useState<RiwayatHpp>(awal);
  const [memuat, setMemuat] = useState(false);
  const [gagal, setGagal] = useState(false);
  const sat = (satuan ?? "").trim().toLowerCase() || "pcs";

  // Halaman berikutnya lewat penunjuk waktu: hanya peristiwa SEBELUM baris terakhir yang tampil.
  const muatLagi = async () => {
    if (!riwayat.berikutnya) return;
    setMemuat(true);
    setGagal(false);
    try {
      const lanjut = await getItemHppHistory(itemId, { sebelum: riwayat.berikutnya });
      setRiwayat((lama) => {
        const sudah = new Set(lama.baris.map((b) => b.kunci));
        return {
          baris: [...lama.baris, ...lanjut.baris.filter((b) => !sudah.has(b.kunci))],
          adaLagi: lanjut.adaLagi,
          berikutnya: lanjut.berikutnya,
        };
      });
    } catch {
      setGagal(true);
    } finally {
      setMemuat(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="py-0">
        <CardContent className="space-y-1 p-4">
          <p className="text-sm font-medium">{t("terbaru")}</p>
          {terbaru ? (
            <>
              <p className="text-xl font-semibold tabular-nums">
                {formatRupiahSen(terbaru.perPcs)}{" "}
                <span className="text-sm font-normal text-muted-foreground">{t("perSatuan", { satuan: sat })}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {terbaru.tautan ? (
                  <Link href={terbaru.tautan} className="font-medium text-foreground underline-offset-4 hover:underline">
                    {terbaru.dokumen}
                  </Link>
                ) : (
                  terbaru.dokumen
                )}{" "}
                · {t(`jenis.${terbaru.jenis}`)} · {formatDisplayDate(terbaru.tanggal, locale)} ·{" "}
                {t("jumlahSatuan", { jumlah: angka(terbaru.jumlah), satuan: sat })}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("belumAda")}</p>
          )}
          {rataRataStok != null && (
            <p className="text-xs text-muted-foreground">{t("rataRataStok", { nilai: formatRupiahSen(rataRataStok) })}</p>
          )}
        </CardContent>
      </Card>

      {riwayat.baris.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("kosong")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colTanggal")}</TableHead>
              <TableHead>{t("colDokumen")}</TableHead>
              <TableHead>{t("colVarian")}</TableHead>
              <TableHead className="text-right">{t("colJumlah", { satuan: sat })}</TableHead>
              <TableHead className="text-right">{t("colHpp", { satuan: sat })}</TableHead>
              <TableHead className="text-right whitespace-normal">{t("colRataRata")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {riwayat.baris.map((b) => (
              // Baris yang bukan dasar HPP terbaru diredupkan; baris yang dikoreksi invoice tidak.
              <TableRow
                key={b.kunci}
                className={b.catatan && b.catatan !== "DIKOREKSI_INVOICE" ? "text-muted-foreground" : undefined}
              >
                <TableCell>{formatDisplayDateTime(b.tanggal, locale)}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {b.tautan ? (
                        <Link href={b.tautan} className="font-medium underline-offset-4 hover:underline">
                          {b.dokumen}
                        </Link>
                      ) : (
                        <span className="font-medium">{b.dokumen}</span>
                      )}
                      <Badge variant="outline">{t(`jenis.${b.jenis}`)}</Badge>
                    </div>
                    {b.induk && (
                      <div className="text-xs text-muted-foreground">
                        {b.tautanInduk ? (
                          <Link href={b.tautanInduk} className="underline-offset-4 hover:underline">
                            {t(b.jenis === "PRODUKSI" ? "dariWo" : "dariPo", { nomor: b.induk })}
                          </Link>
                        ) : (
                          t(b.jenis === "PRODUKSI" ? "dariWo" : "dariPo", { nomor: b.induk })
                        )}
                      </div>
                    )}
                    {b.catatan === "DIKOREKSI_INVOICE" ? (
                      <div className="text-xs">
                        {t("catatan.DIKOREKSI_INVOICE", { sebelum: rupiah(b.hppSebelumKoreksi ?? null) })}
                      </div>
                    ) : b.catatan ? (
                      <div className="text-xs">{t(`catatan.${b.catatan}`)}</div>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="whitespace-normal">{b.varianLabel ?? b.varianSku ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{angka(b.jumlah)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {b.hppPerPcs == null ? <span title={t("tanpaNilai")}>—</span> : rupiah(b.hppPerPcs)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{rupiah(b.rataRataSesudah)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {gagal && (
        <p className="text-sm text-destructive" role="alert">
          {t("gagalMuat")}
        </p>
      )}
      {riwayat.adaLagi && riwayat.berikutnya && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void muatLagi()} disabled={memuat}>
            {memuat && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("muatLagi")}
          </Button>
        </div>
      )}
    </div>
  );
}
