"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { simpanJendelaIndenAction } from "@/app/actions/inden";
import type { GalatJendela } from "@/lib/field-sales/inden";
import { RentangTanggalInput } from "@/components/ui/rentang-tanggal-input";

export type PilihanBarang = { id: string; sku: string; nameId: string; categoryName: string | null };

export type NilaiAwalJendela = {
  id: string;
  name: string;
  note: string | null;
  /** `YYYY-MM-DD` (hari WIB). */
  opensOn: string;
  closesOn: string;
  shipFrom: string;
  shipTo: string;
  isActive: boolean;
  items: Array<{ itemId: string; sku: string; nameId: string; plannedQty: number | null }>;
};

type BarisBarang = { itemId: string; sku: string; nameId: string; rencana: string };

/**
 * Formulir jendela pre-order — dipakai halaman "baru" dan halaman rincian
 * (ubah). Validasinya diulang di server (`validasiJendela`); di sini hanya
 * mencegah kiriman yang jelas salah dan menerjemahkan penolakan server.
 */
export function FormJendelaInden({
  pilihan,
  awal = null,
  /** Barang yang sudah dipesan toko — tidak bisa dikeluarkan dari jendela. */
  dipesanItemIds = [],
  onSelesai,
}: {
  pilihan: PilihanBarang[];
  awal?: NilaiAwalJendela | null;
  dipesanItemIds?: string[];
  onSelesai?: () => void;
}) {
  const t = useTranslations("inden.form");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(awal?.name ?? "");
  const [note, setNote] = useState(awal?.note ?? "");
  const [opensOn, setOpensOn] = useState(awal?.opensOn ?? "");
  const [closesOn, setClosesOn] = useState(awal?.closesOn ?? "");
  const [shipFrom, setShipFrom] = useState(awal?.shipFrom ?? "");
  const [shipTo, setShipTo] = useState(awal?.shipTo ?? "");
  const [isActive, setIsActive] = useState(awal?.isActive ?? true);
  const [barang, setBarang] = useState<BarisBarang[]>(
    (awal?.items ?? []).map((i) => ({ itemId: i.itemId, sku: i.sku, nameId: i.nameId, rencana: i.plannedQty === null ? "" : String(i.plannedQty) })),
  );
  const [galat, setGalat] = useState<string[]>([]);
  const terkunci = new Set(dipesanItemIds);

  const terpilih = useMemo(() => new Set(barang.map((b) => b.itemId)), [barang]);
  const opsi = useMemo(
    () =>
      pilihan
        .filter((p) => !terpilih.has(p.id))
        .map((p) => ({ value: p.id, label: `${p.sku} — ${p.nameId}${p.categoryName ? ` (${p.categoryName})` : ""}` })),
    [pilihan, terpilih],
  );

  function tambah(id: string) {
    const p = pilihan.find((x) => x.id === id);
    if (!p || terpilih.has(id)) return;
    setBarang((prev) => [...prev, { itemId: p.id, sku: p.sku, nameId: p.nameId, rencana: "" }]);
  }

  function rencanaSah(v: string): boolean {
    return v.trim() === "" || /^\d+$/.test(v.trim());
  }

  const pesanGalat = (kode: GalatJendela) => t(`galat.${kode}`);
  const namaBarang = (ids: string[] | undefined) =>
    (ids ?? []).map((id) => barang.find((b) => b.itemId === id)?.sku ?? pilihan.find((p) => p.id === id)?.sku ?? id).join(", ");

  function simpan() {
    const lokal: string[] = [];
    if (barang.some((b) => !rencanaSah(b.rencana))) lokal.push(pesanGalat("RENCANA_TIDAK_SAH"));
    if (lokal.length > 0) {
      setGalat(lokal);
      return;
    }
    setGalat([]);
    startTransition(async () => {
      try {
        const res = await simpanJendelaIndenAction({
          id: awal?.id ?? null,
          name,
          note,
          opensOn,
          closesOn,
          shipFrom,
          shipTo,
          isActive,
          items: barang.map((b) => ({ itemId: b.itemId, plannedQty: b.rencana.trim() === "" ? null : Number(b.rencana.trim()) })),
        });
        if (res.ok) {
          toast.success(awal ? t("tersimpan") : t("dibuat"));
          if (awal) {
            router.refresh();
            onSelesai?.();
          } else {
            router.push(`/backoffice/inden/${res.id}`);
          }
          return;
        }
        if (res.kode === "TIDAK_SAH") {
          const pesan = res.galat.map(pesanGalat);
          setGalat(pesan);
          toast.error(pesan[0] ?? t("gagal"));
          return;
        }
        const pesan =
          res.kode === "BARANG_SUDAH_DIPESAN" || res.kode === "BARANG_TIDAK_SAH"
            ? t(`tolak.${res.kode}`, { barang: namaBarang("itemIds" in res ? res.itemIds : undefined) })
            : t(`tolak.${res.kode}`);
        setGalat([pesan]);
        toast.error(pesan);
      } catch {
        toast.error(t("gagal"));
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("bagianJendela")}</CardTitle>
          <CardDescription>{t("bagianJendelaIsi")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="inden-nama">{t("nama")}</Label>
            <Input id="inden-nama" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("namaContoh")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inden-buka">{t("masaPesan")}</Label>
            <RentangTanggalInput
              id="inden-buka"
              required
              pilihanCepat={false}
              dari={opensOn}
              sampai={closesOn}
              onChange={({ dari, sampai }) => {
                setOpensOn(dari);
                setClosesOn(sampai);
              }}
            />
            <p className="text-xs text-muted-foreground">{t("tanggalTutupBantu")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inden-kirim">{t("masaKirim")}</Label>
            <RentangTanggalInput
              id="inden-kirim"
              pilihanCepat={false}
              dari={shipFrom}
              sampai={shipTo}
              onChange={({ dari, sampai }) => {
                setShipFrom(dari);
                setShipTo(sampai);
              }}
            />
            <p className="text-xs text-muted-foreground">{t("kirimBantu")}</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="inden-catatan">{t("catatan")}</Label>
            <Textarea id="inden-catatan" value={note} maxLength={1000} rows={2} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex items-start gap-3 sm:col-span-2">
            <Switch id="inden-aktif" checked={isActive} onCheckedChange={setIsActive} />
            <div className="space-y-0.5">
              <Label htmlFor="inden-aktif">{t("aktif")}</Label>
              <p className="text-xs text-muted-foreground">{t("aktifBantu")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("bagianBarang")}</CardTitle>
          <CardDescription>{t("bagianBarangIsi")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xl">
            <Label className="mb-1.5 block">{t("tambahBarang")}</Label>
            <SearchableCombobox
              options={opsi}
              value=""
              onValueChange={tambah}
              placeholder={t("tambahBarangPlaceholder")}
              searchPlaceholder={t("cariBarang")}
              emptyMessage={t("barangTidakDitemukan")}
              triggerClassName="w-full"
            />
          </div>
          {barang.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("belumAdaBarang")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("kolomSku")}</TableHead>
                    <TableHead>{t("kolomNama")}</TableHead>
                    <TableHead className="w-40 text-right">{t("kolomRencana")}</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">{t("hapus")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {barang.map((b) => {
                    const kunci = terkunci.has(b.itemId);
                    return (
                      <TableRow key={b.itemId}>
                        <TableCell className="font-mono text-sm">{b.sku}</TableCell>
                        <TableCell className="min-w-[10rem] whitespace-normal">{b.nameId}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            inputMode="numeric"
                            aria-label={t("rencanaUntuk", { sku: b.sku })}
                            aria-invalid={!rencanaSah(b.rencana)}
                            className="ml-auto w-32 text-right tabular-nums"
                            value={b.rencana}
                            placeholder={t("tanpaRencana")}
                            onChange={(e) =>
                              setBarang((prev) => prev.map((x) => (x.itemId === b.itemId ? { ...x, rencana: e.target.value } : x)))
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={kunci}
                            title={kunci ? t("tidakBisaHapus") : t("hapus")}
                            aria-label={kunci ? t("tidakBisaHapus") : t("hapusBarang", { sku: b.sku })}
                            onClick={() => setBarang((prev) => prev.filter((x) => x.itemId !== b.itemId))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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

      {galat.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-red-800 dark:text-red-300">
          <ul className="list-disc space-y-0.5 pl-5">
            {galat.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {awal && onSelesai && (
          <Button type="button" variant="outline" onClick={onSelesai} disabled={pending}>
            {t("batal")}
          </Button>
        )}
        <Button type="button" onClick={simpan} disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {awal ? t("simpan") : t("buat")}
        </Button>
      </div>
    </div>
  );
}
