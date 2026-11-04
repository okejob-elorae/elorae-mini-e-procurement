"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import type { EntriHutang } from "@/lib/finance/saldo-awal/jenis";
import type { KeadaanJenisSaldoAwal } from "@/lib/finance/saldo-awal/queries";
import { AksiSaldoAwal, type KonteksSaldoAwal } from "./AksiSaldoAwal";

const sen = (n: number) => Math.round(n * 100);

function angka(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

type Baris = { supplierId: string; nama: string; kode: string; grn: number; dihitung: number; jumlah: string; manual: boolean };

/**
 * Hutang pemasok per tanggal mulai: penerimaan barang sebelum tanggal mulai
 * yang belum dibayar (dihitung), ditambah pemasok yang hutangnya tidak pernah
 * masuk sistem (diketik). Setiap angka yang berbeda dari hitungan wajib beralasan.
 */
export function EditorHutang({
  hitungan,
  pemasok,
  keadaan,
  konteks,
}: {
  hitungan: EntriHutang[];
  pemasok: { id: string; kode: string; nama: string }[];
  keadaan: KeadaanJenisSaldoAwal;
  konteks: KonteksSaldoAwal;
}) {
  const t = useTranslations("saldoAwal");
  const perId = useMemo(() => new Map(pemasok.map((s) => [s.id, s])), [pemasok]);
  const [baris, setBaris] = useState<Baris[]>(() => {
    const tersimpan = new Map(((keadaan.draf ?? keadaan.posting)?.isi.baris as EntriHutang[] | undefined)?.map((b) => [b.supplierId, b]) ?? []);
    const hasil: Baris[] = hitungan.map((h) => ({
      supplierId: h.supplierId,
      nama: h.nama ?? "",
      kode: h.kode ?? "",
      grn: h.grn ?? 0,
      dihitung: h.jumlah,
      jumlah: String(tersimpan.get(h.supplierId)?.jumlah ?? h.jumlah),
      manual: false,
    }));
    for (const [id, b] of tersimpan) {
      if (hitungan.some((h) => h.supplierId === id)) continue;
      const s = perId.get(id);
      hasil.push({ supplierId: id, nama: s?.nama ?? b.nama ?? id, kode: s?.kode ?? b.kode ?? "", grn: 0, dihitung: 0, jumlah: String(b.jumlah), manual: true });
    }
    return hasil;
  });
  const [tambah, setTambah] = useState("");
  const [catatan, setCatatan] = useState(keadaan.draf?.catatan ?? keadaan.posting?.catatan ?? "");

  const sudah = new Set(baris.map((b) => b.supplierId));
  const pilihan = pemasok.filter((s) => !sudah.has(s.id)).map((s) => ({ value: s.id, label: `${s.nama} (${s.kode})` }));

  const tidakSah = baris.some((b) => angka(b.jumlah) === null);
  const payload = baris.map((b) => ({ supplierId: b.supplierId, jumlah: angka(b.jumlah) ?? 0 }));
  const dikoreksi = baris.some((b) => sen(angka(b.jumlah) ?? 0) !== sen(b.dihitung));
  const total = payload.reduce((s, b) => s + sen(b.jumlah), 0) / 100;
  const alasanBelum = tidakSah ? t("alasan.angka") : dikoreksi && !catatan.trim() ? t("alasan.catatan") : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Truck className="h-5 w-5" aria-hidden />
          {t("jenis.AP")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {baris.length === 0 ? (
          <EmptyState icon={Truck} title={t("hutang.kosong")} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">{t("kolom.pemasok")}</TableHead>
                  <TableHead className="text-right">{t("kolom.grn")}</TableHead>
                  <TableHead className="text-right">{t("kolom.dihitung")}</TableHead>
                  <TableHead className="w-48 text-right">{t("kolom.jumlah")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {baris.map((b) => (
                  <TableRow key={b.supplierId}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{b.nama}</span>
                      {b.kode ? <span className="ml-2 font-mono text-xs text-muted-foreground">{b.kode}</span> : null}
                      {b.manual ? <span className="ml-2 text-xs text-muted-foreground">· {t("hutang.manual")}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.grn}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(b.dihitung)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        className="text-right"
                        aria-label={`${t("kolom.jumlah")} ${b.nama}`}
                        value={b.jumlah}
                        disabled={!konteks.bolehMengelola}
                        onChange={(e) => setBaris((xs) => xs.map((x) => (x.supplierId === b.supplierId ? { ...x, jumlah: e.target.value } : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      {b.manual && konteks.bolehMengelola ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("hutang.hapus")}
                          onClick={() => setBaris((xs) => xs.filter((x) => x.supplierId !== b.supplierId))}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>{t("total")}</TableCell>
                  <TableCell className="text-right tabular-nums">{baris.reduce((s, b) => s + b.grn, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(baris.reduce((s, b) => s + sen(b.dihitung), 0) / 100)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(total)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
        {konteks.bolehMengelola ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[260px] flex-1 space-y-1.5 sm:max-w-md">
              <Label>{t("hutang.tambah")}</Label>
              <SearchableCombobox
                options={pilihan}
                value={tambah}
                onValueChange={setTambah}
                placeholder={t("hutang.pilih")}
                searchPlaceholder={t("hutang.cari")}
                emptyMessage={t("hutang.tanpaPemasok")}
                triggerClassName="w-full"
              />
            </div>
            <Button
              variant="outline"
              disabled={!tambah}
              onClick={() => {
                const s = perId.get(tambah);
                if (!s) return;
                setBaris((xs) => [...xs, { supplierId: s.id, nama: s.nama, kode: s.kode, grn: 0, dihitung: 0, jumlah: "", manual: true }]);
                setTambah("");
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t("hutang.tambahTombol")}
            </Button>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="catatan-hutang">{dikoreksi ? t("catatan.wajib") : t("catatan.label")}</Label>
          <Textarea
            id="catatan-hutang"
            rows={2}
            maxLength={1000}
            value={catatan}
            disabled={!konteks.bolehMengelola}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder={t("catatan.placeholder")}
          />
        </div>
        <AksiSaldoAwal jenis="AP" konteks={konteks} keadaan={keadaan} baris={payload} catatan={catatan} ekuitas={-total} alasanBelum={alasanBelum} />
      </CardContent>
    </Card>
  );
}
