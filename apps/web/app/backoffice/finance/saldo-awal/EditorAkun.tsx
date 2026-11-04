"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatRupiah } from "@/lib/format/rupiah";
import { barisBertandaAkun, susunJurnalSaldoAwal } from "@/lib/finance/saldo-awal/jurnal";
import type { EntriAkun } from "@/lib/finance/saldo-awal/jenis";
import type { AkunSaldoAwal, KeadaanJenisSaldoAwal } from "@/lib/finance/saldo-awal/queries";
import { AksiSaldoAwal, type KonteksSaldoAwal } from "./AksiSaldoAwal";

type Baris = { id: string; akunId: string; debit: string; kredit: string };

let nomor = 0;
const barisBaru = (akunId = "", debit = "", kredit = ""): Baris => ({ id: `b${++nomor}`, akunId, debit, kredit });

function angka(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Kas, bank, aset tetap lama, ekuitas, dan akun neraca lain — diketik per akun. */
export function EditorAkun({ akun, keadaan, konteks }: { akun: AkunSaldoAwal[]; keadaan: KeadaanJenisSaldoAwal; konteks: KonteksSaldoAwal }) {
  const t = useTranslations("saldoAwal");
  const sumber = (keadaan.draf ?? keadaan.posting)?.isi.baris as EntriAkun[] | undefined;
  const [baris, setBaris] = useState<Baris[]>(() =>
    sumber && sumber.length > 0
      ? sumber.map((b) => barisBaru(b.akunId, b.debit ? String(b.debit) : "", b.kredit ? String(b.kredit) : ""))
      : [barisBaru(), barisBaru()],
  );
  const [catatan, setCatatan] = useState(keadaan.draf?.catatan ?? keadaan.posting?.catatan ?? "");

  const pilihan = useMemo(() => akun.map((a) => ({ value: a.id, label: `${a.kode} — ${a.nama}` })), [akun]);
  const ubah = (id: string, patch: Partial<Baris>) => setBaris((xs) => xs.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const terisi = baris.filter((b) => b.akunId && (angka(b.debit) > 0 || angka(b.kredit) > 0));
  const entri: EntriAkun[] = terisi.map((b) => ({ akunId: b.akunId, debit: angka(b.debit), kredit: angka(b.kredit) }));
  const jurnal = susunJurnalSaldoAwal(barisBertandaAkun(entri));
  const totalDebit = entri.reduce((s, e) => s + Math.round(e.debit * 100), 0) / 100;
  const totalKredit = entri.reduce((s, e) => s + Math.round(e.kredit * 100), 0) / 100;
  const ekuitas = jurnal.ekuitasSen / 100;

  const ganda = new Set<string>();
  const dilihat = new Set<string>();
  for (const b of terisi) (dilihat.has(b.akunId) ? ganda : dilihat).add(b.akunId);
  const alasanBelum =
    terisi.length === 0
      ? t("alasan.kosong")
      : ganda.size > 0
        ? t("alasan.akunGanda")
        : baris.some((b) => angka(b.debit) > 0 && angka(b.kredit) > 0)
          ? t("alasan.duaSisi")
          : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" aria-hidden />
          {t("jenis.ACCOUNTS")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px]">{t("kolom.akun")}</TableHead>
                <TableHead className="w-44 text-right">{t("kolom.debit")}</TableHead>
                <TableHead className="w-44 text-right">{t("kolom.kredit")}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {baris.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="whitespace-normal">
                    <SearchableCombobox
                      options={pilihan}
                      value={b.akunId}
                      onValueChange={(v) => ubah(b.id, { akunId: v })}
                      placeholder={t("akun.pilih")}
                      searchPlaceholder={t("akun.cari")}
                      emptyMessage={t("akun.kosong")}
                      triggerClassName="w-full"
                      disabled={!konteks.bolehMengelola}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      className="text-right"
                      aria-label={t("kolom.debit")}
                      value={b.debit}
                      disabled={!konteks.bolehMengelola}
                      onChange={(e) => ubah(b.id, { debit: e.target.value, ...(e.target.value ? { kredit: "" } : {}) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      className="text-right"
                      aria-label={t("kolom.kredit")}
                      value={b.kredit}
                      disabled={!konteks.bolehMengelola}
                      onChange={(e) => ubah(b.id, { kredit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("akun.hapusBaris")}
                      disabled={!konteks.bolehMengelola || baris.length <= 1}
                      onClick={() => setBaris((xs) => xs.filter((x) => x.id !== b.id))}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/30">
                <TableCell className="text-muted-foreground">{t("akun.lawan")}</TableCell>
                <TableCell className="text-right tabular-nums">{ekuitas < 0 ? formatRupiah(-ekuitas) : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{ekuitas > 0 ? formatRupiah(ekuitas) : ""}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t("total")}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(totalDebit + Math.max(0, -ekuitas))}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(totalKredit + Math.max(0, ekuitas))}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        {konteks.bolehMengelola ? (
          <Button variant="outline" size="sm" onClick={() => setBaris((xs) => [...xs, barisBaru()])}>
            <Plus className="h-4 w-4" aria-hidden />
            {t("akun.tambah")}
          </Button>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="catatan-akun">{t("catatan.label")}</Label>
          <Textarea
            id="catatan-akun"
            rows={2}
            maxLength={1000}
            value={catatan}
            disabled={!konteks.bolehMengelola}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder={t("catatan.placeholder")}
          />
        </div>
        <AksiSaldoAwal
          jenis="ACCOUNTS"
          konteks={konteks}
          keadaan={keadaan}
          baris={entri}
          catatan={catatan}
          ekuitas={ekuitas}
          alasanBelum={alasanBelum}
        />
      </CardContent>
    </Card>
  );
}
