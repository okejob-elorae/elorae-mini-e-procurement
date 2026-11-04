"use client";

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { pilihanVarianKirimAction } from "@/app/actions/konsinyasi";
import type { PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";
import type { BarisKurangKirim } from "@/lib/konsinyasi/writer";
import type { PilihanBarang } from "../retur-toko/BarisBarangEditor";
import {
  barisKurang,
  tersediaUntukBaris,
  varianBisaDipilih,
  varianOtomatis,
  type BarisKirimIsian,
  type KeadaanVarian,
} from "./kirim-isian";

const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Pilihan varian per barang, dimuat dari server saat barangnya dipilih (stok per varian
 * tidak ikut dikirim bersama seluruh katalog). Satu permintaan per barang; `segarkan`
 * membuang semuanya sesudah kiriman tersimpan, karena stoknya sudah berubah.
 */
export function useVarianKirim() {
  const [varian, setVarian] = useState<Record<string, KeadaanVarian>>({});
  const janji = useRef(new Map<string, Promise<PilihanVarianKirim | null>>());

  const muat = useCallback((itemId: string, paksa = false): Promise<PilihanVarianKirim | null> => {
    const ada = janji.current.get(itemId);
    if (ada && !paksa) return ada;
    setVarian((lama) => ({ ...lama, [itemId]: { status: "memuat" } }));
    const gagal = () => {
      janji.current.delete(itemId);
      setVarian((lama) => ({ ...lama, [itemId]: { status: "gagal" } }));
      return null;
    };
    const p = pilihanVarianKirimAction(itemId)
      .then((h) => {
        if (!h.ok) return gagal();
        setVarian((lama) => ({ ...lama, [itemId]: { status: "siap", pilihan: h.pilihan } }));
        return h.pilihan;
      })
      .catch(gagal);
    janji.current.set(itemId, p);
    return p;
  }, []);

  const segarkan = useCallback(() => {
    janji.current.clear();
    setVarian({});
  }, []);

  return { varian, muat, segarkan };
}

export function barisKirimKosong(): BarisKirimIsian {
  return { uid: newLocalId(), itemId: null, variantSku: null, itemName: "", qty: 1, price: 0 };
}

/**
 * Penyunting baris "Kirim titipan": satu baris = satu barang + satu ukuran.
 *
 * Berbeda dari penyunting retur: barang katalog langsung KELUAR dari stok gudang saat
 * disimpan, dan stok barang bervarian disimpan per ukuran — jadi ukurannya dipilih di sini
 * (hanya ukuran yang ada stoknya), dan stok tersedianya terlihat sebelum menyimpan.
 */
export function BarisKirimEditor({
  rows,
  onChange,
  katalog,
  varian,
  muatVarian,
  kurang,
  disabled = false,
}: {
  rows: BarisKirimIsian[];
  onChange: Dispatch<SetStateAction<BarisKirimIsian[]>>;
  katalog: PilihanBarang[];
  varian: Record<string, KeadaanVarian>;
  muatVarian: (itemId: string, paksa?: boolean) => Promise<PilihanVarianKirim | null>;
  kurang: BarisKurangKirim[];
  disabled?: boolean;
}) {
  const t = useTranslations("konsinyasi.kirimBaris");
  const tr = useTranslations("storeReturns");
  const tk = useTranslations("konsinyasi");
  const total = rows.reduce((s, r) => s + (Number.isFinite(r.qty) ? r.qty : 0) * (r.price || 0), 0);

  const ubah = (uid: string, patch: Partial<BarisKirimIsian>) =>
    onChange((lama) => lama.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));

  const pilihBarang = (r: BarisKirimIsian, itemId: string) => {
    const dipilih = katalog.find((k) => k.value === itemId);
    ubah(r.uid, { itemId: itemId || null, variantSku: null, itemName: dipilih ? dipilih.nama : r.itemName });
    if (!itemId) return;
    void muatVarian(itemId).then((pilihan) => {
      const sku = pilihan ? varianOtomatis(pilihan) : null;
      if (!sku) return;
      // Hanya bila barisnya masih barang yang sama dan belum dipilih ukurannya.
      onChange((lama) =>
        lama.map((x) => (x.uid === r.uid && x.itemId === itemId && !x.variantSku ? { ...x, variantSku: sku } : x)),
      );
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{tr("itemsLabel")}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onChange((lama) => [...lama, barisKirimKosong()])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {tr("addItem")}
        </Button>
      </div>

      {kurang.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <p className="mb-1 font-medium">{t("shortTitle")}</p>
            <ul className="space-y-0.5 text-sm">
              {kurang.map((k) => (
                <li key={`${k.itemId}::${k.variantSku}`}>
                  {t("shortLine", {
                    item: k.itemName || k.itemId,
                    variant: k.variantLabel ? ` — ${k.variantLabel}` : "",
                    requested: k.requested,
                    available: k.available,
                  })}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const k = r.itemId ? varian[r.itemId] : undefined;
            const tersedia = tersediaUntukBaris(r, k);
            const melebihi = tersedia !== null && Number.isFinite(r.qty) && r.qty > tersedia;
            return (
              <div
                key={r.uid}
                className={cn("space-y-2 rounded-md border p-3", barisKurang(r, kurang) && "border-destructive bg-destructive/[0.04]")}
              >
                <div className="flex gap-2">
                  {/*
                   * Dua isian, seperti penyunting retur: katalog menentukan stok bergerak atau
                   * tidak; namanya yang tercetak di kiriman. Barang di luar katalog tetap bisa
                   * dicatat, tanpa menggerakkan stok.
                   */}
                  <SearchableCombobox
                    options={katalog}
                    value={r.itemId ?? ""}
                    onValueChange={(v) => pilihBarang(r, v)}
                    placeholder={tr("itemPickPlaceholder")}
                    searchPlaceholder={tr("itemSearchPlaceholder")}
                    emptyMessage={tr("itemNoMatch")}
                    disabled={disabled}
                    triggerClassName="w-full min-w-0 flex-1"
                  />
                  <Input
                    value={r.itemName}
                    onChange={(e) => ubah(r.uid, { itemName: e.target.value })}
                    placeholder={tk("shipItemNameOr")}
                    aria-label={tk("shipItemNameOr")}
                    disabled={disabled}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={tr("removeItem")}
                    disabled={disabled}
                    onClick={() => onChange((lama) => lama.filter((x) => x.uid !== r.uid))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  {r.itemId && (
                    <div className="min-w-0 flex-1 space-y-1">
                      <span className="text-xs text-muted-foreground">{t("variant")}</span>
                      <PilihVarian
                        keadaan={k}
                        nilai={r.variantSku ?? ""}
                        disabled={disabled}
                        onPilih={(sku) => ubah(r.uid, { variantSku: sku })}
                        onUlang={() => {
                          if (r.itemId) void muatVarian(r.itemId, true);
                        }}
                      />
                    </div>
                  )}
                  <div className="w-24 space-y-1">
                    <span className="text-xs text-muted-foreground">{t("qty")}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={Number.isFinite(r.qty) ? r.qty : ""}
                      aria-label={t("qty")}
                      disabled={disabled}
                      onChange={(e) => ubah(r.uid, { qty: Number(e.target.value) })}
                    />
                  </div>
                  <div className="w-44 space-y-1">
                    {/* Harga DI TOKO: penilaian barang hilang mengubahnya menjadi
                        harga yang diterima Elorae dengan margin toko. */}
                    <span className="text-xs text-muted-foreground">{tk("shipPriceInStore")}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={r.price}
                      aria-label={tk("shipPriceInStore")}
                      disabled={disabled}
                      onChange={(e) => ubah(r.uid, { price: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {tersedia !== null && (
                  <p className={cn("text-xs", melebihi ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {melebihi ? t("overAvailable", { qty: tersedia }) : t("available", { qty: tersedia })}
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-right text-sm">{tr("itemsTotal", { value: rupiah(total) })}</p>
          <p className="text-xs text-muted-foreground">{t("stockHint")}</p>
        </div>
      )}
    </div>
  );
}

function PilihVarian({
  keadaan,
  nilai,
  disabled,
  onPilih,
  onUlang,
}: {
  keadaan: KeadaanVarian | undefined;
  nilai: string;
  disabled: boolean;
  onPilih: (sku: string) => void;
  onUlang: () => void;
}) {
  const t = useTranslations("konsinyasi.kirimBaris");

  if (!keadaan || keadaan.status === "memuat") {
    return <p className="py-2 text-sm text-muted-foreground">{t("variantLoading")}</p>;
  }
  if (keadaan.status === "gagal") {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-destructive">
        <span>{t("variantLoadFailed")}</span>
        <Button type="button" size="sm" variant="outline" onClick={onUlang}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  const { pilihan } = keadaan;
  if (!pilihan.perluVarian) {
    // Barang polos, atau hanya satu baris stok (penulis memakai baris itu).
    const satu = pilihan.varian[0];
    if (satu) return <p className="py-2 text-sm">{t("variantAuto", { label: satu.label })}</p>;
    if (pilihan.tersediaTanpaVarian === null) return <p className="py-2 text-sm text-destructive">{t("noStock")}</p>;
    return <p className="py-2 text-sm text-muted-foreground">{t("noVariant")}</p>;
  }

  const { tampil, tersembunyi } = varianBisaDipilih(pilihan);
  if (tampil.length === 0) return <p className="py-2 text-sm text-destructive">{t("noStock")}</p>;
  // Varian terpilih yang stoknya kemudian habis tetap terlihat, supaya pilihan tidak hilang diam-diam.
  const terpilihHabis = nilai && !tampil.some((v) => v.sku === nilai) ? pilihan.varian.find((v) => v.sku === nilai) : undefined;
  return (
    <div className="space-y-1">
      <Select value={nilai} onValueChange={onPilih} disabled={disabled}>
        <SelectTrigger className="w-full" aria-label={t("variant")}>
          <SelectValue placeholder={t("variantPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {[...(terpilihHabis ? [terpilihHabis] : []), ...tampil].map((v) => (
            <SelectItem key={v.sku} value={v.sku}>
              {t("variantOption", { label: v.label, qty: v.tersedia })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tersembunyi > 0 && <p className="text-xs text-muted-foreground">{t("variantHidden", { count: tersembunyi })}</p>}
    </div>
  );
}
