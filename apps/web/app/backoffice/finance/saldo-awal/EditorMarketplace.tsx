"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShoppingBag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { KANAL_MARKETPLACE, LABEL_KANAL_JURNAL, type KanalJurnal } from "@/lib/finance/journals/kanal";
import type { EntriPiutangMarketplace } from "@/lib/finance/saldo-awal/jenis";
import type { KeadaanJenisSaldoAwal } from "@/lib/finance/saldo-awal/queries";
import { AksiSaldoAwal, type KonteksSaldoAwal } from "./AksiSaldoAwal";

const sen = (n: number) => Math.round(n * 100);

function angka(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Piutang marketplace per kanal: pesanan terkirim sebelum tanggal mulai yang
 * belum cair. Dihitung sistem, BOLEH dikoreksi per kanal — koreksi wajib
 * beralasan dan angka hitungannya ikut tersimpan di samping angka yang diposting.
 */
export function EditorMarketplace({
  hitungan,
  keadaan,
  konteks,
}: {
  hitungan: EntriPiutangMarketplace[];
  keadaan: KeadaanJenisSaldoAwal;
  konteks: KonteksSaldoAwal;
}) {
  const t = useTranslations("saldoAwal");
  const dihitung = new Map(hitungan.map((h) => [h.kanal, h]));
  const tersimpan = new Map(((keadaan.draf ?? keadaan.posting)?.isi.baris as EntriPiutangMarketplace[] | undefined)?.map((b) => [b.kanal, b.jumlah]) ?? []);
  const [jumlah, setJumlah] = useState<Record<string, string>>(() =>
    Object.fromEntries(KANAL_MARKETPLACE.map((k) => [k, String(tersimpan.get(k) ?? dihitung.get(k)?.jumlah ?? 0)])),
  );
  const [catatan, setCatatan] = useState(keadaan.draf?.catatan ?? keadaan.posting?.catatan ?? "");

  const tidakSah = KANAL_MARKETPLACE.some((k) => angka(jumlah[k] ?? "") === null);
  const baris = KANAL_MARKETPLACE.map((k) => ({ kanal: k, jumlah: angka(jumlah[k] ?? "") ?? 0 }));
  const dikoreksi = baris.some((b) => sen(b.jumlah) !== sen(dihitung.get(b.kanal)?.jumlah ?? 0));
  const total = baris.reduce((s, b) => s + sen(b.jumlah), 0) / 100;
  const totalHitung = hitungan.reduce((s, b) => s + sen(b.jumlah), 0) / 100;
  const alasanBelum = tidakSah ? t("alasan.angka") : dikoreksi && !catatan.trim() ? t("alasan.catatan") : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5" aria-hidden />
          {t("jenis.AR_MARKETPLACE")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("kolom.kanal")}</TableHead>
                <TableHead className="text-right">{t("kolom.pesanan")}</TableHead>
                <TableHead className="text-right">{t("kolom.dihitung")}</TableHead>
                <TableHead className="w-48 text-right">{t("kolom.jumlah")}</TableHead>
                <TableHead className="hidden text-right 2xl:table-cell">{t("kolom.selisih")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {KANAL_MARKETPLACE.map((k: KanalJurnal) => {
                const h = dihitung.get(k);
                const nilai = angka(jumlah[k] ?? "");
                const selisih = nilai === null ? null : (sen(nilai) - sen(h?.jumlah ?? 0)) / 100;
                return (
                  <TableRow key={k}>
                    <TableCell className="font-medium">{LABEL_KANAL_JURNAL[k]}</TableCell>
                    <TableCell className="text-right tabular-nums">{h?.pesanan ?? 0}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(h?.jumlah ?? 0)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        className="text-right"
                        aria-label={`${t("kolom.jumlah")} ${LABEL_KANAL_JURNAL[k]}`}
                        value={jumlah[k] ?? ""}
                        disabled={!konteks.bolehMengelola}
                        onChange={(e) => setJumlah((j) => ({ ...j, [k]: e.target.value }))}
                      />
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums 2xl:table-cell">
                      {selisih ? <span className="text-amber-700 dark:text-amber-400">{formatRupiah(selisih)}</span> : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t("total")}</TableCell>
                <TableCell className="text-right tabular-nums">{hitungan.reduce((s, b) => s + (b.pesanan ?? 0), 0)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(totalHitung)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(total)}</TableCell>
                <TableCell className="hidden 2xl:table-cell" />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        {hitungan.length === 0 ? <p className="text-sm text-muted-foreground">{t("marketplace.kosong")}</p> : null}
        <div className="space-y-1.5">
          <Label htmlFor="catatan-mp">{dikoreksi ? t("catatan.wajib") : t("catatan.label")}</Label>
          <Textarea
            id="catatan-mp"
            rows={2}
            maxLength={1000}
            value={catatan}
            disabled={!konteks.bolehMengelola}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder={t("catatan.placeholder")}
          />
        </div>
        <AksiSaldoAwal
          jenis="AR_MARKETPLACE"
          konteks={konteks}
          keadaan={keadaan}
          baris={baris}
          catatan={catatan}
          ekuitas={total}
          alasanBelum={alasanBelum}
        />
      </CardContent>
    </Card>
  );
}
