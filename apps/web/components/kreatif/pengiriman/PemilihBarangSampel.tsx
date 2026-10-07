"use client";

import { useRef, useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cariBarangSampelAction } from "@/app/actions/kreatif-sampel";
import type { PilihanVarianKirim } from "@/lib/konsinyasi/varian-kirim";
import type { BarangPilihanSampel } from "@/lib/creative/sampel-queries";
import type { KurangStokSampel } from "@/lib/creative/sampel-writer";
import { newLocalId } from "@/lib/pwa/id-lokal";
import { cn } from "@/lib/utils";
import {
  barisKurang,
  labelVarianPendek,
  perluPilihVarian,
  tersediaBaris,
  varianDitawarkan,
  varianOtomatis,
  type BarisIsian,
} from "./isian-pengiriman";

type Props = {
  baris: BarisIsian[];
  onChange: Dispatch<SetStateAction<BarisIsian[]>>;
  /** Pilihan varian + stok tersedia per barang yang sudah diketahui. */
  varian: Record<string, PilihanVarianKirim>;
  onVarian: (itemId: string, pilihan: PilihanVarianKirim) => void;
  kurang?: readonly KurangStokSampel[];
  disabled?: boolean;
};

const JEDA_CARI_MS = 250;

/**
 * Pemilih barang sampel yang ringkas: cari barang jadi (di server), lalu pilih
 * ukuran per baris dari varian yang ADA stoknya — stok tersedia (stok −
 * cadangan) terlihat sebelum paketnya berangkat. Dipakai di baris antrean
 * Sampel dan di dialog panel Pengiriman.
 */
export function PemilihBarangSampel({ baris, onChange, varian, onVarian, kurang = [], disabled = false }: Props) {
  const t = useTranslations("kreatifRuang.sampel.pemilih");
  const [cari, setCari] = useState("");
  const [hasil, setHasil] = useState<BarangPilihanSampel[] | null>(null);
  const [mencari, mulaiCari] = useTransition();
  const [gagal, setGagal] = useState(false);
  const pewaktu = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urutan = useRef(0);

  const jalankanCari = (q: string) => {
    if (pewaktu.current) clearTimeout(pewaktu.current);
    if (!q.trim()) {
      setHasil(null);
      return;
    }
    pewaktu.current = setTimeout(() => {
      const ke = ++urutan.current;
      mulaiCari(async () => {
        const r = await cariBarangSampelAction(q);
        // Jawaban pencarian lama yang datang terlambat tidak menimpa yang baru.
        if (ke !== urutan.current) return;
        setGagal(!r.ok);
        setHasil(r.ok ? r.barang : []);
      });
    }, JEDA_CARI_MS);
  };

  const ubah = (uid: string, patch: Partial<BarisIsian>) => onChange((lama) => lama.map((b) => (b.uid === uid ? { ...b, ...patch } : b)));

  const tambah = (b: BarangPilihanSampel) => {
    onVarian(b.id, b.pilihan);
    const sku = varianOtomatis(b.pilihan);
    const label = sku ? (b.pilihan.varian.find((v) => v.sku === sku)?.label ?? sku) : null;
    onChange((lama) => [
      ...lama,
      {
        uid: newLocalId(),
        itemId: b.id,
        itemName: b.nama,
        variantSku: sku,
        variantLabel: label,
        qty: 1,
        bervarian: b.bervarian || b.pilihan.perluVarian || b.pilihan.varian.length > 0,
      },
    ]);
    setCari("");
    setHasil(null);
  };

  return (
    <div className="space-y-3">
      {baris.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("kosong")}</p>
      ) : (
        <ul className="space-y-2">
          {baris.map((b) => {
            const pilihan = varian[b.itemId];
            const perlu = perluPilihVarian(b, pilihan);
            const tersedia = tersediaBaris(b, pilihan);
            const kurangIni = barisKurang(b, kurang);
            const melebihi = tersedia !== null && Number.isFinite(b.qty) && b.qty > tersedia;
            const tawaran = pilihan && pilihan.varian.length > 0 ? varianDitawarkan(pilihan, b.variantSku) : null;
            return (
              <li
                key={b.uid}
                className={cn("space-y-2 rounded-md border p-2", (kurangIni || melebihi) && "border-destructive bg-destructive/[0.04]")}
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-sm font-medium break-words">{b.itemName}</span>
                  <Input
                    inputMode="numeric"
                    aria-label={t("qty")}
                    value={Number.isFinite(b.qty) ? String(b.qty) : ""}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "");
                      ubah(b.uid, { qty: v ? Number(v) : Number.NaN });
                    }}
                    disabled={disabled}
                    className="h-8 w-16 text-right tabular-nums"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    aria-label={t("hapusBaris")}
                    disabled={disabled}
                    onClick={() => onChange((lama) => lama.filter((x) => x.uid !== b.uid))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {tawaran ? (
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("pilihVarian")}>
                    {tawaran.tampil.map((v) => {
                      const aktif = v.sku === b.variantSku;
                      return (
                        <Button
                          key={v.sku}
                          type="button"
                          size="sm"
                          variant={aktif ? "default" : "outline"}
                          aria-pressed={aktif}
                          disabled={disabled}
                          className="h-7 px-2 text-xs"
                          title={v.label}
                          onClick={() => ubah(b.uid, { variantSku: v.sku, variantLabel: v.label })}
                        >
                          {labelVarianPendek(v.label)}
                          <span className="tabular-nums opacity-70">· {v.tersedia}</span>
                        </Button>
                      );
                    })}
                    {tawaran.tersembunyi > 0 ? (
                      <span className="text-xs text-muted-foreground">{t("tersembunyi", { n: tawaran.tersembunyi })}</span>
                    ) : null}
                  </div>
                ) : null}
                {perlu ? (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{t("varianWajib")}</p>
                ) : kurangIni ? (
                  <p className="text-xs font-medium text-destructive">
                    {t("kurang", { diminta: kurangIni.diminta, tersedia: kurangIni.tersedia })}
                  </p>
                ) : tersedia !== null ? (
                  <p className={cn("text-xs tabular-nums", melebihi ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {tersedia > 0 ? t("tersedia", { n: tersedia }) : t("habis")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-1.5">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={cari}
            onChange={(e) => {
              setCari(e.target.value);
              jalankanCari(e.target.value);
            }}
            placeholder={t("cari")}
            aria-label={t("cari")}
            disabled={disabled}
            className="pl-8"
          />
          {mencari ? <Loader2 className="absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden /> : null}
        </div>
        {hasil !== null ? (
          gagal ? (
            <p className="text-xs text-destructive">{t("gagal")}</p>
          ) : hasil.length === 0 ? (
            <p className="text-xs text-muted-foreground">{mencari ? t("memuat") : t("tidakAda")}</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto rounded-md border">
              {hasil.map((h) => {
                const total = h.pilihan.varian.reduce((s, v) => s + Math.max(0, v.tersedia), 0) + Math.max(0, h.pilihan.tersediaTanpaVarian ?? 0);
                return (
                  <li key={h.id} className="border-b last:border-b-0">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto w-full justify-start gap-2 rounded-none px-2.5 py-2 text-left font-normal"
                      onClick={() => tambah(h)}
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{h.nama}</span>
                        <span className="block truncate text-xs text-muted-foreground">{h.sku}</span>
                      </span>
                      <span className={cn("shrink-0 text-xs tabular-nums", total > 0 ? "text-muted-foreground" : "text-destructive")}>
                        {total > 0 ? t("tersedia", { n: total }) : t("habis")}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
