"use client";

import { useLocale, useTranslations } from "next-intl";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  hasilDariQty,
  keadaanTerhadapTahap,
  qtyBahanDiPo,
  qtyDariHasil,
  type KeadaanTahap,
  type KebutuhanTahapPo,
} from "@/lib/purchase-orders/kebutuhan-tahap";
import { InputAngka } from "./InputAngka";

const NADA: Record<KeadaanTahap["keadaan"], StatusTone> = { PAS: "settled", LEBIH: "waiting", KURANG: "attention" };

/**
 * "Kebutuhan vs tahap" di formulir PO yang dibuat untuk satu tahap produksi:
 * kalkulator 3 arah per bahan — konsumsi/pcs ↔ qty dipesan ↔ hasil pcs. Qty
 * dipesan = jumlah baris PO bahan itu; mengubahnya (atau hasil pcs) menulis
 * ulang baris PO (dibagi rata bila bahan itu dirinci per warna). Konsumsi di
 * sini hanya untuk menghitung, tidak mengubah aturan pemakaian barang jadi.
 */
export function PanelKebutuhanTahap({
  kebutuhan,
  baris,
  konsumsi,
  onKonsumsi,
  onTulisQty,
}: {
  kebutuhan: KebutuhanTahapPo;
  baris: readonly { itemId: string; qty: number }[];
  konsumsi: Record<string, number>;
  onKonsumsi: (itemId: string, nilai: number) => void;
  onTulisQty: (itemId: string, qty: number) => void;
}) {
  const t = useTranslations("purchaseOrders.kebutuhan");
  const locale = useLocale();
  const angka = (n: number) =>
    new Intl.NumberFormat(locale.startsWith("en") ? "en-GB" : "id-ID", { maximumFractionDigits: 2 }).format(n);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Calculator className="h-5 w-5" />
          {t("judul")}
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {t("targetPcs", { qty: angka(kebutuhan.targetQty) })}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {kebutuhan.bahan.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("kosong")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">{t("kolBahan")}</TableHead>
                  <TableHead className="min-w-[120px]">{t("kolKonsumsi")}</TableHead>
                  <TableHead className="min-w-[140px]">{t("kolDipesan")}</TableHead>
                  <TableHead className="min-w-[120px]">{t("kolHasil")}</TableHead>
                  <TableHead>{t("kolKeadaan")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {kebutuhan.bahan.map((b) => {
                  const k = konsumsi[b.itemId] ?? b.perPcs;
                  const qty = qtyBahanDiPo(baris, b.itemId);
                  const hasil = hasilDariQty(qty, k, b.wastePercent);
                  const keadaan = keadaanTerhadapTahap({
                    qty,
                    diPoLain: b.diPo,
                    konsumsi: k,
                    wastePercent: b.wastePercent,
                    targetQty: kebutuhan.targetQty,
                  });
                  return (
                    <TableRow key={b.itemId}>
                      <TableCell className="whitespace-normal">
                        <p className="font-medium">{b.nama}</p>
                        <p className="text-xs text-muted-foreground">{b.sku}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {t("butuhInfo", { butuh: angka(b.butuh), satuan: b.satuan })}
                          {b.diPo > 0 ? ` · ${t("diPoLain", { n: angka(b.diPo), satuan: b.satuan })}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <InputAngka
                          nilai={k}
                          onUbah={(n) => onKonsumsi(b.itemId, n)}
                          className="w-24"
                          aria-label={t("labelKonsumsi", { bahan: b.nama })}
                        />
                        {b.wastePercent > 0 ? (
                          <span className="mt-1 block text-xs text-muted-foreground">{t("susut", { n: angka(b.wastePercent) })}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <InputAngka
                            nilai={qty}
                            onUbah={(n) => onTulisQty(b.itemId, n)}
                            className="w-28"
                            aria-label={t("labelDipesan", { bahan: b.nama })}
                          />
                          <span className="text-sm text-muted-foreground">{b.satuan}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <InputAngka
                            nilai={hasil}
                            disabled={hasil == null}
                            onUbah={(n) => onTulisQty(b.itemId, qtyDariHasil(n, k, b.wastePercent))}
                            className="w-24"
                            aria-label={t("labelHasil", { bahan: b.nama })}
                          />
                          <span className="text-sm text-muted-foreground">{t("pcs")}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {keadaan ? (
                          <StatusPill tone={NADA[keadaan.keadaan]}>
                            {keadaan.keadaan === "PAS"
                              ? t("pas")
                              : keadaan.keadaan === "LEBIH"
                                ? t("lebih", { n: angka(keadaan.pcs) })
                                : t("kurang", { n: angka(keadaan.pcs) })}
                          </StatusPill>
                        ) : (
                          <span className="text-sm text-muted-foreground">{t("tidakDinilai")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
